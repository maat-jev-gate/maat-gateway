# Maat x402 Merchant Service

This is the reusable merchant service for the Maat x402 demo. It advertises payment requirements with x402 and settles a payment through an x402 facilitator before returning the protected response. The root x402 Merchant page shows all three mock Merchant profiles and identifies the profile behind each request.

Request and settlement records are saved in the local, Git-ignored `data/history.json` file in development and production. The console's **Clear History** button opens a confirmation dialog and clears only Merchant records.

## Run

```bash
npm install
cp .env.example .env
# Set MERCHANT_PAY_TO to a Base Sepolia address before using real payments.
npm run dev
```

The production merchant console and API are available at `https://merchant.maat-jev-gate.online`. The deployment script reads `DEPLOY_HOST` and `DEPLOY_DOMAIN` from the ignored `.env`, syncs that file and `deploy/caddy/site.caddy` with `rsync`, then updates PM2 and Caddy. Set `VENDOR_BASE_URL=https://merchant.maat-jev-gate.online` in the local `.env` before publishing:

```bash
npm run deploy
```

The public `https://x402.org/facilitator` test service does not require an OAuth token. Leave `FACILITATOR_AUTH_TOKEN` empty. That variable is only for a private facilitator that explicitly gives you a Bearer API token; it is not a MetaMask credential and there is no token to create for this demo.

The service hosts three mock Merchant profiles, each with its own x402 resource and 402 payment requirements:

| Mock Merchant | Resource | Price | Recipient |
| --- | --- | --- | --- |
| Dataset seller | `GET /vendor/atlas/dataset/:id` | $0.001 USDC | `MERCHANT_PAY_TO` |
| Verification service | `POST /vendor/atlas/verify-account` | $80.00 USDC | `MERCHANT_VERIFY_PAY_TO`, falling back to `MERCHANT_PAY_TO` |
| Risk recipient | `GET /vendor/atlas/risk-check` | $0.001 USDC | `MERCHANT_RISK_PAY_TO`; returns HTTP 503 until configured |

- `GET /health` reports configuration without exposing secrets.

Without a `PAYMENT-SIGNATURE` header, configured vendor endpoints return HTTP `402` with a base64 encoded `PAYMENT-REQUIRED` header. When the header is present, the service decodes the x402 payload, calls the facilitator `/verify` and `/settle` endpoints, and only then returns data.

`DEMO_ALLOW_UNSIGNED_PAYMENT=true` is available for local route wiring only. It returns a response marked `payment.demo=true` and does not create a transaction. Keep it `false` for the real Maat demo.

## On-chain boundary

This project does **not** deploy a smart contract. The merchant is an off-chain HTTP server. The payment becomes an on-chain transaction when the facilitator settles a valid Base Sepolia USDC payment to `MERCHANT_PAY_TO`; the returned `payment.txHash` is the settlement transaction hash. The Maat gateway remains the component that decides whether an agent may create and submit that payment.

The merchant address must be a real Base Sepolia EVM address. It is intentionally supplied through `.env`, because the plan calls for selecting and screening the address with Intercepta rather than hard-coding an unverified address in source.
For the risk demo, set `MERCHANT_RISK_PAY_TO` to the known-risk mainnet address supplied in Intercepta's ETHGlobal Discord channel. Configure the same value as `AGENT_RISK_PAY_TO` in the Agent service. The Gateway screens that address before signing the Base Sepolia payment. `MERCHANT_VERIFY_PAY_TO` can give the $80 service a separate recipient without changing the other quotes.
