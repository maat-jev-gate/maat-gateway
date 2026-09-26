# Maat Agent Demo

The Agent interface presents six independent scenes from the demo script:

| Scene | Gateway endpoint | Current behavior |
| --- | --- | --- |
| Accept dataset purchase | `POST /api/maat/pay` | Buys one $0.001 dataset and displays the returned rows. |
| Block verification fee | `POST /api/maat/pay` | Sends the Merchant's $80 verification request for a Gateway decision. |
| Block risky recipient | `POST /api/maat/pay` | Requests a $0.001 x402 resource whose Merchant quote uses the configured risk recipient. Intercepta decides whether it is blocked. |
| Escalate dataset purchase | `POST /api/maat/pay` | Requests a $0.001 dataset with uncertain coverage. JEV evaluates the live quote; owner approval is required before payment. |
| Review ETH-to-USDC swap | `POST /api/maat/swap` | Requests a $30 mainnet analysis and displays the Guard's live verdict. `ESCALATE` creates a World ID approval; no trade runs. |
| Screen a social token | `POST /api/maat/swap` | Requests a live ETH-to-PEPE analysis and displays the Guard's verdict and quote. No trade runs. |

The browser calls only the Agent service's same-origin `/api/demo/scenarios/*` routes. The Agent service keeps Gateway credentials in its ignored `.env`, sends the fixed scene intents to the Gateway, and forwards decisions. Its `/api/demo/gateway` route exposes the configured public Gateway origin and pay/swap endpoint paths. The Merchant origin comes from `MERCHANT_BASE_URL`; the dataset, verification, and risk resource URLs are defined in `src/scenarios.ts`. Browser requests cannot choose a Merchant URL or payment amount. The Agent UI is open to visitors; Gateway credentials remain server-side.

The Merchant's 402 quote supplies the payment recipient. The Gateway screens that address with Intercepta before signing the Base Sepolia payment. For the risk scene, set `MERCHANT_RISK_PAY_TO` in the Merchant's ignored `.env` to a known-risk mainnet address from Intercepta's pinned ETHGlobal Discord message.

The approval scene sends `demoEscalate: true` for its fixed Agent and task ID. The Gateway checks the Merchant quote and Intercepta, then calls JEV. A JEV probability between 0.30 and 0.80 escalates on its own; otherwise the scene uses a labeled demo override to require owner review. The Gateway console can confirm with World ID or cancel without payment. After approval, the Agent polls the original decision and shows the purchased data only after the Merchant payment completes. World ID must be configured on the Gateway for confirmation to proceed.

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
