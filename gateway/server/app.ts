import { config } from "dotenv";
import Fastify, { type FastifyRequest } from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { isAddress, type Hex } from "viem";
import { gatewaySettings, updateGatewaySettings, type GatewaySettings } from "./settings";
import { checkPaymentRisk, type RiskCheck } from "./intercepta";
import { screenSwap, SwapGuardError, type SwapIntent } from "./swap-guard";
import { isPendingApproval, type ApprovalStatus } from "./approval";
import { evaluateWithJev } from "./jev";
import {
  beginWorldAuthorization,
  exchangeWorldCode,
  verifyWorldToken,
  worldConfigured,
  worldIssuer,
  worldRedirectUri,
  worldResultPage,
} from "./world";

config();

type PayRequest = {
  agentId: string;
  url: string;
  method: string;
  purpose: string;
  payTo?: string;
  authorization?: string;
  taskId: string;
  demoEscalate?: boolean;
};

type DemoScenario = "allow" | "block" | "escalate";
type ApiTrace = { request?: unknown; response?: unknown; status?: number; error?: string };

type PayDecision = {
  id: string;
  createdAt: string;
  agentId: string;
  taskId: string;
  kind: "pay";
  verdict: "ALLOW" | "BLOCK" | "ESCALATE";
  decidedBy: "jev" | "gateway" | "fallback" | "error" | "intercepta" | "demo";
  confidence?: number;
  probability?: number;
  jevVerdict?: "ALLOW" | "BLOCK" | "ESCALATE";
  jevOverride?: "ALLOW" | "BLOCK" | "ESCALATE";
  reasons: string[];
  intent: PayRequest;
  merchant: { status?: number; requirements?: unknown; response?: unknown; payer?: string };
  payer?: string;
  timings: { totalMs: number; merchantMs?: number; jevMs?: number; interceptaMs?: number };
  intercepta?: RiskCheck;
  jevApi?: ApiTrace;
  interceptaOverride?: "ALLOW" | "BLOCK";
  error?: string;
  approvalId?: string;
  intentHash?: string;
  demo?: boolean;
  paymentExecuted?: boolean;
  paymentStatus?: "pending" | "completed" | "failed" | "cancelled";
};
type SwapDecision = {
  id: string;
  kind: "swap";
  createdAt: string;
  agentId: string;
  taskId: string;
  verdict: "ALLOW" | "BLOCK" | "ESCALATE" | "ERROR";
  decidedBy: string;
  reasons: string[];
  intent: SwapIntent;
  timings: {
    totalMs: number;
    interceptaMs?: number;
    uniswapMs?: number;
    forensicsMs?: number;
    jevMs?: number;
  };
  analysisOnly: true;
  approvalId?: string;
  intentHash?: string;
  error?: string;
  quote?: { route?: string };
};
type Decision = PayDecision | SwapDecision;

type ApprovalBase = {
  id: string;
  decisionId: string;
  intentHash: string;
  status: ApprovalStatus;
  createdAt: string;
  expiresAt: string;
  releasedResponse?: unknown;
  worldApi?: ApiTrace;
  demo?: boolean;
};
type Approval = ApprovalBase &
  ({ kind?: "pay"; input: PayRequest } | { kind: "swap"; input: SwapIntent });
type MerchantResult = { status: number; requirements: unknown; response: unknown };
type PaymentRequirements = {
  scheme: "exact";
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { name: string; version: string };
};

const port = Number(process.env.PORT ?? 8787);
const merchantTimeoutMs = Number(process.env.MERCHANT_TIMEOUT_MS ?? 15_000);
const paymentFlowTimeoutMs = Number(process.env.PAYMENT_FLOW_TIMEOUT_MS ?? 60_000);
const staticRoot = fileURLToPath(new URL("../dist", import.meta.url));
const dataDir = fileURLToPath(new URL("../data/", import.meta.url));
const historyFile = join(dataDir, "history.json");
function loadHistory(): { decisions: Decision[]; approvals: Approval[] } {
  try {
    const parsed = JSON.parse(readFileSync(historyFile, "utf8")) as {
      decisions?: Decision[];
      approvals?: Approval[];
    };
    if (!Array.isArray(parsed.decisions) || !Array.isArray(parsed.approvals))
      throw new Error("Invalid Gateway history file.");
    return { decisions: parsed.decisions, approvals: parsed.approvals };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { decisions: [], approvals: [] };
    throw error;
  }
}
const history = loadHistory();
const decisions: Decision[] = history.decisions;
const approvals = new Map(history.approvals.map((approval) => [approval.id, approval]));
function saveHistory() {
  mkdirSync(dataDir, { recursive: true });
  const temporary = `${historyFile}.tmp`;
  writeFileSync(
    temporary,
    JSON.stringify({ decisions, approvals: [...approvals.values()] }, null, 2),
  );
  renameSync(temporary, historyFile);
}
const worldAttempts = new Map<
  string,
  { approvalId: string; intentHash: string; nonce: string; verifier: string; startedAt: number }
