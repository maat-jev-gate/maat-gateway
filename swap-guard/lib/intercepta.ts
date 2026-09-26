/*
 * Intercepta (Web3 Antivirus API) adapter.
 *   Quick Scan Address  GET /api/public/v2/extension/account/{address}/quick-scan
 *   Scan Token          GET /api/public/v2/extension/token-intelligence/token/{address}/risks?chainId=1
 *
 * Tier mapping (documented in README):
 *   token   high   = action "block", riskLevel "high", or category malicious/sanctioned
 *           medium = action "warn" or riskLevel "medium"
 *           low    = everything else
 *   address high   = toxicScore >= 80, or a sanction/known-scammer trait
 *           medium = toxicScore >= 40
 *           low    = everything else
 */
import { config } from "./config";
import { errorMessage, fetchJson } from "./http";
import type { InterceptaAddressResult, InterceptaTokenResult, Tier } from "./types";

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: unknown }>();
const HIGH_TRAITS = new Set(["sanction_address", "known_scammer", "blacklist", "rug_pull"]);

type QuickScan = { toxicScore: number; traits: { name: string; risk: number; description: string; txsCount?: number }[] };
type TokenRisks = {
  riskScore: number;
  riskLevel: string;
  category: string;
  trust: string;
  action: string;
  detectors: { code: string; description: string }[];
  buyTax?: { currentValue: number };
  saleTax?: { currentValue: number };
};

async function get<T>(path: string): Promise<{ body: T; cached: boolean }> {
  const useCache = config.interceptaCache();
  const hit = cache.get(path);
  if (useCache && hit && Date.now() - hit.at < CACHE_MS) return { body: hit.value as T, cached: true };
  const body = await fetchJson<T>(`${config.interceptaUrl()}${path}`, {
    headers: { "X-API-KEY": config.interceptaKey(), Accept: "application/json" },
    timeoutMs: 8_000,
  });
  if (useCache) cache.set(path, { at: Date.now(), value: body });
  return { body, cached: false };
}

export function addressTier(scan: QuickScan): Tier {
  if (scan.toxicScore >= 80 || scan.traits.some((trait) => HIGH_TRAITS.has(trait.name) && trait.risk >= 50)) return "high";
  if (scan.toxicScore >= 40) return "medium";
  return "low";
}

export function tokenTier(risks: TokenRisks): Tier {
  if (risks.action === "block" || risks.riskLevel === "high" || risks.category === "malicious" || risks.category === "sanctioned") return "high";
  if (risks.action === "warn" || risks.riskLevel === "medium") return "medium";
  return "low";
}

export async function quickScanAddress(address: string, raw: unknown[]): Promise<InterceptaAddressResult | undefined> {
  if (!config.interceptaKey()) return undefined;
  const startedAt = performance.now();
  const path = `/api/public/v2/extension/account/${address.toLowerCase()}/quick-scan`;
  try {
    const { body, cached } = await get<QuickScan>(path);
    raw.push({ request: { method: "GET", path }, cached, response: body });
    return {
      address,
      tier: addressTier(body),
      toxicScore: body.toxicScore,
      traits: (body.traits ?? []).map(({ name, risk, description }) => ({ name, risk, description })),
      ms: Math.round(performance.now() - startedAt),
      cached,
    };
  } catch (caught) {
    raw.push({ request: { method: "GET", path }, error: errorMessage(caught) });
    return { address, tier: "unknown", toxicScore: null, traits: [], ms: Math.round(performance.now() - startedAt), cached: false, error: errorMessage(caught) };
  }
}

export async function scanToken(address: string, raw: unknown[]): Promise<InterceptaTokenResult | undefined> {
  if (!config.interceptaKey()) return undefined;
  const startedAt = performance.now();
  const path = `/api/public/v2/extension/token-intelligence/token/${address.toLowerCase()}/risks?chainId=1`;
  try {
    const { body, cached } = await get<TokenRisks>(path);
    raw.push({ request: { method: "GET", path }, cached, response: body });
    return {
      tier: tokenTier(body),
      riskScore: body.riskScore,
      riskLevel: body.riskLevel,
      category: body.category,
      trust: body.trust,
      action: body.action,
      detectors: body.detectors ?? [],
      buyTax: body.buyTax?.currentValue,
      sellTax: body.saleTax?.currentValue,
      ms: Math.round(performance.now() - startedAt),
      cached,
    };
  } catch (caught) {
    raw.push({ request: { method: "GET", path }, error: errorMessage(caught) });
    return { tier: "unknown", riskScore: null, detectors: [], ms: Math.round(performance.now() - startedAt), cached: false, error: errorMessage(caught) };
  }
}
