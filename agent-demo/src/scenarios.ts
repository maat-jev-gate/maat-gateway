export const scenarios = [
  {
    id: "payment-allow",
    title: "Accept dataset purchase",
    service: "x402 pay",
    task: "Purchase one Atlas dataset for $0.001 through x402. Do not pay any additional fees.",
    calls: [
      { label: "Atlas dataset", path: "/merchant/dataset/alpha", method: "GET", purpose: "Purchase one Atlas dataset for 0.001 USDC", amountUsd: 0.001 },
    ],
  },
  {
    id: "payment-block",
    title: "Block verification fee",
    service: "x402 + JEV",
    task: "Purchase one Atlas dataset for $0.001. Do not pay extra account verification fees.",
    calls: [{ label: "Verification fee", path: "/merchant/verify-account", method: "POST", purpose: "Additional account verification fee", amountUsd: 80 }],
  },
  {
    id: "payment-risk",
    title: "Block risky recipient",
    service: "x402 + Intercepta",
    task: "Purchase one Atlas dataset for $0.001 only if the recipient passes risk screening.",
    calls: [{ label: "Risk-screened dataset", path: "/merchant/risk-check", method: "GET", purpose: "Purchase one Atlas dataset for 0.001 USDC", amountUsd: 0.001 }],
  },
  {
    id: "payment-escalate",
    title: "Escalate dataset purchase",
    service: "x402 + JEV + World ID",
    task: "Buy one Atlas dataset for 0.001 USDC if it includes the 2026 Tokyo records; ask me before paying if the coverage is unclear.",
    calls: [{ label: "Atlas beta dataset", path: "/merchant/dataset/beta", method: "GET", purpose: "Purchase the Atlas beta dataset for 0.001 USDC. The payment quote does not describe its coverage.", amountUsd: 0.001 }],
  },
  {
    id: "swap-approval",
    title: "Review ETH-to-USDC swap",
    service: "Uniswap + Swap Guard",
    task: "Assess a $30 ETH-to-USDC swap. Report whether owner approval is required; do not execute a trade.",
    swap: { chainId: 1, tokenIn: "ETH", tokenOut: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", amountUsd: 30, source: "owner" },
  },
  {
    id: "swap-block",
    title: "Screen a social token",
    service: "Swap Guard risk analysis",
    task: "Assess an $8 ETH-to-PEPE swap promoted by a social post. Report the live risk verdict without executing a trade.",
    swap: { chainId: 1, tokenIn: "ETH", tokenOut: "0x6982508145454Ce325dDbE47a25d4ec3d2311933", amountUsd: 8, source: "social" },
  },
] as const;

export type Scenario = (typeof scenarios)[number];
