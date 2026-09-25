import { config } from "dotenv";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

config();

const issuer = (process.env.WORLD_ISSUER ?? "https://sandbox.auth.world.org").replace(/\/$/, "");
const clientId = process.env.WORLD_CLIENT_ID?.trim() ?? "";
const clientSecret = process.env.WORLD_CLIENT_SECRET?.trim() ?? "";
const redirectUri = process.env.WORLD_REDIRECT_URI?.trim() || "http://localhost:8788/auth/world/callback";
const configured = Boolean(clientId && clientSecret);
const attempts = new Map<string, { state: string; nonce: string; verifier: string; startedAt: number }>();
const sessions = new Map<string, { verifiedAt: number; subject: string; approved: boolean }>();

type Discovery = { authorization_endpoint: string; token_endpoint: string; jwks_uri: string };
let discoveryPromise: Promise<Discovery> | undefined;
const getDiscovery = async () => {
  discoveryPromise ??= fetch(`${issuer}/.well-known/openid-configuration`).then(async (response) => {
    if (!response.ok) throw new Error(`World discovery failed (${response.status})`);
    return response.json() as Promise<Discovery>;
  });
  return discoveryPromise;
};

const base64Url = (value: Buffer) => value.toString("base64url");
const newToken = (size = 32) => base64Url(randomBytes(size));
const pkceChallenge = (verifier: string) => base64Url(createHash("sha256").update(verifier).digest());
const parseCookie = (header: string | undefined, name: string) => header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
const cookie = (name: string, value: string, maxAge = 600) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
const sessionId = (request: { headers: { cookie?: string } }) => parseCookie(request.headers.cookie, "world_demo_session");
const getSession = (request: { headers: { cookie?: string } }) => {
  const id = sessionId(request);
  return id ? sessions.get(id) : undefined;
};

async function verifyIdToken(idToken: string, nonce: string): Promise<JWTPayload> {
  const metadata = await getDiscovery();
  const jwks = createRemoteJWKSet(new URL(metadata.jwks_uri));
  const { payload } = await jwtVerify(idToken, jwks, { issuer, audience: clientId });
  if (payload.nonce !== nonce) throw new Error("World ID nonce did not match this attempt");
  if (payload.acr !== "https://world.org/oidc/acr/orb-v3") throw new Error("A compatible Orb credential is required");
  if (!Array.isArray(payload.amr) || !payload.amr.includes("pop")) throw new Error("World proof method was not verified");
  if (typeof payload.auth_time !== "number" || Math.floor(Date.now() / 1000) - payload.auth_time > 120) throw new Error("World proof is not fresh enough");
  return payload;
}

const app = Fastify({ logger: true });
app.register(fastifyStatic, { root: join(fileURLToPath(new URL(".", import.meta.url)), "dist") });

app.get("/api/config", async () => ({ configured, issuer, redirectUri, flow: "OIDC authorization code + PKCE" }));
app.get("/api/status", async (request) => {
  const session = getSession(request);
  return session ? { state: "verified", verifiedAt: session.verifiedAt, approved: session.approved } : { state: "idle", approved: false };
});

app.get("/auth/world/start", async (request, reply) => {
  if (!configured) return reply.code(503).send({ error: "Add WORLD_CLIENT_ID and WORLD_CLIENT_SECRET to .env first." });
  const state = newToken();
  const nonce = newToken();
  const verifier = newToken(48);
  attempts.set(state, { state, nonce, verifier, startedAt: Date.now() });
  const metadata = await getDiscovery();
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "openid", state, nonce, code_challenge: pkceChallenge(verifier), code_challenge_method: "S256", max_age: "0", acr_values: "https://world.org/oidc/acr/orb-v3" });
  reply.header("Set-Cookie", cookie("world_demo_state", state));
  return reply.redirect(`${metadata.authorization_endpoint}?${params}`);
});

app.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>("/auth/world/callback", async (request, reply) => {
  const { code, state, error, error_description: errorDescription } = request.query;
  const attempt = state ? attempts.get(state) : undefined;
  const storedState = parseCookie(request.headers.cookie, "world_demo_state");
  if (error) return reply.redirect(`/?world_error=${encodeURIComponent(errorDescription || error)}`);
  if (!code || !state || !attempt || storedState !== state) return reply.redirect("/?world_error=Verification%20session%20expired%20or%20invalid");
  attempts.delete(state);
  try {
    const metadata = await getDiscovery();
    const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: attempt.verifier });
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const tokenResponse = await fetch(metadata.token_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${auth}` }, body });
    if (!tokenResponse.ok) throw new Error(`World token exchange failed (${tokenResponse.status})`);
    const tokens = await tokenResponse.json() as { id_token?: string };
    if (!tokens.id_token) throw new Error("World did not return an ID token");
    const claims = await verifyIdToken(tokens.id_token, attempt.nonce);
    if (!claims.sub) throw new Error("Verified World identity has no subject");
    const sid = newToken();
    sessions.set(sid, { verifiedAt: Date.now(), subject: claims.sub, approved: false });
    reply.header("Set-Cookie", [cookie("world_demo_session", sid, 3600), cookie("world_demo_state", "", 0)]);
    return reply.redirect("/?world_verified=1");
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "World verification failed";
    return reply.redirect(`/?world_error=${encodeURIComponent(message)}`);
  }
});

app.post("/api/protected-action", async (request, reply) => {
  const id = sessionId(request);
  const session = getSession(request);
  if (!session || !id) return reply.code(403).send({ error: "Complete a fresh World ID verification first." });
  if (session.approved) return { status: "already_approved", message: "This demo action was already approved for the current session." };
  session.approved = true;
  return { status: "approved", message: "Protected action approved. No wallet or chain transaction was required." };
});

app.post("/auth/logout", async (_request, reply) => { return reply.header("Set-Cookie", cookie("world_demo_session", "", 0)).send({ ok: true }); });
app.setNotFoundHandler((_request, reply) => reply.sendFile("index.html"));

const port = Number(process.env.PORT ?? 8788);
await app.listen({ port, host: "127.0.0.1" });
console.log(`World ID demo server listening on http://localhost:${port}`);
