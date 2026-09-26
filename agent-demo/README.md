# Maat Agent Demo

This demo runs a fixed four-step payment story in a full-screen agent view. Each step calls a user-supplied Maat gateway URL with the contract from the project plan:

```json
{ "agentId": "maat-demo-agent", "url": "...", "method": "GET", "purpose": "...", "taskId": "demo-fixed-payment-run" }
```

The browser calls `VITE_MAAT_GATEWAY_URL` (defaulting to `https://gateway.maat-jev-gate.online/api/maat/pay`) and adds HTTP Basic authentication from `VITE_MAAT_GATEWAY_BASIC_USER` and `VITE_MAAT_GATEWAY_BASIC_PASSWORD`. This is intentionally a local demo: Vite exposes `VITE_` variables to the browser, so do not use a production credential here. The demo does not call OpenAI and does not contain a wallet key.

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:5175` for local development. The published Agent UI is `https://agent.maat-jev-gate.online`. The browser calls the Gateway directly, so the Gateway must allow CORS requests from both the local Vite origin and the published Agent origin.

## Publish

Set `DEPLOY_HOST` in `.env`, then run:

```bash
npm run deploy:validate
npm run deploy
```

The deploy script builds the static Vite output, syncs it and `deploy/caddy/site.caddy` with `rsync`, validates and reloads Caddy, then checks the site on the remote machine. The production site is served directly by Caddy; no Node process or PM2 service is needed for this static Agent UI.
