/* Small HTTP helpers: JSON fetch with a timeout, and a concurrency limiter. */

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

export async function fetchJson<T = unknown>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 15_000, ...rest } = init;
  const response = await fetch(url, {
    ...rest,
    cache: "no-store",
    signal: rest.signal ?? AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    /* Keep the raw text for the error message. */
  }
  if (!response.ok) {
    const detail =
      typeof body === "string" ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200);
    throw new HttpError(
      `HTTP ${response.status} from ${new URL(url).host}: ${detail}`,
      response.status,
      body,
    );
  }
  return body as T;
}

/**
 * Runs at most `max` tasks at once, and starts them at least `spacingMs` apart.
 * Used to stay under explorer rate limits.
 */
export function limiter(max: number, spacingMs = 0) {
  let active = 0;
  let lastStart = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const queue: (() => void)[] = [];
  const next = () => {
    if (active >= max || !queue.length || timer) return;
    const wait = lastStart + spacingMs - Date.now();
    if (wait > 0) {
      timer = setTimeout(() => {
        timer = undefined;
        next();
      }, wait);
      return;
    }
    lastStart = Date.now();
    queue.shift()!();
    next();
  };
  return function limit<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        active++;
        task()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
  };
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function errorMessage(caught: unknown): string {
  if (caught instanceof Error) return caught.name === "TimeoutError" ? "timed out" : caught.message;
  return String(caught);
}
