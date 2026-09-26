# Maat Agent Demo

The Agent interface presents four independent scenes from the demo script:

| Scene | Gateway endpoint | Current behavior |
| --- | --- | --- |
| Pay for datasets | `POST /api/maat/pay` | Sends three x402 purchases to the live Merchant, one after another. |
| Block verification fee | `POST /api/maat/pay` | Sends the Merchant's $80 verification request for a Gateway decision. |
| Swap with approval | `POST /api/maat/swap` | Reaches the swap endpoint, which currently returns HTTP 501. |
| Block risky swap | `POST /api/maat/swap` | Reaches the swap endpoint, which currently returns HTTP 501. |

The browser calls only the Agent service's same-origin `/api/demo/scenarios/*` routes. The Agent service keeps Gateway credentials in its ignored `.env`, sends the fixed scene intents to the Gateway, and forwards decisions. Its `/api/demo/gateway` route exposes only the configured public Gateway origin and pay/swap endpoint paths for display. The Merchant origin comes from `MERCHANT_BASE_URL`; the allowed resource paths are defined in `src/scenarios.ts`. Browser requests cannot choose a Merchant URL or payment amount. The Agent UI is open to visitors; Gateway credentials remain server-side.

The current Agent adapter makes direct HTTP tool calls. An MCP server could expose the same `maat_pay` and `maat_swap` operations to general-purpose agents; this demo does not claim to use MCP today.

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

Set the Gateway credentials in `.env`. The intended public demo domains are provided in `.env.example`; local development uses the same online Merchant and Gateway. The interface runs at `http://localhost:5175`, and Vite proxies API requests to the Agent service on port `8794`. The published Agent UI is `https://agent.maat-jev-gate.online` and does not require a visitor login.

## Publish

Set `DEPLOY_HOST` in `.env`, then run:

```bash
npm run deploy:validate
npm run deploy
```

The deploy script builds the site, syncs the Agent service and its server-only `.env`, installs production dependencies, starts it with PM2, and updates Caddy. `npm start` serves the built site and API directly when another HTTPS ingress is used.
