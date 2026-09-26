# Maat Swap Guard (Ethereum mainnet)

A standalone single-page Next.js app for the swap half of Maat: an AI agent asks to buy a token with ETH, and the gate collects live evidence, applies the hard rules, asks JEV about whatever is left, and returns `ALLOW`, `BLOCK`, or `ESCALATE`.

Live demo: https://swap.maat-jev-gate.online

It covers the swap modules from the project plan:

| Module | What this app does |
| --- | --- |
| M4 Uniswap adapter | Mainnet quote: route, amount out, minimum out, price impact |
| M5 Deployer forensics | Real deployer, their other tokens and dev dumps, funding path, token age |
| M8 Interface | The dashboard: verdict, measured timings, signal weights, evidence, rule trace, raw responses |
| M9 JEV adapter | Typed verdict (choice) + rug risk (score), 1.5 s timeout, labeled fallback |

**Mainnet is analysis only.** No private key is configured, nothing is signed or broadcast. `ALLOW` means "would be signed".

**No mock data.** Every figure on the page comes from the request that produced it: mainnet RPC, the block explorer, Uniswap, Intercepta, and JEV. When an integration has no key, the page says so (for example "Intercepta: not configured") and that source contributes nothing. It is never replaced with made-up values.

## Run

```bash
cd swap-guard
npm install
cp .env.example .env   # fill in the keys you have
npm run dev            # http://localhost:3000
```

