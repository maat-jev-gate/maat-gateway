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
    id: "payment-escalate",
    title: "Approve dataset purchase",
    service: "x402 pay + World ID",
    task: "Purchase one Atlas dataset for $0.001. Gateway operator selected an ESCALATE fallback for this demonstration.",
    calls: [{ label: "Atlas dataset", path: "/vendor/atlas/dataset/beta", method: "GET", purpose: "Purchase one Atlas dataset for 0.001 USDC", amountUsd: 0.001 }],
  },
  {
    id: "swap-approval",
    title: "Swap with approval",
    service: "Uniswap + World ID",
    task: "Swap $30 of ETH for USDC. Request human approval before execution; also demonstrate cancellation.",
    swap: { tokenIn: "ETH", tokenOut: "USDC", amountUsd: 30 },
  },
  {
    id: "swap-block",
    title: "Block risky swap",
    service: "Uniswap quote",
    task: "Assess an $8 swap from USDC into the token promoted by a social post and block it if the evidence is unsafe.",
    swap: { tokenIn: "USDC", tokenOut: "DEMO_TOKEN", amountUsd: 8 },
  },
] as const;

export type Scenario = (typeof scenarios)[number];
