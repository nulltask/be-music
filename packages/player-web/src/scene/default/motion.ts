/** Clamp `value` into `[0, 1]`. Non-finite input becomes `0`. */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/** Cubic ease-out — the default settle for HUD slides. */
export function easeOutCubic(t: number): number {
  const x = clamp01(t);
  return 1 - (1 - x) ** 3;
}

/** Cubic ease-in-out for iris covers and cursor travel. */
export function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

/** Expo ease-out — snappy line-draws and rank punches. */
export function easeOutExpo(t: number): number {
  const x = clamp01(t);
  return x === 1 ? 1 : 1 - 2 ** (-10 * x);
}

/**
 * Subtle overshoot (smaller than a comic slam). P3R-style settle: the piece overshoots ~8% then rests.
 */
export function easeOutBack(t: number): number {
  const x = clamp01(t);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
}

/**
 * Piecewise enter: stays at 0 until `delayMs`, then eases to 1 over `durationMs`.
 */
export function staggerProgress(elapsedMs: number, delayMs: number, durationMs: number): number {
  if (!Number.isFinite(elapsedMs) || durationMs <= 0) return 1;
  return clamp01((elapsedMs - delayMs) / durationMs);
}

export function enterT(elapsedMs: number, delayMs: number, durationMs: number): number {
  return easeOutCubic(staggerProgress(elapsedMs, delayMs, durationMs));
}

/** Slide offset in px: `fromPx` at t=0, 0 at t=1. */
export function slideOffset(t: number, fromPx: number): number {
  return (1 - clamp01(t)) * fromPx;
}

/**
 * Exponential follow used by the select cursor so it eases between rows instead of teleporting.
 * `stiffness` is roughly the time-constant in 1/seconds — 18 lands a row step in ~180 ms.
 */
export function cursorFollow(current: number, target: number, dtMs: number, stiffness = 18): number {
  if (!Number.isFinite(current) || !Number.isFinite(target)) return target;
  if (!Number.isFinite(dtMs) || dtMs <= 0) return current;
  const t = 1 - Math.exp(-stiffness * (dtMs / 1000));
  return current + (target - current) * t;
}

/** Count-up: 0 → `target` over `durationMs` with expo ease. */
export function countUp(target: number, elapsedMs: number, durationMs: number): number {
  if (!Number.isFinite(target) || target <= 0) return 0;
  const t = easeOutExpo(staggerProgress(elapsedMs, 0, durationMs));
  return Math.round(target * t);
}

/**
 * Judge popup over ~420 ms. Phases: pop-in (scale + y), overshoot settle, hold with glow, fade up.
 * This is the per-element motion the previous skin treated as a single flash.
 */
export function judgePopup(elapsedMs: number): { scale: number; alpha: number; y: number; glow: number } {
  const ms = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  if (ms >= 420) return { scale: 1, alpha: 0, y: -6, glow: 0 };
  if (ms < 50) {
    const t = easeOutCubic(ms / 50);
    return { scale: 1.52 - 0.64 * t, alpha: t, y: -12 + 14 * t, glow: 0.85 * t };
  }
  if (ms < 130) {
    const t = easeOutBack((ms - 50) / 80);
    return { scale: 0.88 + 0.18 * t, alpha: 1, y: 2 - 3 * t, glow: 0.85 };
  }
  if (ms < 260) {
    const t = (ms - 130) / 130;
    return { scale: 1.06 - 0.06 * t, alpha: 1, y: -1 + t, glow: 0.7 + 0.3 * Math.sin(t * Math.PI) };
  }
  const t = (ms - 260) / 160;
  return { scale: 1 - 0.04 * t, alpha: 1 - t, y: -6 * t, glow: 0.55 * (1 - t) };
}

/** Combo / score digit punch: 1.18 → 1 over 160 ms. */
export function valuePunch(elapsedMs: number): number {
  const ms = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  if (ms >= 160) return 1;
  const t = easeOutBack(ms / 160);
  return 1.18 - 0.18 * t;
}

/** Gauge fill during intro: 0 → actual over the enter window. */
export function introFill(actual: number, t: number): number {
  return clamp01(actual) * clamp01(t);
}

/** Beat pulse: 1 at the downbeat, decaying toward `1 - amount` across the bar. */
export function beatPulse(beatPhase: number | undefined, amount: number): number {
  if (beatPhase === undefined || !Number.isFinite(beatPhase)) return 1;
  const decay = 1 - clamp01(beatPhase);
  return 1 - amount + amount * decay;
}

export function scanlineY(nowMs: number, height: number, periodMs: number): number {
  if (!Number.isFinite(nowMs) || height <= 0 || periodMs <= 0) return 0;
  const p = ((nowMs % periodMs) + periodMs) % periodMs;
  return (p / periodMs) * height;
}

export function clockAngle(nowMs: number, periodMs: number): number {
  if (!Number.isFinite(nowMs) || periodMs <= 0) return 0;
  return ((nowMs % periodMs) / periodMs) * Math.PI * 2;
}

/** Idle glow 0.55–1.0. */
export function idleGlow(nowMs: number, periodMs = 1600): number {
  if (!Number.isFinite(nowMs) || periodMs <= 0) return 1;
  return 0.55 + 0.45 * (0.5 + 0.5 * Math.sin((nowMs / periodMs) * Math.PI * 2));
}

/**
 * Bomb shard flight: unit vector scaled by eased progress. `index` picks a direction around the burst.
 */
export function shardFlight(elapsedMs: number, durationMs: number, index: number, count: number): {
  x: number;
  y: number;
  alpha: number;
  scale: number;
} {
  const t = clamp01(elapsedMs / Math.max(1, durationMs));
  const eased = easeOutCubic(t);
  const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(1, count) + eased * 0.35;
  const dist = 8 + 42 * eased;
  return {
    x: Math.cos(angle) * dist,
    y: Math.sin(angle) * dist,
    alpha: 1 - t,
    scale: 1.15 - 0.55 * t,
  };
}
