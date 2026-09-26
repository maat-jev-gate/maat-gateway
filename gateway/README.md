# Maat Gateway

Maat Gateway is the server-side payment gate between an Agent and an x402 Merchant. The Agent sends one authenticated HTTP request; the Gateway contacts the Merchant, evaluates the payment intent with JEV, and returns a decision. The browser is an observer for the decision stream and does not participate in the payment decision.

## Runtime topology

```text
agent-demo
    │ POST /api/maat/pay + Basic Auth
    ▼
gateway/server.ts
    ├── fetch Merchant URL (quote / HTTP 402)
    ├── screen payTo and supported payment token with Intercepta
    ├── call TypeSafe System One / JEV
    ├── ALLOW      → return decision
    ├── BLOCK      → return decision without releasing a Merchant result
    └── ESCALATE   → create approvalId, wait for World ID, then release Merchant response

gateway/src/App.tsx
    └── polls /api/maat/decisions and /api/maat/approvals/:id every 2 seconds
```

For an `ALLOW` decision, the Gateway signs the x402 EIP-712 `TransferWithAuthorization` payload with the server-only `MAAT_TREASURY_PRIVATE_KEY`, sends it in `PAYMENT-SIGNATURE`, and returns the settled Merchant response. The same path runs after an approved World ID check. The treasury key is never sent to the Agent or browser.

## Directory structure

```text
gateway/
├── server.ts          Thin process entry point
├── server/
│   ├── app.ts         Fastify API assembly and backend request flow
│   ├── intercepta.ts  Server-side x402 recipient and token risk checks
│   └── settings.ts    Server-owned runtime settings and defaults
├── src/
│   ├── App.tsx        Single-column decision stream and development request form
│   ├── main.tsx       React entry point
│   ├── styles.css     Gateway observer interface styles
│   └── vite-env.d.ts  Vite client type declarations
├── index.html         Vite HTML entry
├── vite.config.ts     React build and local API proxy configuration
├── tsconfig.json      TypeScript configuration for server and client
├── .env.example       Server configuration template
└── package.json        Development, build, start, and typecheck scripts
```

## Agent, Gateway, and Merchant calls

The Agent sends x402 requests to `POST /api/maat/pay` and swap intents to the separate `POST /api/maat/swap` endpoint. The pay endpoint contacts the Merchant and runs the current decision and settlement flow. The swap endpoint validates the intent and returns HTTP 501 until the Uniswap quote, risk checks, approval, and execution service is implemented.

The Agent implementation is in [`../agent-demo`](../agent-demo). It sends the following body to `POST /api/maat/pay` and adds an `Authorization: Basic ...` header from its local environment:

The Gateway enables CORS for the Agent's browser request, including the `Authorization` header used by the local demo.

```json
{
  "agentId": "maat-demo-agent",
  "url": "https://merchant.maat-jev-gate.online/vendor/atlas/dataset/demo-1",
  "method": "GET",
  "purpose": "Purchase one Atlas dataset",
  "taskId": "gateway-smoke-test"
}
```

The Gateway uses `url` and `method` to contact the Merchant in `merchantRequest`. The Merchant is the [`../x402-demo/merchant`](../x402-demo/merchant) service. It returns HTTP 402 and payment requirements before a payment is supplied. The Gateway includes those requirements in the JEV state, but does not expose the JEV API key to the Agent or browser.

`BLOCK` decisions return immediately. `ALLOW` and `ESCALATE` decisions return HTTP `202` with a decision `id` and `paymentStatus: "pending"`; the Agent must poll `GET /api/maat/decisions/:id` until `paymentStatus` becomes `completed` or `failed`. Payment signing and settlement happen asynchronously after the initial response. Intercepta is checked again immediately before signing, including after World ID approval. A changed Merchant quote or failed risk check stops settlement.

## Intercepta payment screening

The live call is in [`server/intercepta.ts`](server/intercepta.ts); [`server/app.ts`](server/app.ts) invokes it after reading the Merchant's x402 requirements and before creating a payment signature. Quick Scan checks `payTo`, which is the same EVM address on mainnet and Base Sepolia. Token Scan checks Ethereum and Base mainnet assets. For the demo's Base Sepolia USDC, it checks the official Base mainnet USDC contract (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) as a risk-data proxy. Other testnet tokens receive address screening only. The proxy scan does not establish that a testnet token contract is authentic.

A recipient toxic score of at least 80, a known scammer/sanctions/blacklist/rug-pull trait, or a token `block` / `high` result blocks payment. An API error, missing key, or malformed response also blocks payment before signing. Results, reasons, and raw scan responses appear on the Gateway decision card. Responses are cached for ten minutes by default; set `INTERCEPTA_CACHE=off` to force live calls during a recording.

For a blocked demo, use a mainnet address from the pinned Intercepta channel in the ETHGlobal Discord as the Merchant's `MERCHANT_PAY_TO` in a test Merchant instance. Check it with the live API before recording. The Intercepta API is a lookup for an address supplied by the caller; the prize page points to Discord for known-risk test addresses rather than a list endpoint. Do not send a test payment to that recipient.

