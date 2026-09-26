"use client";
/* The balance: signals pushing toward BLOCK stack on the right pan, toward ALLOW on the left. */
import type { Signal } from "@/lib/types";
import { signed } from "./ui";

const ARM = 80;

function Stack({ signals, color }: { signals: Signal[]; color: string }) {
  let y = 60;
  return (
    <g>
      {signals.map((signal) => {
        const h = Math.max(3, Math.abs(signal.weight) * 4.2);
        y -= h;
        const rect = (
          <rect key={signal.key} x={-7} y={y} width={14} height={h} rx={1.5} fill={color}>
            <title>{`${signed(signal.weight)} · ${signal.label}`}</title>
          </rect>
        );
        y -= 1.5;
        return rect;
      })}
    </g>
  );
}

function Pan({ label, x, y, children }: { label: string; x: number; y: number; children: React.ReactNode }) {
  return (
    <g className="pan" style={{ transform: `translate(${x}px, ${y}px)` }}>
      <line x1={0} y1={0} x2={-24} y2={58} stroke="var(--ink-2)" strokeWidth={1.2} />
      <line x1={0} y1={0} x2={24} y2={58} stroke="var(--ink-2)" strokeWidth={1.2} />
      {children}
      <path d="M-30 58H30Q0 79-30 58Z" fill="var(--surface)" stroke="var(--ink-2)" strokeWidth={1.5} strokeLinejoin="round" />
      <text x={0} y={88} textAnchor="middle" fill="var(--ink-2)" fontSize={10} fontWeight={650} letterSpacing="1.2" style={{ fontFamily: "var(--f-display)" }}>
        {label}
      </text>
    </g>
  );
}

export function Scale({ signals }: { signals: Signal[] }) {
  const net = signals.reduce((total, signal) => total + signal.weight, 0);
  const deg = Math.max(-14, Math.min(14, net * 2.4));
  const rad = (deg * Math.PI) / 180;
  const toBlock = signals.filter((signal) => signal.weight > 0);
  const toAllow = signals.filter((signal) => signal.weight < 0);
  return (
    <svg viewBox="0 0 240 150" className="beam" role="img" aria-label={`Scale tips ${net >= 0 ? "toward block" : "toward allow"}: net weight ${signed(net)}`}>
      <rect x={84} y={138} width={72} height={6} rx={3} fill="var(--rule)" />
      <line x1={120} y1={30} x2={120} y2={139} stroke="var(--ink-2)" strokeWidth={3} strokeLinecap="round" />
      <g className="beam-bar" style={{ transform: `rotate(${deg}deg)` }}>
        <line x1={40} y1={30} x2={200} y2={30} stroke="var(--brass-line)" strokeWidth={4} strokeLinecap="round" />
        <circle cx={40} cy={30} r={3.5} fill="var(--brass-line)" />
        <circle cx={200} cy={30} r={3.5} fill="var(--brass-line)" />
      </g>
      <Pan label="ALLOW" x={120 - ARM * Math.cos(rad)} y={30 - ARM * Math.sin(rad)}>
        <Stack signals={toAllow} color="var(--to-allow)" />
      </Pan>
      <Pan label="BLOCK" x={120 + ARM * Math.cos(rad)} y={30 + ARM * Math.sin(rad)}>
        <Stack signals={toBlock} color="var(--to-block)" />
      </Pan>
      <circle cx={120} cy={30} r={6} fill="var(--surface)" stroke="var(--brass-line)" strokeWidth={3} />
    </svg>
  );
}