>();
const app = Fastify({ logger: true, disableRequestLogging: true, bodyLimit: 64_000 });
app.register(fastifyCors, {
  origin: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type"],
});

function authorized(request: FastifyRequest): boolean {
  const header = request.headers.authorization;
  if (!header?.startsWith("Basic ")) return false;
  const encoded = header.slice("Basic ".length);
  let decoded = "";
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return false;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;
  return (
    decoded.slice(0, separator) === (process.env.GATEWAY_BASIC_USER ?? "demo-agent") &&
    decoded.slice(separator + 1) === (process.env.GATEWAY_BASIC_PASSWORD ?? "")
  );
}

function publicDecision(decision: Decision) {
  return decision;
}

function intentHash(input: PayRequest): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function addDecision(decision: Decision) {
  decisions.unshift(decision);
  saveHistory();
}

async function settleDecisionPayment(
  decision: PayDecision,
  input: PayRequest,
  quote: MerchantResult,
  startedAt: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), paymentFlowTimeoutMs);
  try {
    if (gatewaySettings.bypassRealPayment) {
      decision.paymentStatus = "completed";
      decision.reasons.push("Real payment is bypassed in Gateway settings; this is a dry run.");
      return;
    }
    const requirements = paymentRequirements(quote);
    const original = paymentRequirements(decision.merchant as MerchantResult);
    if (
      ["scheme", "network", "asset", "amount", "payTo", "maxTimeoutSeconds"].some(
        (field) =>
          requirements[field as keyof PaymentRequirements] !==
          original[field as keyof PaymentRequirements],
      ) ||
      requirements.extra.name !== original.extra.name ||
      requirements.extra.version !== original.extra.version
    ) {
      throw new Error("Merchant payment requirements changed after the decision.");
    }
    const risk = gatewaySettings.bypassIntercepta
      ? ({
          status: gatewaySettings.interceptaBypassVerdict === "ALLOW" ? "clear" : "blocked",
          reasons: ["Intercepta bypass result set in Gateway settings."],
          scans: [],
          ms: 0,
        } as RiskCheck)
      : await checkPaymentRisk(requirements, controller.signal);
    decision.intercepta = risk;
    if (gatewaySettings.bypassIntercepta)
      decision.interceptaOverride = gatewaySettings.interceptaBypassVerdict;
    decision.timings.interceptaMs = (decision.timings.interceptaMs ?? 0) + risk.ms;
    if (risk.status !== "clear") {
      decision.verdict = "BLOCK";
      decision.decidedBy = "intercepta";
      throw new Error(`Intercepta ${risk.status}: ${risk.reasons.join("; ")}`);
    }
    const settled = await settleMerchantRequest(input, quote, controller.signal);
    decision.merchant = settled;
    decision.payer = settled.payer;
    decision.paymentExecuted = true;
    decision.paymentStatus = "completed";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payment settlement failed.";
    decision.paymentStatus = "failed";
    decision.error = message;
    decision.reasons.push(message);
  } finally {
    decision.timings.totalMs = Math.round(performance.now() - startedAt);
    if (decisions.includes(decision)) saveHistory();
    clearTimeout(timeout);
  }
}

