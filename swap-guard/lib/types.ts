/*
 * Shared types. `Decision` follows the structure agreed for the Maat gateway
 * (M2, M8, M9) and adds the swap-specific evidence this app renders.
 */

export type Verdict = "ALLOW" | "BLOCK" | "ESCALATE";
export type Rule = "H1" | "H2" | "H3" | "H4" | "H5" | "C";
export type SignalSource = "intercepta" | "uniswap" | "chain" | "policy" | "intent";
export type Tier = "high" | "medium" | "low" | "unknown";
export type InstructionSource = "owner" | "merchant" | "social";

export type Signal = {
  key: string;
  label: string;
  value: string;
  /** Positive pushes toward BLOCK, negative toward ALLOW. Fixed per rule in lib/weights.ts. */
  weight: number;
  source: SignalSource;
  evidenceUrl?: string;
};

export type Policy = {
  perTxLimit: number;
  dailyLimit: number;
  hardCap: number;
  maxPriceImpact: number;
  confidenceThreshold: number;
};

export type StageKey = "price" | "quote" | "tokenScan" | "deployer" | "history" | "funding" | "jev" | "enforce";
export type StageStatus = "running" | "done" | "skipped" | "failed";

export type Stage = {
  key: StageKey;
  status: StageStatus;
  /** Milliseconds from the moment the request was received. */
  start: number;
  end?: number;
  note?: string;
};

export type TokenInfo = {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
};

export type QuoteSummary = {
  provider: "trading-api" | "onchain";
  routing: string;
  amountIn: string;
  amountOut: string;
  minOut?: string;
  priceImpactPct: number | null;
  route: string;
  pools: { protocol: string; address: string; fee?: number }[];
  gasFeeUsd?: string;
  blockNumber?: string;
};

export type InterceptaAddressResult = {
  address: string;
  tier: Tier;
  toxicScore: number | null;
  traits: { name: string; risk: number; description: string }[];
  ms: number;
  cached: boolean;
  error?: string;
};

export type InterceptaTokenResult = {
  tier: Tier;
  riskScore: number | null;
  riskLevel?: string;
  category?: string;
  trust?: string;
  action?: string;
  detectors: { code: string; description: string }[];
  buyTax?: number;
  sellTax?: number;
  ms: number;
  cached: boolean;
  error?: string;
};

export type AddressLabel = {
  name?: string;
  tags: string[];
  isContract: boolean;
  isScam: boolean;
  txCount?: number;
};

export type WatchlistHit = { address: string; label: string; source: string };

export type TrailNode = {
  role: "funder-2" | "funder-1" | "deployer" | "factory" | "token";
  address: string;
  label?: AddressLabel;
  intercepta?: InterceptaAddressResult;
  watchlist?: WatchlistHit;
  /** Transfer that moved funds from this node to the next one. */
  edge?: { valueEth: string; txHash: string; timestamp: number; via: "tx" | "internal" };
  note?: string;
};

export type PriorToken = {
  address: string;
  symbol: string;
  name: string;
  launchedAt: number;
  launchTx: string;
  received: string;
  movedOut: string;
  movedOutPct: number | null;
  firstOutAfterSec: number | null;
  movedOutWithin24hPct: number | null;
  devSold: boolean;
  /** Set when the transfer lookup failed; the row then carries no evidence. */
  error?: string;
};

export type Forensics = {
  token: string;
  creationTx: string;
  createdAt: number;
  ageSec: number;
  deployer: string;
  factory: string | null;
  deployerFirstSeen: number | null;
  priorTokens: PriorToken[];
  priorTokensScanned: number;
  fundingPath: TrailNode[];
  historyError?: string;
  fundingError?: string;
  tokenLabel?: AddressLabel;
  explorer: string;
  ms: number;
};

export type JevResult = {
  verdict: Verdict;
  /** JEV's own confidence in the answer; compared against the policy threshold (rule C). */
  confidence: number;
  /** Probability JEV assigned to the chosen option. */
  probability: number;
  probabilities: Record<string, number>;
  riskScore?: number;
  model?: string;
  latencyMs: number;
};

export type SwapIntent = {
  amountUsd: number;
  network: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  description?: string;
  source: InstructionSource;
  instruction: string;
};

export type Decision = {
  id: string;
  kind: "swap";
  agentId: string;
  createdAt: string;
  verdict: Verdict;
  decidedBy: "rule" | "jev" | "fallback";
  rule?: Rule;
  confidence?: number;
  reasons: string[];
  signals: Signal[];
  intent: SwapIntent;
  policy: Policy;
  timings: { totalMs: number; interceptaMs?: number; uniswapMs?: number; forensicsMs?: number; jevMs?: number };
  raw: { intercepta?: unknown[]; uniswapQuote?: unknown; jevRequest?: unknown; jev?: unknown };
  /** Mainnet swaps are analysed only; nothing is signed or broadcast. */
  analysisOnly: true;
  stages: Stage[];
  token?: TokenInfo;
  ethUsd?: number;
  quote?: QuoteSummary;
  quoteError?: string;
  tokenScan?: InterceptaTokenResult;
  forensics?: Forensics;
  forensicsError?: string;
  jev?: JevResult;
  jevError?: string;
  fallbackNet?: number;
  spentBeforeUsd: number;
  integrations: { intercepta: boolean; uniswapApi: boolean; jev: boolean; explorer: string };
};

export type SwapRequest = {
  agentId: string;
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  amountIn?: string;
  amountUsd?: number;
  purpose?: string;
  source: InstructionSource;
  instruction?: string;
};

export type StreamEvent =
  | { type: "stage"; stage: Stage }
  | { type: "decision"; decision: Decision }
  | { type: "error"; message: string };
