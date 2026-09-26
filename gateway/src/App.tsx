import { useEffect, useState } from "react";
import { formatUnits } from "viem";

type Settings = { bypassJev: boolean; bypassIntercepta: boolean; interceptaBypassVerdict: "ALLOW" | "BLOCK"; bypassRealPayment: boolean; bypassWorldId: boolean; bypassMerchantRequest: boolean; jevBypassVerdict: "ALLOW" | "BLOCK" | "ESCALATE"; worldBypassVerdict: "ALLOW" | "BLOCK"; merchantUrl: string };
type DecisionBase = { id: string; kind: "pay" | "swap"; createdAt: string; agentId: string; taskId: string; verdict: "ALLOW" | "BLOCK" | "ESCALATE" | "ERROR"; reasons: string[]; decidedBy: string; error?: string; approvalId?: string; timings: { totalMs: number; interceptaMs?: number; jevMs?: number; merchantMs?: number; uniswapMs?: number; forensicsMs?: number } };
type ApiTrace = { request?: unknown; response?: unknown; status?: number; error?: string };
type PayDecision = DecisionBase & { kind: "pay"; probability?: number; jevApi?: ApiTrace; jevOverride?: "ALLOW" | "BLOCK" | "ESCALATE"; interceptaOverride?: "ALLOW" | "BLOCK"; intent: { url: string; method: string; purpose: string }; merchant: { status?: number; requirements?: { amount: string; payTo: string; extra?: { name?: string } }[] }; intercepta?: { status: "clear" | "blocked" | "unavailable"; reasons: string[]; scans: { kind: "address" | "token"; address: string; request?: unknown; response: unknown }[] }; paymentExecuted?: boolean; paymentStatus?: "pending" | "completed" | "failed" | "cancelled"; demo?: boolean };
type SwapDecision = DecisionBase & { kind: "swap"; rule?: string; intent: { tokenIn: string; tokenOut: string; amountUsd: number; purpose: string }; analysisOnly: true; quote?: { route?: string }; tokenScan?: { tier?: string; riskLevel?: string; action?: string }; jev?: { verdict?: string; probability?: number }; raw?: { intercepta?: unknown; jevRequest?: unknown; jev?: unknown }; stages?: { key: string; status: string; note?: string }[] };
type Decision = PayDecision | SwapDecision;
type Approval = { id: string; status: "pending" | "approved" | "rejected" | "expired" | "cancelled"; expiresAt: string; worldApi?: ApiTrace };