type Verdict = "ALLOW" | "BLOCK" | "ESCALATE";
async function merchantRequest(input: PayRequest, signal: AbortSignal): Promise<MerchantResult> {
  let response: Response;
  try {
    response = await fetch(input.url, {
      method: input.method,
      signal: AbortSignal.any([signal, AbortSignal.timeout(merchantTimeoutMs)]),
      redirect: "manual",
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown network error";
    throw new Error(`Merchant request failed (${input.method} ${input.url}): ${reason}`);
  }
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    /* Keep non-JSON merchant responses as text. */
  }
  const requirements =
    typeof body === "object" && body !== null && "accepts" in body
      ? (body as { accepts?: unknown }).accepts
      : undefined;
  return { status: response.status, requirements, response: body };
}

function treasuryAccount() {
  const privateKey = process.env.MAAT_TREASURY_PRIVATE_KEY?.trim();
  if (!privateKey || !/^0x[\da-f]{64}$/i.test(privateKey))
    throw new Error("MAAT_TREASURY_PRIVATE_KEY is not configured with a 32-byte hex private key.");
  return privateKeyToAccount(privateKey as Hex);
}

function paymentRequirements(merchant: MerchantResult): PaymentRequirements {
  const body = merchant.response;
  const accepts =
    typeof body === "object" && body !== null && "accepts" in body
      ? (body as { accepts?: unknown }).accepts
      : undefined;
  const requirement = Array.isArray(accepts) ? accepts[0] : undefined;
  if (!requirement || typeof requirement !== "object")
    throw new Error("Merchant did not return x402 payment requirements.");
  const value = requirement as Partial<PaymentRequirements>;
  if (
    value.scheme !== "exact" ||
    typeof value.network !== "string" ||
    typeof value.asset !== "string" ||
    typeof value.amount !== "string" ||
    typeof value.payTo !== "string" ||
    typeof value.maxTimeoutSeconds !== "number" ||
    !value.extra ||
    typeof value.extra.name !== "string" ||
    typeof value.extra.version !== "string"
  )
    throw new Error("Merchant returned unsupported x402 requirements.");
  return value as PaymentRequirements;
}

function chainIdFromNetwork(network: string): number {
  const match = network.match(/^eip155:(\d+)$/);
  if (!match) throw new Error(`Unsupported x402 network: ${network}`);
  return Number(match[1]);
}

function encodePayment(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

async function createPaymentSignature(requirements: PaymentRequirements) {
  const account = treasuryAccount();
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + requirements.maxTimeoutSeconds);
  const authorization = {
    from: account.address,
    to: requirements.payTo as `0x${string}`,
    value: BigInt(requirements.amount),
    validAfter: 0n,
    validBefore,
    nonce: `0x${randomBytes(32).toString("hex")}` as `0x${string}`,
  };
  const signature = await account.signTypedData({
    domain: {
      name: requirements.extra.name,
      version: requirements.extra.version,
      chainId: chainIdFromNetwork(requirements.network),
      verifyingContract: requirements.asset as `0x${string}`,
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: authorization,
  });
  return {
    header: encodePayment({
      x402Version: 2,
      accepted: requirements,
      payload: {
        signature,
        authorization: {
          ...authorization,
          value: authorization.value.toString(),
          validAfter: authorization.validAfter.toString(),
          validBefore: authorization.validBefore.toString(),
        },
      },
    }),
    payer: account.address,
  };
}

async function settleMerchantRequest(
  input: PayRequest,
  quote: MerchantResult,
  signal: AbortSignal,
): Promise<MerchantResult & { payer: string }> {
  const requirements = paymentRequirements(quote);
  const payment = await createPaymentSignature(requirements);
  const response = await fetch(input.url, {
    method: input.method,
    headers: { "PAYMENT-SIGNATURE": payment.header },
    signal: AbortSignal.any([signal, AbortSignal.timeout(merchantTimeoutMs)]),
    redirect: "manual",
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    /* Preserve non-JSON merchant responses. */
  }
  if (!response.ok)
    throw new Error(`Merchant rejected the x402 payment (HTTP ${response.status}).`);
  return { status: response.status, requirements, response: body, payer: payment.payer };
}

app.get("/health", async () => ({
  ok: true,
  service: "maat-gateway",
  decisions: decisions.length,
}));
app.get("/api/maat/decisions", async () => ({ decisions: decisions.map(publicDecision) }));
app.delete("/api/maat/history", async () => {
  decisions.length = 0;
  approvals.clear();
  worldAttempts.clear();
  saveHistory();
  return { cleared: true };
});
app.get<{ Params: { id: string } }>("/api/maat/decisions/:id", async (request, reply) => {
  const decision = decisions.find((item) => item.id === request.params.id);
  if (!decision) return reply.code(404).send({ error: "Decision not found." });
  return decision;
});
app.get("/api/world/config", async () => ({
  configured: worldConfigured(),
  issuer: worldIssuer(),
  redirectUri: worldRedirectUri(),
}));
app.get("/api/maat/settings", async () => ({ ...gatewaySettings }));
app.post<{ Body: Partial<GatewaySettings> }>("/api/maat/settings", async (request) =>
  updateGatewaySettings(request.body ?? {}),
);
app.post<{ Body: { scenario?: DemoScenario; purpose?: string } }>(
  "/api/maat/demo",
  async (request, reply) => {
    const scenario = request.body?.scenario;
    if (!scenario)
      return reply.code(400).send({ error: "scenario must be allow, block, or escalate." });
    const verdict: Verdict =
      scenario === "allow" ? "ALLOW" : scenario === "block" ? "BLOCK" : "ESCALATE";
    const input: PayRequest = {
      agentId: "maat-demo-agent",
      url: gatewaySettings.merchantUrl,
      method: "GET",
      purpose: request.body?.purpose?.trim() || "Purchase one Atlas dataset",
      taskId: `gateway-ui-${scenario}`,
    };
    const startedAt = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), paymentFlowTimeoutMs);
    let merchant: { status?: number; requirements?: unknown; response?: unknown; payer?: string } =
      {};
    try {
      const merchantStartedAt = performance.now();
      if (!gatewaySettings.bypassMerchantRequest)
        merchant = await merchantRequest(input, controller.signal);
      const merchantMs = gatewaySettings.bypassMerchantRequest
        ? undefined
        : Math.round(performance.now() - merchantStartedAt);
      const reasons = [
        gatewaySettings.bypassMerchantRequest
          ? `Simulated ${verdict} result for UI testing. Merchant request was bypassed by Gateway setting.`
          : `Simulated ${verdict} result for UI testing. Merchant was contacted at ${gatewaySettings.merchantUrl}.`,
      ];
      const paymentExecuted = false;
      if (verdict === "ALLOW")
        reasons.push("Demo mode never submits a real payment; this is a dry run.");
      const decision: Decision = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        ...input,
        kind: "pay",
        verdict,
        decidedBy: "gateway",
        reasons,
        intent: input,
        merchant,
        timings: { totalMs: Math.round(performance.now() - startedAt), merchantMs },
        demo: true,
        paymentExecuted,
      };
      if (scenario === "escalate") {
        const approvalId = crypto.randomUUID();
        const hash = intentHash(input);
        const approval: Approval = {
          id: approvalId,
          decisionId: decision.id,
          intentHash: hash,
          input,
          status: "pending",
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 180_000).toISOString(),
          demo: true,
        };
        approvals.set(approvalId, approval);
        decision.approvalId = approvalId;
        decision.intentHash = hash;
        decision.reasons.push("World ID can be opened for this simulated approval.");
        if (gatewaySettings.bypassWorldId)
          decision.reasons.push(
            "World ID is bypassed; click Resolve approval to apply the configured result.",
          );
      }
      addDecision(decision);
      return reply.send(decision);
    } catch (error) {
      return reply
        .code(502)
        .send({ error: error instanceof Error ? error.message : "Demo Merchant request failed." });
    } finally {
      clearTimeout(timeout);
    }
  },
);
app.get<{ Params: { id: string } }>("/api/maat/approvals/:id", async (request, reply) => {
  const approval = approvals.get(request.params.id);
  if (!approval) return reply.code(404).send({ error: "Approval not found." });
  if (approval.status === "pending" && Date.now() > Date.parse(approval.expiresAt)) {
    approval.status = "expired";
    approval.worldApi = { ...approval.worldApi, response: { status: "expired" } };
    saveHistory();
  }
  return approval;
});

