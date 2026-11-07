/**
 * The launch warp, shared by Synesthesia's select and decide screens: picking a chart dashes the camera through the
 * particle field while the title condenses at the centre out of wide-tracked light and a lock-on reticle closes on it.
 * The select screen plays the first moments (its panels fall away and the camera settles onto a straight line), then
 * the decide screen carries the same warp on, adds the chart's genre, difficulty, level and images, and falls to black
 * for the play. Both screens pose everything from the time since the launch, so the hand-over keeps every curve.
 */

import { easeOutCubic, type BeMusicEffectLevel } from '@be-music/player-skin-sdk';

/** How long the warp's ramp runs: the star speed, title, artist and lock-on curves below are authored over it. */
export const LAUNCH_WARP_MS = 700;
/**
 * How long the select screen keeps drawing after a chart is picked (its outro): the panels and list are gone and the
 * camera flies straight, so the decide screen can take the warp over.
 */
export const SELECT_LAUNCH_OUTRO_MS = 210;
/** How long Synesthesia's decide screen shows. */
export const SYNESTHESIA_DECIDE_MS = 1800;
/** The decide screen's closing fall to black, before the play's count-in. */
export const DECIDE_FADE_OUT_MS = 320;
/** How much faster the star field streams at the peak of the warp, and with effects reduced. */
export const WARP_SPEEDUP = 7;
const REDUCED_WARP_SPEEDUP = 2;

/** Everything the warp poses at one moment. Fractions run 0..1 unless noted. */
export interface LaunchWarpPose {
  /** The warp's ramp: how far the star speed has opened up. */
  readonly warp: number;
  /** The camera settling onto the straight dash (select). */
  readonly settle: number;
  /** What is left of the select screen's panels and list. */
  readonly away: number;
  /** The title's opacity, before the closing fade. */
  readonly titleAlpha: number;
  /** The title's letter spacing (px): wide-tracked light condensing to 2. */
  readonly titleTracking: number;
  /** The lock-on reticle closing on the title. */
  readonly lock: number;
  /** The artist line's opacity, before the closing fade. */
  readonly artistAlpha: number;
  /** The genre line's opacity (decide), before the closing fade. */
  readonly genreAlpha: number;
  /** The difficulty, level and images (decide), before the closing fade. */
  readonly detailAlpha: number;
  /** How far (px) the details still have to rise. */
  readonly detailRise: number;
  /** The fall to black (decide): 0 lit, 1 black. */
  readonly dark: number;
}

const clamp01 = (value: number): number => (value <= 0 ? 0 : value >= 1 ? 1 : value);
const ramp = (timeMs: number, fromMs: number, durationMs: number): number => clamp01((timeMs - fromMs) / durationMs);

/**
 * The warp's pose `sinceLaunchMs` after the chart was picked. Effects off settle everything at once; reduced keeps the
 * fades but drops the moves (no tracking squeeze, no closing reticle, no rising details). `decide` adds the decide
 * screen's closing fall to black over its last {@link DECIDE_FADE_OUT_MS} (none with effects off).
 */
export function resolveLaunchWarp(
  sinceLaunchMs: number,
  effects: BeMusicEffectLevel,
  decide?: { readonly elapsedMs: number; readonly durationMs: number },
): LaunchWarpPose {
  const t = effects === 'off' ? Number.POSITIVE_INFINITY : Math.max(0, sinceLaunchMs);
  const still = effects !== 'full';
  const unit = LAUNCH_WARP_MS;
  const warp = ramp(t, 0, unit);
  const form = still ? 1 : easeOutCubic(ramp(t, 0, unit * 0.4));
  const detail = easeOutCubic(ramp(t, unit * 0.45, unit * 0.45));
  const dark =
    decide === undefined || effects === 'off'
      ? 0
      : ramp(decide.elapsedMs, decide.durationMs - DECIDE_FADE_OUT_MS, DECIDE_FADE_OUT_MS);
  return {
    warp,
    settle: easeOutCubic(clamp01(warp / 0.3)),
    away: 1 - easeOutCubic(ramp(t, 0, unit * 0.25)),
    titleAlpha: Math.min(1, (t / unit) * 4),
    titleTracking: 2 + 14 * (1 - form),
    lock: still ? 1 : easeOutCubic(ramp(t, 0, unit * 0.35)),
    artistAlpha: ramp(t, unit * 0.15, unit * 0.2),
    genreAlpha: ramp(t, unit * 0.3, unit * 0.3),
    detailAlpha: detail,
    detailRise: still ? 0 : 10 * (1 - detail),
    dark,
  };
}

/**
 * How fast (world units per second) the star field streams: with the chart's tempo (120 BPM without one, capped at 300),
 * opening up over the warp, and quicker with the music's `level` (0 without audio). Effects reduced open it up less.
 */
