import { config } from "dotenv";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

config();

const port = Number(process.env.PORT ?? 8790);
const network = "eip155:84532";
const asset = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const facilitatorUrl = (process.env.FACILITATOR_URL ?? "https://x402.org/facilitator").replace(/\/$/, "");
const payTo = process.env.MERCHANT_PAY_TO?.trim() ?? "";
const verifyPayTo = process.env.MERCHANT_VERIFY_PAY_TO?.trim() || payTo;
const riskPayTo = process.env.MERCHANT_RISK_PAY_TO?.trim() ?? "";
const allowUnsignedPayment = process.env.DEMO_ALLOW_UNSIGNED_PAYMENT === "true";

type Product = {
  id: string;
  merchantName: string;
  recipient: string;
  priceUsd: string;
  amount: string;
  description: string;
  contentType: string;
};

type PaymentRequirements = {
  scheme: "exact";
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { name: "USDC"; version: "2" };
};

const products: Record<string, Product> = {
  dataset: {
    id: "dataset",
    merchantName: "Dataset seller",
    recipient: payTo,
    priceUsd: "0.001",
    amount: "1000",
    description: "Atlas dataset access",
    contentType: "application/json"
  },
  verifyAccount: {
    id: "verify-account",
    merchantName: "Verification service",
    recipient: verifyPayTo,
    priceUsd: "80.00",
    amount: "80000000",
    description: "Account verification fee",
    contentType: "application/json"
  },
  riskCheck: {
    id: "risk-check",
    merchantName: "Risk recipient",
    recipient: riskPayTo,
    priceUsd: "0.001",
    amount: "1000",
    description: "Risk-screened dataset access",
    contentType: "application/json"
  }
};

