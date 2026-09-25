# Maat World Demo

A small React + Fastify demo for World ID for Agents. It demonstrates the complete browser flow described in the Tokyo 2026 plan:

1. Start a fresh OIDC authorization request with PKCE, state, nonce, `max_age=0`, and the Orb v3 assurance value.
2. Exchange the callback code on the server and verify the ID token signature through World’s JWKS.
3. Release one protected action only after the verified server session is present.

No wallet connection, smart contract, transaction signing, or gas is involved in this identity check.

## Run locally

```bash
npm install
cp .env.example .env
```

Register a confidential client in the [World Sandbox Portal](https://sandbox.auth.world.org/portal), then set `WORLD_CLIENT_ID` and `WORLD_CLIENT_SECRET` in `.env`. Register this exact callback URL:

```text
https://world-demo.maat-jev-gate.online/auth/world/callback
```

For local development, use `http://localhost:8788/auth/world/callback` instead and set the same value in `.env`.

Start the app:

```bash
npm run dev
```

Open [http://localhost:5174](http://localhost:5174). The browser talks to Vite, which proxies `/api` and `/auth` to Fastify on port `8788`.

The server keeps demo sessions in memory. Restarting the server clears them. Client secrets and ID tokens never go to the React app.
