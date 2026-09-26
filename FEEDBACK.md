# Integration Feedback

## World ID for Agents

- Time to first successful verification: About 1 hour.
- Friction: The callback needed a public HTTPS URL. We did not have a domain at first, and localhost could not be used to test the callback flow.
- Missing capability or documentation: None identified during this integration.
- Most impactful improvement: No specific change requested. The integration worked well once the public callback URL was configured.

## Intercepta

- Time to first API call: About 30 minutes.
- Integration experience: The API worked well for screening payment recipients and tokens in the x402 flow.
- What confused us: We initially could not find a way to reproduce a blocked payment. We only found known-risk addresses on the afternoon of Sep 26, in a chat message in the Intercepta partner channel on the ETHGlobal Discord server.
- What was missing: Consider an API endpoint that lists all known-risk addresses and why they are flagged. It could help integrations that need to discover risky addresses before they have a specific address to scan.

## Uniswap

Notes from building Maat Swap Guard, a pre-signing gate for AI agent swaps on Ethereum
mainnet. An agent asks to buy a token with ETH. Before anything is signed, the gate asks
Uniswap for a quote and uses the route and price impact as evidence, together with token
scans and deployer forensics. The Uniswap code is in [`swap-guard/lib/uniswap.ts`](swap-guard/lib/uniswap.ts).

We use Uniswap in two ways:

- **Trading API** `POST /quote` with CLASSIC routing over V2, V3, and V4, when an API key is set.
- **Direct `eth_call`** against the v2 Router02 and v3 QuoterV2 contracts when no key is
  set, so the demo works without a key.

Our use is read-only. We never build or sign a swap. Each point below says what we ran into
and where it shows up in this repository. Behavior was checked against live mainnet in
September 2026.

### 1. What `priceImpact` includes

Rule H4 blocks a swap when price impact is over 3%
([`lib/engine.ts:159`](swap-guard/lib/engine.ts#L159)). The Trading API's `priceImpact`
seems to include the pool fee: an $8 PEPE buy through the 0.30% v3 pool reports about
`0.3`. Our on-chain fallback measures price movement only. It compares the quote with one
for 1/1000 of the size on the same pool
([`lib/uniswap.ts:54`](swap-guard/lib/uniswap.ts#L54)).

So the two sources give different numbers for the same trade, and a 1% fee pool starts
with a third of our 3% budget already used. We record this as a known limit in the
[Swap Guard README](swap-guard/README.md#limits) instead of adjusting for it, because we
could not confirm the definition.

It would help to have one sentence in the API reference that says whether `priceImpact`
includes LP fees and gas, or to get price impact and fees as separate fields. Anyone who
uses the value as a safety threshold needs to know this.

### 2. Response shape for a read-only consumer

We only read the quote. We don't pass it back to `/swap`. Three things took extra parsing
([`lib/uniswap.ts:122`](swap-guard/lib/uniswap.ts#L122)):

- The amount out appears in `quote.output` and also in `quote.aggregatedOutputs`, where
  some entries are fee outputs. We read `output` first and fall back to the
  `aggregatedOutputs` entry with no `fee`
  ([`lib/uniswap.ts:141`](swap-guard/lib/uniswap.ts#L141)). We didn't find anything that
  says which one is the net amount for the swapper when both are present.
- Route legs identify the protocol with a `type` string such as `v3-pool`. We strip the
  suffix to show "V3" ([`lib/uniswap.ts:145`](swap-guard/lib/uniswap.ts#L145)).
- Our type allows the route `fee` to be a string or a number, and we always convert it.

A short "reading a CLASSIC quote" section would save integrators from reverse-engineering
the raw JSON: which field is the net output, what the route `type` values are, and what
type `fee` has. Our consumers are dashboards, risk engines, and agents that only inspect
quotes.

### 3. `swapper` for quote-only requests

We send a `swapper` with every quote. When `UNISWAP_SWAPPER` is not set, we use the
placeholder `0x…dEaD` ([`lib/uniswap.ts:20`](swap-guard/lib/uniswap.ts#L20),
[`lib/uniswap.ts:133`](swap-guard/lib/uniswap.ts#L133)), because the gate runs before any
wallet is involved.

We don't know whether a placeholder swapper changes the route, the gas estimate, or which
routing types are offered. Guidance for analysis-only callers would help: either an
officially accepted placeholder, or a note on what `swapper` affects in a quote.

### 4. No keyless way to find v4 pools

Without an API key, we find pools with `getPair` on the v2 factory and `getPool` on the v3
factory for each of the four standard fee tiers, then quote them through the Router and
QuoterV2 ([`lib/uniswap.ts:54`](swap-guard/lib/uniswap.ts#L54)). This works for any token
with a WETH pool.

We didn't find a v4 equivalent. A v4 pool is identified by its full `PoolKey`, which
includes `tickSpacing` and the hooks address, and the PoolManager has no lookup by token
pair. Without an indexer, we couldn't find which v4 pools exist for an arbitrary token.
So the keyless path covers only v2 and v3, and v4 liquidity is visible only through the
Trading API. The README lists this as a limit.

A public, keyless way to list the v4 pools for a token pair would close this gap. That
could be a documented subgraph query, a small read-only endpoint, or a recommended
indexer.

### What worked well

- One Trading API request with `protocols: ["V2", "V3", "V4"]` gave us a route across
  every version, including v4 pools we could not reach on our own.
- v3 QuoterV2 through `eth_call` (`simulateContract` in viem) is fast and needs no key. We
  also use it for the ETH/USD reference price from the WETH/USDC 0.05% pool
  ([`lib/uniswap.ts:47`](swap-guard/lib/uniswap.ts#L47)).