const emptySettings: Settings = { bypassJev: false, bypassIntercepta: false, interceptaBypassVerdict: "ALLOW", bypassRealPayment: false, bypassWorldId: false, bypassMerchantRequest: false, jevBypassVerdict: "ESCALATE", worldBypassVerdict: "ALLOW", merchantUrl: "https://merchant.maat-jev-gate.online/merchant/dataset/demo-1" };
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
      const response = await fetch("/api/maat/history", { method: "DELETE" });
      if (!response.ok) throw new Error("Gateway history could not be cleared.");
      setDecisions([]); setApprovals({}); setConfirmClear(false); setNotice("Gateway history cleared.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Gateway history could not be cleared."); }
  }

  async function runDemo(scenario: "allow" | "block" | "escalate") {
    setRunning(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/maat/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenario, purpose: demoPurpose }) });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "Demo Merchant request failed.");
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Demo request failed."); }
    finally { setRunning(false); }
  }

  async function resolveApproval(approvalId: string) {
    if (settings.bypassWorldId) {
      try {
        const response = await fetch(`/api/maat/approvals/${approvalId}/resolve`, { method: "POST" });
        if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "Approval could not be resolved.");
        await refresh();
      } catch (caught) { setError(caught instanceof Error ? caught.message : "Approval could not be resolved."); }
      return;
    }
    const popup = window.open(`/api/maat/approvals/${approvalId}/world/start`, "maat-world-approval", "popup,width=480,height=760");
    if (!popup) setError("World ID could not open. Allow pop-ups for this Gateway page and try again.");
  }
  async function cancelApproval(approvalId: string) {
    setError("");
    try {
      const response = await fetch(`/api/maat/approvals/${approvalId}/cancel`, { method: "POST" });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "Approval could not be cancelled.");
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Approval could not be cancelled."); }
  }
  useEffect(() => { void loadSettings(); void refresh(); const timer = window.setInterval(() => void refresh(), 2000); return () => window.clearInterval(timer); }, []);

  function renderDecision(decision: Decision) {
    const approval = decision.approvalId ? approvals[decision.approvalId] : undefined;
    const isPay = decision.kind === "pay";
    const requirement = isPay ? decision.merchant.requirements?.[0] : undefined;
    const amount = requirement?.extra?.name === "USDC" && /^\d+$/.test(requirement.amount)
      ? `${formatUnits(BigInt(requirement.amount), 6)} USDC` : undefined;
    const checks: { name: string; state: "pass" | "fail" | "escalate" | "idle" | "waiting"; note?: string; metric?: string; detail?: string[]; request?: unknown; response?: unknown; error?: string }[] = [];
    if (isPay) {
      const risk = decision.intercepta;
      checks.push({ name: "Intercepta", state: !risk ? "idle" : risk.status === "clear" ? "pass" : "fail", note: decision.interceptaOverride ? "Bypassed" : undefined, detail: risk?.reasons, request: risk?.scans.some((scan) => scan.request) ? risk.scans.map((scan) => scan.request) : undefined, response: risk?.scans.length ? risk.scans.map(({ kind, address, response }) => ({ kind, address, response })) : undefined });
      const jevResult = decision.jevOverride ?? (decision.demo || decision.decidedBy === "demo" || decision.decidedBy === "jev" ? decision.verdict : undefined);
      checks.push({ name: "JEV", state: !jevResult ? decision.decidedBy === "fallback" ? "fail" : "idle" : jevResult === "BLOCK" ? "fail" : jevResult === "ESCALATE" ? "escalate" : "pass", note: decision.jevOverride || decision.demo || decision.decidedBy === "demo" ? "Overridden" : decision.decidedBy === "fallback" ? "Fallback" : undefined, metric: decision.probability !== undefined ? `${Math.round(decision.probability * 100)}%` : undefined, request: decision.jevApi?.request, response: decision.jevApi?.response, error: decision.jevApi?.error });
    } else {
      const scan = decision.stages?.find((stage) => stage.key === "tokenScan");
      const jevStage = decision.stages?.find((stage) => stage.key === "jev");
      checks.push({ name: "Intercepta", state: decision.rule === "H2" ? "fail" : scan?.status === "failed" ? "fail" : !scan || scan.status === "skipped" ? "idle" : decision.tokenScan?.tier === "unknown" ? "fail" : decision.tokenScan?.action === "block" || decision.tokenScan?.tier === "high" ? "fail" : "pass", metric: decision.tokenScan?.tier && decision.tokenScan.tier !== "unknown" ? `${decision.tokenScan.tier} risk` : undefined, detail: decision.reasons.filter((reason) => /Intercepta/i.test(reason)), request: Array.isArray(decision.raw?.intercepta) && decision.raw.intercepta.length ? decision.raw.intercepta.map((item) => (item as { request?: unknown }).request).filter(Boolean) : undefined, response: decision.raw?.intercepta && Array.isArray(decision.raw.intercepta) && decision.raw.intercepta.length ? decision.raw.intercepta : undefined });
      checks.push({ name: "JEV", state: !jevStage || jevStage.status === "skipped" ? "idle" : jevStage.status === "failed" ? "fail" : decision.rule === "C" || decision.jev?.verdict === "ESCALATE" ? "escalate" : decision.jev?.verdict === "BLOCK" ? "fail" : "pass", note: jevStage?.status === "failed" ? "Fallback" : undefined, metric: decision.jev?.probability !== undefined ? `${Math.round(decision.jev.probability * 100)}%` : undefined, detail: jevStage?.note ? [jevStage.note] : undefined, request: decision.raw?.jevRequest, response: decision.raw?.jev });
    }
    checks.push({ name: "World ID", state: !decision.approvalId ? "idle" : approval?.status === "approved" ? "pass" : approval && approval.status !== "pending" ? "fail" : "waiting", note: decision.reasons.some((reason) => reason.includes("World ID bypass")) ? "Bypassed" : undefined, metric: decision.approvalId && (!approval || approval.status === "pending") ? "Pending" : undefined, request: approval?.worldApi?.request, response: approval?.worldApi?.response, error: approval?.worldApi?.error });
    const title = isPay ? `${decision.intent.method} ${new URL(decision.intent.url).pathname}` : `${decision.intent.tokenIn} → ${decision.intent.tokenOut}`;
    const outcome = decision.verdict === "ERROR" || (isPay && decision.paymentStatus === "failed") || (approval && ["rejected", "cancelled", "expired"].includes(approval.status)) ? "block" : approval?.status === "approved" ? "allow" : decision.verdict.toLowerCase();
    const summary = decision.error ?? (isPay && decision.verdict === "BLOCK"
      ? decision.reasons.find((reason) => reason.startsWith("Intercepta blocked:")) ?? decision.reasons.find((reason) => reason !== "Intercepta recipient check clear.")
      : !isPay && decision.verdict !== "ALLOW" ? decision.reasons[0] : undefined);
    return <article className={`decision ${outcome}`} key={decision.id}>
      <div className="decision-top"><div><span className="decision-kicker">{isPay ? "PAYMENT" : "SWAP ANALYSIS"} · {decision.verdict}{approval?.status === "approved" ? " · APPROVED" : ""}</span><h2>{title}</h2></div></div>
      <p className="purpose">{decision.intent.purpose}</p>
      {isPay && requirement && <div className="merchant-quote"><b>MERCHANT QUOTE</b><span>{amount && `${amount} · `}Recipient <code>{requirement.payTo}</code></span>{(decision.demo || decision.reasons.some((reason) => reason.includes("Real payment is bypassed"))) && <small className="check-badge" tabIndex={0} data-tooltip={decision.demo ? "Gateway demo requests never submit payment." : "Real payment was bypassed in Gateway settings."}>Payment Bypassed</small>}</div>}
      {summary && <p className="decision-summary">{summary}</p>}
      <div className="check-grid">{checks.map((check) => {
        const status = check.state === "idle" ? "Not run" : check.state === "waiting" ? "Pending" : check.state === "escalate" ? "Escalate" : check.state === "pass" ? "Pass" : "Fail";
        const expandable = check.request !== undefined || check.response !== undefined || check.error !== undefined;
        const content = <><span className="check-icon" aria-hidden="true">{check.state === "pass" ? "✓" : check.state === "fail" ? "×" : check.state === "escalate" ? "!" : check.state === "waiting" ? "…" : "–"}</span><span className="check-name"><b>{check.name}</b>{check.note && <small className="check-badge" tabIndex={0} data-tooltip={check.note === "Overridden" ? "JEV was not called. The result came from a Gateway demo request or bypass setting." : check.note === "Fallback" ? "JEV was unavailable; the Gateway fallback result was used." : `${check.name} was bypassed in Gateway settings.`}>{check.note}</small>}</span>{check.metric && <span className="check-metric">{check.metric}</span>}{expandable && <span className="check-chevron" aria-hidden="true">⌄</span>}</>;
        return <div className={`check check-${check.state}`} key={check.name}>{expandable ? <details><summary aria-label={`${check.name}: ${status}${check.metric ? `, ${check.metric}` : ""}. Show API details`}>{content}</summary><div className="check-detail">{check.detail?.map((line, index) => <p key={index}>{line}</p>)}{check.request !== undefined && <><b>Request</b><pre>{JSON.stringify(check.request, null, 2)}</pre></>}{check.response !== undefined && <><b>Response</b><pre>{JSON.stringify(check.response, null, 2)}</pre></>}{check.error && <p>{check.error}</p>}</div></details> : <div className="check-row" aria-label={`${check.name}: ${status}${check.metric ? `, ${check.metric}` : ""}`}>{content}</div>}{check.name === "World ID" && approval?.status === "pending" && <div className="check-approval"><div className="approval-actions"><button type="button" onClick={() => void resolveApproval(decision.approvalId!)}>{settings.bypassWorldId ? "Resolve approval" : "Confirm with World ID"}</button><button className="cancel-approval" type="button" onClick={() => void cancelApproval(decision.approvalId!)}>Cancel {isPay ? "payment" : "approval"}</button></div></div>}</div>;
      })}</div>
    </article>;
  }

  return <main className="shell">
    <header className="topbar"><div className="brand"><span className="mark">◈</span><div><b>MA'AT GATEWAY</b><small>SERVER DEBUG CONSOLE</small></div></div><span className={`status ${running ? "running" : ""}`}><i />{running ? "REQUESTING" : "POLLING"}</span></header>
    <section className="workspace">
      <section className="decision-card"><div className="card-head"><span>LIVE DECISIONS</span><div className="history-actions"><span className="live"><i /> AUTO REFRESH · 2S</span><button type="button" onClick={() => setConfirmClear(true)} disabled={decisions.length === 0}>Clear History</button></div></div><div className="stream">{decisions.length === 0 ? <div className="empty"><strong>Waiting for an Agent request</strong><p>Use the Debug Panel below, then send a request through the Agent or use a Demo Request.</p></div> : decisions.map(renderDecision)}</div></section>
      <section className="debug-panel"><div className="panel-title"><div><span className="eyebrow">GATEWAY DEBUG PANEL</span></div></div><div className="settings-grid"><label>Merchant URL<input type="url" value={draft.merchantUrl} onChange={(event) => setDraft({ ...draft, merchantUrl: event.target.value })} /></label></div><div className="switches"><div className="settings-row"><label className="switch"><input type="checkbox" checked={draft.bypassMerchantRequest} onChange={(event) => setDraft({ ...draft, bypassMerchantRequest: event.target.checked })} /><span>Bypass Merchant</span></label></div><div className="settings-row"><label className="switch"><input type="checkbox" checked={draft.bypassIntercepta} onChange={(event) => setDraft({ ...draft, bypassIntercepta: event.target.checked })} /><span>Bypass Intercepta</span></label><label className="settings-result">Intercepta result<select value={draft.interceptaBypassVerdict} onChange={(event) => setDraft({ ...draft, interceptaBypassVerdict: event.target.value as Settings["interceptaBypassVerdict"] })}><option value="ALLOW">Pass</option><option value="BLOCK">Fail</option></select></label></div><div className="settings-row"><label className="switch"><input type="checkbox" checked={draft.bypassJev} onChange={(event) => setDraft({ ...draft, bypassJev: event.target.checked })} /><span>Bypass JEV</span></label><label className="settings-result">JEV result<select value={draft.jevBypassVerdict} onChange={(event) => setDraft({ ...draft, jevBypassVerdict: event.target.value as Settings["jevBypassVerdict"] })}><option value="ALLOW">Accept</option><option value="BLOCK">Reject</option><option value="ESCALATE">Escalate</option></select></label></div><div className="settings-row"><label className="switch"><input type="checkbox" checked={draft.bypassWorldId} onChange={(event) => setDraft({ ...draft, bypassWorldId: event.target.checked })} /><span>Bypass World ID</span></label><label className="settings-result">World ID result<select value={draft.worldBypassVerdict} onChange={(event) => setDraft({ ...draft, worldBypassVerdict: event.target.value as Settings["worldBypassVerdict"] })}><option value="ALLOW">Auto approve</option><option value="BLOCK">Auto reject</option></select></label></div><div className="settings-row"><label className="switch"><input type="checkbox" checked={draft.bypassRealPayment} onChange={(event) => setDraft({ ...draft, bypassRealPayment: event.target.checked })} /><span>Bypass real payment</span></label></div></div><div className="panel-actions"><button className="apply-button" type="button" onClick={() => void applySettings()} disabled={!settingsReady || !dirty}>Apply settings</button></div><div className="demo-bar"><div className="demo-title">DEMO REQUESTS</div><label className="demo-purpose">Payment purpose<input value={demoPurpose} onChange={(event) => setDemoPurpose(event.target.value)} /></label><div className="demo-actions"><button type="button" className="demo-allow" onClick={() => void runDemo("allow")} disabled={running}>Accept</button><button type="button" className="demo-block" onClick={() => void runDemo("block")} disabled={running}>Decline</button><button type="button" className="demo-escalate" onClick={() => void runDemo("escalate")} disabled={running}>Escalate</button></div></div>{notice && <p className="settings-notice">{notice}</p>}</section>
      {error && <p className="error-note">{error}</p>}
    </section>{confirmClear && <div className="confirm-backdrop" role="presentation"><div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-clear-title"><h2 id="confirm-clear-title">Clear Gateway history?</h2><p>This removes all saved decisions and approvals from this Gateway. It does not change settings or Merchant history.</p><div><button type="button" onClick={() => setConfirmClear(false)}>Cancel</button><button type="button" className="confirm-danger" onClick={() => void clearHistory()}>Clear History</button></div></div></div>}<footer><span>MA'AT GATEWAY / SERVER DEBUG CONSOLE</span><span>Configuration is held by the server</span></footer>
  </main>;
}
