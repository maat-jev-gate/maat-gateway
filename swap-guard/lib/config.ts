/* Server configuration: demo policy, endpoints, and which integrations have keys. */
import type { Policy } from "./types";

/** Demo policy from the project plan (§2.2). Shown on the page as-is. */
export const POLICY: Policy = {
  perTxLimit: 10,
  dailyLimit: 50,
  hardCap: 200,
  maxPriceImpact: 3,
  confidenceThreshold: 0.8,
};

export const MAINNET_CHAIN_ID = 1;
export const ETH_BLOCK_MS = 12_000;

function env(name: string, fallback = ""): string {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

function list(name: string, fallback = ""): string[] {
  return env(name, fallback).split(",").map((item) => item.trim()).filter(Boolean);
}

export const config = {
  rpcUrls: () => list("ETH_RPC_URL", "https://eth.drpc.org,https://mainnet.gateway.tenderly.co,https://ethereum-rpc.publicnode.com"),
  etherscanKey: () => env("ETHERSCAN_API_KEY"),
  blockscoutUrl: () => env("BLOCKSCOUT_URL", "https://eth.blockscout.com").replace(/\/+$/, ""),
  blockscoutKey: () => env("BLOCKSCOUT_API_KEY"),
  interceptaKey: () => env("INTERCEPTA_API_KEY"),
  interceptaUrl: () => env("INTERCEPTA_API_URL", "https://api.web3antivirus.io").replace(/\/+$/, ""),
  interceptaCache: () => env("INTERCEPTA_CACHE", "on").toLowerCase() !== "off",
  interceptaTimeoutMs: () => Number(env("INTERCEPTA_TIMEOUT_MS", "15000")) || 15000,
  uniswapKey: () => env("UNISWAP_API_KEY"),
  uniswapUrl: () => env("UNISWAP_API_URL", "https://trade-api.gateway.uniswap.org/v1").replace(/\/+$/, ""),
  uniswapSwapper: () => env("UNISWAP_SWAPPER"),
  jevUrl: () => env("JEV_API_URL", "https://api.typesafe.ai/v1/systemone"),
  jevKey: () => env("JEV_API_KEY"),
  jevModel: () => env("JEV_MODEL", "jev-latest"),
  jevTimeoutMs: () => Number(env("JEV_TIMEOUT_MS", "1500")) || 1500,
  agents: () => list("MAAT_AGENTS", "demo-agent"),
  frozenAgents: () => list("MAAT_FROZEN_AGENTS"),
};

export function integrations() {
  return {
    intercepta: Boolean(config.interceptaKey()),
    uniswapApi: Boolean(config.uniswapKey()),
    jev: Boolean(config.jevKey()),
    explorer: config.etherscanKey() ? "Etherscan V2 → Routescan → Blockscout" : "Routescan → Blockscout",
  };
}
