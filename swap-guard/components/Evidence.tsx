/* "What tipped the scale": every signal, its fixed weight, and where it came from. */
import type { Decision, SignalSource } from "@/lib/types";
import { CardHead, Ext, Icon, signed } from "./ui";

const SOURCE_TEXT: Record<SignalSource, string> = {
  intercepta: "Intercepta",
  uniswap: "Uniswap",
  chain: "On-chain trace",
  policy: "Policy",
  intent: "Intent context",
};

export function Evidence({ decision }: { decision: Decision }) {
  const signals = [...decision.signals].sort((a, b) => b.weight - a.weight);
  if (!signals.length) {
    return (
      <section className="card" aria-labelledby="ev-title">
        <CardHead id="ev-title" title="What tipped the scale" />
        <p className="empty-note">{`Rule ${decision.rule} decided before any evidence was weighed.`}</p>
      </section>
    );
  }
  const maxAbs = Math.max(0.5, ...signals.map((signal) => Math.abs(signal.weight)));
  const dom = maxAbs * 1.3;
  const plus = signals.filter((signal) => signal.weight > 0).reduce((total, signal) => total + signal.weight, 0);
  const minus = signals.filter((signal) => signal.weight < 0).reduce((total, signal) => total + signal.weight, 0);
  const net = plus + minus;
  const missing = [
    !decision.integrations.intercepta ? "Intercepta (no API key)" : null,
    decision.forensicsError ? "deployer forensics (failed)" : null,
  ].filter(Boolean);

  return (
    <section className="card" aria-labelledby="ev-title">
      <CardHead
        id="ev-title"
        title="What tipped the scale"
        sub="Every signal collected for this swap. Bars to the right push toward block, to the left toward allow. Weights are fixed per rule and drive the fallback score; JEV reads the evidence itself."
      />
      <div className="ev-head">
        <span>Signal, evidence and source</span>
        <div className="ev-axis">
          <span>
            <Icon name="allow" className="c-allow" />← Allow
          </span>
          <span>
            Block →<Icon name="block" className="c-block" />
          </span>
        </div>
      </div>
      <div>
        {signals.map((signal) => {
          const width = (Math.abs(signal.weight) / dom) * 50;
          const toBlock = signal.weight >= 0;
          return (
            <div key={signal.key} className="ev-row">
              <div className="ev-text">
                <span className="ev-label">{signal.label}</span>
                <span className="ev-detail">{signal.value}</span>
                <span className="ev-meta">
                  <span className={`tag${signal.source === "intercepta" ? " tag-brass" : ""}`}>{SOURCE_TEXT[signal.source]}</span>
                  {signal.evidenceUrl ? (
                    <Ext href={signal.evidenceUrl}>
                      <span className="muted">evidence ↗</span>
                    </Ext>
                  ) : null}
                </span>
              </div>
              <div className="div-track" title={`${signed(signal.weight)} ${toBlock ? "toward block" : "toward allow"}`}>
                {signal.weight !== 0 ? <span className={`div-bar ${toBlock ? "to-block" : "to-allow"}`} style={{ width: `${width}%` }} /> : null}
                <span className="div-val" style={toBlock ? { left: `calc(${50 + width}% + 6px)` } : { right: `calc(${50 + width}% + 6px)` }}>
                  {signal.weight === 0 ? "0.0" : signed(signal.weight)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="ev-foot">
        <span className="ev-net">
          Net weight<b>{signed(net)}</b>
          {net >= 0 ? "toward block" : "toward allow"}
        </span>
        <span className="muted">
          {`${signed(plus)} block · ${signed(minus)} allow · ${signals.length} signals`}
          {missing.length ? ` · missing: ${missing.join(", ")}` : ""}
        </span>
      </div>
    </section>
  );
}
