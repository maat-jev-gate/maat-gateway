import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { beginWorldAuthorization, exchangeWorldCode, worldConfigured } from "../server/world";

test("World authorization binds PKCE and the token exchange to the configured callback", async () => {
  const originalFetch = globalThis.fetch;
  const original = Object.fromEntries(
    ["WORLD_CLIENT_ID", "WORLD_CLIENT_SECRET", "WORLD_REDIRECT_URI", "WORLD_ISSUER"].map((name) => [
      name,
      process.env[name],
    ]),
  );
  process.env.WORLD_CLIENT_ID = "test-client";
  process.env.WORLD_CLIENT_SECRET = "test-secret";
  process.env.WORLD_REDIRECT_URI = "https://gateway.example.test/auth/world/callback";
  process.env.WORLD_ISSUER = "https://world.example.test";
  try {
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith("/.well-known/openid-configuration")) {
        return Response.json({
          authorization_endpoint: "https://world.example.test/authorize",
          token_endpoint: "https://world.example.test/token",
          jwks_uri: "https://world.example.test/jwks",
        });
      }
      assert.equal(String(url), "https://world.example.test/token");
      assert.equal(init?.method, "POST");
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        `Basic ${Buffer.from("test-client:test-secret").toString("base64")}`,
      );
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get("code"), "test-code");
      assert.equal(body.get("redirect_uri"), process.env.WORLD_REDIRECT_URI);
      assert.equal(body.get("code_verifier"), attempt.verifier);
      return Response.json({ id_token: "test-id-token" });
    };
    assert.equal(worldConfigured(), true);
    const attempt = await beginWorldAuthorization();
    const url = new URL(attempt.url);
    assert.equal(url.origin, "https://world.example.test");
    assert.equal(url.searchParams.get("state"), attempt.state);
    assert.equal(url.searchParams.get("nonce"), attempt.nonce);
    assert.equal(url.searchParams.get("redirect_uri"), process.env.WORLD_REDIRECT_URI);
    assert.equal(
      url.searchParams.get("code_challenge"),
      createHash("sha256").update(attempt.verifier).digest("base64url"),
    );
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.deepEqual(await exchangeWorldCode("test-code", attempt.verifier), {
      status: 200,
      idToken: "test-id-token",
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