app.post<{ Params: { id: string } }>("/api/maat/approvals/:id/cancel", async (request, reply) => {
  const approval = approvals.get(request.params.id);
  if (!approval) return reply.code(404).send({ error: "Approval not found." });
  if (!isPendingApproval(approval))
    return reply.code(409).send({ error: "This approval is no longer pending." });
  approval.status = "cancelled";
  approval.worldApi = { ...approval.worldApi, response: { status: "cancelled" } };
  const decision = decisions.find((item) => item.id === approval.decisionId);
  if (decision) {
    if (decision.kind === "pay") decision.paymentStatus = "cancelled";
    decision.reasons.push(
      decision.kind === "swap"
        ? "Swap analysis approval was cancelled; no trade was executed."
        : "Payment cancelled before World ID approval; nothing was signed.",
    );
  }
  for (const [state, attempt] of worldAttempts) {
    if (attempt.approvalId === approval.id) worldAttempts.delete(state);
  }
  saveHistory();
  return approval;
});

app.post<{ Params: { id: string } }>("/api/maat/approvals/:id/resolve", async (request, reply) => {
  if (!gatewaySettings.bypassWorldId)
    return reply.code(409).send({ error: "World ID bypass is not enabled." });
  const approval = approvals.get(request.params.id);
  if (!approval) return reply.code(404).send({ error: "Approval not found." });
  if (!isPendingApproval(approval))
    return reply.code(409).send({ error: "This approval is no longer pending." });
  const approved = gatewaySettings.worldBypassVerdict === "ALLOW";
  approval.status = approved ? "approved" : "rejected";
  approval.worldApi = {
    request: { mode: "Gateway bypass", configuredResult: gatewaySettings.worldBypassVerdict },
    response: { status: approval.status },
  };
  const decision = decisions.find((item) => item.id === approval.decisionId);
  if (decision) {
    decision.reasons.push(
      `World ID bypass is enabled; approval was ${approval.status} by server setting.`,
    );
    if (approved && approval.kind === "swap") {
      approval.releasedResponse = {
        analysisOnly: true,
        message: "Swap analysis approved; no trade was executed.",
      };
    } else if (approved && approval.kind !== "swap") {
      if (
        approval.demo ||
        gatewaySettings.bypassMerchantRequest ||
        gatewaySettings.bypassRealPayment
      ) {
        approval.releasedResponse = {
          demo: approval.demo === true,
          paymentExecuted: false,
          message: approval.demo
            ? "Simulated approval released."
            : "Approval released without a real Merchant payment.",
        };
      } else {
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          Number(process.env.MERCHANT_TIMEOUT_MS ?? 15000),
        );
        try {
          const quote = await merchantRequest(approval.input, controller.signal);
          if (decision?.kind !== "pay") throw new Error("Payment decision not found.");
          await settleDecisionPayment(decision, approval.input, quote, performance.now());
          approval.releasedResponse = decision.merchant;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Payment processing failed.";
          approval.releasedResponse = { error: message };
          if (decision?.kind === "pay") {
            decision.paymentStatus = "failed";
            decision.error = message;
            decision.reasons.push(message);
          }
        } finally {
          clearTimeout(timeout);
        }
      }
    }
  }
  saveHistory();
  return approval;
});

