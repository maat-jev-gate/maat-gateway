# Maat Gateway Workspace

Maat Gateway screens an Agent's x402 payments and swap intents before any payment is signed.

## Flow

```text
Agent → Gateway → x402 Merchant (payment)
                → Swap Guard → Uniswap (swap analysis)
```

The Agent sends authenticated intents to the Gateway and never receives its treasury key. For payments, the Gateway reads the Merchant's 402 quote, screens it with Intercepta, and evaluates the intent with JEV. `ALLOW` signs and settles the payment, `BLOCK` stops it, and `ESCALATE` waits for World ID approval. The Gateway observer shows decisions and lets the user confirm or cancel; its World callback is `https://gateway.maat-jev-gate.online/auth/world/callback`.

For swaps, the Gateway forwards the intent to Swap Guard for a Uniswap quote and risk analysis. No trade is signed or broadcast.

## Projects

| Project | Subproject | URL | Purpose | Integrations |
| --- | --- | --- | --- | --- |
| Maat Gateway | [`gateway/`](gateway/) | [https://gateway.maat-jev-gate.online](https://gateway.maat-jev-gate.online) | Payment decisions, approval, and observer UI | World ID for Agents, Intercepta, JEV |
| Maat Agent | [`agent-demo/`](agent-demo/) | [https://agent.maat-jev-gate.online](https://agent.maat-jev-gate.online) | Agent payment and swap demonstration | Gateway API |
| Maat Merchant | [`x402-demo/merchant/`](x402-demo/merchant/) | [https://merchant.maat-jev-gate.online](https://merchant.maat-jev-gate.online) | x402 resource quotes and payment settlement | x402 |
| Maat Swap Guard | [`swap-guard/`](swap-guard/) | [https://swap.maat-jev-gate.online](https://swap.maat-jev-gate.online) | Ethereum mainnet swap analysis; no trading execution | Uniswap, Intercepta, JEV |
| Maat Demo | [`maat-demo/`](maat-demo/) | [https://demo.maat-jev-gate.online](https://demo.maat-jev-gate.online) | Combined view of the four main demos | Agent, Gateway, Merchant, Swap Guard pages |
| x402 Client | [`x402-demo/client/`](x402-demo/client/) | — | Local MetaMask payment demo | MetaMask, Merchant API |

DNS should point these hostnames to the deployment server. Caddy terminates HTTPS and routes each server application to its local Node port.

## Sponsor integration code

| Integration | Call and decision locations |
| --- | --- |
| World ID for Agents | [Start OIDC authorization](gateway/server/world.ts#L27), [exchange the code](gateway/server/world.ts#L48), [verify the ID token](gateway/server/world.ts#L67), and [handle approval and payment release](gateway/server/app.ts#L643) |
| JEV | [Call the TypeSafe evaluation API](gateway/server/jev.ts#L17) and [apply the payment verdict](gateway/server/app.ts#L831); Swap Guard has a [separate swap evaluation](swap-guard/lib/jev.ts#L39) |
| Uniswap | [Request a Trading API quote](swap-guard/lib/uniswap.ts#L175) or [quote v2/v3 contracts onchain](swap-guard/lib/uniswap.ts#L73); the [Swap Guard decision pipeline](swap-guard/lib/engine.ts#L54) uses the quote for analysis only |
| Intercepta | [Call the live API](gateway/server/intercepta.ts#L92), [screen the x402 recipient and token](gateway/server/intercepta.ts#L120), and [apply the result before payment signing](gateway/server/app.ts#L798); Swap Guard also [scans tokens](swap-guard/lib/intercepta.ts#L108) |

## Integration feedback

### World ID for Agents

[Integration feedback](FEEDBACK.md#world-id-for-agents)

### Intercepta

[Integration feedback](FEEDBACK.md#intercepta)

## Deploy Gateway

The Gateway deploys with PM2 and Caddy. Fill the deployment and production integration values in the ignored `gateway/.env`, then run:

```bash
cd gateway
npm install
npm run deploy
```

The script builds and type-checks the Gateway locally, syncs the build, server files, `.env`, and `deploy/caddy/site.caddy` to `/opt/maat-gateway` and the Caddy site directory, installs production dependencies, reloads the `maat-gateway` PM2 process, and verifies `/health` on the remote host.
