# Maat Gateway Workspace

This directory contains the small projects used to demonstrate the Maat payment gate. The intended call direction is:

```text
Agent → Maat Gateway → x402 Merchant
                      ├── JEV runs inside the Gateway backend
                      └── World ID is used only when a decision needs a human
```

The Agent never receives the treasury private key. The Gateway owns the decision process and signs x402 payments with its server-only treasury private key after a decision allows the request.

## Public subdomains

The four public projects use the following subdomains under `maat-jev-gate.online`:

| Project | Public URL | Purpose |
| --- | --- | --- |
| `x402-demo/merchant/` | `https://merchant.maat-jev-gate.online` | x402 Merchant API and merchant console |
| `gateway/` | `https://gateway.maat-jev-gate.online` | Maat Gateway API and observer UI |
| `agent-demo/` | `https://agent.maat-jev-gate.online` | Agent payment demonstration UI |
| `world-demo/` | `https://world-demo.maat-jev-gate.online` | World ID verification demonstration and callback endpoint |

`x402-demo/client/` is a local MetaMask learning client and does not receive a public subdomain or a remote deployment.

The World callback must remain:

```text
https://world-demo.maat-jev-gate.online/auth/world/callback
```

DNS should point these four hostnames to the deployment server. Caddy terminates HTTPS and routes the two server applications (`gateway` and `merchant`) to their local Node ports; `agent-demo` is static output, and `world-demo` uses its existing PM2 and Caddy deployment setup.

## Subprojects

```text
maat-gateway/
├── agent-demo/   Browser demo that sends authenticated payment intents to the Gateway
├── gateway/      Maat Gateway API, JEV backend integration, World approval state machine, and polling observer UI
├── swap-guard/   Standalone Next.js swap guard on Ethereum mainnet: Uniswap quote, Intercepta, deployer forensics, JEV (analysis only)
├── x402-demo/
│   ├── merchant/ x402 Merchant that returns HTTP 402 requirements and settles a supplied payment
│   └── client/   Direct MetaMask-to-Merchant learning demo; not the final Agent path
└── world-demo/   Standalone World ID for Agents OIDC reference implementation
```

## How the projects call each other

1. `agent-demo` sends `POST /api/maat/pay` to `gateway` with Basic Auth and the `agentId`, Merchant URL, HTTP method, purpose, and task ID.
2. `gateway/server/app.ts` requests the configured Merchant URL. For the x402 example, this is `x402-demo/merchant`, which first returns a 402 quote.
3. The Gateway sends the original purpose, Agent request, and Merchant response to JEV from the server process.
4. `ALLOW` and `BLOCK` decisions are returned immediately. `ESCALATE` returns HTTP 202 plus an `approvalId` and `intentHash`.
5. The `gateway` observer UI polls the decisions and approval status. The user can start World ID from the pending card.
6. After the Gateway validates the World OIDC callback, it replays the same stored Merchant request and marks the approval as released. The request is bound to the original `intentHash`.

If JEV is unavailable, the Gateway records a `fallback` decision using `JEV_FALLBACK_VERDICT` (default `ESCALATE`). The Debug Panel applies bypass settings on the server. All bypass settings default to `false`; when no setting is changed, the online flow remains JEV evaluation, real payment execution, and World ID approval.

`world-demo` is a standalone reference for the World OIDC flow. The new `gateway` project contains its own copy of that server-side flow so its approval lifecycle stays in the Gateway backend. `x402-demo/client` intentionally demonstrates the lower-level wallet flow and does not represent the final Agent-to-Gateway path.

## Current implementation boundary

The Gateway provides Basic Auth, Merchant inspection, direct JEV calls, server-side x402 signing and settlement, decision polling, asynchronous World approval, and a single-column observer UI. The treasury key is configured only in the Gateway server environment.

See [`gateway/README.md`](gateway/README.md) for setup, environment variables, API behavior, and verification commands.

## Deploy Gateway

The Gateway deployment follows the World Demo's PM2 and Caddy pattern. Fill the deployment and production integration values in the ignored `gateway/.env`, then run:

```bash
cd gateway
npm install
npm run deploy
```

The script builds and type-checks the Gateway locally, syncs the build, server files, `.env`, and `deploy/caddy/site.caddy` to `/opt/maat-gateway` and the Caddy site directory, installs production dependencies, reloads the `maat-gateway` PM2 process, and verifies `/health` on the remote host.
