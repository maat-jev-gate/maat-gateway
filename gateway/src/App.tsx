import { useEffect, useState } from "react";

type Settings = { bypassJev: boolean; bypassRealPayment: boolean; bypassWorldId: boolean; bypassMerchantRequest: boolean; jevBypassVerdict: "ALLOW" | "BLOCK" | "ESCALATE"; worldBypassVerdict: "ALLOW" | "BLOCK"; merchantUrl: string };
type Decision = { id: string; createdAt: string; agentId: string; taskId: string; verdict: "ALLOW" | "BLOCK" | "ESCALATE"; probability?: number; reasons: string[]; intent: { url: string; method: string; purpose: string }; merchant: { status?: number }; timings: { totalMs: number; merchantMs?: number; jevMs?: number; interceptaMs?: number }; intercepta?: { status: "clear" | "blocked" | "unavailable"; reasons: string[]; scans: { kind: "address" | "token"; address: string; response: unknown }[] }; decidedBy: string; error?: string; approvalId?: string; paymentExecuted?: boolean; paymentStatus?: "pending" | "completed" | "failed"; demo?: boolean };
type Approval = { id: string; status: "pending" | "approved" | "rejected" | "expired"; expiresAt: string; releasedResponse?: unknown };

const emptySettings: Settings = { bypassJev: false, bypassRealPayment: false, bypassWorldId: false, bypassMerchantRequest: false, jevBypassVerdict: "ESCALATE", worldBypassVerdict: "ALLOW", merchantUrl: "https://merchant.maat-jev-gate.online/vendor/atlas/dataset/demo-1" };
let gatewayCredentials = "";
function gatewayAuth() {
  if (gatewayCredentials) return gatewayCredentials;
  const user = window.prompt("Gateway username", "demo-agent");
  if (user === null) throw new Error("Gateway authentication was cancelled.");
  const password = window.prompt("Gateway password");
  if (password === null) throw new Error("Gateway authentication was cancelled.");
  gatewayCredentials = `Basic ${btoa(`${user}:${password}`)}`;
  return gatewayCredentials;
}

