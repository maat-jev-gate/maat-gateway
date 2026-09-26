"use client";
/*
 * Single-page swap guard. The form sends a maat_swap request to /api/maat/swap
 * and reads the NDJSON stream: stage events animate the waterfall as they
 * arrive, and the final Decision fills the page. Everything shown comes from
 * that response or from /api/state and /api/chain.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Decision, InstructionSource, Policy, Stage, StreamEvent } from "@/lib/types";
import { Evidence } from "./Evidence";
import { Record, Trail } from "./Forensics";
import { JevCard, RawEvidence, RuleTrace } from "./Judgement";
import { Scale } from "./Scale";
import { Timeline } from "./Timeline";
import {
  CardHead,
  Ext,
  Glyph,
  Icon,
  VERDICTS,
  VERDICT_META,
  VerdictChip,
  addressUrl,
  amount,
  clock,
  duration,
  ms,
  pct,
  short,
  usd,
} from "./ui";

type AppState = {
  policy: Policy;
  integrations: Decision["integrations"];
  watchlistSize: number;
  allowedUsd: number;
  decisions: Decision[];
};
type Chain = { blockNumber: string; ethUsd: number };
type Run = { startedAt: number; stages: Stage[]; token: string };

const PRESETS = [
  { label: "PEPE", address: "0x6982508145454Ce325dDbE47a25d4ec3d2311933" },
  { label: "UNI", address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984" },
];

const SOURCES: { value: InstructionSource; label: string }[] = [
  { value: "social", label: "Social post" },
  { value: "merchant", label: "Merchant message" },
  { value: "owner", label: "Owner" },
];

async function readStream(response: Response, onEvent: (event: StreamEvent) => void) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as StreamEvent);
    if (done) break;
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as StreamEvent);
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function Dashboard() {
  const [app, setApp] = useState<AppState | null>(null);
  const [chain, setChain] = useState<Chain | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [agentId, setAgentId] = useState("demo-agent");
  const [token, setToken] = useState("");
  const [amountText, setAmountText] = useState("8");
  const [unit, setUnit] = useState<"USD" | "ETH">("USD");
  const [source, setSource] = useState<InstructionSource>("social");
  const [instruction, setInstruction] = useState("");
  const running = run !== null;
  const frame = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (response.ok) setApp((await response.json()) as AppState);
  }, []);

  useEffect(() => {
    void refresh();
    const stateTimer = setInterval(() => void refresh(), 2_000);
    const loadChain = () =>
      fetch("/api/chain", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: Chain | null) => body && setChain(body))
        .catch(() => undefined);
    loadChain();
    const timer = setInterval(loadChain, 12_000);
    return () => {
      clearInterval(stateTimer);
      clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    if (!run) return;
    const tick = () => {
      setElapsed(performance.now() - run.startedAt);
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current!);
  }, [run]);

  const decisions = app?.decisions ?? [];
  const selected = decisions.find((decision) => decision.id === selectedId) ?? decisions[0];

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (running) return;
    setError(null);
    const value = Number(amountText);
    const body = {
      agentId,
      chainId: 1,
      tokenIn: "ETH",
      tokenOut: token.trim(),
      ...(unit === "USD" ? { amountUsd: value } : { amountIn: amountText.trim() }),
      source,
      instruction,
      purpose: instruction,
    };
    setRun({ startedAt: performance.now(), stages: [], token: token.trim() });
    setElapsed(0);
    try {
      const response = await fetch("/api/maat/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify(body),
      });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      await readStream(response, (streamEvent) => {
        if (streamEvent.type === "stage") {
          setRun((current) =>
            current
              ? {
                  ...current,
                  stages: [
                    ...current.stages.filter((stage) => stage.key !== streamEvent.stage.key),
                    streamEvent.stage,
                  ],
                }
              : current,
          );
        } else if (streamEvent.type === "decision") {
          setSelectedId(streamEvent.decision.id);
          setApp((current) =>
            current
              ? {
                  ...current,
                  decisions: [
                    streamEvent.decision,
                    ...current.decisions.filter((d) => d.id !== streamEvent.decision.id),
                  ],
                }
              : current,
          );
        } else {
          setError(streamEvent.message);
        }
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRun(null);
      refresh();
    }
  }

  async function resetDemo() {
    await fetch("/api/admin/reset", { method: "POST" });
    setSelectedId(null);
    refresh();
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <Glyph />
          <span className="wordmark">Maat</span>
          <span className="brand-sub">Swap guard for AI agents</span>
        </div>
        <div className="chips">
          <span className="chip">
            <span className="live-dot" aria-hidden="true" />
            Ethereum mainnet
          </span>
          <span className="chip">
            <span className="chip-k">Block</span>
            <span className="num">
              {chain ? `#${Number(chain.blockNumber).toLocaleString("en-US")}` : "…"}
            </span>
          </span>
          <span className="chip">
            <span className="chip-k">ETH</span>
            <span className="num">{chain ? usd(chain.ethUsd) : "…"}</span>
          </span>
          <span className="chip chip-brass">Analysis only · nothing is signed</span>
        </div>
      </header>

      <Integrations app={app} />
      <Kpis app={app} decisions={decisions} />

      <div className="workspace">
        <aside className="side">
          <section className="card" aria-labelledby="form-title">
            <CardHead
              id="form-title"
              title="maat_swap"
              sub="What the agent asks the gate to sign."
            />
            <form className="form" onSubmit={submit}>
              <div className="field">
                <label htmlFor="token">Token to buy (mainnet address)</label>
                <input
                  id="token"
                  className="input mono"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="0x…"
                  spellCheck={false}
                  autoComplete="off"
                  required
                  pattern="^0x[0-9a-fA-F]{40}$"
                />
                <span className="presets">
                  <span className="hint">Try:</span>
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.address}
                      type="button"
                      className="preset"
                      onClick={() => setToken(preset.address)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </span>
              </div>
              <div className="field">
                <span className="label">Pay with ETH</span>
                <div className="row">
                  <input
                    className="input num"
                    inputMode="decimal"
                    value={amountText}
                    onChange={(e) => setAmountText(e.target.value)}
                    aria-label="Amount"
                    required
                  />
                  <span className="seg" role="group" aria-label="Amount unit">
                    {(["USD", "ETH"] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={unit === option}
                        onClick={() => setUnit(option)}
                      >
                        {option}
                      </button>
                    ))}
                  </span>
                </div>
                {chain && Number(amountText) > 0 ? (
                  <span className="hint num">
                    {unit === "USD"
                      ? `≈ ${(Number(amountText) / chain.ethUsd).toPrecision(4)} ETH`
                      : `≈ ${usd(Number(amountText) * chain.ethUsd)}`}
                  </span>
                ) : null}
              </div>
              <div className="field">
                <label htmlFor="source">Instruction came from</label>
                <select
                  id="source"
                  className="select"
                  value={source}
                  onChange={(e) => setSource(e.target.value as InstructionSource)}
                >
                  {SOURCES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="instruction">Instruction text</label>
                <textarea
                  id="instruction"
                  className="textarea"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="What the agent read, e.g. a post telling it to buy now"
                />
              </div>
              <div className="field">
                <label htmlFor="agent">Agent ID</label>
                <input
                  id="agent"
                  className="input"
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  required
                />
              </div>
              <button className="btn btn-primary" type="submit" disabled={running}>
                <Icon name="run" />
                {running ? "Screening…" : "Screen this swap"}
              </button>
              {error ? <p className="form-error">{error}</p> : null}
            </form>
          </section>

          <section aria-labelledby="log-title" className="side">
            <div className="log-head">
              <h2 id="log-title">Decision log</h2>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={resetDemo}
                title="Clear today's allowed total and the log"
              >
                <Icon name="reset" />
                Reset demo data
              </button>
            </div>
            <div className="log-list">
              {decisions.length ? (
                decisions.map((decision) => (
                  <button
                    key={decision.id}
                    type="button"
                    className="log-row"
                    aria-pressed={selected?.id === decision.id && !running}
                    onClick={() => setSelectedId(decision.id)}
                  >
                    <span className="log-pair">{`${usd(decision.intent.amountUsd)} of ETH → ${decision.token?.symbol ?? short(decision.intent.tokenOut)}`}</span>
                    <VerdictChip verdict={decision.verdict} />
                    <span className="log-reason">{decision.reasons[0]}</span>
                    <span className="log-meta">
                      <span className="mono">{clock(decision.createdAt)}</span>
                      <b>{ms(decision.timings.totalMs)}</b>
                      <span>
                        {decision.decidedBy === "jev"
                          ? `JEV ${pct(decision.confidence ?? 0, 0)}`
                          : decision.decidedBy === "rule"
                            ? `rule ${decision.rule}`
                            : "fallback"}
                      </span>
                    </span>
                  </button>
                ))
              ) : (
                <p className="empty-note">No decisions yet. Screen a swap to start.</p>
              )}
            </div>
          </section>
        </aside>

        <main className="detail" aria-live="polite">
          {running ? (
            <Pending run={run} elapsed={elapsed} />
          ) : selected ? (
            <DecisionView decision={selected} />
          ) : (
            <Intro />
          )}
        </main>
      </div>

      <footer className="foot">
        <ol>
          <li>
            <b>Uniswap</b> quotes the route
          </li>
          <li>
            <b>Intercepta</b> screens token and wallets
          </li>
          <li>
            <b>On-chain trace</b> finds the real deployer
          </li>
          <li>
            <b>JEV</b> judges the grey zone
          </li>
          <li>
            <b>World ID</b> brings in the owner
          </li>
        </ol>
        <p>All figures are read live from Ethereum mainnet and the listed APIs for each request.</p>
      </footer>
    </div>
  );
}

function Integrations({ app }: { app: AppState | null }) {
  if (!app) return null;
  const { integrations } = app;
  const item = (on: boolean, label: string, state: string) => (
    <span className="chip" key={label}>
      <span className={`dot ${on ? "on" : "off"}`} aria-hidden="true" />
      <b>{label}</b>
      <span className="chip-k">{state}</span>
    </span>
  );
  return (
    <div className="status" aria-label="Integration status">
      {item(true, "Uniswap", integrations.uniswapApi ? "Trading API" : "on-chain v2/v3 quoter")}
      {item(
        integrations.intercepta,
        "Intercepta",
        integrations.intercepta ? "live" : "not configured",
      )}
      {item(integrations.jev, "JEV", integrations.jev ? "live" : "not configured · fallback only")}
      {item(true, "Explorer", integrations.explorer)}
      {item(app.watchlistSize > 0, "Watchlist", `${app.watchlistSize} addresses`)}
    </div>
  );
}

function Kpis({ app, decisions }: { app: AppState | null; decisions: Decision[] }) {
  const counts = useMemo(
    () =>
      Object.fromEntries(
        VERDICTS.map((verdict) => [verdict, decisions.filter((d) => d.verdict === verdict).length]),
      ) as Record<string, number>,
    [decisions],
  );
  if (!app) return null;
  const { policy } = app;
  const times = decisions.map((decision) => decision.timings.totalMs);
  const used = app.allowedUsd / policy.dailyLimit;
  return (
    <section className="kpis" aria-label="This session">
      <div className="card kpi">
        <p className="eyebrow">Swaps screened (this server session)</p>
        <p className="kpi-value">{decisions.length}</p>
        <div
          className="mix"
          role="img"
          aria-label={VERDICTS.map((v) => `${VERDICT_META[v].label} ${counts[v]}`).join(", ")}
        >
          {VERDICTS.map((verdict) =>
            counts[verdict] ? (
              <span
                key={verdict}
                style={{
                  flex: `${counts[verdict]} 1 0`,
                  background: `var(--${VERDICT_META[verdict].cls})`,
                }}
              />
            ) : null,
          )}
        </div>
        <div className="legend">
          {VERDICTS.map((verdict) => (
            <span key={verdict}>
              <Icon
                name={VERDICT_META[verdict].icon}
                className={`c-${VERDICT_META[verdict].cls}`}
              />
              {VERDICT_META[verdict].label}
              <b>{counts[verdict]}</b>
            </span>
          ))}
        </div>
      </div>
      <div className="card kpi">
        <p className="eyebrow">Allowed today</p>
        <p className="kpi-value">
          {usd(app.allowedUsd)}
          <small>{`/ ${usd(policy.dailyLimit)}`}</small>
        </p>
        <div className="bar-track">
          <span
            className={`bar-fill${used > 1 ? " over" : ""}`}
            style={{ width: `${Math.min(100, used * 100)}%` }}
          />
        </div>
        <p className="kpi-note">Counted toward the daily limit (H3).</p>
      </div>
      <div className="card kpi">
        <p className="eyebrow">Median decision time</p>
        <p className="kpi-value">{times.length ? ms(median(times)) : "—"}</p>
        <p className="kpi-note">
          {times.length
            ? `Measured over ${times.length} decision${times.length === 1 ? "" : "s"}; slowest ${ms(Math.max(...times))}.`
            : "Measured per request."}
        </p>
      </div>
      <div className="card kpi">
        <p className="eyebrow">Policy</p>
        <dl className="policy-list">
          <div>
            <dt>Per swap</dt>
            <dd>{usd(policy.perTxLimit)}</dd>
          </div>
          <div>
            <dt>Daily</dt>
            <dd>{usd(policy.dailyLimit)}</dd>
          </div>
          <div>
            <dt>Hard cap</dt>
            <dd>{usd(policy.hardCap)}</dd>
          </div>
          <div>
            <dt>Max impact</dt>
            <dd>{`${policy.maxPriceImpact}%`}</dd>
          </div>
          <div>
            <dt>JEV threshold</dt>
            <dd>{pct(policy.confidenceThreshold, 0)}</dd>
          </div>
          <div>
            <dt>JEV timeout</dt>
            <dd>1.5 s</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

function Intro() {
  return (
    <section className="card intro">
      <p className="eyebrow">Maat · pre-signing gate</p>
      <h1>
        The agent holds no keys. Every swap is screened, weighed, then signed, blocked, or sent to
        its owner.
      </h1>
      <p>
        Enter a token on Ethereum mainnet and screen a buy. Each request runs live against mainnet:
        nothing on this page is precomputed.
      </p>
      <ol className="steps">
        <li>
          <b>Uniswap quote</b>Route, amount out, and price impact for the exact size.
        </li>
        <li>
          <b>Intercepta</b>Token scan, plus a quick scan of the deployer and its funders.
        </li>
        <li>
          <b>Deployer forensics</b>The real signer behind the launch, its other tokens, and where
          its ETH came from.
        </li>
        <li>
          <b>Rules, then JEV</b>Hard limits first; JEV judges the rest and returns a typed verdict
          with confidence.
        </li>
      </ol>
    </section>
  );
}

function Pending({ run, elapsed }: { run: Run; elapsed: number }) {
  return (
    <>
      <article className="card decision">
        <div className="decision-title">
          <p className="eyebrow">Screening on Ethereum mainnet</p>
          <h1 className="intent-title">
            <span className="who">Collecting evidence for</span>
            <span className="mono" style={{ fontSize: 18 }}>
              {run.token}
            </span>
          </h1>
        </div>
        <div className="verdict-panel">
          <Scale signals={[]} />
          <div className="stamp v-pending">Weighing</div>
          <p className="verdict-caption">{`${ms(elapsed)} so far`}</p>
        </div>
      </article>
      <Timeline stages={run.stages} elapsed={elapsed} running />
    </>
  );
}

function DecisionView({ decision }: { decision: Decision }) {
  const meta = VERDICT_META[decision.verdict];
  const { quote, forensics, token } = decision;
  const symbol = token?.symbol ?? short(decision.intent.tokenOut);
  const facts: [string, React.ReactNode][] = [];
  facts.push([
    "Swap value",
    `${usd(decision.intent.amountUsd)}${decision.ethUsd ? ` at ETH ${usd(decision.ethUsd)}` : ""}`,
  ]);
  if (quote) {
    facts.push(["Quote", `${amount(quote.amountIn)} ETH → ${amount(quote.amountOut)} ${symbol}`]);
    facts.push([
      "Price impact",
      quote.priceImpactPct === null
        ? "not reported"
        : quote.priceImpactPct < 0.01
          ? "< 0.01%"
          : `${quote.priceImpactPct.toFixed(2)}%`,
    ]);
    if (quote.minOut) facts.push(["Min out (2% slippage)", `${amount(quote.minOut)} ${symbol}`]);
    facts.push(["Route", quote.route]);
    facts.push([
      "Quote source",
      quote.provider === "trading-api"
        ? `Uniswap Trading API · ${quote.routing}`
        : `Uniswap contracts via eth_call · block ${quote.blockNumber}`,
    ]);
  } else if (decision.quoteError) {
    facts.push(["Quote", `failed: ${decision.quoteError}`]);
  }
  if (forensics) {
    facts.push(["Token age", duration(forensics.ageSec)]);
    facts.push([
      "Deployer",
      <Ext key="d" href={addressUrl(forensics.deployer)}>
        <span className="mono">{short(forensics.deployer)}</span>
      </Ext>,
    ]);
  }
  if (decision.tokenScan) {
    facts.push([
      "Intercepta token scan",
      decision.tokenScan.error
        ? `failed: ${decision.tokenScan.error}`
        : `${decision.tokenScan.riskLevel} · risk ${decision.tokenScan.riskScore} · ${decision.tokenScan.action}`,
    ]);
  }

  return (
    <>
      <article className="card decision">
        <div className="decision-title">
          <p className="eyebrow">{`Swap intent · ${clock(decision.createdAt)} · Uniswap on Ethereum mainnet`}</p>
          <h1 className="intent-title">
            <span className="who">{`${decision.agentId} wants to swap`}</span>
            {`${usd(decision.intent.amountUsd)} of ETH`}
            <span className="arrow"> → </span>
            <Ext href={addressUrl(decision.intent.tokenOut)}>{symbol}</Ext>
          </h1>
          <ul className="reasons">
            {decision.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
        <div className="decision-facts">
          <dl className="kv">
            {facts.map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="source-line">
            <span className="eyebrow">Instruction</span>
            <span className="tag">{decision.intent.source}</span>
            <span>{decision.intent.instruction || "(no text)"}</span>
          </p>
        </div>
        <div className="verdict-panel">
          <Scale signals={decision.signals} />
          <div key={decision.id} className={`stamp v-${meta.cls}`}>
            <Icon name={meta.icon} />
            {meta.label}
          </div>
          <div className="verdict-meta">
            <div>
              <b>
                {decision.confidence !== undefined
                  ? pct(decision.confidence)
                  : decision.decidedBy === "rule"
                    ? decision.rule
                    : "—"}
              </b>
              <span>
                {decision.confidence !== undefined
                  ? "JEV confidence"
                  : decision.decidedBy === "rule"
                    ? "hard rule"
                    : "fallback"}
              </span>
            </div>
            <div>
              <b>{ms(decision.timings.totalMs)}</b>
              <span>to decide</span>
            </div>
          </div>
          <p className="verdict-caption">{meta.caption}</p>
        </div>
      </article>
      <Timeline
        stages={decision.stages}
        elapsed={decision.timings.totalMs}
        totalMs={decision.timings.totalMs}
        running={false}
      />
      <Evidence decision={decision} />
      {forensics ? (
        <div className="two-up">
          <Trail forensics={forensics} />
          <Record forensics={forensics} />
        </div>
      ) : decision.forensicsError ? (
        <p className="banner error">{`Deployer forensics failed: ${decision.forensicsError}`}</p>
      ) : null}
      <div className="two-up">
        <JevCard decision={decision} />
        <RuleTrace decision={decision} />
      </div>
      <RawEvidence decision={decision} />
    </>
  );
}
