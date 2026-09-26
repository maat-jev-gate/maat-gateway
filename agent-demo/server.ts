import { config } from "dotenv";
import Fastify, { type FastifyReply } from "fastify";
import fastifyStatic from "@fastify/static";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { steps } from "./src/steps";

config();

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

const port = Number(process.env.PORT ?? 8794);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid port.");
const siteUser = required("AGENT_SITE_BASIC_USER");
const sitePassword = required("AGENT_SITE_BASIC_PASSWORD");
const gatewayUser = required("GATEWAY_BASIC_USER");
const gatewayPassword = required("GATEWAY_BASIC_PASSWORD");
const gatewayUrl = new URL(process.env.GATEWAY_URL?.trim() || "https://gateway.maat-jev-gate.online/api/maat/pay");
if (gatewayUrl.protocol !== "https:" || gatewayUrl.pathname !== "/api/maat/pay") throw new Error("GATEWAY_URL must be an HTTPS Gateway pay endpoint.");
const gatewayAuth = `Basic ${Buffer.from(`${gatewayUser}:${gatewayPassword}`).toString("base64")}`;
const app = Fastify({ logger: true, bodyLimit: 4_000 });

function matchesBasicAuth(header: string | undefined) {
  if (!header?.startsWith("Basic ")) return false;
  const actual = Buffer.from(header.slice(6), "base64");
  const expected = Buffer.from(`${siteUser}:${sitePassword}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

app.addHook("onRequest", async (request, reply) => {
  if (request.url === "/health") return;
  if (!matchesBasicAuth(request.headers.authorization)) {
    return reply.code(401).header("WWW-Authenticate", 'Basic realm="Maat Agent Demo"').send({ error: "Agent demo authentication required." });
  }
});

async function gatewayRequest(path: string, init?: RequestInit) {
  try {
    return await fetch(new URL(path, gatewayUrl.origin), {
      ...init,
      headers: { accept: "application/json", ...init?.headers, authorization: gatewayAuth },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error("Gateway is unavailable.");
  }
}

async function forward(response: Response, reply: FastifyReply) {
  const body = await response.json().catch(() => ({ error: "Gateway returned an invalid response." }));
  return reply.code(response.status).send(body);
}

app.get("/health", async () => ({ ok: true, service: "maat-agent-demo" }));
app.post<{ Params: { index: string }; Body: { task?: unknown } }>("/api/demo/steps/:index", async (request, reply) => {
  const index = Number(request.params.index);
  const task = request.body?.task;
  if (!Number.isInteger(index) || index < 0 || index >= steps.length || typeof task !== "string" || !task.trim() || task.length > 1_000) {
    return reply.code(400).send({ error: "A valid step and task are required." });
  }
  const step = steps[index];
  const response = await gatewayRequest("/api/maat/pay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId: "maat-demo-agent", url: step.url, method: step.method, purpose: `${task.trim()} - ${step.purpose}`, taskId: "demo-fixed-payment-run" }),
  });
  return forward(response, reply);
});
app.get<{ Params: { id: string } }>("/api/demo/decisions/:id", async (request, reply) => {
  if (!/^[0-9a-f-]{36}$/i.test(request.params.id)) return reply.code(400).send({ error: "Invalid decision ID." });
  return forward(await gatewayRequest(`/api/maat/decisions/${request.params.id}`), reply);
});

app.register(fastifyStatic, { root: fileURLToPath(new URL("./dist", import.meta.url)) });
app.setNotFoundHandler((request, reply) => {
  if (request.method === "GET" && !request.url.startsWith("/api/")) return reply.sendFile("index.html");
  return reply.code(404).send({ error: "Not found." });
});

await app.listen({ port, host: process.env.HOST ?? "127.0.0.1" });
