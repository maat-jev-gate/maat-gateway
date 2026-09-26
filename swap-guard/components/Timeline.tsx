"use client";
/* Measured stage timings, drawn as a waterfall. While a request runs, open stages grow with the clock. */
import type { Stage, StageKey } from "@/lib/types";
import { CardHead, ms } from "./ui";

const LANES: { key: StageKey; name: string; hint: string }[] = [
  { key: "price", name: "Token & ETH price", hint: "ERC-20 metadata · Uniswap v3 WETH/USDC" },
  { key: "quote", name: "Uniswap quote", hint: "route · amount out · price impact" },
  { key: "tokenScan", name: "Intercepta token scan", hint: "honeypot · fake · sanctions" },
  { key: "deployer", name: "Find real deployer", hint: "creation tx signer, skip factory" },
  { key: "history", name: "Deployer history", hint: "other launches · dev dumps" },
  { key: "funding", name: "Trace funding", hint: "first ETH in, 2 hops · Intercepta" },
  { key: "jev", name: "JEV decides", hint: "typed verdict + confidence" },
  { key: "enforce", name: "Enforce", hint: "record · analysis only" },
];
const LOOKUPS: StageKey[] = ["quote", "tokenScan", "deployer", "history", "funding"];
const ETH_BLOCK_MS = 12_000;

function niceStep(domain: number) {
  const raw = domain / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((candidate) => candidate >= raw) ?? raw;
  return step;
}

export function Timeline({ stages, elapsed, totalMs, running }: { stages: Stage[]; elapsed: number; totalMs?: number; running: boolean }) {
  const byKey = new Map(stages.map((stage) => [stage.key, stage]));
  const endOf = (stage: Stage) => stage.end ?? elapsed;
  const shown = running ? elapsed : totalMs ?? elapsed;
  const step = niceStep(Math.max(shown, 200));
  const domain = Math.ceil(Math.max(shown, 1) / step) * step;
  const ticks = Array.from({ length: Math.round(domain / step) + 1 }, (_, index) => index * step);

  const lookups = LOOKUPS.map((key) => byKey.get(key)).filter((stage): stage is Stage => Boolean(stage && stage.status !== "skipped" && stage.end !== undefined));
  const windowMs = lookups.length ? Math.max(...lookups.map((stage) => stage.end!)) - Math.min(...lookups.map((stage) => stage.start)) : 0;
  const serialMs = lookups.reduce((total, stage) => total + (stage.end! - stage.start), 0);
  const jev = byKey.get("jev");

  return (
    <section className="card" aria-labelledby="tl-title">
      <CardHead id="tl-title" title="From intent to verdict" sub="Every bar is a measured duration from this request. The lookups run side by side, then the rules and JEV decide." />
      <div className="tl-body">
        <div className="tl-hero">
          <p className="hero-num">
            {shown >= 10_000 ? (shown / 1000).toFixed(1) : Math.round(shown).toLocaleString("en-US")}
            <span className="unit">{shown >= 10_000 ? "s" : "ms"}</span>
          </p>
          <p className="hero-cap">{running ? "running…" : "from request to verdict"}</p>
          <div className="bar-track" role="img" aria-label={`${Math.round((shown / ETH_BLOCK_MS) * 100)}% of one Ethereum block`}>
            <span className={`bar-fill${shown > ETH_BLOCK_MS ? " over" : ""}`} style={{ width: `${Math.min(100, (shown / ETH_BLOCK_MS) * 100)}%` }} />
          </div>
          <p className="hero-cap">{`${Math.round((shown / ETH_BLOCK_MS) * 100)}% of one Ethereum block (12 s)`}</p>
          {!running && lookups.length ? (
            <dl className="tl-facts">
              <div>
                <dt>{`${lookups.length} lookups, in parallel`}</dt>
                <dd>{ms(windowMs)}</dd>
              </div>
              <div>
                <dt>Same lookups one by one</dt>
                <dd>{ms(serialMs)}</dd>
              </div>
              <div>
                <dt>JEV decision</dt>
                <dd>{jev?.status === "done" && jev.end !== undefined ? ms(jev.end - jev.start) : jev?.status === "skipped" ? "not needed" : "fallback"}</dd>
              </div>
            </dl>
          ) : null}
        </div>
        <div className="wf">
          {LANES.map((lane) => {
            const stage = byKey.get(lane.key);
            return (
              <div key={lane.key} className={`wf-lane${lane.key === "jev" ? " is-jev" : ""}`}>
                <div className="wf-label">
                  <span className="wf-name">{lane.name}</span>
                  <span className="wf-hint">{lane.hint}</span>
                </div>
                <div className="wf-track">
                  {!stage ? (
                    running ? null : <span className="wf-skip">not reached</span>
                  ) : stage.status === "skipped" ? (
                    <span className="wf-skip">{stage.note ?? "skipped"}</span>
                  ) : (
                    <>
                      <span
                        className={`wf-bar${stage.status === "running" ? " running" : ""}${stage.status === "failed" ? " failed" : ""}`}
                        style={{ left: `${(stage.start / domain) * 100}%`, width: `${((endOf(stage) - stage.start) / domain) * 100}%` }}
                        title={`${lane.name}: ${stage.start}–${Math.round(endOf(stage))} ms${stage.note ? ` · ${stage.note}` : ""}`}
                      />
                      <span className="wf-val" style={{ left: `${(endOf(stage) / domain) * 100}%` }}>
                        {stage.status === "running" ? "…" : ms(endOf(stage) - stage.start)}
                        {stage.status === "failed" ? " ✕" : ""}
                      </span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          <div className="wf-axis" aria-hidden="true">
            {ticks.map((tick, index) => (
              <span key={tick} style={{ left: `${(tick / domain) * 100}%` }}>
                {index === ticks.length - 1 ? ms(tick) : tick >= 10_000 ? `${tick / 1000}s` : tick}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
