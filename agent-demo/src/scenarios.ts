export const scenarios = [
  {
    id: "payment-allow",
    title: "Pay for datasets",
    service: "x402 pay",
    task: "Purchase the three Atlas datasets at $0.001 each through x402. Do not pay any additional fees.",
    calls: [
      { label: "Dataset 01", path: "/vendor/atlas/dataset/alpha", method: "GET", purpose: "Purchase the first Atlas dataset", amountUsd: 0.001 },
      { label: "Dataset 02", path: "/vendor/atlas/dataset/beta", method: "GET", purpose: "Purchase the second Atlas dataset", amountUsd: 0.001 },
      { label: "Dataset 03", path: "/vendor/atlas/dataset/gamma", method: "GET", purpose: "Purchase the third Atlas dataset", amountUsd: 0.001 },
    ],
  },
  {
    id: "payment-block",
    title: "Block verification fee",
    service: "x402 pay",
    task: "Purchase only three Atlas datasets. Do not pay extra account verification fees.",
    calls: [{ label: "Verification fee", path: "/vendor/atlas/verify-account", method: "POST", purpose: "Additional account verification fee", amountUsd: 80 }],
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
