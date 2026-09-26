/*
 * Themis / Ma'at swap guard: MOCK DATA for the hackathon demo.
 *
 * Every number, address and token on the dashboard comes from this file.
 * To wire in the real guard later, produce objects of the same shape
 * (one per swap intent) and assign them to window.THEMIS_DATA.swaps.
 *
 * Conventions
 *   verdict        one of "ALLOW" | "LIMIT" | "ESCALATE" | "BLOCK"
 *   stages[]       ms offsets from the moment the swap was intercepted
 *                  (skipped stages have start/end = null and a `note`)
 *   signals[].w    weight fed to the judge: positive tips toward BLOCK,
 *                  negative tips toward ALLOW
 *   trail[].risk   "high" | "medium" | "low" | "none"
 */
window.THEMIS_DATA = {
  agent: {
    ens: "databuyer.agent.eth",
    chain: "Base",
    venue: "Uniswap v4",
    policy: { newTokenCapEth: 1.0, maxImpactPct: 2.0, dailyBudgetEth: 2.0 }
  },

  blockTimeMs: 2000, // one Base block

  today: {
    screened: 1284,
    verdicts: { ALLOW: 1171, LIMIT: 67, ESCALATE: 9, BLOCK: 37 },
    ethKept: 21.6,
    humans: { approved: 7, rejected: 2 },
    latency: {
      binStart: 60,
      binWidth: 20,
      counts: [18, 64, 118, 196, 241, 232, 177, 128, 72, 28, 10]
    },
    blockReasons: [
      { reason: "Deployer has dev-sell history", source: "On-chain trace", n: 13 },
      { reason: "Funding traced to a rug cluster", source: "On-chain trace", n: 9 },
      { reason: "Token impersonation", source: "Intercepta", n: 6 },
      { reason: "Drainer or phishing contract", source: "Intercepta", n: 5 },
      { reason: "Sanctioned counterparty", source: "Intercepta", n: 2 },
      { reason: "Bundled launch supply", source: "Holder analysis", n: 2 }
    ],
    // Reliability of the judge's confidence over the last 30 days.
    // Label = what actually happened within 24 h (rugged, flagged, or fine).
    calibration: [
      { bucket: "50–60%", predicted: 0.55, observed: 0.53, n: 41 },
      { bucket: "60–70%", predicted: 0.65, observed: 0.67, n: 88 },
      { bucket: "70–80%", predicted: 0.75, observed: 0.73, n: 156 },
      { bucket: "80–90%", predicted: 0.85, observed: 0.86, n: 312 },
      { bucket: "90–95%", predicted: 0.925, observed: 0.918, n: 498 },
      { bucket: "95–99%", predicted: 0.97, observed: 0.968, n: 1204 },
      { bucket: "99%+", predicted: 0.993, observed: 0.991, n: 2870 }
    ]
  },

  swaps: [
    {
      id: "yuzu",
      time: "14:07:51",
      sell: { sym: "ETH", amt: "0.80" },
      buy: { sym: "YUZU", amt: "1,912,440" },
      verdict: "BLOCK",
      confidence: 0.974,
      latencyMs: 184,
      short: "Deployer dev-sold 3 prior tokens",
      headline:
        "The deployer dev-sold 3 of their last 4 tokens, and the launch money came from rug cluster R-17.",
      source: "Reply on a social feed (untrusted): “YUZU is sending, ape 0.8 now”",
      intent: [
        ["Route", "Universal Router · V4_SWAP"],
        ["Pool", "YUZU / ETH · fee 1.00% · no hooks"],
        ["Quote", "0.80 ETH → 1,912,440 YUZU"],
        ["Price impact", "1.9%"],
        ["Min out", "1,874,191 YUZU (2.0% slippage)"],
        ["Token age", "38 min"]
      ],
      stages: [
        { key: "intercept", start: 0, end: 5 },
        { key: "screen", start: 5, end: 48 },
        { key: "pool", start: 5, end: 39 },
        { key: "deployer", start: 5, end: 27 },
        { key: "funding", start: 27, end: 74 },
        { key: "history", start: 27, end: 66 },
        { key: "jev", start: 74, end: 176 },
        { key: "enforce", start: 176, end: 184 }
      ],
      signals: [
        { label: "Deployer dev-sold 3 of 4 prior launches", detail: "SAKE, KOI, RAMEN: sold 88–100% of the dev allocation within 2 h 05 m", source: "On-chain trace", w: 2.4 },
        { label: "Launch funds traced to rug cluster R-17", detail: "4.20 ETH, 2 hops, arrived 3 h 12 m before deploy", source: "On-chain trace", w: 1.9 },
        { label: "Bundled launch supply", detail: "6 deployer-funded wallets bought in the launch block; top 10 hold 71.4%", source: "Holder analysis", w: 1.1 },
        { label: "Liquidity not locked", detail: "Deployer holds 100% of the LP position and can pull it any time", source: "Pool state", w: 0.8 },
        { label: "Token is 38 minutes old", detail: "Launched 13:29 through a launchpad factory", source: "On-chain trace", w: 0.4 },
        { label: "Instruction came from an untrusted post", detail: "The agent acted on a social reply, not its owner", source: "Intent context", w: 0.3 },
        { label: "Pool is deep enough for the size", detail: "0.80 ETH moves price 1.9% (policy max 2.0%)", source: "Pool state", w: -0.3 },
        { label: "No sanctioned counterparties", detail: "Deployer, pool and router clear on sanctions lists", source: "Intercepta", w: -0.5 },
        { label: "Contract looks standard", detail: "Verified source, mint disabled, 0% buy/sell tax", source: "Intercepta", w: -0.6 }
      ],
      trail: [
        { role: "Known rug cluster", name: "Cluster R-17", addr: "7 linked wallets", fact: "Tied to 11 rugs since May", risk: "high", edge: "4.20 ETH · 3 h 12 m before launch" },
        { role: "Hop wallet", addr: "0x3f9c…a17b", fact: "1 day old · no other activity", risk: "medium", edge: "4.15 ETH · same hour" },
        { role: "Real deployer", addr: "0x7a41…e2c9", fact: "Signed the launch tx · 4 prior tokens", risk: "high", edge: "create() through launchpad factory 0x51e0…77d2. The factory is the on-chain creator, so the guard follows the signer instead." },
        { role: "Token", name: "YUZU", addr: "0xd2b8…904e", fact: "38 min old · 1B supply · 412 holders", risk: "medium", edge: "Seeded with 3.5 ETH · LP kept by deployer" },
        { role: "Uniswap v4 pool", name: "YUZU / ETH · 1.00%", addr: "pool 0x9e1f…3b60", fact: "41.2 ETH on the ETH side", risk: "low" }
      ],
      record: {
        deployer: "0x7a41…e2c9",
        summary: "3 of 4 prior launches were dev-sold within 2 h 05 m. Median holder loss from peak: −97%.",
        rows: [
          { token: "SAKE", launched: "9 d ago", peak: "$412k", sold: "96%", after: "41 min", now: "−94%", devSold: true },
          { token: "KOI", launched: "7 d ago", peak: "$238k", sold: "88%", after: "17 min", now: "−97%", devSold: true },
          { token: "RAMEN", launched: "4 d ago", peak: "$1.06M", sold: "100%", after: "2 h 05 m", now: "−99%", devSold: true },
          { token: "NORI", launched: "2 d ago", peak: "$57k", sold: "0%", after: "—", now: "Dead", devSold: false }
        ]
      },
      probs: { ALLOW: 0.003, LIMIT: 0.004, ESCALATE: 0.019, BLOCK: 0.974 },
      outcome: [
        { t: "+184 ms", text: "Swap dropped before signing. Nothing was broadcast." },
        { t: "+190 ms", text: "Agent told: “Blocked: deployer dev-sold 3 prior tokens.” It moved on to its next task." },
        { t: "+0.4 s", text: "Deployer 0x7a41…e2c9 and hop wallet 0x3f9c…a17b added to the watchlist." },
        { t: "+0.6 s", text: "Alert posted to #agent-ops with the evidence bundle." }
      ]
    },

    {
      id: "mochi",
      time: "14:03:12",
      sell: { sym: "ETH", amt: "2.40" },
      buy: { sym: "MOCHI", amt: "8,315,092" },
      verdict: "ESCALATE",
      confidence: 0.883,
      latencyMs: 199,
      short: "Over new-token cap · fresh deployer",
      headline:
        "Signals are clean, but 2.40 ETH is over the 1.00 ETH cap for new tokens and the deployer has no history. A human decides.",
      source: "Owner's standing order: “buy the top trending meme on Base”",
      intent: [
        ["Route", "Universal Router · V4_SWAP"],
        ["Pool", "MOCHI / ETH · fee 1.00% · no hooks"],
        ["Quote", "2.40 ETH → 8,315,092 MOCHI"],
        ["Price impact", "1.7%"],
        ["Min out", "8,148,790 MOCHI (2.0% slippage)"],
        ["Token age", "3 days"]
      ],
      stages: [
        { key: "intercept", start: 0, end: 5 },
        { key: "screen", start: 5, end: 52 },
        { key: "pool", start: 5, end: 44 },
        { key: "deployer", start: 5, end: 29 },
        { key: "funding", start: 29, end: 88 },
        { key: "history", start: 29, end: 51 },
        { key: "jev", start: 88, end: 193 },
        { key: "enforce", start: 193, end: 199 }
      ],
      signals: [
        { label: "Size is over the new-token cap", detail: "2.40 ETH vs 1.00 ETH per swap for tokens under 30 days old", source: "Agent policy", w: 1.6 },
        { label: "Deployer has no history", detail: "Fresh wallet, first transaction 4 days ago", source: "On-chain trace", w: 0.7 },
        { label: "Funds bridged from an unlabeled wallet", detail: "3.1 ETH bridged from Ethereum; source wallet has no label", source: "On-chain trace", w: 0.6 },
        { label: "Token is 3 days old", detail: "Deployed directly, no launchpad", source: "On-chain trace", w: 0.3 },
        { label: "Pool is deep enough for the size", detail: "2.40 ETH moves price 1.7% (policy max 2.0%)", source: "Pool state", w: -0.3 },
        { label: "No flags on token or counterparties", detail: "Sanctions, phishing, drainer and impersonation checks clear", source: "Intercepta", w: -0.5 },
        { label: "Holders are spread out", detail: "Top 10 hold 22%; no bundling in the launch block", source: "Holder analysis", w: -0.8 },
        { label: "Liquidity locked for 90 days", detail: "LP position locked until Dec 24", source: "Pool state", w: -0.9 }
      ],
      trail: [
        { role: "Source wallet (Ethereum)", addr: "0xc07e…5d12", fact: "Unlabeled · 212 days old", risk: "medium", edge: "3.1 ETH bridged · 4 days before launch" },
        { role: "Real deployer", addr: "0x19ab…07f3", fact: "Fresh wallet · first launch", risk: "medium", edge: "Deployed directly (no factory)" },
        { role: "Token", name: "MOCHI", addr: "0x6e04…c1d8", fact: "3 days old · 2,806 holders", risk: "low", edge: "LP locked until Dec 24" },
        { role: "Uniswap v4 pool", name: "MOCHI / ETH · 1.00%", addr: "pool 0x4b7d…e219", fact: "140 ETH on the ETH side", risk: "low" }
      ],
      record: {
        deployer: "0x19ab…07f3",
        summary: "First launch from this wallet. There is no track record to check either way.",
        rows: []
      },
      probs: { ALLOW: 0.061, LIMIT: 0.044, ESCALATE: 0.883, BLOCK: 0.012 },
      outcome: [
        { t: "+199 ms", text: "Swap held. World ID approval requested from the agent's owner." },
        { t: "+14 s", text: "Owner verified as a unique human with World ID." },
        { t: "+41 s", text: "Owner approved the full 2.40 ETH. Swap signed and sent." },
        { t: "+43 s", text: "Confirmed on Base: 2.40 ETH → 8,315,092 MOCHI." }
      ]
    },

    {
      id: "onsen",
      time: "13:58:40",
      sell: { sym: "ETH", amt: "1.00" },
      buy: { sym: "ONSEN", amt: "6,167,610" },
      verdict: "LIMIT",
      confidence: 0.912,
      latencyMs: 166,
      short: "7.9% impact → cut to 0.23 ETH",
      headline:
        "The token checks out, but the pool is thin. Full size would move the price 7.9%, so the swap was cut to 0.23 ETH.",
      source: "Owner's standing order: “buy the top trending meme on Base”",
      intent: [
        ["Route", "Universal Router · V4_SWAP"],
        ["Pool", "ONSEN / ETH · fee 1.00% · no hooks"],
        ["Quote", "1.00 ETH → 6,167,610 ONSEN"],
        ["Price impact", "7.9%"],
        ["Min out", "6,044,258 ONSEN (2.0% slippage)"],
        ["Token age", "9 days"]
      ],
      stages: [
        { key: "intercept", start: 0, end: 4 },
        { key: "screen", start: 4, end: 45 },
        { key: "pool", start: 4, end: 47 },
        { key: "deployer", start: 4, end: 24 },
        { key: "funding", start: 24, end: 63 },
        { key: "history", start: 24, end: 58 },
        { key: "jev", start: 63, end: 160 },
        { key: "enforce", start: 160, end: 166 }
      ],
      signals: [
        { label: "Price impact too high at full size", detail: "1.00 ETH moves price 7.9%; policy max is 2.0%", source: "Pool state", w: 1.8 },
        { label: "Thin pool", detail: "11.6 ETH on the ETH side", source: "Pool state", w: 0.5 },
        { label: "No flags on token or counterparties", detail: "Sanctions, phishing, drainer and impersonation checks clear", source: "Intercepta", w: -0.5 },
        { label: "Funded from an exchange withdrawal", detail: "Deployer's ETH came from a labeled exchange hot wallet", source: "On-chain trace", w: -0.6 },
        { label: "Liquidity burned", detail: "LP tokens sent to the burn address at launch", source: "Pool state", w: -0.7 },
        { label: "Deployer has a clean record", detail: "2 prior launches, both still trading, no dev sells", source: "On-chain trace", w: -1.2 }
      ],
      trail: [
        { role: "Funding source", name: "Exchange hot wallet", addr: "0x71d0…9a4c", fact: "Labeled exchange withdrawal", risk: "none", edge: "1.8 ETH · 6 days before launch" },
        { role: "Real deployer", addr: "0x2c58…b0e6", fact: "2 prior launches, both live", risk: "low", edge: "create() through launchpad factory. Factory skipped, signer followed." },
        { role: "Token", name: "ONSEN", addr: "0xa931…44c0", fact: "9 days old · 1,120 holders", risk: "low", edge: "LP burned at launch" },
        { role: "Uniswap v4 pool", name: "ONSEN / ETH · 1.00%", addr: "pool 0x0d5e…71aa", fact: "11.6 ETH on the ETH side · thin", risk: "medium" }
      ],
      record: {
        deployer: "0x2c58…b0e6",
        summary: "2 prior launches, both still trading. This deployer has never sold.",
        rows: [
          { token: "TATAMI", launched: "58 d ago", peak: "$890k", sold: "0%", after: "—", now: "Live", devSold: false },
          { token: "UMAMI", launched: "31 d ago", peak: "$344k", sold: "0%", after: "—", now: "Live", devSold: false }
        ]
      },
      probs: { ALLOW: 0.058, LIMIT: 0.912, ESCALATE: 0.024, BLOCK: 0.006 },
      outcome: [
        { t: "+166 ms", text: "Size cut from 1.00 ETH to 0.23 ETH, which keeps price impact at 1.9%." },
        { t: "+180 ms", text: "New quote fetched. Agent signed the smaller swap." },
        { t: "+2.3 s", text: "Confirmed on Base: 0.23 ETH → 1,418,550 ONSEN. The other 0.77 ETH stays in the wallet." }
      ]
    },

    {
      id: "fake-usdc",
      time: "13:52:07",
      sell: { sym: "ETH", amt: "0.50" },
      buy: { sym: "“USDC”", amt: "1,342.10" },
      verdict: "BLOCK",
      confidence: 0.993,
      latencyMs: 156,
      short: "Impersonates USDC",
      headline:
        "This “USDC” is a lookalike contract from a known phishing kit. Real USDC lives at a different address.",
      source: "Invoice memo from a data vendor: “pay in USDC at 0x83358A…F02913”",
      intent: [
        ["Route", "Universal Router · V4_SWAP"],
        ["Pool", "“USDC” / ETH · fee 1.00% · no hooks"],
        ["Quote", "0.50 ETH → 1,342.10 “USDC”"],
        ["Token address", "0x83358Ac1…e8F02913"],
        ["Real USDC", "0x833589fC…bdA02913"],
        ["Token age", "11 min"]
      ],
      stages: [
        { key: "intercept", start: 0, end: 5 },
        { key: "screen", start: 5, end: 39 },
        { key: "pool", start: 5, end: 30 },
        { key: "deployer", start: 5, end: 26 },
        { key: "funding", start: 26, end: 57 },
        { key: "history", start: 26, end: 49 },
        { key: "jev", start: 57, end: 149 },
        { key: "enforce", start: 149, end: 156 }
      ],
      signals: [
        { label: "Impersonates USDC", detail: "Symbol “USDC”; first and last 4 hex characters match the real contract", source: "Intercepta", w: 3.1 },
        { label: "Deployer funded by a phishing kit", detail: "Funding wallet is in Intercepta's address-poisoning set", source: "Intercepta", w: 1.4 },
        { label: "Owner can freeze transfers", detail: "pause() and blacklist() are live owner functions", source: "Contract scan", w: 0.9 },
        { label: "Pool created 11 minutes ago", detail: "0.9 ETH of liquidity, seeded by the deployer", source: "Pool state", w: 0.6 },
        { label: "Address came from an invoice memo", detail: "The agent copied the token address from free text", source: "Intent context", w: 0.5 },
        { label: "No sanctioned counterparties", detail: "Deployer and pool clear on sanctions lists", source: "Intercepta", w: -0.3 }
      ],
      trail: [
        { role: "Phishing set (Intercepta)", addr: "0xe4a2…d90b", fact: "Address-poisoning kit operator", risk: "high", edge: "0.6 ETH · 2 h before deploy" },
        { role: "Real deployer", addr: "0x55f1…c3a8", fact: "14 lookalike tokens this week", risk: "high", edge: "Deployed directly (no factory)" },
        { role: "Token (lookalike)", name: "“USDC”", addr: "0x83358Ac1…e8F02913", fact: "Not Circle's contract", risk: "high", edge: "Seeded with 0.4 ETH" },
        { role: "Uniswap v4 pool", name: "“USDC” / ETH · 1.00%", addr: "pool 0x7aa0…2c5e", fact: "11 min old · 0.9 ETH on the ETH side", risk: "medium" }
      ],
      record: {
        deployer: "0x55f1…c3a8",
        summary: "This deployer shipped 14 lookalike tokens in 7 days. The 3 most recent are shown.",
        rows: [
          { token: "“USDT”", launched: "1 d ago", peak: "—", sold: "—", after: "—", now: "Flagged", devSold: true },
          { token: "“WETH”", launched: "2 d ago", peak: "—", sold: "—", after: "—", now: "Flagged", devSold: true },
          { token: "“cbBTC”", launched: "2 d ago", peak: "—", sold: "—", after: "—", now: "Flagged", devSold: true }
        ],
        pipLabel: "flagged lookalikes"
      },
      probs: { ALLOW: 0.001, LIMIT: 0.001, ESCALATE: 0.005, BLOCK: 0.993 },
      outcome: [
        { t: "+156 ms", text: "Swap dropped before signing. Nothing was broadcast." },
        { t: "+160 ms", text: "Agent told: “Blocked: token impersonates USDC. Real USDC is 0x833589fC…bdA02913.”" },
        { t: "+0.3 s", text: "The invoice memo that supplied the address was marked untrusted." }
      ]
    },

    {
      id: "koban",
      time: "13:41:29",
      sell: { sym: "ETH", amt: "0.30" },
      buy: { sym: "KOBAN", amt: "96,204" },
      verdict: "ALLOW",
      confidence: 0.934,
      latencyMs: 185,
      short: "Clean deployer · LP burned",
      headline:
        "A 41-day-old meme whose deployer never sold, with burned liquidity and a wide holder base.",
      source: "Owner's standing order: “hold 5% of the portfolio in memes”",
      intent: [
        ["Route", "Universal Router · V4_SWAP"],
        ["Pool", "KOBAN / ETH · fee 0.30% · no hooks"],
        ["Quote", "0.30 ETH → 96,204 KOBAN"],
        ["Price impact", "0.14%"],
        ["Min out", "94,280 KOBAN (2.0% slippage)"],
        ["Token age", "41 days"]
      ],
      stages: [
        { key: "intercept", start: 0, end: 4 },
        { key: "screen", start: 4, end: 50 },
        { key: "pool", start: 4, end: 41 },
        { key: "deployer", start: 4, end: 33 },
        { key: "funding", start: 33, end: 79 },
        { key: "history", start: 33, end: 71 },
        { key: "jev", start: 79, end: 178 },
        { key: "enforce", start: 178, end: 185 }
      ],
      signals: [
        { label: "High volatility", detail: "30-day realized volatility 160%", source: "Pool state", w: 0.6 },
        { label: "Deployer funds bridged, source unlabeled", detail: "0.9 ETH bridged from Arbitrum 2 days before launch", source: "On-chain trace", w: 0.3 },
        { label: "Pool is deep for the size", detail: "0.30 ETH moves price 0.14%", source: "Pool state", w: -0.4 },
        { label: "No flags on token or counterparties", detail: "Sanctions, phishing, drainer and impersonation checks clear", source: "Intercepta", w: -0.5 },
        { label: "Holders are spread out", detail: "9,412 holders; top 10 hold 18%", source: "Holder analysis", w: -0.8 },
        { label: "Liquidity burned", detail: "LP tokens sent to the burn address at launch", source: "Pool state", w: -0.9 },
        { label: "Deployer never sold", detail: "Still holds 2.0% after 41 days; ownership renounced", source: "On-chain trace", w: -1.1 }
      ],
      trail: [
        { role: "Funding source", addr: "0x8d3e…61f7", fact: "Bridged from Arbitrum · unlabeled", risk: "low", edge: "0.9 ETH · 2 days before launch" },
        { role: "Real deployer", addr: "0xf20c…3e19", fact: "Ownership renounced · holds 2.0%", risk: "none", edge: "create() through launchpad factory. Factory skipped, signer followed." },
        { role: "Token", name: "KOBAN", addr: "0x3c7a…b5e2", fact: "41 days old · 9,412 holders", risk: "none", edge: "LP burned at launch" },
        { role: "Uniswap v4 pool", name: "KOBAN / ETH · 0.30%", addr: "pool 0xb18e…6d04", fact: "220 ETH on the ETH side", risk: "none" }
      ],
      record: {
        deployer: "0xf20c…3e19",
        summary: "First launch from this wallet. The deployer has held their 2.0% for 41 days without selling.",
        rows: []
      },
      probs: { ALLOW: 0.934, LIMIT: 0.041, ESCALATE: 0.019, BLOCK: 0.006 },
      outcome: [
        { t: "+185 ms", text: "Approved. Agent signed the swap through Universal Router." },
        { t: "+2.0 s", text: "Confirmed on Base: 0.30 ETH → 96,204 KOBAN." }
      ]
    },

    {
      id: "usdc",
      time: "13:30:02",
      sell: { sym: "ETH", amt: "0.15" },
      buy: { sym: "USDC", amt: "402.61" },
      verdict: "ALLOW",
      confidence: 0.991,
      latencyMs: 137,
      short: "Allowlisted issuer · deep pool",
      headline:
        "Canonical USDC from an allowlisted issuer, in a deep pool. The agent is topping up for x402 data payments.",
      source: "Scheduled task: top up USDC for x402 data purchases",
      intent: [
        ["Route", "Universal Router · V4_SWAP"],
        ["Pool", "ETH / USDC · fee 0.05% · no hooks"],
        ["Quote", "0.15 ETH → 402.61 USDC"],
        ["Price impact", "< 0.01%"],
        ["Min out", "400.60 USDC (0.5% slippage)"],
        ["Token", "0x833589fC…bdA02913"]
      ],
      stages: [
        { key: "intercept", start: 0, end: 4 },
        { key: "screen", start: 4, end: 41 },
        { key: "pool", start: 4, end: 22 },
        { key: "deployer", start: 4, end: 9 },
        { key: "funding", start: null, end: null, note: "skipped · allowlisted issuer" },
        { key: "history", start: null, end: null, note: "skipped · allowlisted issuer" },
        { key: "jev", start: 41, end: 131 },
        { key: "enforce", start: 131, end: 137 }
      ],
      signals: [
        { label: "Permit2 allowance is unlimited", detail: "Router allowance set to max; consider a cap", source: "Agent policy", w: 0.2 },
        { label: "Scheduled task from the owner", detail: "Recurring top-up, not a third-party instruction", source: "Intent context", w: -0.2 },
        { label: "Within the daily budget", detail: "0.15 ETH of the 2.0 ETH daily swap budget", source: "Agent policy", w: -0.4 },
        { label: "No flags on token or counterparties", detail: "Token, pool and router clear", source: "Intercepta", w: -0.6 },
        { label: "Deep liquidity", detail: "0.15 ETH moves price less than 0.01%", source: "Pool state", w: -1.2 },
        { label: "Allowlisted issuer", detail: "Circle-issued USDC at its canonical address", source: "Policy allowlist", w: -3.0 }
      ],
      trail: [
        { role: "Issuer", name: "Circle", addr: "on allowlist", fact: "Canonical USDC issuer", risk: "none", edge: "Issues" },
        { role: "Token", name: "USDC", addr: "0x833589fC…bdA02913", fact: "Canonical USDC on Base", risk: "none", edge: "Trades in" },
        { role: "Uniswap v4 pool", name: "ETH / USDC · 0.05%", addr: "pool 0x21c6…8f0a", fact: "18,400 ETH on the ETH side", risk: "none" }
      ],
      record: {
        deployer: "Circle (allowlisted)",
        summary: "Allowlisted issuer, so there is no launch history to review.",
        rows: []
      },
      probs: { ALLOW: 0.991, LIMIT: 0.006, ESCALATE: 0.002, BLOCK: 0.001 },
      outcome: [
        { t: "+137 ms", text: "Approved. Agent signed the swap through Universal Router." },
        { t: "+2.1 s", text: "Confirmed on Base: 0.15 ETH → 402.61 USDC, ready for x402 payments." }
      ]
    }
  ]
};