## JEV decision flow

`server/app.ts` calls `JEV_API_URL` directly with the TypeSafe System One contract. The current question is a boolean `intent_match` question. Thresholds match the project plan:

- probability `>= 0.80`: `ALLOW`
- probability `<= 0.30`: `BLOCK`
- otherwise: `ESCALATE`

An `ESCALATE` response has HTTP `202`, an `approvalId`, and an `intentHash`. The original intent is stored server-side. The browser polls `GET /api/maat/approvals/:id`; it never decides whether a request is approved.

Gateway decisions and approvals are saved to the local, Git-ignored `data/history.json` file in development and production. The console's **Clear History** action asks for confirmation and then calls the authenticated `DELETE /api/maat/history` endpoint. It removes saved decisions and approvals without changing Gateway settings or Merchant records.

## World ID approval

World ID uses the same OIDC + PKCE pattern as [`../world-demo`](../world-demo):

1. The UI opens `/api/maat/approvals/:id/world/start`.
2. The Gateway creates `state`, `nonce`, and a PKCE verifier bound to the approval ID and intent hash.
3. World redirects to `/auth/world/callback`.
4. The Gateway exchanges the code, verifies the ID token signature, issuer, audience, nonce, Orb assurance, proof method, and fresh `auth_time`.
5. The Gateway re-fetches the original Merchant resource and marks the approval `approved`.

## Run locally

Start the Merchant first:

```bash
cd ../x402-demo/merchant
npm install
cp .env.example .env
npm run dev
```

Then start the Gateway:

```bash
cd ../gateway
npm install
cp .env.example .env
# Set JEV_API_KEY and the World ID values before using those integrations.
npm run dev
```

The observer UI runs at `http://localhost:5176`. The API runs at `http://localhost:8787`. In production, `npm run build` creates `dist`; `npm start` serves the API and built UI from the same Fastify process.

## Configuration

| Variable | Purpose |
| --- | --- |
| `GATEWAY_BASIC_USER` / `GATEWAY_BASIC_PASSWORD` | Server-side credentials required by Agent requests and authenticated Gateway console actions |
| `MAAT_TREASURY_PRIVATE_KEY` | Server-only 32-byte hex private key used to sign x402 payments |
| `INTERCEPTA_API_KEY` | Server-only Intercepta key; required for real x402 payments |
| `INTERCEPTA_API_URL` / `INTERCEPTA_CACHE` | Optional API base URL and ten-minute response cache control |
| `JEV_API_URL` / `JEV_API_KEY` / `JEV_MODEL` | Direct TypeSafe JEV connection used by the Gateway |
| `WORLD_ISSUER` | World Sandbox issuer, normally `https://sandbox.auth.world.org` |
| `WORLD_CLIENT_ID` / `WORLD_CLIENT_SECRET` | Confidential World OIDC client credentials |
| `WORLD_REDIRECT_URI` | Registered callback URL for this Gateway |
| `MERCHANT_TIMEOUT_MS` | Timeout for each Merchant request |
| `MERCHANT_URL` | Merchant resource URL used by the Gateway console defaults and demo requests |

`MAAT_TREASURY_PRIVATE_KEY` must be a testnet-only account funded with the Merchant's payment token and native gas. Keep it in the ignored `.env` file; do not add it to any `VITE_` variable.

The Agent supplies `purpose` on every payment request. The Gateway console keeps Demo purpose in the Demo Requests row, while server Settings contain only the Merchant URL and runtime controls. Agent purposes can differ by task and step; the Agent demo combines the user task with each step purpose before calling the Gateway.

Agents may also send `payTo` as their intended recipient. The Gateway blocks the request when it differs from the Merchant's `payTo` in the x402 quote. The risk-recipient Agent scene supplies this field from its server-only environment; the Merchant quotes the same address from its own environment.

The Debug Panel edits Merchant URL, the four bypass controls in call order (Merchant request, JEV, World ID, real payment), the JEV result used for bypasses and JEV failures, the World ID bypass result, and the Demo purpose locally. `Apply settings` sends the complete configuration to `POST /api/maat/settings` without a password; the server returns the authoritative configuration and the UI replaces its local copy with that response. Other authenticated console actions prompt the operator for Gateway credentials and keep them only in page memory. The JEV result defaults to `ESCALATE`. When World ID bypass is enabled, an Escalate card still requires a user click; that click applies Auto approve or Auto reject without calling World ID. Real payment runs only after an approval is accepted.

The three buttons under **DEMO REQUESTS** call authenticated `POST /api/maat/demo`. This route is isolated from the external Agent contract and always runs as a dry run. It accepts `allow`, `block`, or `escalate` to rehearse the three UI states without depending on JEV output. External Agents use `POST /api/maat/pay`, where verdicts come from JEV or the current Gateway settings. The Agent's approval scene uses the Debug Panel JEV bypass with an ESCALATE result; this setting must be turned off before demonstrating live JEV decisions again.

## Verification

```bash
npm run typecheck
npm run build
```