app.get<{ Params: { id: string } }>(
  "/api/maat/approvals/:id/world/start",
  async (request, reply) => {
    const approval = approvals.get(request.params.id);
    if (!approval) return reply.code(404).send({ error: "Approval not found." });
    if (!isPendingApproval(approval))
      return reply.code(409).send({ error: "This approval is no longer pending." });
    if (gatewaySettings.bypassWorldId)
      return reply.code(409).send({
        error: "World ID bypass is enabled; resolve the approval from the Gateway console.",
      });
    if (!worldConfigured())
      return reply
        .code(503)
        .send({ error: "WORLD_CLIENT_ID and WORLD_CLIENT_SECRET are not configured." });
    const { state, nonce, verifier, url } = await beginWorldAuthorization();
    worldAttempts.set(state, {
      approvalId: approval.id,
      intentHash: approval.intentHash,
      nonce,
      verifier,
      startedAt: Date.now(),
    });
    approval.worldApi = {
      request: {
        method: "OIDC authorization code",
        scope: "openid",
        credential: "orb-v3",
        maxAgeSeconds: 0,
      },
      response: { status: "pending" },
    };
    saveHistory();
    return reply.redirect(url);
  },
);

app.get<{
  Querystring: { code?: string; state?: string; error?: string; error_description?: string };
}>("/auth/world/callback", async (request, reply) => {
  const { code, state, error, error_description: errorDescription } = request.query;
  const attempt = state ? worldAttempts.get(state) : undefined;
  if (state) worldAttempts.delete(state);
  const approval = attempt ? approvals.get(attempt.approvalId) : undefined;
  const failure = (message: string) => {
    if (approval?.status === "pending") {
      approval.status = "rejected";
      approval.worldApi = {
        ...approval.worldApi,
        response: { status: "rejected", error: message },
      };
      saveHistory();
    }
    return reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "no-store")
      .send(worldResultPage("failure", message));
  };
  if (error || !code || !state || !attempt)
    return failure(errorDescription || error || "The World ID verification session expired.");
  if (!approval || approval.intentHash !== attempt.intentHash || !isPendingApproval(approval))
    return failure("This approval is no longer pending.");
  try {
    const exchange = await exchangeWorldCode(code, attempt.verifier);
    approval.worldApi = { ...approval.worldApi, status: exchange.status };
    if (exchange.status < 200 || exchange.status >= 300)
      throw new Error(`World token exchange failed (${exchange.status}).`);
    if (!exchange.idToken) throw new Error("World did not return an ID token.");
    const claims = await verifyWorldToken(exchange.idToken, attempt.nonce);
    if (!claims.sub) throw new Error("Verified World identity has no subject.");
    if (!isPendingApproval(approval)) return failure("This approval is no longer pending.");
    approval.status = "approved";
    approval.worldApi = {
      ...approval.worldApi,
      response: {
        status: "approved",
        verified: true,
        credential: claims.acr,
        methods: claims.amr,
        authenticatedAt: claims.auth_time,
      },
    };
    if (approval.kind === "swap") {
      approval.releasedResponse = {
        analysisOnly: true,
        message: "Swap analysis approved; no trade was executed.",
      };
      const decision = decisions.find((item) => item.id === approval.decisionId);
      decision?.reasons.push(
        "Human approval accepted for this swap analysis; no trade was executed.",
      );
    } else if (approval.demo)
      approval.releasedResponse = { demo: true, message: "Simulated approval released." };
    else {
      const decision = decisions.find((item) => item.id === approval.decisionId);
      if (decision?.kind === "pay") {
        decision.reasons.push("Human approval accepted; payment processing started.");
        void (async () => {
          const controller = new AbortController();
          const timeout = setTimeout(
            () => controller.abort(),
            Number(process.env.MERCHANT_TIMEOUT_MS ?? 15000),
          );
          try {
            const quote = await merchantRequest(approval.input, controller.signal);
            await settleDecisionPayment(decision, approval.input, quote, performance.now());
            approval.releasedResponse = decision.merchant;
          } finally {
            clearTimeout(timeout);
          }
        })().catch((error) => {
          const message = error instanceof Error ? error.message : "Payment processing failed.";
          decision.paymentStatus = "failed";
          decision.error = message;
          decision.reasons.push(message);
          saveHistory();
        });
      }
    }
    saveHistory();
    return reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "no-store")
      .send(worldResultPage("success", "Return to the Gateway window to see the approval update."));
  } catch (caught) {
    approval.status = "rejected";
    approval.worldApi = {
      ...approval.worldApi,
      response: {
        status: "rejected",
        error: caught instanceof Error ? caught.message : "World ID verification failed.",
      },
    };
    saveHistory();
    return failure(caught instanceof Error ? caught.message : "World ID verification failed.");
  }
});

