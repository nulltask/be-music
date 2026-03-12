export interface RenderThrottle {
  request: () => void;
  dispose: () => void;
}

export interface CreateRenderThrottleOptions {
  minIntervalMs?: number;
  now?: () => number;
}

export function createRenderThrottle(
  render: () => void,
  options: CreateRenderThrottleOptions = {},
): RenderThrottle {
  const minIntervalMs = normalizeMinInterval(options.minIntervalMs);
  const now = options.now ?? Date.now;
  let disposed = false;
  let lastRenderAtMs = Number.NEGATIVE_INFINITY;
  let timer: NodeJS.Timeout | undefined;

  const clearTimer = (): void => {
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    timer = undefined;
  };

  const run = (): void => {
    timer = undefined;
    if (disposed) {
      return;
    }
    lastRenderAtMs = now();
    render();
  };

  return {
    request: () => {
      if (disposed) {
        return;
      }
      const remainingMs = minIntervalMs - (now() - lastRenderAtMs);
      if (remainingMs <= 0) {
        clearTimer();
        run();
        return;
      }
      if (timer) {
        return;
      }
      timer = setTimeout(run, remainingMs);
    },
    dispose: () => {
      disposed = true;
      clearTimer();
    },
  };
}

function normalizeMinInterval(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}
