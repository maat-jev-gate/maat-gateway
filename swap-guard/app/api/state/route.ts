/* GET /api/state: policy, integration status, today's ledger, and the decision log. */
import { POLICY, integrations } from "@/lib/config";
import { snapshot } from "@/lib/store";
import { watchlistSize } from "@/lib/watchlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    policy: POLICY,
    integrations: integrations(),
    watchlistSize,
    ...snapshot(),
  });
}