app.post<{ Body: PayRequest }>("/api/maat/pay", async (request, reply) => {
  if (!authorized(request))
    return reply
      .code(401)
      .header("WWW-Authenticate", "Basic realm=maat-gateway")
      .send({ error: "Gateway Basic Auth failed." });
  const input = request.body;
  if (
    !input ||
    typeof input.agentId !== "string" ||
    typeof input.url !== "string" ||
    typeof input.method !== "string" ||
    typeof input.purpose !== "string" ||
    typeof input.taskId !== "string" ||
    (input.payTo !== undefined && !isAddress(input.payTo))
  ) {
    return reply
      .code(400)
      .send({ error: "agentId, url, method, purpose, and taskId are required." });
  }
  if (
    input.demoEscalate !== undefined &&
    (input.demoEscalate !== true ||
      input.agentId !== "maat-demo-agent" ||
      input.taskId !== "demo-payment-escalate")
  ) {
    return reply
      .code(400)
      .send({ error: "demoEscalate is available only for the payment approval demo." });
  }
  const totalStartedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), paymentFlowTimeoutMs);
  let merchant: { status?: number; requirements?: unknown; response?: unknown; payer?: string } =
    {};
  try {
    const merchantStartedAt = performance.now();
    if (!gatewaySettings.bypassMerchantRequest)
      merchant = await merchantRequest(input, controller.signal);
    const merchantMs = gatewaySettings.bypassMerchantRequest
      ? undefined
      : Math.round(performance.now() - merchantStartedAt);
    const requirements = gatewaySettings.bypassMerchantRequest
      ? undefined
      : paymentRequirements(merchant as MerchantResult);
    const recipientMismatch = Boolean(
      input.payTo && requirements && input.payTo.toLowerCase() !== requirements.payTo.toLowerCase(),
    );
    const risk = requirements
      ? gatewaySettings.bypassIntercepta
        ? ({
            status: gatewaySettings.interceptaBypassVerdict === "ALLOW" ? "clear" : "blocked",
            reasons: ["Intercepta bypass result set in Gateway settings."],
            scans: [],
            ms: 0,
          } as RiskCheck)
        : await checkPaymentRisk(requirements, controller.signal)
      : undefined;
    let verdict: Verdict;
    let decidedBy: PayDecision["decidedBy"] = "jev";
    let probability: number | undefined;
    let confidence: number | undefined;
    let jevMs: number | undefined;
    let jevApi: ApiTrace | undefined;
    const reasons: string[] = [];
    if (gatewaySettings.bypassMerchantRequest)
      reasons.push("Merchant request is bypassed by Gateway setting.");
    if (recipientMismatch)
      reasons.push("Merchant payTo does not match the Agent's intended recipient.");
    if (risk)
      reasons.push(
        risk.status === "clear"
          ? "Intercepta recipient check clear."
          : `Intercepta ${risk.status}: ${risk.reasons.join("; ")}`,
      );
    const bypassJev = gatewaySettings.bypassJev;
    if (recipientMismatch) {
      verdict = "BLOCK";
      decidedBy = "gateway";
    } else if (risk && risk.status !== "clear") {
      verdict = "BLOCK";
      decidedBy = "intercepta";
    } else if (bypassJev) {
      verdict = gatewaySettings.jevBypassVerdict;
      decidedBy = "fallback";
      reasons.push(`JEV bypass is enabled; using configured ${verdict} verdict.`);
    } else {
      jevApi = {};
      try {
        const jev = await evaluateWithJev(input, merchant, controller.signal, jevApi);
        probability = jev.probability;
        confidence = jev.confidence;
        jevMs = jev.latencyMs;
        verdict = probability >= 0.8 ? "ALLOW" : probability <= 0.3 ? "BLOCK" : "ESCALATE";
        reasons.push(`JEV intent match probability: ${Math.round(probability * 100)}%.`);
      } catch (caught) {
        jevApi.error = caught instanceof Error ? caught.message : "JEV request failed.";
        verdict = gatewaySettings.jevBypassVerdict;
        decidedBy = "fallback";
        reasons.push(`JEV failed: ${caught instanceof Error ? caught.message : "unknown error"}`);
        reasons.push(`Using the configured ${verdict} result.`);
      }
    }
    const jevVerdict = decidedBy === "jev" ? verdict : undefined;
    if (
      input.demoEscalate &&
      verdict !== "ESCALATE" &&
      decidedBy !== "gateway" &&
      decidedBy !== "intercepta"
    ) {
      verdict = "ESCALATE";
      decidedBy = "demo";
      reasons.push(
        "The approval demo requires owner review when JEV does not escalate the payment.",
      );
    }
    const paymentExecuted = false;
    const decisionId = crypto.randomUUID();
    const decision: PayDecision = {
      id: decisionId,
      createdAt: new Date().toISOString(),
      ...input,
      kind: "pay",
      verdict,
      decidedBy,
      confidence,
      probability,
      jevVerdict,
      jevApi,
      jevOverride:
        decidedBy === "fallback" && bypassJev ? gatewaySettings.jevBypassVerdict : undefined,
      reasons,
      intent: input,
      merchant,
      payer: merchant.payer,
      intercepta: risk,
      interceptaOverride:
        risk && gatewaySettings.bypassIntercepta
          ? gatewaySettings.interceptaBypassVerdict
          : undefined,
      paymentExecuted,
      paymentStatus: verdict === "BLOCK" ? "completed" : "pending",
      timings: {
        totalMs: Math.round(performance.now() - totalStartedAt),
        merchantMs,
        jevMs,
        interceptaMs: risk?.ms,
      },
    };
    if (verdict === "ESCALATE") {
      const approvalId = crypto.randomUUID();
      const hash = intentHash(input);
      const approval: Approval = {
        id: approvalId,
        decisionId,
        intentHash: hash,
        input,
        status: "pending",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 180_000).toISOString(),
      };
      approvals.set(approvalId, approval);
      decision.approvalId = approvalId;
      decision.intentHash = hash;
      decision.reasons.push(
        "Human approval is required before the Merchant response can be released.",
      );
      if (gatewaySettings.bypassWorldId)
        decision.reasons.push(
          "World ID is bypassed; click Resolve approval to apply the configured result.",
        );
    }
    addDecision(decision);
    if (verdict === "ALLOW" && !gatewaySettings.bypassMerchantRequest) {
      void settleDecisionPayment(decision, input, merchant as MerchantResult, totalStartedAt);
    } else if (verdict === "ALLOW" && gatewaySettings.bypassMerchantRequest) {
      reasons.push("Merchant request is bypassed; no payment was submitted.");
    }
    return reply.code(verdict === "BLOCK" ? 200 : 202).send(decision);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gateway decision failed.";
    const decision: Decision = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...input,
      kind: "pay",
      verdict: "ESCALATE",
      decidedBy: "error",
      reasons: [message],
      intent: input,
      merchant,
      timings: { totalMs: Math.round(performance.now() - totalStartedAt) },
      error: message,
    };
    addDecision(decision);
    return reply.code(502).send(decision);
  } finally {
    clearTimeout(timeout);
  }
});

