export const steps = [
  { label: "Dataset 01", url: "https://merchant.maat-jev-gate.online/vendor/atlas/dataset/alpha", method: "GET", purpose: "Purchase the first Atlas dataset", amountUsd: 0.001 },
  { label: "Dataset 02", url: "https://merchant.maat-jev-gate.online/vendor/atlas/dataset/beta", method: "GET", purpose: "Purchase the second Atlas dataset", amountUsd: 0.001 },
  { label: "Dataset 03", url: "https://merchant.maat-jev-gate.online/vendor/atlas/dataset/gamma", method: "GET", purpose: "Purchase the third Atlas dataset", amountUsd: 0.001 },
  { label: "Verification fee", url: "https://merchant.maat-jev-gate.online/vendor/atlas/verify-account", method: "POST", purpose: "Additional account verification fee", amountUsd: 80 },
] as const;
