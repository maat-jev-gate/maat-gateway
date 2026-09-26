import { useEffect, useRef, useState } from "react";
import { scenarios, type Scenario } from "./scenarios";

type TimelineItem = { kind: "task" | "activity" | "decision" | "result" | "error"; text: string; label?: string; amountUsd?: number; verdict?: string; status?: string; elapsedMs?: number };
type GatewayDecision = { id?: string; verdict?: string; paymentStatus?: string; error?: string };

export function App() {
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [runningId, setRunningId] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  useEffect(() => { feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" }); }, [timeline]);

  function append(item: TimelineItem) { setTimeline(current => [...current, item]); }

  async function request(path: string): Promise<{ decision: GatewayDecision; status: number }> {
    const response = await fetch(path, { method: "POST", headers: { accept: "application/json" } });
    const decision = await response.json().catch(() => ({})) as GatewayDecision;
    if (!response.ok) throw new Error(decision.error || `Request failed (HTTP ${response.status}).`);
    return { decision, status: response.status };
  }

  async function runPay(scenario: Extract<Scenario, { calls: readonly unknown[] }>) {
    for (const [index, call] of scenario.calls.entries()) {
      append({ kind: "activity", text: `Requesting ${call.label} through Ma'at Gateway.` });
      const startedAt = performance.now();
      let { decision, status } = await request(`/api/demo/scenarios/${scenario.id}/pay/${index}`);
      if (status === 202 && decision.verdict === "ALLOW") {
        const decisionId = decision.id;
        if (!decisionId) throw new Error(`${call.label}: Gateway returned no decision ID.`);
        for (let attempt = 0; attempt < 60 && decision.paymentStatus === "pending"; attempt += 1) {
          await new Promise(resolve => window.setTimeout(resolve, 500));
          const response = await fetch(`/api/demo/decisions/${encodeURIComponent(decisionId)}`, { headers: { accept: "application/json" } });
          if (!response.ok) throw new Error(`${call.label}: decision lookup failed (HTTP ${response.status}).`);
          decision = await response.json() as GatewayDecision;
        }
      }
      append({ kind: "decision", label: call.label, amountUsd: call.amountUsd, verdict: decision.verdict, status: decision.paymentStatus, elapsedMs: Math.round(performance.now() - startedAt), text: JSON.stringify(decision, null, 2) });
      if (decision.paymentStatus === "failed") throw new Error(`${call.label}: ${decision.error || "payment failed"}`);
      if (decision.verdict === "BLOCK") break;
      if (decision.verdict === "ESCALATE") { append({ kind: "result", text: "Human approval is required before this payment can continue." }); break; }
      if (decision.paymentStatus === "pending") throw new Error(`${call.label}: payment is still pending. Check the Gateway decision before retrying.`);
    }
  }

  async function runScenario(scenario: Scenario) {
    if (runningId) return;
    setRunningId(scenario.id);
    append({ kind: "task", text: scenario.task });
    try {
      if ("calls" in scenario) await runPay(scenario);
      else {
        append({ kind: "activity", text: `Requesting ${scenario.swap.tokenIn} to ${scenario.swap.tokenOut} through Ma'at Gateway.` });
        const { decision } = await request(`/api/demo/scenarios/${scenario.id}/swap`);
        append({ kind: "decision", label: scenario.title, amountUsd: scenario.swap.amountUsd, verdict: decision.verdict, text: JSON.stringify(decision, null, 2) });
      }
      append({ kind: "result", text: `${scenario.title}: request finished.` });
    } catch (caught) {
      append({ kind: "error", text: caught instanceof Error ? caught.message : "The scenario failed. Try again." });
    } finally { setRunningId(null); }
  }

  return <main className="shell">
    <header className="topbar"><div className="brand"><span className="mark">◈</span><div><b>MA'AT AGENT</b><small>PAYMENT AND SWAP DEMO</small></div></div><span className={`status ${runningId ? "running" : ""}`}><i />{runningId ? "RUNNING" : "READY"}</span></header>
    <section className="workspace">
      <div className="intro"><p className="eyebrow">AGENT WORKSPACE</p><h1>Agent intents, routed through <em>Ma'at</em>.</h1></div>
      <div className="agent-card"><div className="agent-head"><div className="orb">✦</div><div><b>Atlas Data Buyer</b><span>agentId: maat-demo-agent</span></div><span className="badge">DEMO</span></div>
        <div className="scenario-list" aria-label="Demo scenarios">{scenarios.map(scenario => <button type="button" className="scenario-button" key={scenario.id} onClick={() => void runScenario(scenario)} disabled={runningId !== null} aria-busy={runningId === scenario.id}><span><b>{scenario.title}</b><small>{scenario.service}</small></span><span className="scenario-action">{runningId === scenario.id ? "Running" : "Run"}</span></button>)}</div>
        <div className="chat" ref={feedRef} role="log" aria-live="polite">{timeline.length === 0 && <div className="welcome"><span>AGENT</span><p>Select a scenario to send an intent through Ma'at Gateway.</p></div>}{timeline.map((item, index) => item.kind === "decision" ? <article className={`payment ${item.verdict?.toLowerCase() || ""}`} key={index}><div><span>GATEWAY DECISION</span><b>{item.label}</b></div><strong>${item.amountUsd?.toFixed(3)}</strong><small>{item.verdict || "Decision received"}{item.status ? ` · ${item.status}` : ""}{item.elapsedMs !== undefined ? ` · ${item.elapsedMs} ms` : ""}</small><pre>{item.text}</pre></article> : <div className={`bubble ${item.kind}`} key={index}><span>{item.kind === "task" ? "AGENT INTENT" : item.kind === "activity" ? "GATEWAY CALL" : item.kind === "error" ? "ERROR" : "RESULT"}</span><p>{item.text}</p></div>)}</div>
        <div className="agent-actions"><button type="button" onClick={() => setTimeline([])} disabled={runningId !== null || timeline.length === 0}>Clear activity</button></div>
      </div>
    </section>
    <footer><span>MA'AT GATEWAY / AGENT DEMO</span><span>Gateway authentication stays on the server</span></footer>
  </main>;
}
