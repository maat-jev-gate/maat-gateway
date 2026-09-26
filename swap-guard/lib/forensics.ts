/*
 * Deployer forensics on Ethereum mainnet, computed live for every request:
 *   1. Real deployer: the signer of the token's creation transaction. When the
 *      token was created by a launchpad or factory contract, that contract is
 *      recorded as `factory` and the signer is followed instead.
 *   2. Prior tokens: contracts the deployer created directly, tokens created
 *      through the same factory call, and tokens minted straight to the
 *      deployer. For each, how much of the deployer's balance left the wallet
 *      and how soon after launch.
 *   3. Funding path: the deployer's earliest incoming ETH, traced back up to two
 *      hops. Each address is checked against Intercepta, Blockscout labels, and
 *      the team watchlist.
 *   4. Token age.
 */
import { formatUnits, type Address, type Hex } from "viem";
import { TRANSFER_TOPIC, ZERO_ADDRESS, checksum, rpc, tokenInfo } from "./chain";
import { addressLabel, contractCreations, explorerName, internalTxList, tokenTxList, txList, type ContractCreation, type ExplorerInternalTx, type ExplorerTokenTx, type ExplorerTx } from "./explorer";
import { errorMessage, limiter } from "./http";
import { quickScanAddress } from "./intercepta";
import type { Forensics, PriorToken, StageKey, TrailNode } from "./types";
import { watchlistHit } from "./watchlist";

const MAX_PRIOR_TOKENS = 8;
const MAX_FACTORY_RECEIPTS = 12;
const DEV_SOLD_PCT = 50;
const DEV_SOLD_WINDOW_SEC = 7 * 24 * 3600;
const HUB_TX_COUNT = 5000;
const TRANSFER_PAGE = 1000;
const MAX_MINT_CHECKS = 10;
const LP_SYMBOLS = /^(UNI-V2|SLP|Cake-LP|SUSHI-LP)$/i;

type StageHook = (key: StageKey, event: "start" | "done" | "failed", note?: string) => void;

const lower = (value: string | null | undefined) => (value ?? "").toLowerCase();
const zeroTopic = `0x${"0".repeat(64)}`;

async function resolveDeployer(token: Address) {
  const [creation] = await contractCreations([token]);
  if (!creation?.txHash) throw new Error("The explorer has no creation record for this token.");
  const tx = await rpc().getTransaction({ hash: creation.txHash as Hex });
  const block = await rpc().getBlock({ blockNumber: tx.blockNumber! });
  const deployer = checksum(tx.from);
  const factory = tx.to && lower(tx.to) !== lower(token) ? checksum(tx.to) : null;
  return {
    creationTx: creation.txHash,
    createdAt: Number(block.timestamp),
    deployer,
    factory,
    methodId: factory ? tx.input.slice(0, 10) : null,
  };
}

/** Tokens a factory call minted, read from the call's Transfer(from = 0x0) logs. */
async function mintedInTx(hash: string): Promise<Address[]> {
  const receipt = await rpc().getTransactionReceipt({ hash: hash as Hex });
  const minted = receipt.logs
    .filter((log) => log.topics[0] === TRANSFER_TOPIC && log.topics[1] === zeroTopic && log.topics.length === 3)
    .map((log) => checksum(log.address));
  return [...new Set(minted)];
}

type Candidate = { address: Address; launchTx: string; launchedAt: number };

/** The subset of `addresses` whose creation transaction was signed by `deployer`. */
async function createdBy(deployer: Address, addresses: string[]) {
  const creations: ContractCreation[] = [];
  for (let index = 0; index < addresses.length; index += 5) {
    creations.push(...(await contractCreations(addresses.slice(index, index + 5))));
  }
  const checks = await Promise.all(
    creations.map(async (creation) => {
      if (lower(creation.contractCreator) === lower(deployer)) return creation;
      const tx = await rpc().getTransaction({ hash: creation.txHash as Hex }).catch(() => null);
      return tx && lower(tx.from) === lower(deployer) ? creation : null;
    }),
  );
  return checks.filter((creation): creation is ContractCreation => Boolean(creation)).map((creation) => ({ address: creation.contractAddress, txHash: creation.txHash }));
}

