import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { checkPaymentRisk } from "../server/intercepta";

const originalFetch = globalThis.fetch;
const originalKey = process.env.INTERCEPTA_API_KEY;
const originalCache = process.env.INTERCEPTA_CACHE;
const recipient = "0x1111111111111111111111111111111111111111";
const testnetUsdc = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const requirements = { payTo: recipient, asset: testnetUsdc, network: "eip155:84532" };

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.INTERCEPTA_API_KEY;
  else process.env.INTERCEPTA_API_KEY = originalKey;
  if (originalCache === undefined) delete process.env.INTERCEPTA_CACHE;
  else process.env.INTERCEPTA_CACHE = originalCache;
});

test("screens the recipient and the Base mainnet USDC proxy before allowing payment", async () => {
  process.env.INTERCEPTA_API_KEY = "test-key";
  process.env.INTERCEPTA_CACHE = "off";
  const urls: string[] = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(new Headers(init?.headers).get("X-API-KEY"), "test-key");
    urls.push(String(input));
    return Response.json(urls.length === 1
      ? { toxicScore: 0, traits: [] }
      : { action: "allow", riskLevel: "low", category: "legitimate" });
  };
  const risk = await checkPaymentRisk(requirements);
  assert.equal(risk.status, "clear");
  assert.equal(risk.scans.length, 2);
  assert.deepEqual(risk.scans.map((scan) => scan.request.method), ["GET", "GET"]);
  assert.deepEqual(risk.scans.map((scan) => scan.response), [{ toxicScore: 0, traits: [] }, { action: "allow", riskLevel: "low", category: "legitimate" }]);
  assert.ok(risk.scans.every((scan) => !JSON.stringify(scan.request).includes("test-key")));
  assert.match(urls[0], /account\/0x1111111111111111111111111111111111111111\/quick-scan/);
  assert.match(urls[1], /token\/0x833589fcd6edb6e08f4c7c32d4f71b54bda02913\/risks\?chainId=8453/);
});

test("blocks a risky recipient without needing a token verdict", async () => {
  process.env.INTERCEPTA_API_KEY = "test-key";
  process.env.INTERCEPTA_CACHE = "off";
  globalThis.fetch = async (input) => Response.json(String(input).includes("quick-scan")
    ? { toxicScore: 90, traits: [{ name: "known_scammer", risk: 90 }] }
    : { action: "allow", riskLevel: "low" });
  const risk = await checkPaymentRisk(requirements);
  assert.equal(risk.status, "blocked");
  assert.match(risk.reasons.join(" "), /toxic score 90/);
});

test("does not clear payment when Intercepta is unavailable", async () => {
  delete process.env.INTERCEPTA_API_KEY;
  const risk = await checkPaymentRisk(requirements);
  assert.equal(risk.status, "unavailable");
  assert.match(risk.reasons[0], /INTERCEPTA_API_KEY/);
});
