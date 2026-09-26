import { useEffect, useRef, useState } from "react";
import { scenarios, type Scenario } from "./scenarios";

type PurchasedData = { id?: string; title?: string; rows?: { key: string; value: string }[]; payment?: { txHash?: string; demo?: boolean } };
type TimelineItem = { kind: "task" | "activity" | "decision" | "result" | "error"; text: string; label?: string; amountUsd?: number; verdict?: string; status?: string; elapsedMs?: number; data?: PurchasedData; approvalId?: string; decisionId?: string; decidedBy?: string; reasons?: string[] };
type GatewayDecision = { id?: string; verdict?: string; paymentStatus?: string; error?: string; approvalId?: string; decidedBy?: string; reasons?: string[]; merchant?: { status?: number; response?: PurchasedData } };
type GatewayInfo = { url: string; endpoints: { pay: string; swap: string } };

export function App() {
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [gatewayInfo, setGatewayInfo] = useState<GatewayInfo | null>(null);
  const [gatewayError, setGatewayError] = useState(false);
  const [worldConfigured, setWorldConfigured] = useState<boolean | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  useEffect(() => { feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" }); }, [timeline]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/demo/gateway", { signal: controller.signal })
      .then(response => response.ok ? response.json() as Promise<GatewayInfo> : Promise.reject(new Error("Gateway details unavailable.")))
      .then(setGatewayInfo)
      .catch(() => { if (!controller.signal.aborted) setGatewayError(true); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!timeline.some(item => item.approvalId && item.status === "pending")) return;
    const timer = window.setInterval(() => {
      for (const item of timeline) {
        if (!item.approvalId || !item.decisionId || item.status !== "pending") continue;
        void Promise.all([
          fetch(`/api/demo/decisions/${item.decisionId}`).then(response => response.ok ? response.json() as Promise<GatewayDecision> : Promise.reject()),
          fetch(`/api/demo/approvals/${item.approvalId}`).then(response => response.ok ? response.json() as Promise<{ status: string }> : Promise.reject()),
        ]).then(([decision, approval]) => {
          const status = decision.paymentStatus === "completed" || decision.paymentStatus === "failed" ? decision.paymentStatus : approval.status === "pending" || approval.status === "approved" ? "pending" : approval.status;
          if (status !== "pending") setTimeline(current => current.map(entry => entry.decisionId === item.decisionId ? { ...entry, status, data: status === "completed" && decision.merchant?.status === 200 ? decision.merchant.response : undefined, reasons: decision.reasons } : entry));
        }).catch(() => {});
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [timeline]);
  useEffect(() => {
    if (!timeline.some(item => item.approvalId)) return;
    void fetch("/api/demo/world/config").then(response => response.ok ? response.json() as Promise<{ configured: boolean }> : Promise.reject()).then(config => setWorldConfigured(config.configured)).catch(() => setWorldConfigured(false));
  }, [timeline.some(item => item.approvalId)]);

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
      append({ kind: "decision", label: call.label, amountUsd: call.amountUsd, verdict: decision.verdict, status: decision.paymentStatus, elapsedMs: Math.round(performance.now() - startedAt), decidedBy: decision.decidedBy, reasons: decision.reasons, approvalId: decision.approvalId, decisionId: decision.id, data: decision.paymentStatus === "completed" && decision.merchant?.status === 200 ? decision.merchant.response : undefined, text: "" });
      if (decision.paymentStatus === "failed") throw new Error(`${call.label}: ${decision.error || "payment failed"}`);
      if (decision.verdict === "BLOCK") break;
      if (decision.verdict === "ESCALATE") { append({ kind: "result", text: "Human approval is required before payment. Open the Gateway decision to continue with World ID." }); break; }
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
        append({ kind: "decision", label: scenario.title, amountUsd: scenario.swap.amountUsd, verdict: decision.verdict, reasons: decision.reasons, text: decision.error || "Swap is not available yet." });
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
        <div className="gateway-connection"><div><span>GATEWAY URL</span><strong>Ma'at Gateway</strong><small>Current integration: HTTP API</small></div><div className="gateway-target">{gatewayInfo ? <><a href={gatewayInfo.url} target="_blank" rel="noopener noreferrer">{gatewayInfo.url}</a><small><code>POST {gatewayInfo.endpoints.pay}</code> · <code>POST {gatewayInfo.endpoints.swap}</code></small></> : <small>{gatewayError ? "Gateway URL unavailable" : "Loading Gateway URL"}</small>}</div></div>
        <p className="demo-note">This is a scripted demo, not an AI agent. A production agent could use Ma'at through an MCP server or Skill.</p>
        <div className="chat" ref={feedRef} role="log" aria-live="polite">{timeline.length === 0 && <div className="welcome"><span>AGENT</span><p>Select a scenario to send an intent through Ma'at Gateway.</p></div>}{timeline.map((item, index) => item.kind === "decision" ? <article className={`payment ${item.verdict?.toLowerCase() || ""}`} key={index}><div><span>GATEWAY DECISION</span><b>{item.label}</b></div><strong>${item.amountUsd?.toFixed(3)}</strong><small>{item.verdict || "Decision received"}{item.decidedBy ? ` · ${item.decidedBy}` : ""}{item.status ? ` · ${item.status}` : ""}{item.elapsedMs !== undefined ? ` · ${item.elapsedMs} ms` : ""}</small>{item.reasons?.map((reason, reasonIndex) => <p className="decision-reason" key={reasonIndex}>{reason}</p>)}{item.data?.rows && <div className="dataset"><div className="dataset-head"><span>PURCHASED DATA</span><b>{item.data.title || "Dataset"} · {item.data.id}</b></div><dl>{item.data.rows.map((row, rowIndex) => <div key={rowIndex}><dt>{row.key}</dt><dd>{row.value}</dd></div>)}</dl>{item.data.payment?.txHash && <small>Transaction: {item.data.payment.txHash}</small>}</div>}{item.approvalId && item.status === "pending" && gatewayInfo && (worldConfigured ? <a className="approval-link" href={`${gatewayInfo.url}/api/maat/approvals/${item.approvalId}/world/start`} target="_blank" rel="noopener noreferrer">Approve with World ID ↗</a> : <p className="decision-reason">{worldConfigured === false ? "World ID is not configured on this Gateway." : "Checking World ID availability..."}</p>)}{item.text && <p className="decision-reason">{item.text}</p>}</article> : <div className={`bubble ${item.kind}`} key={index}><span>{item.kind === "task" ? "AGENT INTENT" : item.kind === "activity" ? "GATEWAY CALL" : item.kind === "error" ? "ERROR" : "RESULT"}</span><p>{item.text}</p></div>)}</div>
        <div className="scenario-section"><div className="scenario-heading"><b>Scenarios</b><button type="button" onClick={() => setTimeline([])} disabled={runningId !== null || timeline.length === 0}>Clear activity</button></div><div className="scenario-list" aria-label="Demo scenarios">{scenarios.map(scenario => <button type="button" className="scenario-button" key={scenario.id} onClick={() => void runScenario(scenario)} disabled={runningId !== null} aria-busy={runningId === scenario.id}><span><b>{scenario.title}</b><small>{scenario.service}</small></span><span className="scenario-action">{runningId === scenario.id ? "Running" : "Run"}</span></button>)}</div></div>
      </div>
    </section>
    <footer><span>MA'AT GATEWAY / AGENT DEMO</span><span>Gateway authentication stays on the server</span></footer>
  </main>;
}
