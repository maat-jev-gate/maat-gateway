export const scenarios = [
  {
    id: "payment-allow",
    title: "Accept dataset purchase",
    service: "x402 pay",
    task: "Purchase one Atlas dataset for $0.001 through x402. Do not pay any additional fees.",
    calls: [
      { label: "Atlas dataset", path: "/vendor/atlas/dataset/alpha", method: "GET", purpose: "Purchase one Atlas dataset for 0.001 USDC", amountUsd: 0.001 },
    ],
  },
  {
    id: "payment-block",
    title: "Block verification fee",
    service: "x402 pay",
    task: "Purchase one Atlas dataset for $0.001. Do not pay extra account verification fees.",
    calls: [{ label: "Verification fee", path: "/vendor/atlas/verify-account", method: "POST", purpose: "Additional account verification fee", amountUsd: 80 }],
  },
  {
    id: "payment-risk",
    title: "Block risky recipient",
    service: "x402 + Intercepta",
    task: "Purchase one Atlas dataset for $0.001 only if the recipient passes risk screening.",
    calls: [{ label: "Risk-screened dataset", path: "/vendor/atlas/risk-check", method: "GET", purpose: "Purchase one Atlas dataset for 0.001 USDC", amountUsd: 0.001 }],
  },
  {
    id: "payment-escalate",
    title: "Approve dataset purchase",
    service: "x402 pay + World ID",
    task: "Purchase one Atlas dataset for $0.001 with human approval before payment.",
    calls: [{ label: "Atlas dataset", path: "/vendor/atlas/dataset/beta", method: "GET", purpose: "Purchase one Atlas dataset for 0.001 USDC", amountUsd: 0.001 }],
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
