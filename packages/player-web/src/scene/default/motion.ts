export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function easeOutCubic(t: number): number {
  const x = clamp01(t);
  return 1 - (1 - x) ** 3;
}

export function easeOutExpo(t: number): number {
  const x = clamp01(t);
  return x >= 1 ? 1 : 1 - 2 ** (-10 * x);
}

export function easeOutBack(t: number, overshoot = 1.70158): number {
  const x = clamp01(t);
  const c3 = overshoot + 1;
  return 1 + c3 * (x - 1) ** 3 + overshoot * (x - 1) ** 2;
}

export function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Slam-in scale: `from` at t=0, settling on 1 with a brief overshoot. */
export function slamScale(t: number, from = 2.4): number {
  return lerp(from, 1, easeOutBack(t));
}

/** Horizontal throw-in in design pixels. Negative `from` enters from the left. */
export function slamOffset(t: number, from = -56): number {
  return lerp(from, 0, easeOutExpo(t));
}

/** Chromatic / impact jitter in design pixels. Full magnitude at t=0, gone by t=1. */
export function impactOffset(t: number, magnitude = 7): number {
  return (1 - easeOutCubic(t)) * magnitude;
}

/**
 * Downbeat flash. `beatPhase` is the fractional beat in [0, 1); 1 on the attack, 0 after `decay` of the beat.
 */
export function beatImpulse(beatPhase: number | undefined, decay = 0.22): number {
  if (beatPhase === undefined || !Number.isFinite(beatPhase)) return 0;
  const phase = ((beatPhase % 1) + 1) % 1;
  if (phase >= decay || decay <= 0) return 0;
  return 1 - phase / decay;
}

/**
 * Staggered 0→1 envelope: silent until `delayMs`, then ramps over `durationMs`.
 * A non-positive duration is already complete once `elapsedMs` has reached the delay.
 */
export function staggerProgress(elapsedMs: number, delayMs: number, durationMs: number): number {
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(delayMs)) return 0;
  if (!(durationMs > 0)) return elapsedMs >= delayMs ? 1 : 0;
  return clamp01((elapsedMs - delayMs) / durationMs);
}

export function cursorFollow(current: number, target: number, dtMs: number, stiffness = 18): number {
  if (!Number.isFinite(current) || !Number.isFinite(target)) return target;
  if (!Number.isFinite(dtMs) || dtMs <= 0) return current;
  const t = 1 - Math.exp(-stiffness * (dtMs / 1000));
  return lerp(current, target, t);
}

export type JudgePopupPhase = {
  scale: number;
  alpha: number;
  offsetY: number;
};

/**
 * Judge popup over ~620 ms. Phases: comic slam, overshoot settle, hold, fade-up.
 * Pass the raw elapsed clock — do not pre-ease, or the slam overshoot disappears.
 */
export function judgePopup(elapsedMs: number): JudgePopupPhase {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return { scale: 1, alpha: 0, offsetY: 0 };
  if (elapsedMs < 70) {
    const t = elapsedMs / 70;
    return { scale: slamScale(t, 2.45), alpha: Math.min(1, t * 4), offsetY: slamOffset(t, -18) };
  }
  if (elapsedMs < 160) {
    const t = (elapsedMs - 70) / 90;
    return { scale: lerp(1.08, 0.94, easeOutCubic(t)), alpha: 1, offsetY: lerp(-2, 4, t) };
  }
  if (elapsedMs < 420) {
    return { scale: 1, alpha: 1, offsetY: 4 };
  }
  if (elapsedMs < 620) {
    const t = (elapsedMs - 420) / 200;
    return { scale: lerp(1, 0.82, t), alpha: 1 - t, offsetY: lerp(4, -10, t) };
  }
  return { scale: 0.82, alpha: 0, offsetY: -10 };
}

/** Combo / score digit punch: starts oversized, settles to 1 over 180 ms. */
export function valuePunch(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > 180) return 1;
  if (elapsedMs < 50) return lerp(1.32, 1.1, easeOutCubic(elapsedMs / 50));
  return lerp(1.1, 1, easeOutCubic((elapsedMs - 50) / 130));
}

export function introFill(actual: number, t: number): number {
  return clamp01(actual) * clamp01(t);
}

export function countUp(target: number, elapsedMs: number, durationMs = 720): number {
  if (!Number.isFinite(target) || target <= 0) return 0;
  if (durationMs <= 0) return target;
  return Math.round(target * easeOutCubic(clamp01(elapsedMs / durationMs)));
}

export function idlePulse(nowMs: number, periodMs = 900): number {
  if (!Number.isFinite(nowMs) || periodMs <= 0) return 1;
  return 0.7 + 0.3 * (0.5 + 0.5 * Math.sin((nowMs / periodMs) * Math.PI * 2));
}

/**
 * Bomb shard flight: unit vector scaled by eased progress. `index` picks a direction around the burst.
 */
export function shardFlight(
  elapsedMs: number,
  durationMs: number,
  index: number,
  count: number,
): { x: number; y: number; alpha: number; scale: number } {
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

export function slamAlpha(t: number): number {
  return t <= 0 ? 0 : Math.min(1, t * 8);
}
