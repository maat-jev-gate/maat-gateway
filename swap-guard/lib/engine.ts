/*
 * maat_swap pipeline for Ethereum mainnet (analysis only).
 *   ① read policy   ② collect evidence in parallel (Uniswap quote, Intercepta
 *   token scan, deployer forensics)   ③ hard rules H1–H5, then JEV for the grey
 *   zone, C for low confidence, F fallback   ④ record the decision.
 * Stage timings are measured and streamed to the page as they happen.
 */
import { parseEther } from "viem";
import { WETH, NATIVE_ETH, checksum, isAddress, tokenInfo } from "./chain";
import { MAINNET_CHAIN_ID, POLICY, config, integrations } from "./config";
import { runForensics } from "./forensics";
import { errorMessage } from "./http";
import { scanToken } from "./intercepta";
import { askJev } from "./jev";
import { buildSignals, fallbackVerdict, formatDuration } from "./signals";
import { recordDecision, spentTodayUsd } from "./store";
import { ethUsdPrice, quoteEthToToken } from "./uniswap";
import type { Decision, Forensics, InterceptaTokenResult, JevResult, QuoteSummary, Rule, Stage, StageKey, StreamEvent, SwapRequest, TokenInfo, Verdict } from "./types";

export class RequestError extends Error {}

function validate(input: SwapRequest) {
  if (!input.agentId?.trim()) throw new RequestError("agentId is required.");
  if (Number(input.chainId) !== MAINNET_CHAIN_ID) throw new RequestError("Only Ethereum mainnet (chainId 1) is supported.");
  const tokenIn = (input.tokenIn ?? "").toLowerCase();
  if (!["eth", NATIVE_ETH, WETH.toLowerCase()].includes(tokenIn)) throw new RequestError("tokenIn must be ETH (native or WETH).");
  if (!isAddress(input.tokenOut ?? "")) throw new RequestError("tokenOut must be a token contract address.");
  if (input.tokenOut.toLowerCase() === WETH.toLowerCase()) throw new RequestError("tokenOut must differ from tokenIn.");
  const amountIn = input.amountIn ? Number(input.amountIn) : NaN;
  const amountUsd = input.amountUsd !== undefined ? Number(input.amountUsd) : NaN;
  if (!(amountIn > 0) && !(amountUsd > 0)) throw new RequestError("Provide amountIn (ETH) or amountUsd greater than zero.");
  if (!["owner", "vendor", "social"].includes(input.source)) throw new RequestError("source must be owner, vendor, or social.");
}

