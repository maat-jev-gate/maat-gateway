/*
 * Uniswap adapter for Ethereum mainnet (analysis only, nothing is signed).
 *
 * With UNISWAP_API_KEY: Trading API POST /quote, CLASSIC routing over V2/V3/V4.
 * Without it: direct eth_call against the Uniswap v2 Router02 and v3 QuoterV2
 * contracts for the WETH pair, and price impact measured against a quote 1/1000
 * the size on the same pool.
 */
import { formatUnits, parseAbi, type Address } from "viem";
import { NATIVE_ETH, USDC, WETH, rpc } from "./chain";
import { config } from "./config";
import { fetchJson } from "./http";
import type { QuoteSummary, TokenInfo } from "./types";

const V2_ROUTER: Address = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const V2_FACTORY: Address = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
const V3_QUOTER_V2: Address = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";
const V3_FACTORY: Address = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const V3_FEES = [100, 500, 3000, 10000] as const;
const DEFAULT_SWAPPER: Address = "0x000000000000000000000000000000000000dEaD";
const SLIPPAGE_PCT = 2;

const v2RouterAbi = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
]);
const v2FactoryAbi = parseAbi(["function getPair(address, address) view returns (address)"]);
const v3FactoryAbi = parseAbi([
  "function getPool(address, address, uint24) view returns (address)",
]);
const quoterV2Abi = parseAbi([
  "struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }",
  "function quoteExactInputSingle(QuoteExactInputSingleParams params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

async function v3Quote(
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
  fee: number,
): Promise<bigint> {
  const { result } = await rpc().simulateContract({
    address: V3_QUOTER_V2,
    abi: quoterV2Abi,
    functionName: "quoteExactInputSingle",
    args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
  });
  return result[0];
}

async function v2Quote(tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<bigint> {
  const amounts = await rpc().readContract({
    address: V2_ROUTER,
    abi: v2RouterAbi,
    functionName: "getAmountsOut",
    args: [amountIn, [tokenIn, tokenOut]],
  });
  return amounts[amounts.length - 1];
}

/** USD price of 1 ETH from the Uniswap v3 WETH/USDC 0.05% pool. */
export async function ethUsdPrice(): Promise<number> {
  const out = await v3Quote(WETH, USDC, 10n ** 18n, 500);
  return Number(formatUnits(out, 6));
}

type Candidate = {
  protocol: "V2" | "V3";
  fee?: number;
  out: bigint;
  quote: (amount: bigint) => Promise<bigint>;
};

async function onchainQuote(
  token: TokenInfo,
  amountInWei: bigint,
): Promise<{ summary: QuoteSummary; raw: unknown }> {
  const tokenOut = token.address as Address;
  const attempts: Promise<Candidate | null>[] = [
    v2Quote(WETH, tokenOut, amountInWei)
      .then((out) => ({
        protocol: "V2" as const,
        out,
        quote: (amount: bigint) => v2Quote(WETH, tokenOut, amount),
      }))
      .catch(() => null),
    ...V3_FEES.map((fee) =>
      v3Quote(WETH, tokenOut, amountInWei, fee)
        .then((out) => ({
          protocol: "V3" as const,
          fee,
          out,
          quote: (amount: bigint) => v3Quote(WETH, tokenOut, amount, fee),
        }))
        .catch(() => null),
    ),
  ];
  const candidates = (await Promise.all(attempts)).filter((item): item is Candidate =>
    Boolean(item && item.out > 0n),
  );
  if (!candidates.length) throw new Error("No Uniswap v2 or v3 WETH pool could quote this token.");
  const best = candidates.reduce((a, b) => (b.out > a.out ? b : a));

  const refIn = amountInWei / 1000n > 0n ? amountInWei / 1000n : 1n;
  const [refOut, pool, blockNumber] = await Promise.all([
    best.quote(refIn),
    best.protocol === "V2"
      ? rpc().readContract({
          address: V2_FACTORY,
          abi: v2FactoryAbi,
          functionName: "getPair",
          args: [WETH, tokenOut],
        })
      : rpc().readContract({
          address: V3_FACTORY,
          abi: v3FactoryAbi,
          functionName: "getPool",
          args: [WETH, tokenOut, best.fee!],
        }),
    rpc().getBlockNumber(),
  ]);
  // Execution price vs. the near-spot price of a tiny trade on the same pool.
  const exec = Number(best.out) / Number(amountInWei);
  const spot = Number(refOut) / Number(refIn);
  const impact = spot > 0 ? Math.max(0, (1 - exec / spot) * 100) : null;
  const minOut = (best.out * BigInt(10000 - SLIPPAGE_PCT * 100)) / 10000n;
  const feeLabel = ` ${((best.fee ?? 3000) / 10000).toFixed(2)}%`;

  return {
    summary: {
      provider: "onchain",
      routing: "CLASSIC",
      amountIn: formatUnits(amountInWei, 18),
      amountOut: formatUnits(best.out, token.decimals),
      minOut: formatUnits(minOut, token.decimals),
      priceImpactPct: impact,
      route: `ETH → ${token.symbol} via Uniswap ${best.protocol}${feeLabel}`,
      pools: [{ protocol: best.protocol, address: pool, fee: best.fee ?? 3000 }],
      blockNumber: blockNumber.toString(),
    },
    raw: {
      source: "onchain",
      candidates: candidates.map((item) => ({
        protocol: item.protocol,
        fee: item.fee ?? 3000,
        amountOut: item.out.toString(),
      })),
      reference: { amountIn: refIn.toString(), amountOut: refOut.toString() },
      pool,
      blockNumber: blockNumber.toString(),
    },
  };
}

type TradingApiRoute = {
  type: string;
  address: string;
  fee?: string | number;
  tokenIn?: { symbol?: string };
  tokenOut?: { symbol?: string };
};
type TradingApiQuote = {
  routing: string;
  quote: {
    input?: { amount?: string };
    output?: { amount?: string; minimumAmount?: string };
    priceImpact?: number;
    routeString?: string;
    route?: TradingApiRoute[][];
    gasFeeUSD?: string;
    blockNumber?: string;
    aggregatedOutputs?: { amount?: string; minAmount?: string; fee?: string }[];
  };
};

async function tradingApiQuote(
  token: TokenInfo,
  amountInWei: bigint,
): Promise<{ summary: QuoteSummary; raw: unknown }> {
  const body = await fetchJson<TradingApiQuote>(`${config.uniswapUrl()}/quote`, {
    method: "POST",
    headers: {
      "x-api-key": config.uniswapKey(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      type: "EXACT_INPUT",
      amount: amountInWei.toString(),
      tokenInChainId: 1,
      tokenOutChainId: 1,
      tokenIn: NATIVE_ETH,
      tokenOut: token.address,
      swapper: config.uniswapSwapper() || DEFAULT_SWAPPER,
      slippageTolerance: SLIPPAGE_PCT,
      routingPreference: "BEST_PRICE",
      protocols: ["V2", "V3", "V4"],
    }),
    timeoutMs: 10_000,
  });
  const quote = body.quote ?? {};
  const core = quote.aggregatedOutputs?.find((output) => !output.fee);
  const outAmount = quote.output?.amount ?? core?.amount ?? "0";
  const minAmount = quote.output?.minimumAmount ?? core?.minAmount;
  const pools = (quote.route ?? []).flat().map((pool) => ({
    protocol: pool.type.replace("-pool", "").toUpperCase(),
    address: pool.address,
    fee: pool.fee === undefined ? undefined : Number(pool.fee),
  }));
  return {
    summary: {
      provider: "trading-api",
      routing: body.routing,
      amountIn: formatUnits(BigInt(quote.input?.amount ?? amountInWei.toString()), 18),
      amountOut: formatUnits(BigInt(outAmount), token.decimals),
      minOut: minAmount ? formatUnits(BigInt(minAmount), token.decimals) : undefined,
      priceImpactPct: typeof quote.priceImpact === "number" ? quote.priceImpact : null,
      route: pools.length
        ? `ETH → ${token.symbol} via Uniswap ${pools.map((pool) => `${pool.protocol}${pool.fee !== undefined ? ` ${(pool.fee / 10000).toFixed(2)}%` : ""}`).join(" + ")}`
        : (quote.routeString ?? body.routing),
      pools,
      gasFeeUsd: quote.gasFeeUSD,
      blockNumber: quote.blockNumber,
    },
    raw: body,
  };
}

export async function quoteEthToToken(token: TokenInfo, amountInWei: bigint) {
  return config.uniswapKey()
    ? tradingApiQuote(token, amountInWei)
    : onchainQuote(token, amountInWei);
}
