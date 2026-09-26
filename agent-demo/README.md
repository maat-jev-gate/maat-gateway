# Maat Agent Demo

This demo runs a fixed four-step payment story in a full-screen agent view. The Agent service sends each payment intent to the configured Maat Gateway:

```json
{ "agentId": "maat-demo-agent", "url": "...", "method": "GET", "purpose": "...", "taskId": "demo-fixed-payment-run" }
```

The browser calls only the Agent service's same-origin `/api/demo/*` routes. The service keeps `GATEWAY_BASIC_USER` and `GATEWAY_BASIC_PASSWORD` in its server-side `.env`, calls `GATEWAY_URL`, and forwards Gateway decisions. `AGENT_SITE_BASIC_USER` and `AGENT_SITE_BASIC_PASSWORD` protect the site and its API with separate credentials. The four Merchant endpoints are fixed in `src/steps.ts`; browser requests cannot choose a payment URL. The demo does not call OpenAI and does not contain a wallet key.

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:5175` for local development. Vite proxies `/api` to the Agent service on port `8794`. The published Agent UI is `https://agent.maat-jev-gate.online`. Sign in with the Agent site credentials from `.env`; they are distinct from the Gateway credentials.

## Publish

Set `DEPLOY_HOST` in `.env`, then run:

```bash
npm run deploy:validate
npm run deploy
```

The deploy script builds the Vite output, syncs the Agent service and its server-only `.env`, installs production dependencies, starts it with PM2, then updates Caddy to proxy the public domain to port `8794`. `npm start` serves the built site and API directly without Caddy when another HTTPS ingress is used.