Production: `npm run build && npm start`. The decision log and the daily total are kept in server memory (see [Limits](#limits)), so run it as one long-lived Node process (`next start`, PM2) rather than serverless.

To publish the standalone demo, set `PORT`, `DEPLOY_HOST`, and `DEPLOY_DOMAIN` in the ignored `.env`, then run `npm run deploy`. The script builds locally, syncs the production build and `.env`, starts a single PM2 process, configures Caddy, and checks the API on the host. The HTTP API is currently public and intended for the analysis-only demo; add service authentication and request limits before using it as a Gateway dependency.

Set `MAAT_DEBUG=1` to log every explorer call with its duration.

## Environment

| Variable | Needed | Purpose |
| --- | --- | --- |
| `ETH_RPC_URL` | no | Comma-separated mainnet RPC URLs, tried in order. Defaults to keyless public endpoints |
| `ETHERSCAN_API_KEY` | recommended | Etherscan V2 for account history, with Routescan then Blockscout (keyless, rate limited) as failover |
| `BLOCKSCOUT_URL`, `BLOCKSCOUT_API_KEY` | no | Address labels and scam flags (Blockscout v2 API) |
| `INTERCEPTA_API_KEY` | for Intercepta | Token scan + address quick scans |
| `INTERCEPTA_CACHE` | no | `on` caches responses per address for 10 min; set `off` when recording |
| `UNISWAP_API_KEY` | for Trading API | Without it, quotes come from the Uniswap v2 Router and v3 QuoterV2 contracts via `eth_call` |
| `UNISWAP_SWAPPER` | no | `swapper` field for Trading API quotes |
| `JEV_API_URL`, `JEV_API_KEY`, `JEV_MODEL` | for JEV | TypeSafe `…/v1/systemone` (`jev-latest`) or the Vercel AI Gateway base `https://ai-gateway.vercel.sh/v1` (`typesafe-ai/jev`) |
| `JEV_TIMEOUT_MS` | no | Default 1500. After this, the fallback score decides |
| `MAAT_AGENTS`, `MAAT_FROZEN_AGENTS` | no | Registered and frozen agent IDs for rule H1 |

## API

`POST /api/maat/swap` takes the `maat_swap` shape from the plan and returns a `Decision` (the shared structure from §3 plus swap evidence):

```json
{ "agentId": "demo-agent", "chainId": 1, "tokenIn": "ETH", "tokenOut": "0x…",
  "amountUsd": 8, "source": "social", "instruction": "ape now" }
```

`amountIn` (ETH) can be sent instead of `amountUsd`. With `Accept: application/x-ndjson` the response streams one stage event per line as each lookup starts and ends, and the Decision comes last. The page uses this to draw the waterfall live.

For a JSON response:

```bash
curl -X POST https://swap.maat-jev-gate.online/api/maat/swap \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"demo-agent","chainId":1,"tokenIn":"ETH","tokenOut":"0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984","amountUsd":8,"source":"owner","instruction":"Assess this UNI purchase"}'
```

Other routes:

- `POST /api/forensics { chainId: 1, token }`: returns `{ deployer, priorTokens, fundingPath, signals, ms }`, the M5 contract
- `GET /api/state`: policy, integration status, today's allowed total, and the decision log
- `GET /api/chain`: latest block and ETH price
- `POST /api/admin/reset`: clears the decision log and today's total ("Reset demo data")

## How a decision is made

1. **Evidence, in parallel** (each stage's duration is measured and shown):
   - Token metadata and the ETH price (Uniswap v3 WETH/USDC 0.05% pool)
   - Uniswap quote for the exact size
   - Intercepta Scan Token
   - Deployer forensics (below), which includes an Intercepta Quick Scan of the deployer and each funder
2. **Hard rules, in fixed order** ([lib/engine.ts:62](lib/engine.ts#L62), [lib/engine.ts:134](lib/engine.ts#L134)):
   H1 agent registered → H2 Intercepta high risk on token or deployer → H3 hard cap / daily limit → H4 price impact > 3% (or no route) → H5 over $10 per swap → escalate.
3. **JEV** judges the rest ([lib/engine.ts:170](lib/engine.ts#L170)). If JEV's confidence is below 0.80 → `ESCALATE` (rule C). If JEV times out or has no key, the fixed-weight fallback decides and the page labels it `fallback` (F): net ≥ +1.5 blocks, ≤ −0.5 allows, otherwise escalates.

Policy (from the plan): $10 per swap, $50 per day, $200 hard cap, 3% price impact, 0.80 confidence, 1.5 s JEV timeout.

## Deployer forensics

All computed per request ([lib/forensics.ts](lib/forensics.ts)):

- **Real deployer** ([lib/forensics.ts:37](lib/forensics.ts#L37)): the signer of the token's creation transaction. If a factory or launchpad contract created the token, it is recorded as the factory and the signer is followed instead.
- **Other tokens** ([lib/forensics.ts:80](lib/forensics.ts#L80)): contracts the deployer deployed directly, tokens minted by the deployer's other calls to the same factory function (read from the receipts' `Transfer(from = 0x0)` logs), and tokens minted to the deployer. The last group is only accepted after checking that the deployer signed the token's creation ([lib/forensics.ts:65](lib/forensics.ts#L65)). Spam tokens mint themselves to well-known wallets and emit fake transfers, and without this check PEPE's deployer showed as a serial dumper. LP tokens are excluded. Up to 8 ERC-20s, newest first.
- **Dev dumps** ([lib/forensics.ts:152](lib/forensics.ts#L152)): for each of those tokens, how much of what the deployer received left its wallet (sold or transferred), how much within 24 h, and how soon after launch. "Dumped" means ≥ 50% out within 7 days.
- **Funding path** ([lib/forensics.ts:209](lib/forensics.ts#L209)): the deployer's earliest incoming ETH (normal or internal transfer) before launch, then that funder's earliest incoming ETH. Tracing stops at contracts, labeled wallets, and wallets with more than 5,000 outgoing transactions (exchange hot wallets). Every address is checked against Intercepta Quick Scan, Blockscout's scam flag, and `data/watchlist.json`.
- **Token age**: from the creation block.

A lookup that fails is shown as failed. It never turns into a clean result.

**Scope:** any ERC-20 on Ethereum mainnet with a Uniswap v2/v3 WETH pool (or any route the Trading API finds). The deployer history reads the first 1,000 transactions of the deployer, and the funding trace reads the first 200 incoming transfers of each wallet.

Tested on 2026-09-26 against live mainnet: PEPE and UNI (no other launches, exchange-funded), a serial deployer who launched 23 tokens directly, and a token launched through a factory whose deployer moved out ~99% of three earlier tokens within 25–32 minutes of each launch.

### Watchlist

`data/watchlist.json` holds team-curated addresses, for example wallets tied to a known scam launch. It ships empty. Each entry needs a public source:

```json
[{ "address": "0x…", "label": "Funder of the XYZ rug", "source": "https://…" }]
```

## Where each integration lives

| Integration | File |
| --- | --- |
| Uniswap Trading API `/quote` | [lib/uniswap.ts:122](lib/uniswap.ts#L122) |
| Uniswap on-chain quote (v2 Router, v3 QuoterV2) | [lib/uniswap.ts:54](lib/uniswap.ts#L54) |
| ETH price from the v3 WETH/USDC pool | [lib/uniswap.ts:47](lib/uniswap.ts#L47) |
| Intercepta Scan Token | [lib/intercepta.ts:79](lib/intercepta.ts#L79) |
| Intercepta Quick Scan Address | [lib/intercepta.ts:58](lib/intercepta.ts#L58) |
| Intercepta tier mapping | [lib/intercepta.ts:46](lib/intercepta.ts#L46) |
| JEV call | [lib/jev.ts:26](lib/jev.ts#L26) |
| Rules and pipeline | [lib/engine.ts:35](lib/engine.ts#L35) |
| Signal weights and fallback | [lib/signals.ts:22](lib/signals.ts#L22), [lib/signals.ts:157](lib/signals.ts#L157) |

### Intercepta tier mapping

| Scan | High (→ H2) | Medium (signal for JEV) | Low |
| --- | --- | --- | --- |
| Token | action `block`, riskLevel `high`, or category `malicious`/`sanctioned` | action `warn` or riskLevel `medium` | everything else |
| Address | toxicScore ≥ 80, or a `sanction_address`, `known_scammer`, `blacklist`, or `rug_pull` trait with risk ≥ 50 | toxicScore ≥ 40 | everything else |

A high-risk deployer triggers H2. A high-risk funder is a strong signal for JEV but does not block on its own, so that the verdict comes from the evidence.

## Limits

- The decision log and daily total are in memory and reset when the process restarts.
- Keyless explorers are rate limited. A single run makes about 6–10 account-history calls. Once a provider is rate limited it is skipped for 60 s. Set `ETHERSCAN_API_KEY` for a demo: it has a dedicated quota, although its responses are slower than Routescan's (the 1,000-row history takes ~2 s).
- The on-chain quote fallback covers Uniswap v2 and v3 WETH pools only. v4 pools are reached through the Trading API.
- The Trading API's `priceImpact` appears to include the pool fee (a $8 PEPE buy through the 0.30% pool reports 0.3%), while the on-chain fallback measures price movement only. H4 compares whichever figure the quote returned against 3%.
- Signal weights are fixed per rule ([lib/signals.ts](lib/signals.ts)). They drive the fallback and the "What tipped the scale" view. JEV receives the evidence, not the weights.

## Pre-hackathon work

The visual direction (brass palette, the balance, the verdict stamp, the timing waterfall) follows a static concept page with mock data that was made before the start. It was briefly kept in this repository as `swap-guard-demo/` and has since been removed. This app was written from scratch after the start: no code, data, or address lists were copied from that page, and it contains no mock data.

## AI usage

Written with Claude Code (Claude Opus 5.5): the app code in `lib/`, `components/`, and `app/`, and this README. API shapes were taken from the Uniswap Trading API OpenAPI spec, the Web3 Antivirus (Intercepta) API reference, and the TypeSafe / Vercel AI Gateway evaluation docs. Behavior was checked against live mainnet data.
