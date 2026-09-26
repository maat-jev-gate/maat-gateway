export type SwapIntent = {
  agentId: string;
  taskId: string;
  purpose: string;
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  amountUsd: number;
  source: "owner" | "vendor" | "social";
  instruction?: string;
};

export class SwapGuardError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function endpoint(): URL {
  const configured = process.env.SWAP_GUARD_URL?.trim();
  if (!configured) throw new SwapGuardError("SWAP_GUARD_URL is not configured.", 503);
  let url: URL;
  try { url = new URL(configured); }
  catch { throw new SwapGuardError("SWAP_GUARD_URL is invalid.", 503); }
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if ((!localHttp && url.protocol !== "https:") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new SwapGuardError("SWAP_GUARD_URL must be an HTTPS origin or a local HTTP origin.", 503);
  }
  return new URL("/api/maat/swap", url);
}

export async function screenSwap(input: SwapIntent): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(endpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(65_000),
    });
  } catch (error) {
    if (error instanceof SwapGuardError) throw error;
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new SwapGuardError(timedOut ? "Swap Guard timed out." : "Swap Guard is unavailable.", timedOut ? 504 : 502);
  }

  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new SwapGuardError("Swap Guard returned an invalid response.", 502);
  const result = body as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof result.error === "string" ? result.error : "Swap Guard rejected the request.";
    throw new SwapGuardError(message, response.status === 400 ? 400 : 502);
  }
  const intent = result.intent as Record<string, unknown> | undefined;
  if (result.kind !== "swap" || result.analysisOnly !== true || result.agentId !== input.agentId ||
      !["ALLOW", "BLOCK", "ESCALATE"].includes(String(result.verdict)) ||
      !Array.isArray(result.reasons) || !result.reasons.every((reason) => typeof reason === "string") ||
      typeof intent?.tokenOut !== "string" || intent.tokenOut.toLowerCase() !== input.tokenOut.toLowerCase()) {
    throw new SwapGuardError("Swap Guard returned a mismatched decision.", 502);
  }
  return result;
}
