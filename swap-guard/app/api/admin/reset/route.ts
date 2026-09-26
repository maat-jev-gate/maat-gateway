/* POST /api/admin/reset: clears today's allowed total and the decision log. */
import { reset, snapshot } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  reset();
  return Response.json(snapshot());
}
