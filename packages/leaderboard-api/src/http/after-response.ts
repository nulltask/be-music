import type { Context } from 'hono';

/**
 * Runs `work` after the response is sent (`waitUntil`). Without an execution context (tests calling `app.request`
 * directly) the work is dropped: use it only for work a scheduled run also does.
 */
export function afterResponse(c: Context, work: Promise<unknown>): void {
  let context: { waitUntil(promise: Promise<unknown>): void } | undefined;
  try {
    context = c.executionCtx;
  } catch {
    context = undefined;
  }
  if (context === undefined) {
    work.catch(() => undefined);
    return;
  }
  context.waitUntil(work.catch((error: unknown) => console.warn('background work failed', error)));
}