async function findPriorTokens(
  deployer: Address,
  token: Address,
  factory: Address | null,
  methodId: string | null,
  creationTx: string,
  txs: ExplorerTx[],
  transfersRequest: Promise<ExplorerTokenTx[]>,
) {
  const candidates = new Map<string, Candidate>();
  const add = (address: string, launchTx: string, launchedAt: number) => {
    const key = lower(address);
    if (!key || key === lower(token) || candidates.has(key)) return;
    candidates.set(key, { address: checksum(address), launchTx, launchedAt });
  };

  for (const tx of txs) {
    if (tx.isError === "0" && tx.contractAddress && !tx.to) add(tx.contractAddress, tx.hash, Number(tx.timeStamp));
  }

  if (factory && methodId) {
    const factoryCalls = txs
      .filter((tx) => tx.isError === "0" && lower(tx.to) === lower(factory) && tx.input?.startsWith(methodId) && lower(tx.hash) !== lower(creationTx))
      .slice(-MAX_FACTORY_RECEIPTS);
    const receiptLimit = limiter(4);
    const minted = await Promise.all(
      factoryCalls.map((tx) => receiptLimit(() => mintedInTx(tx.hash).then((tokens) => ({ tx, tokens })).catch(() => ({ tx, tokens: [] as Address[] })))),
    );
    for (const { tx, tokens } of minted) for (const address of tokens) add(address, tx.hash, Number(tx.timeStamp));
  }

  // One call for all of the deployer's token transfers; per-token calls only if it was truncated.
  const transfers = await transfersRequest;
  const truncated = transfers.length >= TRANSFER_PAGE;

  // Tokens minted straight to the deployer are only candidates: spam tokens mint
  // themselves to well-known wallets and emit fake transfers. Keep one only if
  // its creation transaction was signed by the deployer.
  const minted = new Map<string, { address: string; hash: string; at: number }>();
  for (const transfer of transfers) {
    const key = lower(transfer.contractAddress);
    if (lower(transfer.from) === ZERO_ADDRESS && lower(transfer.to) === lower(deployer) && key !== lower(token) && !candidates.has(key) && !minted.has(key)) {
      minted.set(key, { address: transfer.contractAddress, hash: transfer.hash, at: Number(transfer.timeStamp) });
    }
  }
  const toVerify = [...minted.values()].sort((a, b) => b.at - a.at).slice(0, MAX_MINT_CHECKS);
  for (const verified of await createdBy(deployer, toVerify.map((item) => item.address))) {
    const item = minted.get(lower(verified.address))!;
    add(item.address, verified.txHash, item.at);
  }

  const recent = [...candidates.values()].sort((a, b) => b.launchedAt - a.launchedAt).slice(0, MAX_PRIOR_TOKENS * 2);
  const checked = await Promise.all(recent.map((candidate) => tokenInfo(candidate.address).then((info) => ({ candidate, info })).catch(() => null)));
  const tokens = checked
    .filter((item): item is NonNullable<typeof item> => Boolean(item) && !LP_SYMBOLS.test(item!.info.symbol))
    .slice(0, MAX_PRIOR_TOKENS);

  const rows = await Promise.all(
    tokens.map(async ({ candidate, info }) => {
      try {
        const own = truncated
          ? await tokenTxList(deployer, candidate.address)
          : transfers.filter((transfer) => lower(transfer.contractAddress) === lower(candidate.address));
        return devFlow(deployer, candidate, info.symbol, info.name, info.decimals, own);
      } catch (caught) {
        return { ...devFlow(deployer, candidate, info.symbol, info.name, info.decimals, []), error: errorMessage(caught) };
      }
    }),
  );
  return { rows, scanned: candidates.size };
}

