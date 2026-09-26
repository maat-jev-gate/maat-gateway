import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateWithJev } from "../server/jev";

test("JEV receives the trusted authorization and keeps it out of the public trace", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.JEV_API_URL;
  const originalKey = process.env.JEV_API_KEY;
  process.env.JEV_API_URL = "https://jev.example.test/v1";
  process.env.JEV_API_KEY = "test-key";
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://jev.example.test/v1/evaluate");
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-key");
      const body = JSON.parse(String(init?.body));
      const state = JSON.parse(body.state);
      assert.equal(state.user_authorization, "Buy the dataset only if it covers Tokyo.");
      assert.equal(state.merchant_requirements[0].amount, "1000");
      return Response.json({ answers: { intent_match: { probability: 0.35 } } });
    };
    const trace: { request?: unknown; response?: unknown; status?: number } = {};
    const result = await evaluateWithJev(
      {
        url: "https://merchant.example.test/dataset/beta",
        method: "GET",
        purpose: "Buy the beta dataset; coverage is unclear.",
        authorization: "Buy the dataset only if it covers Tokyo.",
      },
      { status: 402, requirements: [{ amount: "1000" }] },
      AbortSignal.timeout(1000),
      trace,
    );
    assert.equal(result.probability, 0.35);
    assert.equal(result.confidence, undefined);
    assert.equal(trace.status, 200);
    assert.ok(!JSON.stringify(trace.request).includes("Buy the dataset only if it covers Tokyo."));
    assert.ok(!JSON.stringify(trace.request).includes("test-key"));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.JEV_API_URL;
    else process.env.JEV_API_URL = originalUrl;
    if (originalKey === undefined) delete process.env.JEV_API_KEY;
    else process.env.JEV_API_KEY = originalKey;
  }
});
