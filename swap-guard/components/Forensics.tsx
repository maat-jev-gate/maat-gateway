/* Money trail and deployer track record, both computed live from mainnet. */
import type { Forensics, Tier, TrailNode } from "@/lib/types";
import { CardHead, Ext, Icon, TIER_TEXT, addressUrl, amount, duration, txUrl } from "./ui";

const ROLE_TEXT: Record<TrailNode["role"], string> = {
  "funder-2": "Second-hop funder",
  "funder-1": "First funder",
  deployer: "Real deployer (signer)",
  factory: "Launchpad / factory",
  token: "Token",
};

function nodeTier(node: TrailNode): Tier | "none" {
  if (node.watchlist || node.label?.isScam || node.intercepta?.tier === "high") return "high";
  if (node.intercepta?.tier === "medium") return "medium";
  if (node.intercepta?.tier === "low") return "low";
  return "none";
}

function nodeFacts(node: TrailNode, forensics: Forensics) {
  const facts: string[] = [];
  if (node.label?.name) facts.push(node.label.name);
  if (node.label?.tags.length) facts.push(node.label.tags.join(", "));
  if (node.watchlist) facts.push(`Watchlist: ${node.watchlist.label} (${node.watchlist.source})`);
  if (node.label?.isScam) facts.push("Marked as scam on Blockscout");
  if (node.intercepta) {
    facts.push(
      node.intercepta.error
        ? `Intercepta: ${node.intercepta.error}`
        : `Intercepta toxicScore ${node.intercepta.toxicScore}${node.intercepta.traits.length ? ` · ${node.intercepta.traits.map((trait) => trait.name).join(", ")}` : ""}`,
    );
  }
  if (node.label?.txCount !== undefined) facts.push(`${node.label.txCount.toLocaleString("en-US")} outgoing txs`);
  if (node.role === "deployer" && forensics.deployerFirstSeen !== null) facts.push(`first tx ${duration(forensics.createdAt - forensics.deployerFirstSeen)} before launch`);
  if (node.role === "token") facts.push(`${duration(forensics.ageSec)} old`);
  if (node.note) facts.push(node.note);
  return facts.join(" · ") || (node.label ? "No labels" : "Blockscout label unavailable");
}

function edgeText(from: TrailNode, to: TrailNode | undefined, forensics: Forensics) {
  if (from.edge) {
    return (
      <>
        {`Sent ${amount(from.edge.valueEth)} ETH${from.edge.via === "internal" ? " (internal call)" : ""} · ${new Date(from.edge.timestamp * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC · `}
        <Ext href={txUrl(from.edge.txHash)}>tx ↗</Ext>
      </>
    );
  }
  if (from.role === "deployer" && to?.role === "factory") return "Signed the creation call; the factory is the on-chain creator, so the signer is followed.";
  if ((from.role === "deployer" || from.role === "factory") && to?.role === "token") {
    return (
      <>
        {"Created the token · "}
        <Ext href={txUrl(forensics.creationTx)}>creation tx ↗</Ext>
      </>
    );
  }
  return null;
}

export function Trail({ forensics }: { forensics: Forensics }) {
  const nodes = forensics.fundingPath;
  return (
    <section className="card" aria-labelledby="trail-title">
      <CardHead id="trail-title" title="Follow the money" sub="The deployer's first incoming ETH, traced back up to two hops, then down to the token." />
      {forensics.fundingError ? <p className="empty-note">{`Funding trace failed: ${forensics.fundingError}`}</p> : null}
      <div className="trail">
        {nodes.map((node, index) => {
          const tier = nodeTier(node);
          const next = nodes[index + 1];
          return (
            <div key={`${node.role}-${node.address}`}>
              <div className={`trail-node risk-${tier}`}>
                <span className={`risk-dot risk-${tier}`} aria-hidden="true" />
                <div>
                  <div className="trail-top">
                    <span className="trail-role">{ROLE_TEXT[node.role]}</span>
                    <span className="trail-risk">{tier === "none" ? (node.intercepta ? TIER_TEXT.unknown : "Not scanned") : TIER_TEXT[tier]}</span>
                  </div>
                  <div className="trail-name">
                    <Ext href={addressUrl(node.address)}>
                      <span className="mono">{node.address}</span>
                    </Ext>
                  </div>
                  <div className="trail-fact">{nodeFacts(node, forensics)}</div>
                </div>
              </div>
              {next ? (
                <div className="trail-edge">
                  <span className="line" aria-hidden="true" />
                  <p>{edgeText(node, next, forensics)}</p>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function Record({ forensics }: { forensics: Forensics }) {
  const rows = forensics.priorTokens;
  const known = rows.filter((row) => !row.error && row.movedOutPct !== null);
  const dumped = rows.filter((row) => row.devSold);
  return (
    <section className="card" aria-labelledby="record-title">
      <CardHead id="record-title" title="Deployer track record" sub={<span className="mono">{forensics.deployer}</span>} />
      {forensics.historyError ? (
        <p className="empty-note">{`History lookup failed: ${forensics.historyError}`}</p>
      ) : rows.length ? (
        <>
          <div className="pips">
            <span className="pips-row" aria-hidden="true">
              {rows.map((row) => (
                <span key={row.address} className={`pip${row.devSold ? " on" : ""}`} />
              ))}
            </span>
            <span>
              <b>{`${dumped.length} of ${rows.length}`}</b> other tokens dumped by the deployer
            </span>
          </div>
          <p className="note" style={{ marginTop: 0, marginBottom: 10 }}>
            {`"Dumped" = the deployer moved out at least 50% of what it received within 7 days of launch. ${known.length} of ${rows.length} tokens were ever held by the deployer.`}
          </p>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Launched</th>
                  <th className="r">Moved out</th>
                  <th className="r">In 24 h</th>
                  <th className="r">First move</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.address} className={row.devSold ? "flag" : undefined}>
                    <td>
                      <span className="cell-flag">
                        {row.devSold ? <Icon name="block" className="c-block" /> : null}
                        <Ext href={addressUrl(row.address)}>{row.symbol}</Ext>
                      </span>
                    </td>
                    <td>
                      <Ext href={txUrl(row.launchTx)}>{`${duration(Math.max(0, Date.now() / 1000 - row.launchedAt))} ago`}</Ext>
                    </td>
                    <td className="r">{row.error ? "lookup failed" : row.movedOutPct === null ? "never held" : `${row.movedOutPct.toFixed(0)}%`}</td>
                    <td className="r">{row.movedOutWithin24hPct === null ? "—" : `${row.movedOutWithin24hPct.toFixed(0)}%`}</td>
                    <td className="r">{row.firstOutAfterSec === null ? "—" : `+${duration(row.firstOutAfterSec)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">{`${forensics.priorTokensScanned} candidate contract(s) found from the deployer's history; showing up to 8 ERC-20 tokens, newest first.`}</p>
        </>
      ) : (
        <p className="empty-note">No other tokens found in the deployer's history.</p>
      )}
    </section>
  );
}
