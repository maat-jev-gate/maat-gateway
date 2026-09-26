/*
 * Team-curated address list (data/watchlist.json), e.g. wallets tied to known
 * scam launches. Each entry must name its public source. The file ships empty.
 */
import entries from "@/data/watchlist.json";
import type { WatchlistHit } from "./types";

type Entry = { address: string; label: string; source: string };

const index = new Map<string, WatchlistHit>(
  (entries as Entry[]).map((entry) => [entry.address.toLowerCase(), { address: entry.address, label: entry.label, source: entry.source }]),
);

export function watchlistHit(address: string): WatchlistHit | undefined {
  return index.get(address.toLowerCase());
}

export const watchlistSize = index.size;
