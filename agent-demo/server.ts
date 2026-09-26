import { config } from "dotenv";
import Fastify, { type FastifyReply } from "fastify";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { scenarios } from "./src/scenarios";

config();

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

const port = Number(process.env.PORT ?? 8794);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be a valid port.");
const gatewayUser = required("GATEWAY_BASIC_USER");
const gatewayPassword = required("GATEWAY_BASIC_PASSWORD");
const gatewayUrl = new URL(required("GATEWAY_URL"));
if (
  (gatewayUrl.protocol !== "https:" &&
    !(
      gatewayUrl.protocol === "http:" && ["127.0.0.1", "localhost"].includes(gatewayUrl.hostname)
    )) ||
  gatewayUrl.pathname !== "/api/maat/pay"
)
  throw new Error("GATEWAY_URL must be an HTTPS Gateway pay endpoint or a local HTTP endpoint.");
const gatewayPaths = { pay: "/api/maat/pay", swap: "/api/maat/swap" } as const;
const merchantUrl = new URL(required("MERCHANT_BASE_URL"));
if (merchantUrl.protocol !== "https:")
  throw new Error("MERCHANT_BASE_URL must be an HTTPS origin.");
const gatewayAuth = `Basic ${Buffer.from(`${gatewayUser}:${gatewayPassword}`).toString("base64")}`;
const app = Fastify({ logger: true, bodyLimit: 4_000 });

async function gatewayRequest(path: string, init?: RequestInit, timeoutMs = 20_000) {
  try {
    return await fetch(new URL(path, gatewayUrl.origin), {
      ...init,
      headers: { accept: "application/json", ...init?.headers, authorization: gatewayAuth },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error("Gateway is unavailable.");
  }
}

async function forward(response: Response, reply: FastifyReply) {
  const body = await response
    .json()
    .catch(() => ({ error: "Gateway returned an invalid response." }));
  return reply.code(response.status).send(body);
}

app.get("/health", async () => ({ ok: true, service: "maat-agent-demo" }));
app.get("/api/demo/gateway", async () => ({ url: gatewayUrl.origin, endpoints: gatewayPaths }));
app.get("/api/demo/world/config", async (_request, reply) =>
  forward(await gatewayRequest("/api/world/config"), reply),
);
app.post<{ Params: { id: string; index: string } }>(
  "/api/demo/scenarios/:id/pay/:index",
  async (request, reply) => {
    const scenario = scenarios.find((item) => item.id === request.params.id);
    const index = Number(request.params.index);
    if (
      !scenario ||
      !("calls" in scenario) ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= scenario.calls.length
    ) {
      return reply.code(400).send({ error: "Invalid payment scenario or call." });
    }
    const call = scenario.calls[index];
    const response = await gatewayRequest(
      gatewayPaths.pay,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: "maat-demo-agent",
          url: new URL(call.path, merchantUrl).toString(),
          method: call.method,
          authorization: scenario.task,
          purpose: call.purpose,
          taskId: `demo-${scenario.id}`,
          ...(scenario.id === "payment-escalate" ? { demoEscalate: true } : {}),
        }),
      },
      75_000,
    );
    return forward(response, reply);
  },
);
app.post<{ Params: { id: string } }>("/api/demo/scenarios/:id/swap", async (request, reply) => {
  const scenario = scenarios.find((item) => item.id === request.params.id);
  if (!scenario || !("swap" in scenario))
    return reply.code(400).send({ error: "Invalid swap scenario." });
  const response = await gatewayRequest(
    gatewayPaths.swap,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: "maat-demo-agent",
        taskId: `demo-${scenario.id}`,
        purpose: scenario.task,
        ...scenario.swap,
      }),
    },
    75_000,
  );
  return forward(response, reply);
});
app.get<{ Params: { id: string } }>("/api/demo/decisions/:id", async (request, reply) => {
  if (!/^[0-9a-f-]{36}$/i.test(request.params.id))
    return reply.code(400).send({ error: "Invalid decision ID." });
  return forward(await gatewayRequest(`/api/maat/decisions/${request.params.id}`), reply);
});
app.get<{ Params: { id: string } }>("/api/demo/approvals/:id", async (request, reply) => {
  if (!/^[0-9a-f-]{36}$/i.test(request.params.id))
    return reply.code(400).send({ error: "Invalid approval ID." });
  return forward(await gatewayRequest(`/api/maat/approvals/${request.params.id}`), reply);
});

app.register(fastifyStatic, { root: fileURLToPath(new URL("./dist", import.meta.url)) });
app.setNotFoundHandler((request, reply) => {
  if (request.method === "GET" && !request.url.startsWith("/api/"))
    return reply.sendFile("index.html");
  return reply.code(404).send({ error: "Not found." });
});

await app.listen({ port, host: process.env.HOST ?? "127.0.0.1" });
