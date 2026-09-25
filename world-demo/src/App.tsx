import { useEffect, useState } from "react";

type Status = { state: "idle" | "verified"; verifiedAt?: number; approved: boolean };
type Config = { configured: boolean; issuer: string; redirectUri: string; flow: string };

const statusCopy = {
  idle: { label: "Awaiting proof", tone: "idle" },
  verified: { label: "Human verified", tone: "good" },
};

export function App() {
  const [status, setStatus] = useState<Status>({ state: "idle", approved: false });
  const [config, setConfig] = useState<Config>();
  const [busy, setBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [error, setError] = useState(() => new URLSearchParams(location.search).get("world_error") || "");

  const refresh = async () => {
    const response = await fetch("/api/status");
    setStatus(await response.json());
  };
  useEffect(() => { void Promise.all([fetch("/api/config").then((response) => response.json()).then(setConfig), refresh()]); }, []);

  const startVerification = () => { setBusy(true); setError(""); location.href = "/auth/world/start"; };
  const approveAction = async () => {
    setBusy(true); setActionMessage(""); setError("");
    const response = await fetch("/api/protected-action", { method: "POST" });
    const body = await response.json();
    if (!response.ok) setError(body.error || "The protected action was denied.");
    else { setActionMessage(body.message); await refresh(); }
    setBusy(false);
  };
  const reset = async () => { await fetch("/auth/logout", { method: "POST" }); setStatus({ state: "idle", approved: false }); setActionMessage(""); setError(""); };
  const current = statusCopy[status.state];

  return <main className="shell">
    <nav className="nav"><a className="wordmark" href="/">HUMAN<span>CHECKPOINT</span></a><span className="nav-note">WORLD ID FOR AGENTS / SANDBOX</span><a className="docs" href="https://sandbox.auth.world.org/docs" target="_blank" rel="noreferrer">Open docs <span aria-hidden="true">↗</span></a></nav>
    <section className="hero">
      <div className="eyebrow"><span className="pulse" /> OIDC proof gate</div>
      <h1>Make the sensitive action<br /><em>wait for a human.</em></h1>
      <p className="lede">A small, verifiable checkpoint for agent workflows. World ID confirms a unique human right before an action that matters.</p>
    </section>
    <section className="workspace">
      <div className="main-card">
        <div className="card-kicker">01 <span>IDENTITY CHECK</span><span className={`status ${current.tone}`}><i /> {current.label}</span></div>
        <div className="identity-stage">
          <div className="orbit"><div className="orbit-core">{status.state === "verified" ? "✓" : "W"}</div></div>
          <div><h2>{status.state === "verified" ? "Proof accepted" : "Verify your humanity"}</h2><p>{status.state === "verified" ? "The server validated a fresh World ID proof for this session." : "The next step opens World’s Sandbox authorization flow and asks for a fresh proof."}</p></div>
        </div>
        <div className="proof-row"><span>PROTOCOL</span><strong>OpenID Connect + PKCE</strong><span>ASSURANCE</span><strong>Orb credential · fresh auth</strong></div>
        {error && <div className="notice error"><strong>Verification stopped</strong><span>{error}</span></div>}
        {status.state === "verified" && actionMessage && <div className="notice success"><strong>Action released</strong><span>{actionMessage}</span></div>}
        <div className="actions">
          {status.state === "idle" ? <button className="primary" onClick={startVerification} disabled={busy || !config?.configured}>{busy ? "Opening World…" : "Continue with World ID"}<span>↗</span></button> : <button className="primary" onClick={approveAction} disabled={busy || status.approved}>{status.approved ? "Action already approved" : busy ? "Releasing action…" : "Release protected action"}<span>→</span></button>}
          {status.state === "verified" && <button className="secondary" onClick={reset}>Reset session</button>}
        </div>
        {config && !config.configured && <div className="setup"><strong>Sandbox credentials needed</strong><span>Copy <code>.env.example</code> to <code>.env</code>, then add the client ID and secret from the World Sandbox Portal.</span></div>}
      </div>
      <aside className="side-card">
        <div className="card-kicker">02 <span>WHAT THIS PROVES</span></div>
        <div className="side-list"><div><b>Fresh proof</b><span><i className="check">✓</i> Re-authentication requested for this attempt</span></div><div><b>Server verified</b><span><i className="check">✓</i> Signature, issuer, audience and nonce checked</span></div><div><b>Human approval</b><span><i className="dot" /> Action waits until you release it</span></div></div>
        <div className="boundary"><span className="boundary-mark">◎</span><div><b>Chain independent</b><p>World ID supplies an identity signal. This demo does not connect a wallet, sign a transaction or spend gas.</p></div></div>
      </aside>
    </section>
    <footer><span>DEMO / TOKYO 2026</span><span>Session state stays in the server memory</span><span>{config?.flow || "Loading protocol…"}</span></footer>
  </main>;
}
