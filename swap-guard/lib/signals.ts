/*
 * Turns collected evidence into signals. Weights are fixed per rule below: they
 * drive the "What tipped the scale" view and the fallback score used when JEV
 * is unavailable. JEV itself receives the evidence, not these weights.
 */
import { etherscanAddress, etherscanTx, shortAddress } from "./chain";
import type {
  Forensics,
  InstructionSource,
  InterceptaAddressResult,
  InterceptaTokenResult,
  QuoteSummary,
  Signal,
} from "./types";

const DAY = 24 * 3600;

export function formatDuration(sec: number): string {
  if (sec < 90) return `${Math.round(sec)} s`;
  if (sec < 90 * 60) return `${Math.round(sec / 60)} min`;
  if (sec < 48 * 3600) return `${(sec / 3600).toFixed(1)} h`;
  return `${Math.round(sec / DAY)} days`;
}

function traitList(scan: InterceptaAddressResult) {
  return scan.traits.length ? scan.traits.map((trait) => trait.name).join(", ") : "no traits";
}

export function buildSignals(input: {
  source: InstructionSource;
  quote?: QuoteSummary;
  maxPriceImpact: number;
  tokenScan?: InterceptaTokenResult;
  forensics?: Forensics;
}): Signal[] {
  const signals: Signal[] = [];
  const { quote, tokenScan, forensics } = input;

  // Where the instruction came from.
  if (input.source === "owner") {
    signals.push({
      key: "source",
      label: "Instruction came from the owner",
      value: "Owner instruction",
      weight: -0.3,
      source: "intent",
    });
  } else {
    signals.push({
      key: "source",
      label: `Instruction came from an untrusted ${input.source === "social" ? "social post" : "merchant message"}`,
      value: input.source,
      weight: 0.6,
      source: "intent",
    });
  }

  // Uniswap quote.
  if (quote && quote.priceImpactPct !== null) {
    const impact = quote.priceImpactPct;
    signals.push({
      key: "price-impact",
      label: impact < 1 ? "Pool is deep enough for the size" : "Noticeable price impact",
      value: `${impact < 0.01 ? "< 0.01" : impact.toFixed(2)}% impact (policy max ${input.maxPriceImpact}%) · ${quote.route}`,
      weight: impact < 1 ? -0.3 : 0.3,
      source: "uniswap",
      evidenceUrl: quote.pools[0]?.address ? etherscanAddress(quote.pools[0].address) : undefined,
    });
  }

  // Intercepta token scan.
  if (tokenScan && tokenScan.tier !== "unknown") {
    const detectors =
      tokenScan.detectors.map((detector) => detector.code).join(", ") || "no detectors";
    const weight =
      tokenScan.tier === "high"
        ? 3
        : tokenScan.tier === "medium"
          ? 1.2
          : tokenScan.trust === "whitelist"
            ? -1.5
            : -0.5;
    signals.push({
      key: "intercepta-token",
      label:
        tokenScan.tier === "low"
          ? "Intercepta: token scan clear"
          : `Intercepta: token flagged ${tokenScan.tier}`,
      value: `risk ${tokenScan.riskScore ?? "?"} · ${tokenScan.riskLevel ?? "?"} · action ${tokenScan.action ?? "?"} · ${detectors}`,
      weight,
      source: "intercepta",
    });
  }

  if (!forensics) return signals;

  // Token age.
  const age = forensics.ageSec;
  signals.push({
    key: "token-age",
    label: `Token is ${formatDuration(age)} old`,
    value: `Created ${new Date(forensics.createdAt * 1000).toISOString().replace("T", " ").slice(0, 16)} UTC${forensics.factory ? ` through ${shortAddress(forensics.factory)}` : ""}`,
    weight: age < DAY ? 0.8 : age < 7 * DAY ? 0.4 : age > 90 * DAY ? -0.5 : 0,
    source: "chain",
    evidenceUrl: etherscanTx(forensics.creationTx),
  });

  // Deployer track record. Rows whose lookup failed carry no evidence either way.
  const prior = forensics.priorTokens.filter((row) => !row.error);
  const sold = prior.filter((row) => row.devSold);
  if (forensics.historyError) {
    signals.push({
      key: "dev-sold",
      label: "Deployer history could not be read",
      value: forensics.historyError,
      weight: 0,
      source: "chain",
      evidenceUrl: etherscanAddress(forensics.deployer),
    });
  } else if (sold.length) {
    signals.push({
      key: "dev-sold",
      label: `Deployer dumped ${sold.length} of ${prior.length} other tokens`,
      value: sold
        .slice(0, 4)
        .map(
          (row) =>
            `${row.symbol}: ${row.movedOutPct?.toFixed(0)}% out${row.firstOutAfterSec !== null ? ` after ${formatDuration(row.firstOutAfterSec)}` : ""}`,
        )
        .join("; "),
      weight: Math.min(2.5, 0.9 * sold.length),
      source: "chain",
      evidenceUrl: etherscanAddress(forensics.deployer),
    });
  } else if (prior.some((row) => row.movedOutPct !== null)) {
    const held = prior.filter((row) => row.movedOutPct !== null);
    signals.push({
      key: "dev-sold",
      label: `No dev dumps across ${held.length} other token${held.length === 1 ? "" : "s"}`,
      value: held.map((row) => `${row.symbol}: ${row.movedOutPct?.toFixed(0)}% out`).join("; "),
      weight: -0.8,
      source: "chain",
      evidenceUrl: etherscanAddress(forensics.deployer),
    });
  } else if (prior.length) {
    signals.push({
      key: "dev-sold",
      label: `Deployer launched ${prior.length} other token${prior.length === 1 ? "" : "s"} but never held supply`,
      value: prior.map((row) => row.symbol).join(", "),
      weight: 0,
      source: "chain",
      evidenceUrl: etherscanAddress(forensics.deployer),
    });
  } else {
    signals.push({
      key: "dev-sold",
      label: "Deployer has no other tokens",
      value: "No track record either way",
      weight: 0.2,
      source: "chain",
      evidenceUrl: etherscanAddress(forensics.deployer),
    });
  }

  // Fresh deployer wallet.
  if (forensics.deployerFirstSeen !== null) {
    const walletAge = forensics.createdAt - forensics.deployerFirstSeen;
    if (walletAge < 7 * DAY) {
      signals.push({
        key: "fresh-deployer",
        label: "Deployer wallet was fresh at launch",
        value: `First transaction ${formatDuration(walletAge)} before the launch`,
        weight: 0.4,
        source: "chain",
        evidenceUrl: etherscanAddress(forensics.deployer),
      });
    }
  }

  // Deployer and funding wallets.
  for (const node of forensics.fundingPath) {
    if (node.role === "token" || node.role === "factory") continue;
    const who =
      node.role === "deployer"
        ? "Deployer"
        : node.role === "funder-1"
          ? "Deployer's first funder"
          : "Second-hop funder";
    if (node.watchlist) {
      signals.push({
        key: `watch-${node.address}`,
        label: `${who} is on the team watchlist`,
        value: `${node.watchlist.label} (source: ${node.watchlist.source})`,
        weight: 2,
        source: "chain",
        evidenceUrl: etherscanAddress(node.address),
      });
    }
    if (node.label?.isScam) {
      signals.push({
        key: `scam-${node.address}`,
        label: `${who} is marked as scam on Blockscout`,
        value: shortAddress(node.address),
        weight: 1.5,
        source: "chain",
        evidenceUrl: etherscanAddress(node.address),
      });
    }
    const scan = node.intercepta;
    if (scan && scan.tier !== "unknown") {
      const weight =
        scan.tier === "high"
          ? node.role === "deployer"
            ? 2
            : 1.8
          : scan.tier === "medium"
            ? 0.8
            : node.role === "deployer"
              ? -0.3
              : -0.1;
      signals.push({
        key: `intercepta-${node.role}`,
        label:
          scan.tier === "low"
            ? `Intercepta: ${who.toLowerCase()} clear`
            : `Intercepta: ${who.toLowerCase()} is ${scan.tier} risk`,
        value: `toxicScore ${scan.toxicScore} · ${traitList(scan)}`,
        weight,
        source: "intercepta",
        evidenceUrl: etherscanAddress(node.address),
      });
    }
    if (node.role === "funder-1" && node.label && (node.label.name || node.label.tags.length)) {
      signals.push({
        key: "funder-labeled",
        label: "Launch funds came from a labeled wallet",
        value: node.label.name ?? node.label.tags.join(", "),
        weight: -0.3,
        source: "chain",
        evidenceUrl: etherscanAddress(node.address),
      });
    } else if (node.role === "funder-1" && (node.label?.txCount ?? 0) > 5000) {
      signals.push({
        key: "funder-hub",
        label: "Launch funds came from a high-volume wallet",
        value: `${node.label!.txCount!.toLocaleString("en-US")} outgoing transactions, typical of an exchange hot wallet`,
        weight: -0.2,
        source: "chain",
        evidenceUrl: etherscanAddress(node.address),
      });
    }
  }

  // Token flagged on Blockscout.
  if (forensics.tokenLabel?.isScam) {
    signals.push({
      key: "token-scam",
      label: "Token is marked as scam on Blockscout",
      value: shortAddress(forensics.token),
      weight: 2,
      source: "chain",
      evidenceUrl: etherscanAddress(forensics.token),
    });
  }

  return signals;
}

/** Fixed-weight fallback used when JEV times out or is not configured. */
export function fallbackVerdict(signals: Signal[]) {
  const net = signals.reduce((total, signal) => total + signal.weight, 0);
  const verdict = net >= 1.5 ? "BLOCK" : net <= -0.5 ? "ALLOW" : "ESCALATE";
  return { verdict: verdict as "ALLOW" | "BLOCK" | "ESCALATE", net: Math.round(net * 100) / 100 };
}