function devFlow(deployer: Address, candidate: Candidate, symbol: string, name: string, decimals: number, transfers: ExplorerTokenTx[]): PriorToken {
  let received = 0n;
  let movedOut = 0n;
  let movedOut24h = 0n;
  let firstOut: number | null = null;
  for (const transfer of transfers) {
    const value = BigInt(transfer.value || "0");
    const at = Number(transfer.timeStamp);
    if (lower(transfer.to) === lower(deployer)) received += value;
    if (lower(transfer.from) === lower(deployer)) {
      movedOut += value;
      if (at - candidate.launchedAt <= 24 * 3600) movedOut24h += value;
      if (firstOut === null || at < firstOut) firstOut = at;
    }
  }
  const pct = (part: bigint) => (received > 0n ? Math.min(100, Number((part * 10000n) / received) / 100) : null);
  const movedOutPct = pct(movedOut);
  const firstOutAfterSec = firstOut === null ? null : Math.max(0, firstOut - candidate.launchedAt);
  return {
    address: candidate.address,
    symbol,
    name,
    launchedAt: candidate.launchedAt,
    launchTx: candidate.launchTx,
    received: formatUnits(received, decimals),
    movedOut: formatUnits(movedOut, decimals),
    movedOutPct,
    firstOutAfterSec,
    movedOutWithin24hPct: pct(movedOut24h),
    devSold: movedOutPct !== null && movedOutPct >= DEV_SOLD_PCT && firstOutAfterSec !== null && firstOutAfterSec <= DEV_SOLD_WINDOW_SEC,
  };
}

type Incoming = { from: Address; valueEth: string; txHash: string; timestamp: number; via: "tx" | "internal" };

async function earliestIncoming(address: Address, beforeTs: number, knownTxs?: ExplorerTx[], knownInternal?: Promise<ExplorerInternalTx[]>): Promise<Incoming | null> {
  const [txs, internal] = await Promise.all([knownTxs ?? txList(address, 200), knownInternal ?? internalTxList(address, 200)]);
  const incoming: Incoming[] = [
    ...txs
      .filter((tx) => tx.isError === "0" && lower(tx.to) === lower(address) && BigInt(tx.value || "0") > 0n && Number(tx.timeStamp) <= beforeTs)
      .map((tx) => ({ from: checksum(tx.from), valueEth: formatUnits(BigInt(tx.value), 18), txHash: tx.hash, timestamp: Number(tx.timeStamp), via: "tx" as const })),
    ...internal
      .filter((tx) => tx.isError === "0" && lower(tx.to) === lower(address) && BigInt(tx.value || "0") > 0n && Number(tx.timeStamp) <= beforeTs)
      .map((tx) => ({ from: checksum(tx.from), valueEth: formatUnits(BigInt(tx.value), 18), txHash: tx.transactionHash ?? tx.hash ?? "", timestamp: Number(tx.timeStamp), via: "internal" as const })),
  ];
  incoming.sort((a, b) => a.timestamp - b.timestamp);
  return incoming[0] ?? null;
}

async function enrich(node: TrailNode, raw: unknown[], withCount: boolean): Promise<TrailNode> {
  const [label, intercepta] = await Promise.all([
    addressLabel(node.address, withCount),
    node.role === "token" ? Promise.resolve(undefined) : quickScanAddress(node.address, raw),
  ]);
  return { ...node, label, intercepta, watchlist: watchlistHit(node.address) };
}

