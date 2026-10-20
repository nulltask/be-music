import type { Context } from 'hono';

/**
 * Starts `work` after the response is sent (`waitUntil`). Without an execution context (tests calling `app.request`
 * directly) the work is not started at all: use it only for work a scheduled run also does.
 */
export function afterResponse(c: Context, work: () => Promise<unknown>): void {
  let context: { waitUntil(promise: Promise<unknown>): void } | undefined;
  try {
    context = c.executionCtx;
  } catch {
    context = undefined;
  }
  if (context === undefined) return;
  context.waitUntil(work().catch((error: unknown) => console.warn('background work failed', error)));
}