app.post<{ Body: SwapIntent }>("/api/maat/swap", async (request, reply) => {
  if (!authorized(request))
    return reply
      .code(401)
      .header("WWW-Authenticate", "Basic realm=maat-gateway")
      .send({ error: "Gateway Basic Auth failed." });
  const input = request.body;
  if (
    !input ||
    typeof input.agentId !== "string" ||
    !input.agentId.trim() ||
    typeof input.taskId !== "string" ||
    !input.taskId.trim() ||
    typeof input.purpose !== "string" ||
    !input.purpose.trim() ||
    input.chainId !== 1 ||
    typeof input.tokenIn !== "string" ||
    typeof input.tokenOut !== "string" ||
    !isAddress(input.tokenOut) ||
    typeof input.amountUsd !== "number" ||
    !Number.isFinite(input.amountUsd) ||
    input.amountUsd <= 0 ||
    !["owner", "merchant", "social"].includes(input.source) ||
    (input.instruction !== undefined && typeof input.instruction !== "string")
  ) {
    return reply.code(400).send({
      error:
        "A valid agentId, taskId, purpose, mainnet chainId, tokenIn, tokenOut address, positive amountUsd, and source are required.",
    });
  }
  const startedAt = performance.now();
  try {
    const result = await screenSwap(input);
    const decision: SwapDecision = {
      ...(result as SwapDecision),
      id: String(result.id),
      kind: "swap",
      createdAt: String(result.createdAt),
      agentId: input.agentId,
      taskId: input.taskId,
      intent: input,
      verdict: result.verdict as SwapDecision["verdict"],
      decidedBy: String(result.decidedBy),
      reasons: result.reasons as string[],
      analysisOnly: true,
      timings: (result.timings as SwapDecision["timings"]) ?? {
        totalMs: Math.round(performance.now() - startedAt),
      },
    };
    if (decision.verdict === "ESCALATE") {
      const approvalId = crypto.randomUUID();
      const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
      const approval: Approval = {
        kind: "swap",
        id: approvalId,
        decisionId: decision.id,
        intentHash: hash,
        input,
        status: "pending",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 180_000).toISOString(),
      };
      approvals.set(approvalId, approval);
      decision.approvalId = approvalId;
      decision.intentHash = hash;
      decision.reasons.push(
        "Human approval is required for this swap analysis; no trade will be executed.",
      );
    }
    addDecision(decision);
    return reply.header("Cache-Control", "no-store").send(decision);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Swap Guard request failed.";
    const decision: SwapDecision = {
      id: crypto.randomUUID(),
      kind: "swap",
      createdAt: new Date().toISOString(),
      agentId: input.agentId,
      taskId: input.taskId,
      verdict: "ERROR",
      decidedBy: "error",
      reasons: [message],
      intent: input,
      analysisOnly: true,
      timings: { totalMs: Math.round(performance.now() - startedAt) },
      error: message,
    };
    addDecision(decision);
    return reply
      .code(error instanceof SwapGuardError ? error.status : 502)
      .send({ error: message, id: decision.id });
  }
});

app.register(fastifyStatic, { root: staticRoot });
app.setNotFoundHandler((request, reply) => {
  if (request.method === "GET" && !request.url.startsWith("/api/"))
    return reply.sendFile("index.html");
  return reply.code(404).send({ error: "Not found" });
});

await app.listen({ port, host: "127.0.0.1" });
console.log(`Maat Gateway listening on http://127.0.0.1:${port}`);
