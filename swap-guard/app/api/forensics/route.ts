/*
 * POST /api/forensics { chainId: 1, token }
 * Returns { deployer, priorTokens, fundingPath, signals, ms } computed live.
 */
import { isAddress } from "@/lib/chain";
import { POLICY } from "@/lib/config";
import { runForensics } from "@/lib/forensics";
import { errorMessage } from "@/lib/http";
import { buildSignals } from "@/lib/signals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { chainId?: number; token?: string };
  if (Number(body.chainId ?? 1) !== 1)
    return Response.json(
      { error: "Only Ethereum mainnet (chainId 1) is supported." },
      { status: 400 },
    );
  if (!body.token || !isAddress(body.token))
    return Response.json({ error: "token must be a contract address." }, { status: 400 });
  try {
    const raw: unknown[] = [];
    const forensics = await runForensics(body.token, raw);
    // Only the chain-derived signals; the instruction source is not part of this call.
    const signals = buildSignals({
      source: "owner",
      maxPriceImpact: POLICY.maxPriceImpact,
      forensics,
    }).filter((signal) => signal.source !== "intent");
    return Response.json({ ...forensics, signals, raw: { intercepta: raw } });
  } catch (caught) {
    return Response.json({ error: errorMessage(caught) }, { status: 502 });
  }
}
