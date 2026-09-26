/*
 * Block explorer access. Account history uses the Etherscan V2 API when a key is
 * configured and the Blockscout Etherscan-compatible API otherwise; both accept
 * the same module/action parameters. Address labels come from Blockscout v2.
 */
import type { Address } from "viem";
import { rpc } from "./chain";
import { config } from "./config";
import { HttpError, errorMessage, fetchJson, limiter, sleep } from "./http";
import type { AddressLabel } from "./types";

type ExplorerResponse<T> = { status?: string; message?: string; result: T };

export type ExplorerTx = {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  value: string;
  contractAddress: string;
  input: string;
  methodId?: string;
  isError: string;
};

export type ExplorerInternalTx = {
  blockNumber: string;
  timeStamp: string;
  transactionHash: string;
  hash?: string;
  from: string;
  to: string;
  value: string;
  contractAddress: string;
  type: string;
  isError: string;
};

export type ExplorerTokenTx = {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  value: string;
  contractAddress: string;
  tokenSymbol?: string;
  tokenName?: string;
  tokenDecimal?: string;
};

export type ContractCreation = {
  contractAddress: string;
  contractCreator: string;
  txHash: string;
  blockNumber?: string;
  contractFactory?: string;
};

// Account history providers, tried in order: Etherscan V2 when ETHERSCAN_API_KEY
// is set (5 calls/s on the free tier), then Routescan's and Blockscout's keyless
// Etherscan-compatible APIs. A provider that is rate limited or failing hands
// the call to the next one.
type Provider = {
  name: string;
  url: (query: URLSearchParams) => string;
  limit: ReturnType<typeof limiter>;
  coolUntil?: number;
};
const COOL_DOWN_MS = 60_000;

const PROVIDERS: Record<"etherscan" | "routescan" | "blockscout", Provider> = {
  etherscan: {
    name: "Etherscan",
    url: (query) => {
      query.set("chainid", "1");
      query.set("apikey", config.etherscanKey());
      return `https://api.etherscan.io/v2/api?${query}`;
    },
    limit: limiter(3, 220),
  },
  routescan: {
    name: "Routescan",
    url: (query) => `https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api?${query}`,
    limit: limiter(3, 250),
  },
  blockscout: {
    name: "Blockscout",
    url: (query) => withBlockscoutKey(`${config.blockscoutUrl()}/api?${query}`),
    limit: limiter(1, 350),
  },
};
// Blockscout's v2 REST API (labels) has its own budget: 180 requests per 30 s.
const blockscoutV2Limit = limiter(3, 170);
const RATE_LIMITED = /rate limit|too many requests/i;

/** Logs each explorer call and its duration when MAAT_DEBUG=1. */
function debug(label: string, startedAt: number, outcome: string) {
  if (process.env.MAAT_DEBUG === "1")
    console.log(`[explorer] ${label} ${Math.round(performance.now() - startedAt)}ms ${outcome}`);
}

function providers(): Provider[] {
  const keyless = [PROVIDERS.routescan, PROVIDERS.blockscout];
  return config.etherscanKey() ? [PROVIDERS.etherscan, ...keyless] : keyless;
}

export function explorerName(): string {
  return providers()
    .map((provider) => provider.name)
    .join(" → ");
}

function withBlockscoutKey(url: string) {
  const key = config.blockscoutKey();
  if (!key) return url;
  return `${url}${url.includes("?") ? "&" : "?"}apikey=${encodeURIComponent(key)}`;
}

/** Blockscout v2 GET with pacing and retry on HTTP 429. */
async function blockscoutGet<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const startedAt = performance.now();
    try {
      const result = await blockscoutV2Limit(() =>
        fetchJson<T>(withBlockscoutKey(`${config.blockscoutUrl()}${path}`), { timeoutMs: 10_000 }),
      );
      debug(`blockscout-v2 ${path}`, startedAt, "ok");
      return result;
    } catch (caught) {
      debug(`blockscout-v2 ${path}`, startedAt, errorMessage(caught).slice(0, 60));
      if (attempt < 3 && caught instanceof HttpError && caught.status === 429) {
        await sleep(700 * (attempt + 1));
        continue;
      }
      throw caught;
    }
  }
}

class RateLimited extends Error {}

