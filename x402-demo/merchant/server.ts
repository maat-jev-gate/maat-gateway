import { config } from "dotenv";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

config();

const port = Number(process.env.PORT ?? 8790);
const network = "eip155:84532";
const asset = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const facilitatorUrl = (process.env.FACILITATOR_URL ?? "https://x402.org/facilitator").replace(/\/$/, "");
const payTo = process.env.MERCHANT_PAY_TO?.trim() ?? "";
const allowUnsignedPayment = process.env.DEMO_ALLOW_UNSIGNED_PAYMENT === "true";

type Product = {
  id: string;
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
    priceUsd: "0.001",
    amount: "1000",
    description: "Atlas dataset access",
    contentType: "application/json"
  },
  verifyAccount: {
    id: "verify-account",
    priceUsd: "80.00",
    amount: "80000000",
    description: "Account verification fee",
    contentType: "application/json"
  }
};

const app = Fastify({ logger: true });
const events: Array<{
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
}> = [];

function addEvent(event: Omit<(typeof events)[number], "id" | "createdAt">) {
  events.unshift({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...event });
  if (events.length > 50) events.pop();
}

function encodeBase64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function requirements(product: Product): PaymentRequirements {
  if (!payTo) throw new Error("MERCHANT_PAY_TO is not configured");
  return {
    scheme: "exact",
    network,
    asset,
    amount: product.amount,
    payTo,
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

app.get("/health", async () => ({ ok: true, service: "maat-x402-vendor", network, configured: Boolean(payTo) }));
app.get("/api/merchant/events", async () => ({ events, payTo, network, asset }));

app.get<{ Params: { id: string } }>("/vendor/atlas/dataset/:id", async (request, reply) => {
  const product = products.dataset;
  return paidResponse(request, reply, product, {
    id: request.params.id,
    title: "Atlas dataset",
    rows: [{ key: "alpha", value: "settled" }, { key: "beta", value: "verified" }]
  });
});

app.post("/vendor/atlas/verify-account", async (request, reply) => {
  const product = products.verifyAccount;
  return paidResponse(request, reply, product, { status: "verified", account: "atlas-demo-account" });
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
console.log(`x402 vendor listening on http://localhost:${port}`);