export function App() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [settings, setSettings] = useState<Settings>(emptySettings);
  const [draft, setDraft] = useState<Settings>(emptySettings);
  const [settingsReady, setSettingsReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [demoPurpose, setDemoPurpose] = useState("Purchase one Atlas dataset");
  const [approvals, setApprovals] = useState<Record<string, Approval>>({});
  const dirty = JSON.stringify(settings) !== JSON.stringify(draft);

  async function refresh() {
    const response = await fetch("/api/maat/decisions");
    if (!response.ok) return;
    const next = (await response.json() as { decisions: Decision[] }).decisions;
    setDecisions(next);
    await Promise.all(next.filter((decision) => decision.approvalId).map(async (decision) => {
      const approvalResponse = await fetch(`/api/maat/approvals/${decision.approvalId}`);
      if (approvalResponse.ok) { const approval = await approvalResponse.json() as Approval; setApprovals((current) => ({ ...current, [approval.id]: approval })); }
    }));
  }

  async function loadSettings() {
    const response = await fetch("/api/maat/settings");
    if (!response.ok) return;
    const current = await response.json() as Settings;
    setSettings(current); setDraft(current); setSettingsReady(true);
  }

  async function applySettings() {
    setError(""); setNotice("");
    try {
      const response = await fetch("/api/maat/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      if (!response.ok) throw new Error("Gateway settings could not be applied.");
      const current = await response.json() as Settings;
      setSettings(current); setDraft(current); setNotice("Settings applied on the Gateway server.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Gateway settings could not be applied."); }
  }

  async function clearHistory() {
    setError(""); setNotice("");
    try {
      const response = await fetch("/api/maat/history", { method: "DELETE", headers: { Authorization: gatewayAuth() } });
      if (response.status === 401) gatewayCredentials = "";
      if (!response.ok) throw new Error("Gateway history could not be cleared.");
      setDecisions([]); setApprovals({}); setConfirmClear(false); setNotice("Gateway history cleared.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Gateway history could not be cleared."); }
  }

  async function runDemo(scenario: "allow" | "block" | "escalate") {
    setRunning(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/maat/demo", { method: "POST", headers: { Authorization: gatewayAuth(), "Content-Type": "application/json" }, body: JSON.stringify({ scenario, purpose: demoPurpose }) });
      if (response.status === 401) gatewayCredentials = "";
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "Demo Merchant request failed.");
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Demo request failed."); }
    finally { setRunning(false); }
  }

  async function resolveApproval(approvalId: string) {
    if (settings.bypassWorldId) {
      try {
        const response = await fetch(`/api/maat/approvals/${approvalId}/resolve`, { method: "POST", headers: { Authorization: gatewayAuth() } });
        if (response.status === 401) gatewayCredentials = "";
        if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "Approval could not be resolved.");
        await refresh();
      } catch (caught) { setError(caught instanceof Error ? caught.message : "Approval could not be resolved."); }
      return;
    }
    const popup = window.open(`/api/maat/approvals/${approvalId}/world/start`, "maat-world-approval", "popup,width=480,height=760");
    if (!popup) setError("World ID could not open. Allow pop-ups for this Gateway page and try again.");
  }
  useEffect(() => { void loadSettings(); void refresh(); const timer = window.setInterval(() => void refresh(), 2000); return () => window.clearInterval(timer); }, []);

  function renderDecision(decision: Decision) {
    const approval = decision.approvalId ? approvals[decision.approvalId] : undefined;
    const paymentLabel = decision.paymentStatus ?? (decision.paymentExecuted ? "completed" : "dry run");
    return <article className={`decision ${decision.verdict.toLowerCase()}`} key={decision.id}><div className="decision-top"><div><span className="decision-kicker">{decision.verdict} · {decision.decidedBy.toUpperCase()}{decision.demo ? " · DEMO" : ""}</span><h2>{decision.intent.method} {decision.intent.url}</h2></div><strong>{decision.probability === undefined ? "—" : `${Math.round(decision.probability * 100)}%`}</strong></div><p className="purpose">{decision.intent.purpose}</p><div className="metrics"><span>Intercepta {decision.intercepta?.status ?? "—"} · {decision.timings.interceptaMs ?? "—"} ms</span><span>JEV {decision.timings.jevMs ?? "—"} ms</span><span>Merchant {decision.timings.merchantMs ?? "—"} ms</span><span>Total {decision.timings.totalMs} ms</span><span>Payment {paymentLabel}</span><span>{new Date(decision.createdAt).toLocaleTimeString()}</span></div>{decision.reasons.map((reason, index) => <div className={`reason${index ? " secondary-reason" : ""}`} key={`${index}-${reason}`}>{reason}</div>)}{decision.intercepta && <details><summary>Intercepta scan results</summary><pre>{JSON.stringify(decision.intercepta.scans, null, 2)}</pre></details>}{decision.approvalId && <div className="approval"><span>WORLD ID · {approval?.status ?? "pending"}</span>{approval?.status === "pending" && <button type="button" onClick={() => void resolveApproval(decision.approvalId!)}>{settings.bypassWorldId ? "Resolve approval" : "Approve with World ID ↗"}</button>}{approval?.status === "approved" && <strong>Approval accepted</strong>}{approval?.status === "rejected" && <strong>Approval rejected</strong>}</div>}</article>;
  }

  return <main className="shell">
    <header className="topbar"><div className="brand"><span className="mark">◈</span><div><b>MA'AT GATEWAY</b><small>SERVER DEBUG CONSOLE</small></div></div><span className={`status ${running ? "running" : ""}`}><i />{running ? "REQUESTING" : "POLLING"}</span></header>
    <section className="workspace">
      <section className="decision-card"><div className="card-head"><span>LIVE DECISIONS</span><div className="history-actions"><span className="live"><i /> AUTO REFRESH · 2S</span><button type="button" onClick={() => setConfirmClear(true)} disabled={decisions.length === 0}>Clear History</button></div></div><div className="stream">{decisions.length === 0 ? <div className="empty"><strong>Waiting for an Agent request</strong><p>Use the Debug Panel below, then send a request through the Agent or use a Demo Request.</p></div> : decisions.map(renderDecision)}</div></section>
      <section className="debug-panel"><div className="panel-title"><div><span className="eyebrow">GATEWAY DEBUG PANEL</span></div></div><div className="settings-grid"><label>Merchant URL<input type="url" value={draft.merchantUrl} onChange={(event) => setDraft({ ...draft, merchantUrl: event.target.value })} /></label></div><div className="switches"><div className="settings-row"><label className="switch"><input type="checkbox" checked={draft.bypassMerchantRequest} onChange={(event) => setDraft({ ...draft, bypassMerchantRequest: event.target.checked })} /><span>Bypass Merchant</span></label></div><div className="settings-row"><label className="switch"><input type="checkbox" checked={draft.bypassJev} onChange={(event) => setDraft({ ...draft, bypassJev: event.target.checked })} /><span>Bypass JEV</span></label><label className="settings-result">JEV bypass result<select value={draft.jevBypassVerdict} onChange={(event) => setDraft({ ...draft, jevBypassVerdict: event.target.value as Settings["jevBypassVerdict"] })}><option value="ALLOW">Accept</option><option value="BLOCK">Reject</option><option value="ESCALATE">Escalate</option></select></label></div><div className="settings-row"><label className="switch"><input type="checkbox" checked={draft.bypassWorldId} onChange={(event) => setDraft({ ...draft, bypassWorldId: event.target.checked })} /><span>Bypass World ID</span></label><label className="settings-result">World ID bypass result<select value={draft.worldBypassVerdict} onChange={(event) => setDraft({ ...draft, worldBypassVerdict: event.target.value as Settings["worldBypassVerdict"] })}><option value="ALLOW">Auto approve</option><option value="BLOCK">Auto reject</option></select></label></div><div className="settings-row"><label className="switch"><input type="checkbox" checked={draft.bypassRealPayment} onChange={(event) => setDraft({ ...draft, bypassRealPayment: event.target.checked })} /><span>Bypass real payment</span></label></div></div><div className="panel-actions"><button className="apply-button" type="button" onClick={() => void applySettings()} disabled={!settingsReady || !dirty}>Apply settings</button></div><div className="demo-bar"><div className="demo-title">DEMO REQUESTS</div><label className="demo-purpose">Payment purpose<input value={demoPurpose} onChange={(event) => setDemoPurpose(event.target.value)} /></label><div className="demo-actions"><button type="button" className="demo-allow" onClick={() => void runDemo("allow")} disabled={running}>Accept</button><button type="button" className="demo-block" onClick={() => void runDemo("block")} disabled={running}>Decline</button><button type="button" className="demo-escalate" onClick={() => void runDemo("escalate")} disabled={running}>Escalate</button></div></div>{notice && <p className="settings-notice">{notice}</p>}</section>
      {error && <p className="error-note">{error}</p>}
    </section>{confirmClear && <div className="confirm-backdrop" role="presentation"><div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-clear-title"><h2 id="confirm-clear-title">Clear Gateway history?</h2><p>This removes all saved decisions and approvals from this Gateway. It does not change settings or Merchant history.</p><div><button type="button" onClick={() => setConfirmClear(false)}>Cancel</button><button type="button" className="confirm-danger" onClick={() => void clearHistory()}>Clear History</button></div></div></div>}<footer><span>MA'AT GATEWAY / SERVER DEBUG CONSOLE</span><span>Configuration is held by the server</span></footer>
  </main>;
}