async function callProvider<T>(
  provider: Provider,
  params: Record<string, string>,
  attempts: number,
): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    let body: ExplorerResponse<T>;
    const startedAt = performance.now();
    const label = `${provider.name} ${params.action} ${params.address ?? params.contractaddresses ?? ""}`;
    try {
      body = await provider.limit(() =>
        fetchJson<ExplorerResponse<T>>(provider.url(new URLSearchParams(params)), {
          timeoutMs: 15_000,
        }),
      );
      debug(label, startedAt, `status ${body.status} ${body.message ?? ""}`);
    } catch (caught) {
      debug(label, startedAt, errorMessage(caught).slice(0, 60));
      if (caught instanceof HttpError && caught.status === 429) {
        await sleep(600 * (attempt + 1));
        continue;
      }
      throw caught;
    }
    if (body.status === "0") {
      const message = `${body.message ?? ""} ${typeof body.result === "string" ? body.result : ""}`;
      if (/no (transactions|records|token transfers|internal transactions) found/i.test(message))
        return [] as T;
      if (RATE_LIMITED.test(message)) {
        await sleep(600 * (attempt + 1));
        continue;
      }
      if (Array.isArray(body.result)) return body.result;
      throw new Error(`${provider.name}: ${message.trim()}`);
    }
    if (body.result === null || body.result === undefined)
      throw new Error(`${provider.name} returned no result: ${body.message ?? "unknown"}`);
    return body.result;
  }
  provider.coolUntil = Date.now() + COOL_DOWN_MS;
  throw new RateLimited(`${provider.name} rate limit reached`);
}

async function call<T>(params: Record<string, string>): Promise<T> {
  const errors: string[] = [];
  const all = providers();
  // Skip providers that were rate limited recently, unless every one of them was.
  const ready = all.filter((provider) => !provider.coolUntil || provider.coolUntil < Date.now());
  const order = ready.length ? ready : all;
  for (const [index, provider] of order.entries()) {
    try {
      // Retry harder on the last provider: nothing is left to hand over to.
      return await callProvider<T>(provider, params, index === order.length - 1 ? 3 : 2);
    } catch (caught) {
      errors.push(caught instanceof Error ? caught.message : String(caught));
    }
  }
  throw new Error(
    `Explorer unavailable (${errors.join("; ")}). Set ETHERSCAN_API_KEY for a dedicated quota.`,
  );
}

const page = (offset: number, sort: "asc" | "desc" = "asc") => ({
  page: "1",
  offset: String(offset),
  sort,
});

export function txList(address: string, offset = 1000, sort: "asc" | "desc" = "asc") {
  return call<ExplorerTx[]>({
    module: "account",
    action: "txlist",
    address,
    startblock: "0",
    endblock: "99999999",
    ...page(offset, sort),
  });
}

export function internalTxList(address: string, offset = 200) {
  return call<ExplorerInternalTx[]>({
    module: "account",
    action: "txlistinternal",
    address,
    startblock: "0",
    endblock: "99999999",
    ...page(offset),
  });
}

export function tokenTxList(address: string, contractAddress?: string, offset = 1000) {
  const params: Record<string, string> = {
    module: "account",
    action: "tokentx",
    address,
    startblock: "0",
    endblock: "99999999",
    ...page(offset),
  };
  if (contractAddress) params.contractaddress = contractAddress;
  return call<ExplorerTokenTx[]>(params);
}

/** Creation records for up to 5 contracts per call. */
export async function contractCreations(addresses: string[]): Promise<ContractCreation[]> {
  if (!addresses.length) return [];
  return call<ContractCreation[]>({
    module: "contract",
    action: "getcontractcreation",
    contractaddresses: addresses.join(","),
  });
}

type BlockscoutAddress = {
  name?: string | null;
  is_contract?: boolean;
  is_scam?: boolean;
  public_tags?: { display_name?: string; label?: string }[];
  metadata?: { tags?: { name?: string }[] } | null;
  token?: { holders_count?: string; holders?: string } | null;
};

/**
 * Label, contract flag and Blockscout scam flag for an address, plus the
 * outgoing transaction count (nonce) from the RPC when `withCount` is set.
 * Returns undefined when Blockscout is unreachable.
 */
export async function addressLabel(
  address: string,
  withCount = false,
): Promise<AddressLabel | undefined> {
  try {
    const [info, nonce] = await Promise.all([
      blockscoutGet<BlockscoutAddress>(`/api/v2/addresses/${address}`),
      withCount
        ? rpc()
            .getTransactionCount({ address: address as Address })
            .catch(() => undefined)
        : undefined,
    ]);
    const tags = [
      ...(info.public_tags ?? []).map((tag) => tag.display_name ?? tag.label ?? ""),
      ...(info.metadata?.tags ?? []).map((tag) => tag.name ?? ""),
    ].filter(Boolean);
    return {
      name: info.name ?? undefined,
      tags: [...new Set(tags)],
      isContract: Boolean(info.is_contract),
      isScam: Boolean(info.is_scam),
      txCount: nonce,
    };
  } catch {
    return undefined;
  }
}

type BlockscoutToken = { holders_count?: string; holders?: string };

export async function tokenHolders(address: string): Promise<number | undefined> {
  try {
    const token = await blockscoutGet<BlockscoutToken>(`/api/v2/tokens/${address}`);
    const holders = token.holders_count ?? token.holders;
    return holders ? Number(holders) : undefined;
  } catch {
    return undefined;
  }
}
