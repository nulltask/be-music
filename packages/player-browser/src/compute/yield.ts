/**
 * Resolves after a task boundary, so the host can paint and dispatch pending events before the caller continues.
 *
 * `scheduler.yield()` where the host has it; otherwise a `MessageChannel` message, which starts a new task without the
 * clamp nested `setTimeout(…, 0)` calls get (4 ms in browsers, 1 ms in Node); `setTimeout` only as the last resort.
 * `queueMicrotask` would not do: microtasks run before the host gets a render opportunity.
 */
export function yieldToTask(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield !== undefined) return scheduler.yield();
  if (typeof MessageChannel === 'function') {
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve();
      };
      channel.port2.postMessage(undefined);
    });
  }
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