export function resolveWarpStarSpeed(
  bpm: number | undefined,
  warp: number,
  effects: BeMusicEffectLevel,
  level = 0,
): number {
  const beatsPerSecond = (bpm !== undefined && Number.isFinite(bpm) && bpm > 0 ? Math.min(bpm, 300) : 120) / 60;
  const speedup = effects === 'full' ? WARP_SPEEDUP : REDUCED_WARP_SPEEDUP;
  return (80 + beatsPerSecond * 55) * (1 + speedup * warp * warp) * (1 + 1.2 * level);
}

/** The lock-on reticle's box around a title `titleWidth` wide: wide open, closing to the title as `lock` reaches 1. */
export function resolveTitleLockBox(
  titleWidth: number,
  designWidth: number,
  lock: number,
): { readonly width: number; readonly height: number } {
  return {
    width: Math.min(designWidth - 80, titleWidth + 48) + 160 * (1 - lock),
    height: 64 + 60 * (1 - lock),
  };
}

/** Where the decide screen sets each line, centred on the stage. */
export interface DecideLayout {
  readonly centerX: number;
  readonly centerY: number;
  readonly genreY: number;
  readonly titleY: number;
  readonly artistY: number;
  readonly detailY: number;
  /** The banner's box, under the details: fitted inside, centred on `centerX`. */
  readonly bannerTop: number;
  readonly bannerMaxWidth: number;
  readonly bannerMaxHeight: number;
  /** The widest the title, and the genre / artist lines, may run. */
  readonly titleMaxWidth: number;
  readonly lineMaxWidth: number;
}

/**
 * The decide screen's layout: the title at the centre where the select screen's warp put it, the genre over the
 * reticle, the artist under the title, the difficulty and level under the reticle, and the banner below them. The
 * title and its reticle never move between the screens; the lines around them keep inside the stage.
 */
export function resolveDecideLayout(designWidth: number, designHeight: number): DecideLayout {
  const centerX = designWidth / 2;
  const centerY = designHeight / 2;
  const detailY = centerY + 58;
  const bannerTop = detailY + 22;
  return {
    centerX,
    centerY,
    genreY: centerY - 46,
    titleY: centerY - 6,
    artistY: centerY + 24,
    detailY,
    bannerTop,
    bannerMaxWidth: Math.min(300, designWidth - 80),
    bannerMaxHeight: Math.max(0, Math.min(80, designHeight - bannerTop - 24)),
    titleMaxWidth: designWidth - 120,
    lineMaxWidth: designWidth - 160,
  };
}

/** `width` x `height` scaled to fit inside `maxWidth` x `maxHeight`, keeping its aspect (never scaled up past 1). */
export function fitInside(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { readonly width: number; readonly height: number } {
  if (!(width > 0) || !(height > 0) || !(maxWidth > 0) || !(maxHeight > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return { width: width * scale, height: height * scale };
}

/** What the select screen hands the decide screen as its outro ends: which chart, when it launched, and the travel. */
export interface LaunchHandoff {
  readonly chartId: string;
  /** The select screen's clock when the chart was picked. */
  readonly launchAtMs: number;
  /** The select screen's clock on its last outro frame. */
  readonly lastFrameMs: number;
  /** The star field's accumulated travel on that frame, so the decide screen's stars carry straight on. */
  readonly travel: number;
  /** The music's level on that frame (it quickens the stars); the decide screen lets it die away. */
  readonly level: number;
}

/** How long the handed-over music level takes to die away on the decide screen, which has no audio. */
export const HANDOFF_LEVEL_DECAY_MS = 400;

/** The handed-over music `level`, `sinceHandoffMs` into the decide screen: easing out to 0. */
export function resolveHandoffLevel(level: number, sinceHandoffMs: number): number {
  const left = 1 - ramp(sinceHandoffMs, 0, HANDOFF_LEVEL_DECAY_MS);
  return Math.max(0, level) * left * left;
}

/** How long after the select screen's last outro frame the decide screen may still take its warp over. */
export const LAUNCH_HANDOFF_WINDOW_MS = 1500;

/**
 * Whether the decide screen showing `chartId` at `nowMs` carries `handoff` on: the same chart, and soon enough after
 * the select screen's last outro frame (a course's decide screen, or one reached any other way, starts its own warp).
 */
export function acceptsLaunchHandoff(handoff: LaunchHandoff | undefined, chartId: string, nowMs: number): boolean {
  if (handoff === undefined || handoff.chartId !== chartId) return false;
  const since = nowMs - handoff.lastFrameMs;
  return since >= 0 && since <= LAUNCH_HANDOFF_WINDOW_MS;
}

let pendingHandoff: LaunchHandoff | undefined;

/** The select screen records its outro's latest frame. */
export function recordLaunchHandoff(handoff: LaunchHandoff): void {
  pendingHandoff = handoff;
}

/** The decide screen takes the select screen's warp over when {@link acceptsLaunchHandoff} allows; it is used once. */
export function takeLaunchHandoff(chartId: string, nowMs: number): LaunchHandoff | undefined {
  const handoff = pendingHandoff;
  pendingHandoff = undefined;
  return acceptsLaunchHandoff(handoff, chartId, nowMs) ? handoff : undefined;
}