const app = Fastify({ logger: true });
type MerchantEvent = {
  id: string;
  createdAt: string;
  method: string;
  path: string;
  status: number;
  product: string;
  amount: string;
  payer?: string;
  txHash?: string;
  demo: boolean;
  message: string;
};
const dataDir = fileURLToPath(new URL("./data/", import.meta.url));
const historyFile = join(dataDir, "history.json");
function loadEvents(): MerchantEvent[] {
  try {
    const parsed = JSON.parse(readFileSync(historyFile, "utf8")) as { events?: MerchantEvent[] };
    if (!Array.isArray(parsed.events)) throw new Error("Invalid Merchant history file.");
    return parsed.events;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
const events = loadEvents();
function saveEvents() {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(`${historyFile}.tmp`, JSON.stringify({ events }, null, 2));
  renameSync(`${historyFile}.tmp`, historyFile);
}

function addEvent(event: Omit<MerchantEvent, "id" | "createdAt">) {
  events.unshift({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...event });
  saveEvents();
}

function encodeBase64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function requirements(product: Product): PaymentRequirements {
  if (!/^0x[\da-f]{40}$/i.test(product.recipient)) throw new Error("Merchant payment recipient is not configured with a valid address.");
  return {
    scheme: "exact",
    network,
    asset,
    amount: product.amount,
    payTo: product.recipient,
    maxTimeoutSeconds: 300,
    extra: { name: "USDC", version: "2" }
  };
}

function sendPaymentRequired(reply: FastifyReply, product: Product) {
  const accepts = [requirements(product)];
  const response = { x402Version: 2, accepts };
  return reply
    .code(402)
    .header("PAYMENT-REQUIRED", encodeBase64Json(response))
    .send({ error: "Payment required", x402Version: 2, accepts });
}

function paymentSignature(request: FastifyRequest): string | undefined {
  const value = request.headers["payment-signature"];
  return Array.isArray(value) ? value[0] : value;
}

async function settlePayment(request: FastifyRequest, product: Product): Promise<{ txHash?: string; demo: boolean }> {
  const signature = paymentSignature(request);
  if (!signature) {
    if (allowUnsignedPayment) return { demo: true };
    throw new PaymentRequiredError();
  }

  const req = requirements(product);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.FACILITATOR_AUTH_TOKEN) headers.authorization = `Bearer ${process.env.FACILITATOR_AUTH_TOKEN}`;

  const verify = await fetch(`${facilitatorUrl}/verify`, {
    method: "POST",
    headers,
    body: JSON.stringify({ x402Version: 2, paymentPayload: decodePayment(signature), paymentRequirements: req })
  });
  const verification = await verify.json().catch(() => ({})) as { isValid?: boolean; invalidReason?: string; invalidMessage?: string };
  if (!verify.ok || verification.isValid !== true) throw new Error(`Payment verification failed: ${verification.invalidReason ?? verify.status}${verification.invalidMessage ? ` (${verification.invalidMessage})` : ""}`);

  const settle = await fetch(`${facilitatorUrl}/settle`, {
    method: "POST",
    headers,
    body: JSON.stringify({ x402Version: 2, paymentPayload: decodePayment(signature), paymentRequirements: req })
  });
  const result = await settle.json().catch(() => ({})) as { success?: boolean; txHash?: string; errorReason?: string; errorMessage?: string };
  if (!settle.ok || result.success !== true) throw new Error(`Payment settlement failed: ${result.errorReason ?? settle.status}${result.errorMessage ? ` (${result.errorMessage})` : ""}`);
  return { txHash: result.txHash, demo: false };
}

function decodePayment(signature: string): unknown {
  try {
    return JSON.parse(Buffer.from(signature, "base64").toString("utf8"));
  } catch {
    throw new Error("PAYMENT-SIGNATURE must be a base64 encoded x402 payment payload");
  }
}

function payerFromPayment(signature: string | undefined): string | undefined {
  if (!signature) return undefined;
  try {
    const decoded = decodePayment(signature) as { payload?: { authorization?: { from?: string } } };
    return decoded.payload?.authorization?.from;
  } catch {
    return undefined;
  }
}

class PaymentRequiredError extends Error {}

async function paidResponse(request: FastifyRequest, reply: FastifyReply, product: Product, data: unknown) {
  try {
    const settlement = await settlePayment(request, product);
    addEvent({ method: request.method, path: request.url, status: 200, product: product.id, amount: product.priceUsd, payer: payerFromPayment(paymentSignature(request)), txHash: settlement.txHash, demo: settlement.demo, message: settlement.demo ? "Demo response without settlement" : "Payment settled" });
    return reply.send({ ...data as object, payment: { network, amount: product.amount, txHash: settlement.txHash, demo: settlement.demo } });
  } catch (error) {
    if (error instanceof PaymentRequiredError) {
      addEvent({ method: request.method, path: request.url, status: 402, product: product.id, amount: product.priceUsd, demo: false, message: "Payment required" });
      return sendPaymentRequired(reply, product);
    }
    const message = error instanceof Error ? error.message : "Payment processing failed";
    addEvent({ method: request.method, path: request.url, status: 402, product: product.id, amount: product.priceUsd, payer: payerFromPayment(paymentSignature(request)), demo: false, message });
    return reply.code(402).send({ error: message });
  }
}

app.register(fastifyStatic, { root: join(fileURLToPath(new URL(".", import.meta.url)), "public") });

app.get("/health", async () => ({ ok: true, service: "maat-x402-merchant", network, configured: Boolean(payTo) }));
app.get("/api/merchant/events", async () => ({
  events,
  merchants: Object.values(products).map(({ id, merchantName, recipient, priceUsd }) => ({ id, name: merchantName, payTo: recipient, priceUsd })),
  network,
  asset
}));
app.delete("/api/merchant/history", async (request, reply) => {
  if (request.headers["x-clear-history"] !== "confirmed") return reply.code(400).send({ error: "Clear confirmation is required." });
  if (!request.headers.origin || new URL(request.headers.origin).host !== request.headers.host) return reply.code(403).send({ error: "Same-origin request required." });
  events.length = 0;
  saveEvents();
  return { cleared: true };
});

app.get<{ Params: { id: string } }>("/merchant/dataset/:id", async (request, reply) => {
  const product = products.dataset;
  return paidResponse(request, reply, product, {
    id: request.params.id,
    title: "Atlas dataset",
    rows: [{ key: "alpha", value: "settled" }, { key: "beta", value: "verified" }]
  });
});

app.post("/merchant/verify-account", async (request, reply) => {
  const product = products.verifyAccount;
  return paidResponse(request, reply, product, { status: "verified", account: "atlas-demo-account" });
});

app.get("/merchant/risk-check", async (request, reply) => {
  if (!riskPayTo) return reply.code(503).send({ error: "MERCHANT_RISK_PAY_TO is not configured." });
  return paidResponse(request, reply, products.riskCheck, { id: "risk-check", title: "Atlas dataset", rows: [] });
});

app.setErrorHandler((error, _request, reply) => {
  const message = error instanceof Error ? error.message : "Internal server error";
  return reply.code(500).send({ error: message });
});

app.setNotFoundHandler((request, reply) => {
  if (request.method === "GET" && request.url === "/") return reply.sendFile("index.html");
  return reply.code(404).send({ error: "Not found" });
});

await app.listen({ port, host: "127.0.0.1" });
console.log(`x402 merchant listening on http://localhost:${port}`);
