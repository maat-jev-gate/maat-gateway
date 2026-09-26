/* Icons, verdict metadata, and formatting helpers shared by the dashboard. */
import type { ReactNode } from "react";
import type { Tier, Verdict } from "@/lib/types";

const PATHS = {
  allow: <path d="M3.2 8.6l3.1 3 6.5-7.2" />,
  human: (
    <>
      <circle cx="8" cy="5" r="2.6" />
      <path d="M2.8 14.2c.3-3 2.4-4.6 5.2-4.6s4.9 1.6 5.2 4.6" />
    </>
  ),
  block: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <path d="M4.1 11.9l7.8-7.8" />
    </>
  ),
  run: <path d="M4.5 2.8l8.4 5.2-8.4 5.2z" />,
  reset: (
    <>
      <path d="M2.9 8a5.1 5.1 0 1 0 1.5-3.6" />
      <path d="M2.6 2.2v2.9h2.9" />
    </>
  ),
  link: <path d="M6.5 3.5H3.5v9h9v-3M9 2.5h4.5V7M13.5 2.5L7 9" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      {PATHS[name]}
    </svg>
  );
}

export function Glyph() {
  // A feather over a baseline: Ma'at's emblem, drawn for this app.
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="brand-glyph" aria-hidden="true">
      <path d="M23.5 3.5C15 5 9.8 12 9.4 20.5l-.4 4.3c3.9-2.3 9.3-6.6 12.4-11.4 2.6-4 3.1-7.2 2.1-9.9z" fill="currentColor" fillOpacity=".18" />
      <path d="M7 29.5l14.5-21M13.2 17.5l4.3.6M15.4 14.2l4 .3M11.4 21l4.2 1" />
    </svg>
  );
}

export const VERDICTS: Verdict[] = ["ALLOW", "ESCALATE", "BLOCK"];

export const VERDICT_META: Record<Verdict, { label: string; cls: string; icon: IconName; caption: string }> = {
  ALLOW: { label: "Allow", cls: "allow", icon: "allow", caption: "Would be signed. Mainnet is analysis only, so nothing was sent." },
  ESCALATE: { label: "Escalate", cls: "escalate", icon: "human", caption: "Held for the owner to approve with World ID." },
  BLOCK: { label: "Block", cls: "block", icon: "block", caption: "Dropped before signing. Nothing was signed." },
};

export function VerdictChip({ verdict }: { verdict: Verdict }) {
  const meta = VERDICT_META[verdict];
  return (
    <span className="vchip">
      <Icon name={meta.icon} className={`c-${meta.cls}`} />
      {meta.label}
    </span>
  );
}

export const TIER_TEXT: Record<Tier, string> = { high: "High risk", medium: "Watch", low: "Clear", unknown: "Unknown" };

export function Ext({ href, children }: { href?: string; children: ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

export const short = (value: string) => (value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value);
export const pct = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;
export const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}`;
export const usd = (value: number) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const ms = (value: number) => (value >= 10_000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value).toLocaleString("en-US")} ms`);
export const txUrl = (hash: string) => `https://etherscan.io/tx/${hash}`;
export const addressUrl = (address: string) => `https://etherscan.io/address/${address}`;

export function amount(value: string, digits = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (n === 0) return "0";
  if (n >= 1_000_000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return n.toPrecision(digits);
}

export function duration(sec: number) {
  if (sec < 90) return `${Math.round(sec)} s`;
  if (sec < 90 * 60) return `${Math.round(sec / 60)} min`;
  if (sec < 48 * 3600) return `${(sec / 3600).toFixed(1)} h`;
  return `${Math.round(sec / 86400).toLocaleString("en-US")} days`;
}

export function clock(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour12: false });
}

export function CardHead({ id, title, sub, children }: { id: string; title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="card-head">
      <div>
        <h2 id={id}>{title}</h2>
        {sub ? <p className="card-sub">{sub}</p> : null}
      </div>
      {children}
    </header>
  );
}
