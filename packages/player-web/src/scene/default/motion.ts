/**
 * Easing and slam helpers for the built-in default skin. Persona-5-grade chrome is all overshoot, impact, and
 * staggered cuts — these stay allocation-free so the pooled gameplay HUD can call them every frame.
 */

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
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
  const c1 = overshoot;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
}

/**
 * Slam-in scale: `from` at t=0, settling on 1 with a brief overshoot. t is unclamped; values outside [0, 1] saturate.
 */
export function slamScale(t: number, from = 2.4): number {
  return from + (1 - from) * easeOutBack(t);
}

/**
 * Horizontal throw-in in design pixels. Negative `from` enters from the left.
 */
export function slamOffset(t: number, from = -56): number {
  return from * (1 - easeOutExpo(t));
}

/**
 * Chromatic / impact jitter in design pixels. Full magnitude at t=0, gone by t=1.
 */
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
 */
export function staggerProgress(elapsedMs: number, delayMs: number, durationMs: number): number {
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(delayMs)) return 0;
  const span = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 1;
  return clamp01((elapsedMs - delayMs) / span);
}