export async function analyzeSwap(input: SwapRequest, emit: (event: StreamEvent) => void = () => {}): Promise<Decision> {
  validate(input);
  const t0 = performance.now();
  const now = () => Math.round(performance.now() - t0);
  const stages = new Map<StageKey, Stage>();
  const stage = (key: StageKey, event: "start" | "done" | "failed" | "skipped", note?: string) => {
    const existing = stages.get(key);
    const next: Stage =
      event === "start"
        ? { key, status: "running", start: now() }
        : { key, status: event === "skipped" ? "skipped" : event, start: existing?.start ?? now(), end: now(), note };
    stages.set(key, next);
    emit({ type: "stage", stage: next });
  };

  const agentId = input.agentId.trim();
  const tokenOut = checksum(input.tokenOut);
  const policy = POLICY;
  const spentBeforeUsd = spentTodayUsd();
  const rawIntercepta: unknown[] = [];
  const reasons: string[] = [];
  const timings: Decision["timings"] = { totalMs: 0 };

  let verdict: Verdict | undefined;
  let rule: Rule | undefined;
  let decidedBy: Decision["decidedBy"] = "rule";

  // H1: agent must be registered and not frozen. Nothing else runs if it fails.
  if (!config.agents().includes(agentId) || config.frozenAgents().includes(agentId)) {
    verdict = "BLOCK";
    rule = "H1";
    reasons.push(config.frozenAgents().includes(agentId) ? `Agent "${agentId}" is frozen.` : `Agent "${agentId}" is not registered.`);
  }

  let token: TokenInfo | undefined;
  let ethUsd: number | undefined;
  let amountEth = input.amountIn ? Number(input.amountIn) : 0;
  let amountUsd = input.amountUsd ? Number(input.amountUsd) : 0;
  let quote: QuoteSummary | undefined;
  let quoteRaw: unknown;
  let quoteError: string | undefined;
  let tokenScan: InterceptaTokenResult | undefined;
  let forensics: Forensics | undefined;
  let forensicsError: string | undefined;

  if (!verdict) {
    stage("price", "start");
    try {
      [token, ethUsd] = await Promise.all([tokenInfo(tokenOut), ethUsdPrice()]);
      if (input.amountUsd && !input.amountIn) amountEth = Number((amountUsd / ethUsd).toFixed(8));
      else amountUsd = Math.round(amountEth * ethUsd * 100) / 100;
      stage("price", "done", `${token.symbol} · ETH $${ethUsd.toFixed(2)}`);
    } catch (caught) {
      stage("price", "failed", errorMessage(caught));
      throw new RequestError(`Could not read the token or the ETH price on mainnet: ${errorMessage(caught)}`);
    }
    const amountWei = parseEther(amountEth.toFixed(18));
    const resolvedToken = token;

    await Promise.all([
      (async () => {
        stage("quote", "start");
        const startedAt = performance.now();
        try {
          const result = await quoteEthToToken(resolvedToken, amountWei);
          quote = result.summary;
          quoteRaw = result.raw;
          stage("quote", "done", quote.provider === "trading-api" ? "Trading API" : "on-chain quoter");
        } catch (caught) {
          quoteError = errorMessage(caught);
          quoteRaw = { error: quoteError };
          stage("quote", "failed", quoteError);
        }
        timings.uniswapMs = Math.round(performance.now() - startedAt);
      })(),
      (async () => {
        if (!config.interceptaKey()) {
          stage("tokenScan", "skipped", "INTERCEPTA_API_KEY not set");
          return;
        }
        stage("tokenScan", "start");
        tokenScan = await scanToken(tokenOut, rawIntercepta);
        timings.interceptaMs = tokenScan?.ms;
        stage("tokenScan", tokenScan?.error ? "failed" : "done", tokenScan?.error ?? `${tokenScan?.tier} risk`);
      })(),
      (async () => {
        try {
          forensics = await runForensics(tokenOut, rawIntercepta, stage);
          timings.forensicsMs = forensics.ms;
        } catch (caught) {
          forensicsError = errorMessage(caught);
        }
      })(),
    ]);
  }

  const signals = verdict ? [] : buildSignals({ source: input.source, quote, maxPriceImpact: policy.maxPriceImpact, tokenScan, forensics });
  const deployerScan = forensics?.fundingPath.find((node) => node.role === "deployer")?.intercepta;

  // H2–H5, in order.
  if (!verdict && tokenScan?.tier === "high") {
    verdict = "BLOCK";
    rule = "H2";
    reasons.push(`Intercepta flags the token as high risk (${tokenScan.detectors.map((d) => d.code).join(", ") || tokenScan.category}).`);
  }
  if (!verdict && deployerScan?.tier === "high") {
    verdict = "BLOCK";
    rule = "H2";
    reasons.push(`Intercepta flags the deployer as high risk (toxicScore ${deployerScan.toxicScore}).`);
  }
  if (!verdict && (amountUsd > policy.hardCap || spentBeforeUsd + amountUsd > policy.dailyLimit)) {
    verdict = "BLOCK";
    rule = "H3";
    reasons.push(
      amountUsd > policy.hardCap
        ? `$${amountUsd.toFixed(2)} is over the $${policy.hardCap} hard cap.`
        : `$${spentBeforeUsd.toFixed(2)} already allowed today + $${amountUsd.toFixed(2)} exceeds the $${policy.dailyLimit} daily limit.`,
    );
  }
  if (!verdict && !quote) {
    verdict = "BLOCK";
    rule = "H4";
    reasons.push(`No Uniswap route could quote this swap${quoteError ? `: ${quoteError}` : "."}`);
  }
  if (!verdict && quote && quote.priceImpactPct !== null && quote.priceImpactPct > policy.maxPriceImpact) {
    verdict = "BLOCK";
    rule = "H4";
    reasons.push(`Price impact ${quote.priceImpactPct.toFixed(2)}% is over the ${policy.maxPriceImpact}% limit.`);
  }
  if (!verdict && amountUsd > policy.perTxLimit) {
    verdict = "ESCALATE";
    rule = "H5";
    reasons.push(`$${amountUsd.toFixed(2)} is over the $${policy.perTxLimit} per-swap limit; the owner must approve.`);
  }

  // J / C / F.
  let jev: JevResult | undefined;
  let jevRaw: unknown;
  let jevError: string | undefined;
  let fallbackNet: number | undefined;
  if (verdict) {
    stage("jev", "skipped", `decided by rule ${rule}`);
  } else {
    if (forensicsError) reasons.push(`Deployer forensics failed: ${forensicsError}`);
    stage("jev", "start");
    if (config.jevKey()) {
      try {
        const answer = await askJev(jevState({ input, agentId, amountUsd, amountEth, token: token!, quote, tokenScan, forensics, signals, spentBeforeUsd }));
        jev = answer.result;
        jevRaw = answer.raw;
        timings.jevMs = jev.latencyMs;
      } catch (caught) {
        jevError = errorMessage(caught);
        jevRaw = { error: jevError };
      }
    } else {
      jevError = "JEV_API_KEY not set";
    }

    if (jev) {
      decidedBy = "jev";
      stage("jev", "done", `${jev.verdict} ${(jev.confidence * 100).toFixed(0)}%`);
      if (jev.confidence < policy.confidenceThreshold) {
        verdict = "ESCALATE";
        rule = "C";
        reasons.push(`JEV said ${jev.verdict} at ${(jev.confidence * 100).toFixed(1)}% confidence, under the ${policy.confidenceThreshold * 100}% threshold; the owner decides.`);
      } else {
        verdict = jev.verdict;
        reasons.push(`JEV: ${jev.verdict} at ${(jev.confidence * 100).toFixed(1)}% confidence.`);
      }
    } else {
      decidedBy = "fallback";
      const fallback = fallbackVerdict(signals);
      verdict = fallback.verdict;
      fallbackNet = fallback.net;
      stage("jev", "failed", `fallback: ${jevError}`);
      reasons.push(`JEV unavailable (${jevError}); fixed-weight fallback net ${fallback.net >= 0 ? "+" : ""}${fallback.net} → ${verdict}.`);
    }
    reasons.push(...topReasons(signals, verdict));
  }

  stage("enforce", "start");
  const decision: Decision = {
    id: crypto.randomUUID(),
    kind: "swap",
    agentId,
    createdAt: new Date().toISOString(),
    verdict: verdict!,
    decidedBy,
    rule,
    confidence: jev?.confidence,
    reasons,
    signals,
    intent: {
      amountUsd,
      network: "eip155:1",
      tokenIn: "ETH",
      tokenOut,
      amountIn: amountEth ? String(amountEth) : "",
      description: input.purpose,
      source: input.source,
      instruction: input.instruction ?? "",
    },
    policy,
    timings,
    raw: { intercepta: rawIntercepta, uniswapQuote: quoteRaw, jev: jevRaw },
    analysisOnly: true,
    stages: [],
    token,
    ethUsd,
    quote,
    quoteError,
    tokenScan,
    forensics,
    forensicsError,
    jev,
    jevError,
    fallbackNet,
    spentBeforeUsd,
    integrations: integrations(),
  };
  stage("enforce", "done", "analysis only · nothing signed");
  decision.timings.totalMs = now();
  decision.stages = [...stages.values()];
  recordDecision(decision);
  emit({ type: "decision", decision });
  return decision;
}

