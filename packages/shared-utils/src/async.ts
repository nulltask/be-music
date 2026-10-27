/** Schedule a timeout and return a function that cancels it. */
export type ScheduleTimeout = (callback: () => void, timeoutMs: number) => () => void;

const scheduleHostTimeout: ScheduleTimeout = (callback, timeoutMs) => {
  const timer = setTimeout(callback, timeoutMs);
  return () => clearTimeout(timer);
};

/**
 * Wait for cleanup to settle, swallowing its rejection. Return false only when the timeout wins.
 * Timing out stops waiting; the cleanup task continues. Always cancel the timeout after the wait.
 */
export async function settleWithTimeout(
  task: void | Promise<void> | undefined,
  timeoutMs: number,
  scheduleTimeout: ScheduleTimeout = scheduleHostTimeout,
): Promise<boolean> {
  if (!task) return true;
  let cancelTimeout: (() => void) | undefined;
  let completed = false;
  const guardedTask = Promise.resolve(task)
    .catch(() => undefined)
    .then(() => {
      completed = true;
    });
  const timeout = new Promise<void>((resolve) => {
    cancelTimeout = scheduleTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([guardedTask, timeout]);
    return completed;
  } finally {
    cancelTimeout?.();
  }
}
