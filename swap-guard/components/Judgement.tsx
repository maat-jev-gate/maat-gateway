/* JEV output, the rule trace (H1–H5, J, C, F), and the raw responses behind the decision. */
import type { Decision, Rule } from "@/lib/types";
import { CardHead, Icon, VERDICTS, VERDICT_META, ms, pct, signed, usd } from "./ui";

export function JevCard({ decision }: { decision: Decision }) {
  const { jev } = decision;
  if (!jev) {
    const skipped = decision.decidedBy === "rule";
    return (
      <section className="card" aria-labelledby="jev-title">
        <CardHead
          id="jev-title"
          title="JEV output"
          sub="JEV picks one typed option and returns a probability for each. It cannot answer in free text."
        />
        {skipped ? (
          <p className="empty-note">{`Not asked: hard rule ${decision.rule} decided first. JEV only judges the grey zone.`}</p>
        ) : (
          <>
            <p className="empty-note">
              <span className="tag tag-warn">fallback</span>
              {` JEV unavailable: ${decision.jevError ?? "unknown error"}. The verdict came from the fixed signal weights (net ${signed(decision.fallbackNet ?? 0)}; ≥ +1.5 blocks, ≤ −0.5 allows, otherwise escalates).`}
            </p>
          </>
        )}
      </section>
    );
  }
  return (
    <section className="card" aria-labelledby="jev-title">
      <CardHead
        id="jev-title"
        title="JEV output"
        sub="JEV picks one typed option and returns a probability for each. It cannot answer in free text."
      />
      <div className="probs">
        {VERDICTS.map((verdict) => {
          const p = jev.probabilities[verdict] ?? 0;
          const meta = VERDICT_META[verdict];
          return (
            <div key={verdict} className={`prob${verdict === jev.verdict ? " is-top" : ""}`}>
              <span className="prob-name">
                <Icon name={meta.icon} className={`c-${meta.cls}`} />
                {meta.label}
              </span>
              <div className="prob-track">
                <span
                  className="prob-bar"
                  style={{ width: `${p * 100}%`, background: `var(--${meta.cls})` }}
                />
                <span className="prob-val" style={{ left: `${p * 100}%` }}>
                  {pct(p)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <pre className="code" aria-label="Typed JEV output">
        {"decide(swap_intent) → {\n"}
        {"  verdict:    "}
        <span className="s">{`"${jev.verdict}"`}</span>
        {",\n  p(verdict):  "}
        <span className="s">{jev.probability.toFixed(3)}</span>
        {",\n  confidence: "}
        <span className="s">{jev.confidence.toFixed(3)}</span>
        <span className="c">{"  // JEV's own certainty; rule C"}</span>
        {",\n  rug_risk:   "}
        <span className="s">{jev.riskScore === undefined ? "null" : jev.riskScore.toFixed(2)}</span>
        <span className="c">{"  // 0 none … 4 severe"}</span>
        {",\n  latency_ms: "}
        <span className="s">{jev.latencyMs}</span>
        {"\n}"}
      </pre>
      <p className="note">{`Model ${jev.model ?? "unknown"}. Confidence below ${pct(decision.policy.confidenceThreshold, 0)} is escalated to a human (rule C).`}</p>
    </section>
  );
}

type RowState = "pass" | "hit" | "ran" | "idle";

export function RuleTrace({ decision }: { decision: Decision }) {
  const { policy, intent } = decision;
  const order: (Rule | "J" | "F")[] = ["H1", "H2", "H3", "H4", "H5", "J", "C", "F"];
  const hitIndex = decision.rule && decision.rule !== "C" ? order.indexOf(decision.rule) : -1;
  const state = (id: (typeof order)[number], index: number): RowState => {
    if (hitIndex >= 0) return index < hitIndex ? "pass" : index === hitIndex ? "hit" : "idle";
    if (id === "J")
      return decision.decidedBy === "jev" ? (decision.rule === "C" ? "ran" : "hit") : "idle";
    if (id === "C")
      return decision.rule === "C" ? "hit" : decision.decidedBy === "jev" ? "pass" : "idle";
    if (id === "F") return decision.decidedBy === "fallback" ? "hit" : "idle";
    return "pass";
  };
  const text: Record<(typeof order)[number], string> = {
    H1: `Agent "${decision.agentId}" registered and not frozen`,
    H2: "Intercepta: token and deployer not high risk",
    H3: `${usd(intent.amountUsd)} ≤ ${usd(policy.hardCap)} cap; ${usd(decision.spentBeforeUsd)} + this ≤ ${usd(policy.dailyLimit)}/day`,
    H4: `Uniswap price impact ≤ ${policy.maxPriceImpact}%`,
    H5: `${usd(intent.amountUsd)} ≤ ${usd(policy.perTxLimit)} per swap (else escalate)`,
    J: "JEV judges the remaining grey zone",
    C: `JEV confidence ≥ ${pct(policy.confidenceThreshold, 0)} (else escalate)`,
    F: "Fallback: fixed weights if JEV times out or is unavailable",
  };
  const label: Record<RowState, string> = { pass: "pass", hit: "decided", ran: "ran", idle: "—" };
  return (
    <section className="card" aria-labelledby="rules-title">
      <CardHead
        id="rules-title"
        title="Rule trace"
        sub="Hard rules run first, in a fixed order. Whatever they do not settle goes to JEV."
      />
      <ol className="rules">
        {order.map((id, index) => {
          const current = state(id, index);
          return (
            <li key={id} className={`rule ${current}`}>
              <span className="rule-id">{id}</span>
              <span>{text[id]}</span>
              <span className="rule-state">{label[current]}</span>
            </li>
          );
        })}
      </ol>
      <p className="note">{`Decided by ${decision.decidedBy}${decision.rule ? ` (${decision.rule})` : ""} in ${ms(decision.timings.totalMs)}.`}</p>
    </section>
  );
}

export function RawEvidence({ decision }: { decision: Decision }) {
  const blocks: [string, unknown][] = [
    ["Uniswap quote response", decision.raw.uniswapQuote],
    [
      "Intercepta responses",
      decision.raw.intercepta?.length
        ? decision.raw.intercepta
        : decision.integrations.intercepta
          ? []
          : "INTERCEPTA_API_KEY not set",
    ],
    [
      "JEV response",
      decision.raw.jev ?? (decision.decidedBy === "rule" ? "not asked" : decision.jevError),
    ],
    ["Full decision", { ...decision, raw: "(shown above)" }],
  ];
  return (
    <section className="card" aria-labelledby="raw-title">
      <CardHead
        id="raw-title"
        title="Raw evidence"
        sub="The unedited responses behind this decision."
      />
      {blocks.map(([title, value]) => (
        <details key={title} className="raw">
          <summary>{title}</summary>
          <pre>{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>
        </details>
      ))}
    </section>
  );
}
