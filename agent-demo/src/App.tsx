import { FormEvent, useEffect, useRef, useState } from "react";
import { steps } from "./steps";

type TimelineItem = { kind: "user" | "assistant" | "activity" | "payment" | "summary" | "error"; text: string; step?: number; label?: string; amountUsd?: number; status?: string; elapsedMs?: number };
const exampleTask = "Purchase three Atlas datasets. If the vendor asks for an additional account verification fee, submit it to Ma'at for a decision.";

export function App() {
  const [task, setTask] = useState(exampleTask);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [manualMode, setManualMode] = useState(false);
  const [nextStep, setNextStep] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  useEffect(() => { feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" }); }, [timeline]);

  async function executeStep(index: number, currentTask: string) {
    const step = steps[index];
    setTimeline(current => [...current, { kind: "activity", text: `Calling Ma'at for ${step.label}: ${step.method} ${step.url}` }]);
    const startedAt = performance.now();
    const response = await fetch(`/api/demo/steps/${index}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ task: currentTask }) });
    const elapsedMs = Math.round(performance.now() - startedAt);
    const raw = await response.text();
    let decision: unknown;
    try { decision = raw ? JSON.parse(raw) : {}; } catch { decision = { raw }; }
    if (!response.ok) throw new Error(`Gateway returned HTTP ${response.status} for ${step.label}.`);
    if (response.status === 202) {
      if (typeof decision !== "object" || decision === null || typeof (decision as { id?: unknown }).id !== "string" || !(decision as { id: string }).id) {
        throw new Error(`Gateway returned HTTP 202 without a decision ID for ${step.label}.`);
      }
      const decisionId = (decision as { id: string }).id;
      const decisionEndpoint = `/api/demo/decisions/${encodeURIComponent(decisionId)}`;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        const poll = await fetch(decisionEndpoint, { headers: { accept: "application/json" } });
        if (!poll.ok) throw new Error(`Gateway decision polling failed for ${step.label} (HTTP ${poll.status}).`);
        decision = await poll.json();
        if (typeof decision === "object" && decision !== null && (decision as { paymentStatus?: string }).paymentStatus !== "pending") break;
      }
    }
    const finalStatus = typeof decision === "object" && decision !== null && "paymentStatus" in decision ? String((decision as { paymentStatus: unknown }).paymentStatus) : "complete";
    if (finalStatus === "pending") throw new Error(`${step.label} is still pending after polling. Resume the request with decision id ${(decision as { id: string }).id}.`);
    setTimeline(current => [...current, { kind: "payment", text: JSON.stringify(decision, null, 2), step: index + 1, label: step.label, amountUsd: step.amountUsd, status: finalStatus, elapsedMs }]);
    const verdict = typeof decision === "object" && decision !== null && "verdict" in decision ? String((decision as { verdict: unknown }).verdict) : "decision received";
    setTimeline(current => [...current, { kind: "assistant", text: `${step.label} returned ${verdict}.` }]);
    setNextStep(index + 1);
  }

  async function run(event: FormEvent) {
    event.preventDefault();
    if (running || nextStep >= steps.length || !task.trim()) return;
    setRunning(true); setError("");
    try {
      if (!hasStarted) {
        setTimeline([{ kind: "user", text: task.trim() }, { kind: "assistant", text: "Starting the fixed payment demo through Ma'at Gateway." }]);
        setHasStarted(true);
      }
      const indexes = manualMode ? [nextStep] : steps.slice(nextStep).map((_, index) => nextStep + index);
      for (const index of indexes) await executeStep(index, task.trim());
      if (indexes.at(-1) === steps.length - 1) setTimeline(current => [...current, { kind: "summary", text: "Fixed demo complete." }]);
    } catch (caught) { const message = caught instanceof Error ? caught.message : "Demo failed."; setError(message); setTimeline(current => [...current, { kind: "error", text: message }]); }
    finally { setRunning(false); }
  }

  function resetDemo() {
    if (running) return;
    setTimeline([]); setError(""); setNextStep(0); setHasStarted(false);
  }

  return <main className="shell">
    <header className="topbar"><div className="brand"><span className="mark">◈</span><div><b>MA'AT AGENT</b><small>FIXED PAYMENT DEMO</small></div></div><span className={`status ${running ? "running" : ""}`}><i />{running ? "RUNNING" : "READY"}</span></header>
    <section className="workspace">
      <div className="intro"><p className="eyebrow">01 / AGENT WORKSPACE</p><h1>Payment intent, routed through <em>Ma'at</em>.</h1><p className="lede">A deterministic agent run with four gateway calls.</p></div>
      <div className="agent-card"><div className="agent-head"><div className="orb">✦</div><div><b>Atlas Data Buyer</b><span>agentId: maat-demo-agent</span></div><span className="badge">DEMO</span></div>
        <div className="chat" ref={feedRef}>{timeline.length === 0 && <div className="welcome"><span>AGENT</span><p>Run the fixed payment story through Ma'at Gateway.</p></div>}{timeline.map((item, index) => item.kind === "payment" ? <article className={`payment ${item.status}`} key={index}><div><span>GATEWAY DECISION {String(item.step).padStart(2, "0")}</span><b>{item.label}</b></div><strong>${item.amountUsd?.toFixed(3)}</strong><small>{item.status === "error" ? "Gateway error" : "Decision received"} · {item.elapsedMs} ms</small><pre>{item.text}</pre></article> : <div className={`bubble ${item.kind}`} key={index}><span>{item.kind === "user" ? "YOU" : item.kind === "activity" ? "GATEWAY CALL" : item.kind === "summary" ? "RUN SUMMARY" : item.kind === "error" ? "ERROR" : "AGENT"}</span><p>{item.text}</p></div>)}</div>
        {error && <div className="error-note">{error}</div>}
        <form onSubmit={run} className="composer"><label className="task-field">Task<textarea value={task} onChange={event => setTask(event.target.value)} disabled={running} required /></label><div className="actions"><button className="primary" type="submit" disabled={running || nextStep >= steps.length}>{running ? "Running…" : nextStep >= steps.length ? "Demo complete" : manualMode ? `Run next step (${nextStep + 1}/${steps.length})` : "Run fixed demo"}</button></div><div className="config-divider" /><div className="config-row"><label className="mode-toggle"><input type="checkbox" checked={manualMode} onChange={event => setManualMode(event.target.checked)} disabled={running || hasStarted} /><span>Manual step mode</span><small>Run one gateway call per click.</small></label><button className="reset-button" type="button" onClick={resetDemo} disabled={running}>Reset</button></div></form>
      </div>
    </section>
    <footer><span>MA'AT GATEWAY / AGENT DEMO</span><span>Gateway authentication stays on the server</span></footer>
  </main>;
}
