/* Ethereum mainnet reads through viem: token metadata, transactions, and receipts. */
import { createPublicClient, erc20Abi, fallback, getAddress, http, type Address, type Hex } from "viem";
import { mainnet } from "viem/chains";
import { config } from "./config";

export const WETH: Address = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
export const USDC: Address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
export const NATIVE_ETH: Address = "0x0000000000000000000000000000000000000000";
export const ZERO_ADDRESS = NATIVE_ETH;
export const TRANSFER_TOPIC: Hex = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

let client: ReturnType<typeof makeClient> | undefined;

function makeClient() {
  // Try each configured RPC in order; a slow or failing endpoint hands over to the next.
  const transports = config.rpcUrls().map((url) => http(url, { timeout: 8_000, retryCount: 0 }));
  return createPublicClient({ chain: mainnet, transport: fallback(transports, { retryCount: 1 }), batch: { multicall: true } });
}

export function rpc() {
  client ??= makeClient();
  return client;
}

export function isAddress(value: string): value is Address {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function checksum(value: string): Address {
  return getAddress(value);
}

export async function tokenInfo(address: Address) {
  const [name, symbol, decimals] = await Promise.all([
    rpc().readContract({ address, abi: erc20Abi, functionName: "name" }).catch(() => ""),
    rpc().readContract({ address, abi: erc20Abi, functionName: "symbol" }),
    rpc().readContract({ address, abi: erc20Abi, functionName: "decimals" }),
  ]);
  return { address, name: String(name), symbol: String(symbol), decimals: Number(decimals) };
}

export function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export const etherscanTx = (hash: string) => `https://etherscan.io/tx/${hash}`;
export const etherscanAddress = (address: string) => `https://etherscan.io/address/${address}`;