function topReasons(signals: Decision["signals"], verdict: Verdict): string[] {
  const direction = verdict === "ALLOW" ? -1 : 1;
  return signals
    .filter((signal) => signal.weight * direction > 0)
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, 3)
    .map((signal) => `${signal.label}.`);
}

function jevState(ctx: {
  input: SwapRequest;
  agentId: string;
  amountUsd: number;
  amountEth: number;
  token: TokenInfo;
  quote?: QuoteSummary;
  tokenScan?: InterceptaTokenResult;
  forensics?: Forensics;
  signals: Decision["signals"];
  spentBeforeUsd: number;
}) {
  const { forensics } = ctx;
  return {
    task: "Pre-signing check for an AI agent's Uniswap swap on Ethereum mainnet.",
    policy_passed: { per_swap_limit_usd: POLICY.perTxLimit, daily_limit_usd: POLICY.dailyLimit, max_price_impact_pct: POLICY.maxPriceImpact },
    intent: {
      agent: ctx.agentId,
      sell: `${ctx.amountEth} ETH ($${ctx.amountUsd.toFixed(2)})`,
      buy: `${ctx.token.symbol} (${ctx.token.name}) ${ctx.token.address}`,
      instruction_source: ctx.input.source,
      instruction_text: ctx.input.instruction ?? "",
      purpose: ctx.input.purpose ?? "",
    },
    uniswap: ctx.quote ? { price_impact_pct: ctx.quote.priceImpactPct, route: ctx.quote.route } : "no quote",
    intercepta_token_scan: ctx.tokenScan
      ? { risk_score: ctx.tokenScan.riskScore, risk_level: ctx.tokenScan.riskLevel, action: ctx.tokenScan.action, detectors: ctx.tokenScan.detectors }
      : "not available",
    forensics: forensics
      ? {
          token_age: formatDuration(forensics.ageSec),
          launched_through_factory: Boolean(forensics.factory),
          deployer_prior_tokens: forensics.priorTokens.map((row) => ({
            symbol: row.symbol,
            deployer_moved_out_pct: row.movedOutPct,
            first_move_after_launch: row.firstOutAfterSec === null ? null : formatDuration(row.firstOutAfterSec),
            dumped: row.devSold,
          })),
          funding_path: forensics.fundingPath.map((node) => ({
            role: node.role,
            label: node.label?.name ?? (node.label?.tags.join(", ") || null),
            blockscout_scam_flag: node.label?.isScam ?? null,
            intercepta: node.intercepta ? { tier: node.intercepta.tier, toxic_score: node.intercepta.toxicScore, traits: node.intercepta.traits.map((t) => t.name) } : null,
            watchlist: node.watchlist?.label ?? null,
            funded_with_eth: node.edge?.valueEth ?? null,
          })),
        }
      : "forensics failed",
    evidence: ctx.signals.map((signal) => ({ signal: signal.label, detail: signal.value, source: signal.source })),
  };
}
