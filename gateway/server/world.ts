import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

type WorldDiscovery = { authorization_endpoint: string; token_endpoint: string; jwks_uri: string };
let discoveryPromise: Promise<WorldDiscovery> | undefined;

const clientId = () => process.env.WORLD_CLIENT_ID?.trim() ?? "";
const clientSecret = () => process.env.WORLD_CLIENT_SECRET?.trim() ?? "";
export const worldConfigured = () => Boolean(clientId() && clientSecret());
export const worldIssuer = () =>
  (process.env.WORLD_ISSUER ?? "https://sandbox.auth.world.org").replace(/\/$/, "");
export const worldRedirectUri = () =>
  process.env.WORLD_REDIRECT_URI?.trim() || "http://localhost:8787/auth/world/callback";

async function worldDiscovery() {
  discoveryPromise ??= fetch(`${worldIssuer()}/.well-known/openid-configuration`).then(
    async (response) => {
      if (!response.ok) throw new Error(`World discovery failed (${response.status})`);
      return response.json() as Promise<WorldDiscovery>;
    },
  );
  return discoveryPromise;
}

const newToken = (size = 32) => randomBytes(size).toString("base64url");

export async function beginWorldAuthorization() {
  const state = newToken();
  const nonce = newToken();
  const verifier = newToken(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const metadata = await worldDiscovery();
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: worldRedirectUri(),
    response_type: "code",
    scope: "openid",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    max_age: "0",
    acr_values: "https://world.org/oidc/acr/orb-v3",
  });
  return { state, nonce, verifier, url: `${metadata.authorization_endpoint}?${params}` };
}

export async function exchangeWorldCode(code: string, verifier: string) {
  const metadata = await worldDiscovery();
  const response = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId()}:${clientSecret()}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: worldRedirectUri(),
      code_verifier: verifier,
    }),
  });
  const tokens = response.ok
    ? ((await response.json().catch(() => ({}))) as { id_token?: string })
    : undefined;
  return { status: response.status, idToken: tokens?.id_token };
}

export async function verifyWorldToken(idToken: string, nonce: string): Promise<JWTPayload> {
  const metadata = await worldDiscovery();
  const { payload } = await jwtVerify(idToken, createRemoteJWKSet(new URL(metadata.jwks_uri)), {
    issuer: worldIssuer(),
    audience: clientId(),
  });
  if (payload.nonce !== nonce) throw new Error("World ID nonce did not match this attempt.");
  if (payload.acr !== "https://world.org/oidc/acr/orb-v3")
    throw new Error("A compatible Orb credential is required.");
  if (!Array.isArray(payload.amr) || !payload.amr.includes("pop"))
    throw new Error("World proof method was not verified.");
  if (
    typeof payload.auth_time !== "number" ||
    Math.floor(Date.now() / 1000) - payload.auth_time > 120
  )
    throw new Error("World proof is not fresh enough.");
  return payload;
}

export function worldResultPage(status: "success" | "failure", message: string) {
  const escapedMessage = message.replace(
    /[&<>\"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
      character,
  );
  const title =
    status === "success" ? "World ID verification successful" : "World ID verification failed";
  const mark = status === "success" ? "&#10003;" : "!";
  const tone = status === "success" ? "success" : "failure";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #f3f5f4; color: #21332d; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; box-sizing: border-box; }
      main { width: min(100%, 420px); padding: 34px; box-sizing: border-box; text-align: center; background: #fffdf8; border: 1px solid #dbe2dd; border-radius: 8px; box-shadow: 0 16px 40px rgba(34, 57, 48, .08); }
      .mark { width: 58px; height: 58px; margin: 0 auto 22px; display: grid; place-items: center; border-radius: 50%; font-size: 28px; font-weight: 700; }
      .success .mark { color: #236d54; background: #e3f1e9; }
      .failure .mark { color: #a04536; background: #f9e8e3; }
      h1 { margin: 0; font-size: 22px; letter-spacing: -.02em; }
      p { margin: 12px 0 26px; color: #68766f; line-height: 1.55; }
      button { border: 0; border-radius: 4px; padding: 12px 22px; background: #2c6655; color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
      button:hover { background: #205344; }
    </style>
  </head>
  <body>
    <main class="${tone}">
      <div class="mark" aria-hidden="true">${mark}</div>
      <h1>${title}</h1>
      <p>${escapedMessage}</p>
      <button type="button" onclick="window.close()">Close window</button>
    </main>
  </body>
</html>`;
}
