import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { screenSwap, SwapGuardError, type SwapIntent } from "../server/swap-guard";

const originalFetch = globalThis.fetch;
const originalUrl = process.env.SWAP_GUARD_URL;
const input: SwapIntent = {
  agentId: "maat-demo-agent",
  taskId: "demo-swap",
  purpose: "Assess a swap",
  chainId: 1,
  tokenIn: "ETH",
  tokenOut: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  amountUsd: 30,
  source: "owner",
};
const decision = {
  id: "decision-id",
  createdAt: "2026-09-26T00:00:00.000Z",
  kind: "swap",
  agentId: input.agentId,
  verdict: "ESCALATE",
  reasons: ["Owner review required."],
  analysisOnly: true,
  timings: { totalMs: 12 },
  intent: { tokenOut: input.tokenOut },
  quote: { route: "ETH to USDC" },
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.SWAP_GUARD_URL;
  else process.env.SWAP_GUARD_URL = originalUrl;
});

test("forwards the authenticated Agent intent and returns the Guard decision unchanged", async () => {
  process.env.SWAP_GUARD_URL = "https://swap.example.test";
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://swap.example.test/api/maat/swap");
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), input);
    assert.equal(new Headers(init?.headers).get("Accept"), "application/json");
    return Response.json(decision);
  };
  assert.deepEqual(await screenSwap(input), decision);
});

test("passes through Guard input errors", async () => {
  process.env.SWAP_GUARD_URL = "https://swap.example.test";
  globalThis.fetch = async () => Response.json({ error: "Unsupported token." }, { status: 400 });
  await assert.rejects(screenSwap(input), (error: unknown) => error instanceof SwapGuardError && error.status === 400 && error.message === "Unsupported token.");
});

test("rejects an upstream decision for a different token", async () => {
  process.env.SWAP_GUARD_URL = "https://swap.example.test";
  globalThis.fetch = async () => Response.json({ ...decision, intent: { tokenOut: "0x6982508145454Ce325dDbE47a25d4ec3d2311933" } });
  await assert.rejects(screenSwap(input), (error: unknown) => error instanceof SwapGuardError && error.status === 502);
});

test("rejects an insecure non-local Guard origin", async () => {
  process.env.SWAP_GUARD_URL = "http://swap.example.test";
  await assert.rejects(screenSwap(input), (error: unknown) => error instanceof SwapGuardError && error.status === 503);
});
