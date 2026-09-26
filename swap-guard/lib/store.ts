/*
 * In-memory decision log and daily ledger. Lives for the lifetime of the server
 * process, which is enough for a single `next start` demo host. "Reset demo
 * data" clears both.
 */
import type { Decision } from "./types";

type Store = { day: string; allowedUsd: number; decisions: Decision[] };

const globalStore = globalThis as unknown as { __maatSwapGuard?: Store };

function today() {
  return new Date().toISOString().slice(0, 10);
}

function store(): Store {
  const current = (globalStore.__maatSwapGuard ??= { day: today(), allowedUsd: 0, decisions: [] });
  if (current.day !== today()) {
    current.day = today();
    current.allowedUsd = 0;
  }
  return current;
}

export function spentTodayUsd() {
  return store().allowedUsd;
}

export function recordDecision(decision: Decision) {
  const current = store();
  current.decisions.unshift(decision);
  current.decisions.length = Math.min(current.decisions.length, 100);
  if (decision.verdict === "ALLOW") current.allowedUsd += decision.intent.amountUsd;
}

export function snapshot() {
  const current = store();
  return { day: current.day, allowedUsd: current.allowedUsd, decisions: current.decisions };
}

export function reset() {
  const current = store();
  current.allowedUsd = 0;
  current.decisions = [];
}
