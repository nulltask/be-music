import { clamp01, easeInOutCubic, easeOutCubic, staggerProgress } from './motion.ts';

/**
 * Cover amount: 1 = fully hidden, 0 = fully revealed.
 *
 * Incoming scenes open (1→0). Decide's last beat closes (0→1) so the next scene can open from a black cut-in
 * wipe instead of popping the new HUD on an empty frame.
 */
export type CoverDirection = 'open' | 'close';

export function coverAmount(elapsedMs: number, delayMs: number, durationMs: number, direction: CoverDirection): number {
  const t = easeInOutCubic(staggerProgress(elapsedMs, delayMs, durationMs));
  return direction === 'open' ? 1 - t : t;
}

/**
 * Per-scene enter windows. Each HUD piece has its own delay so the screen assembles instead of fading as one plate.
 * Cover finishes first so the player sees pieces land, not pop in behind a wipe.
 */
export const SELECT_TIMELINE = {
  coverDelay: 0,
  coverDuration: 480,
  header: { delay: 80, duration: 320 },
  detail: { delay: 160, duration: 380 },
  list: { delay: 220, duration: 420 },
  rowStagger: 28,
  actions: { delay: 420, duration: 280 },
  search: { delay: 480, duration: 260 },
} as const;

export const DECIDE_TIMELINE = {
  coverDelay: 0,
  coverDuration: 420,
  line: { delay: 0, duration: 280 },
  slash: { delay: 40, duration: 320 },
  title: { delay: 180, duration: 400 },
  artist: { delay: 280, duration: 360 },
  meta: { delay: 380, duration: 320 },
  ready: { delay: 440, duration: 280 },
  closeDelay: 1180,
  closeDuration: 320,
  total: 1500,
  /** Skinless `#STARTINPUT` — skip is allowed once the wipe has opened and the title is readable. */
  startInput: 500,
} as const;

export const GAMEPLAY_TIMELINE = {
  coverDelay: 0,
  coverDuration: 520,
  playfield: { delay: 80, duration: 400 },
  header: { delay: 140, duration: 340 },
  bga: { delay: 200, duration: 380 },
  score: { delay: 240, duration: 380 },
  tally: { delay: 300, duration: 360 },
  gauge: { delay: 280, duration: 460 },
  song: { delay: 360, duration: 340 },
  ready: { delay: 420, duration: 360 },
  readyHoldUntil: 1900,
  readyFade: 400,
} as const;

export const RESULT_TIMELINE = {
  coverDelay: 0,
  coverDuration: 500,
  banner: { delay: 80, duration: 360 },
  rank: { delay: 0, duration: 420 },
  metrics: { delay: 180, duration: 360 },
  metricStagger: 70,
  judges: { delay: 280, duration: 400 },
  judgeStagger: 55,
  graphs: { delay: 420, duration: 480 },
  footer: { delay: 520, duration: 280 },
  countDuration: 720,
} as const;

export function pieceT(
  elapsedMs: number,
  piece: { readonly delay: number; readonly duration: number },
): number {
  return easeOutCubic(staggerProgress(elapsedMs, piece.delay, piece.duration));
}

/** Raw 0→1 stagger for slam helpers — do not ease, or easeOutBack overshoot disappears. */
export function pieceRawT(
  elapsedMs: number,
  piece: { readonly delay: number; readonly duration: number },
): number {
  return staggerProgress(elapsedMs, piece.delay, piece.duration);
}

export function selectRowT(elapsedMs: number, visibleIndex: number): number {
  return easeOutCubic(
    staggerProgress(elapsedMs, SELECT_TIMELINE.list.delay + visibleIndex * SELECT_TIMELINE.rowStagger, 280),
  );
}

export function selectRowRawT(elapsedMs: number, visibleIndex: number): number {
  return staggerProgress(elapsedMs, SELECT_TIMELINE.list.delay + visibleIndex * SELECT_TIMELINE.rowStagger, 280);
}

export function resultMetricT(elapsedMs: number, index: number): number {
  return easeOutCubic(
    staggerProgress(elapsedMs, RESULT_TIMELINE.metrics.delay + index * RESULT_TIMELINE.metricStagger, RESULT_TIMELINE.metrics.duration),
  );
}

export function resultMetricRawT(elapsedMs: number, index: number): number {
  return staggerProgress(elapsedMs, RESULT_TIMELINE.metrics.delay + index * RESULT_TIMELINE.metricStagger, RESULT_TIMELINE.metrics.duration);
}

export function resultJudgeT(elapsedMs: number, index: number): number {
  return easeOutCubic(
    staggerProgress(elapsedMs, RESULT_TIMELINE.judges.delay + index * RESULT_TIMELINE.judgeStagger, RESULT_TIMELINE.judges.duration),
  );
}

export function resultJudgeRawT(elapsedMs: number, index: number): number {
  return staggerProgress(elapsedMs, RESULT_TIMELINE.judges.delay + index * RESULT_TIMELINE.judgeStagger, RESULT_TIMELINE.judges.duration);
}

export function readyAlpha(elapsedMs: number): number {
  const enter = pieceT(elapsedMs, GAMEPLAY_TIMELINE.ready);
  const fade = easeOutCubic(staggerProgress(elapsedMs, GAMEPLAY_TIMELINE.readyHoldUntil, GAMEPLAY_TIMELINE.readyFade));
  return clamp01(enter * (1 - fade));
}

export function decideCloseCover(elapsedMs: number): number {
  return coverAmount(elapsedMs, DECIDE_TIMELINE.closeDelay, DECIDE_TIMELINE.closeDuration, 'close');
}

/**
 * Decide is the hinge between select and gameplay: wipe-open on enter (same language as the other default scenes),
 * wipe-close on the last beat so gameplay can open from a fully covered frame instead of popping HUD onto the
 * READY splash.
 */
export function decideCover(elapsedMs: number): number {
  return Math.max(
    coverAmount(elapsedMs, DECIDE_TIMELINE.coverDelay, DECIDE_TIMELINE.coverDuration, 'open'),
    decideCloseCover(elapsedMs),
  );
}

/**
 * Scene-relative elapsed time for default-family intros. Callers that omit a clock (benches) get a settled HUD.
 */
export function fallbackSceneElapsed(sceneElapsedMs: number | undefined): number {
  if (sceneElapsedMs !== undefined && Number.isFinite(sceneElapsedMs)) return Math.max(0, sceneElapsedMs);
  return 10_000;
}
