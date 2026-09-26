# Maat Agent Demo

The Agent interface presents five independent scenes from the demo script:

| Scene | Gateway endpoint | Current behavior |
| --- | --- | --- |
| Accept dataset purchase | `POST /api/maat/pay` | Buys one $0.001 dataset and displays the returned rows. |
| Block verification fee | `POST /api/maat/pay` | Sends the Merchant's $80 verification request for a Gateway decision. |
| Approve dataset purchase | `POST /api/maat/pay` | Buys one $0.001 dataset after a Gateway operator enables JEV bypass with the ESCALATE result and a human approves it. |
| Swap with approval | `POST /api/maat/swap` | Reaches the swap endpoint, which currently returns HTTP 501. |
| Block risky swap | `POST /api/maat/swap` | Reaches the swap endpoint, which currently returns HTTP 501. |

The browser calls only the Agent service's same-origin `/api/demo/scenarios/*` routes. The Agent service keeps Gateway credentials in its ignored `.env`, sends the fixed scene intents to the Gateway, and forwards decisions. Its `/api/demo/gateway` route exposes only the configured public Gateway origin and pay/swap endpoint paths for display. The Merchant origin comes from `MERCHANT_BASE_URL`; the allowed resource paths are defined in `src/scenarios.ts`. Browser requests cannot choose a Merchant URL or payment amount. The Agent UI is open to visitors; Gateway credentials remain server-side.

The approval scene uses the Gateway Debug Panel's existing **Bypass JEV** and **JEV bypass result: Escalate** settings. This produces a labeled fallback decision, not a JEV model result. The Agent rejects this scene when those settings are not enabled. After an approval, the Agent polls the original decision and shows the purchased data only after the Merchant payment completes. World ID must be configured on the Gateway for that approval to proceed.

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
