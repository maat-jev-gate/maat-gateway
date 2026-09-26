/*
 * POST /api/maat/swap
 * Body: { agentId, chainId: 1, tokenIn: "ETH", tokenOut, amountIn?, amountUsd?, purpose?, source, instruction? }
 * Returns a Decision. With `Accept: application/x-ndjson` the stage events are
 * streamed first, one JSON object per line, and the Decision comes last.
 */
import { RequestError, analyzeSwap } from "@/lib/engine";
import { errorMessage } from "@/lib/http";
import type { StreamEvent, SwapRequest } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  let input: SwapRequest;
  try {
    input = (await request.json()) as SwapRequest;
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }

  if (!(request.headers.get("accept") ?? "").includes("application/x-ndjson")) {
    try {
      return Response.json(await analyzeSwap(input));
    } catch (caught) {
      return Response.json({ error: errorMessage(caught) }, { status: caught instanceof RequestError ? 400 : 502 });
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        await analyzeSwap(input, send);
      } catch (caught) {
        send({ type: "error", message: errorMessage(caught) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
