import { isAddress } from "viem";

const API_URL = "https://api.web3antivirus.io";
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const BASE_MAINNET_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const HIGH_TRAITS = new Set(["sanction_address", "known_scammer", "blacklist", "rug_pull", "drainer"]);
const cache = new Map<string, { expiresAt: number; response: unknown }>();

export type RiskCheck = {
  status: "clear" | "blocked" | "unavailable";
  reasons: string[];
  scans: { kind: "address" | "token"; address: string; chainId?: number; cached: boolean; request: { method: "GET"; path: string }; response: unknown }[];
  ms: number;
};

type Requirements = { payTo: string; asset: string; network: string };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

export function addressRisk(response: unknown): string | undefined {
  const body = record(response);
  const score = body.toxicScore;
  if (typeof score !== "number" || !Number.isFinite(score) || !Array.isArray(body.traits)) throw new Error("Intercepta returned an invalid address scan.");
  if (score >= 80) return `recipient toxic score ${score}`;
  for (const item of body.traits) {
    const trait = record(item);
    const code = text(trait.name).replace(/\s+/g, "_") || text(trait.code).replace(/\s+/g, "_");
    const risk = text(trait.risk);
    if (HIGH_TRAITS.has(code) || HIGH_TRAITS.has(risk)) return `recipient flagged ${code || risk}`;
  }
  return undefined;
}

export function tokenRisk(response: unknown): string | undefined {
  const body = record(response);
  if (typeof body.action !== "string" || typeof body.riskLevel !== "string") throw new Error("Intercepta returned an invalid token scan.");
  if (text(body.action) === "block" || text(body.riskLevel) === "high" || ["malicious", "sanctioned"].includes(text(body.category))) {
    return `payment token flagged ${text(body.action) || text(body.riskLevel)}`;
  }
  return undefined;
}

async function get(path: string, signal?: AbortSignal): Promise<{ response: unknown; cached: boolean }> {
  const key = process.env.INTERCEPTA_API_KEY?.trim();
  if (!key) throw new Error("INTERCEPTA_API_KEY is not configured.");
  const cached = process.env.INTERCEPTA_CACHE?.toLowerCase() === "off" ? undefined : cache.get(path);
  if (cached && cached.expiresAt > Date.now()) return { response: cached.response, cached: true };
  const response = await fetch(`${(process.env.INTERCEPTA_API_URL?.trim() || API_URL).replace(/\/+$/, "")}${path}`, {
    headers: { "X-API-KEY": key, Accept: "application/json" },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Intercepta request failed (HTTP ${response.status}).`);
  const body: unknown = await response.json();
  if (process.env.INTERCEPTA_CACHE?.toLowerCase() !== "off") cache.set(path, { expiresAt: Date.now() + 600_000, response: body });
  return { response: body, cached: false };
}

export async function checkPaymentRisk(requirements: Requirements, signal?: AbortSignal): Promise<RiskCheck> {
  const startedAt = performance.now();
  const scans: RiskCheck["scans"] = [];
  const reasons: string[] = [];
  try {
    if (!isAddress(requirements.payTo) || !isAddress(requirements.asset)) throw new Error("Invalid x402 recipient or token address.");
    const chainId = Number(requirements.network.match(/^eip155:(\d+)$/)?.[1]);
    if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("Invalid x402 network for Intercepta screening.");
    const address = requirements.payTo.toLowerCase();
    const addressPath = `/api/public/v2/extension/account/${address}/quick-scan`;
    const addressScan = await get(addressPath, signal);
    scans.push({ kind: "address", address, request: { method: "GET", path: addressPath }, ...addressScan });
    const addressFlag = addressRisk(addressScan.response);
    if (addressFlag) reasons.push(addressFlag);

    const token = chainId === 84532 && requirements.asset.toLowerCase() === BASE_SEPOLIA_USDC.toLowerCase()
      ? { address: BASE_MAINNET_USDC.toLowerCase(), chainId: 8453 }
      : [1, 8453].includes(chainId) ? { address: requirements.asset.toLowerCase(), chainId } : undefined;
    if (token) {
      const tokenPath = `/api/public/v2/extension/token-intelligence/token/${token.address}/risks?chainId=${token.chainId}`;
      const tokenScan = await get(tokenPath, signal);
      scans.push({ kind: "token", ...token, request: { method: "GET", path: tokenPath }, ...tokenScan });
      const tokenFlag = tokenRisk(tokenScan.response);
      if (tokenFlag) reasons.push(tokenFlag);
    }
    return { status: reasons.length ? "blocked" : "clear", reasons, scans, ms: Math.round(performance.now() - startedAt) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Intercepta screening failed.";
    return { status: "unavailable", reasons: [message], scans, ms: Math.round(performance.now() - startedAt) };
  }
}