async function traceFunding(
  deployer: Address,
  factory: Address | null,
  token: Address,
  createdAt: number,
  deployerTxs: ExplorerTx[],
  deployerInternal: Promise<ExplorerInternalTx[]>,
  raw: unknown[],
) {
  const hop1 = await earliestIncoming(deployer, createdAt, deployerTxs, deployerInternal);
  const nodes: TrailNode[] = [];
  let funder1: TrailNode | null = null;
  if (hop1) {
    funder1 = await enrich({ role: "funder-1", address: hop1.from, edge: hop1 }, raw, true);
    const label = funder1.label;
    const hubReason = !label
      ? null
      : label.isContract
        ? "a contract"
        : label.name || label.tags.length
          ? "a labeled wallet"
          : (label.txCount ?? 0) > HUB_TX_COUNT
            ? "a high-volume wallet"
            : null;
    if (hubReason) {
      funder1.note = `Not traced further: ${hubReason}.`;
    } else {
      const hop2 = await earliestIncoming(hop1.from, hop1.timestamp).catch((caught) => {
        funder1!.note = `Second hop not traced: ${errorMessage(caught)}`;
        return null;
      });
      if (hop2) nodes.push(await enrich({ role: "funder-2", address: hop2.from, edge: hop2 }, raw, true));
    }
    nodes.push(funder1);
  }
  const tail: TrailNode[] = [{ role: "deployer", address: deployer }];
  if (factory) tail.push({ role: "factory", address: factory });
  tail.push({ role: "token", address: token });
  nodes.push(...(await Promise.all(tail.map((node) => enrich(node, raw, false)))));
  return { nodes, deployerFirstSeen: deployerTxs[0] ? Number(deployerTxs[0].timeStamp) : null };
}

export async function runForensics(tokenAddress: string, raw: unknown[], onStage: StageHook = () => {}): Promise<Forensics> {
  const startedAt = performance.now();
  const token = checksum(tokenAddress);

  onStage("deployer", "start");
  let origin: Awaited<ReturnType<typeof resolveDeployer>>;
  let deployerTxs: ExplorerTx[];
  let transfersRequest: Promise<ExplorerTokenTx[]>;
  let internalRequest: Promise<ExplorerInternalTx[]>;
  try {
    origin = await resolveDeployer(token);
    // The deployer's three histories are independent; fetch them together.
    transfersRequest = tokenTxList(origin.deployer, undefined, TRANSFER_PAGE);
    internalRequest = internalTxList(origin.deployer, 200);
    transfersRequest.catch(() => undefined);
    internalRequest.catch(() => undefined);
    deployerTxs = await txList(origin.deployer, 1000);
    onStage("deployer", "done", origin.factory ? "factory skipped, signer followed" : "direct deployment");
  } catch (caught) {
    onStage("deployer", "failed", errorMessage(caught));
    throw caught;
  }

  onStage("history", "start");
  onStage("funding", "start");
  const [history, funding] = await Promise.all([
    findPriorTokens(origin.deployer, token, origin.factory, origin.methodId, origin.creationTx, deployerTxs, transfersRequest)
      .then((result) => {
        onStage("history", "done", `${result.rows.length} prior token(s)`);
        return result;
      })
      .catch((caught) => {
        onStage("history", "failed", errorMessage(caught));
        return { rows: [] as PriorToken[], scanned: 0, error: errorMessage(caught) };
      }),
    traceFunding(origin.deployer, origin.factory, token, origin.createdAt, deployerTxs, internalRequest, raw)
      .then((result) => {
        onStage("funding", "done", `${result.nodes.filter((node) => node.role.startsWith("funder")).length} hop(s)`);
        return result;
      })
      .catch((caught) => {
        onStage("funding", "failed", errorMessage(caught));
        return { nodes: [] as TrailNode[], deployerFirstSeen: null, error: errorMessage(caught) };
      }),
  ]);

  return {
    token,
    creationTx: origin.creationTx,
    createdAt: origin.createdAt,
    ageSec: Math.max(0, Math.round(Date.now() / 1000) - origin.createdAt),
    deployer: origin.deployer,
    factory: origin.factory,
    deployerFirstSeen: funding.deployerFirstSeen,
    priorTokens: history.rows,
    priorTokensScanned: history.scanned,
    fundingPath: funding.nodes,
    historyError: "error" in history ? history.error : undefined,
    fundingError: "error" in funding ? funding.error : undefined,
    tokenLabel: funding.nodes.find((node) => node.role === "token")?.label,
    explorer: explorerName(),
    ms: Math.round(performance.now() - startedAt),
  };
}
