import { Container, Sprite, Texture } from 'pixi.js';
import {
  computeScoreRate,
  createEmptyScore,
  resolveIidxSelectRankOp,
  type ScoreSummary,
} from '@be-music/player/core/scoring';
import type { BrowserSongEntry } from './types.ts';
import {
  type Lr2DestinationRect,
  type Lr2GrooveGaugeElement,
  type Lr2ImageElement,
  type Lr2NowComboElement,
  type Lr2NowComboKind,
  type Lr2Skin,
} from './lr2-skin.ts';
import { applyDestinationToSprite, createCroppedTexture } from './lr2-render.ts';

export function isLr2OverlayImage(image: Lr2ImageElement): boolean {
  const t = image.destination.timer;
  return (t >= 50 && t <= 89) || (t >= 100 && t <= 139);
}

export function resolveNumberValue(
  num: number,
  score: ScoreSummary,
  song: BrowserSongEntry | undefined,
  gauge: number,
  combo: number,
  hiSpeed: number,
  seconds: number,
  displayedScore: number,
  fps: number,
  liveBpm: number | undefined,
  totalSeconds: number,
  maxCombo: number,
): number | undefined {
  const rate = computeScoreRate(score);
  const ratePct = Math.round(rate * 100);
  const rateDecimals = Math.round(rate * 10000) % 100;
  const remaining = Math.max(0, totalSeconds - seconds);
  switch (num) {
    case 10:
      return Math.round(hiSpeed * 100);
    case 20:
      return Math.round(fps);
    case 100:
      return Math.round(displayedScore);
    case 101:
      return score.exScore;
    case 102:
      return Math.round(fps);
    case 103:
      return Math.round(rate * 10000);
    case 104:
      return combo;
    case 105:
      return maxCombo;
    case 106:
      return score.total;
    case 107:
      return Math.round(gauge);
    case 108:
      return 0;
    case 110:
      return score.perfect;
    case 111:
      return score.great;
    case 112:
      return score.good;
    case 113:
      return score.bad;
    case 114:
      return score.poor;
    case 115:
      return ratePct;
    case 116:
      return rateDecimals;
    case 150:
    case 151:
      return 0;
    case 152:
    case 153:
      return score.exScore;
    case 154: {
      if (score.total <= 0) {
        return 0;
      }
      const max = score.total * 2;
      const thresholds = [8 / 9, 7 / 9, 6 / 9, 5 / 9, 4 / 9, 3 / 9, 2 / 9, 1 / 9];
      const next = thresholds.find((threshold) => score.exScore < max * threshold) ?? 0;
      return Math.max(0, Math.ceil(max * next - score.exScore));
    }
    case 160:
      return liveBpm ?? song?.bpm;
    case 161:
      return Math.floor(seconds / 60);
    case 162:
      return Math.floor(seconds % 60);
    case 163:
      return Math.floor(remaining / 60);
    case 164:
      return Math.floor(remaining % 60);
    case 165:
      return 100;
    default:
      return undefined;
  }
}

export function computeRankOp(score: ScoreSummary): number | undefined {
  return resolveIidxSelectRankOp(score);
}

export function lastJudgeToNowComboKind(lastJudge: string): Lr2NowComboKind | undefined {
  switch (lastJudge) {
    case 'PERFECT':
      return 'perfect';
    case 'GREAT':
      return 'great';
    case 'GOOD':
      return 'good';
    default:
      return undefined;
  }
}

export function renderNowComboElement(
  layer: Container,
  element: Lr2NowComboElement,
  combo: number,
  judgeAnchor: Lr2DestinationRect,
  textures: ReadonlyMap<string, Texture>,
  elapsedMs: number,
  offsetX: number,
  dst: Lr2DestinationRect,
): void {
  if (dst.w === 0 || dst.h === 0) {
    return;
  }
  const baseTexture = textures.get(element.source.imagePath);
  if (!baseTexture) {
    return;
  }
  const divx = Math.max(1, element.source.divx);
  const divy = Math.max(1, element.source.divy);
  const cellWidth = element.source.w / divx;
  const cellHeight = element.source.h / divy;
  if (cellWidth <= 0 || cellHeight <= 0) {
    return;
  }
  const display = Math.max(0, Math.trunc(combo)).toString().split('');
  const dstWidth = dst.w;
  const absX = judgeAnchor.x + dst.x + offsetX;
  const absY = judgeAnchor.y + dst.y;
  let startX = absX;
  if (element.source.alignment === 'center') {
    startX = absX - (dstWidth * display.length) / 2;
  } else if (element.source.alignment === 'right') {
    startX = absX - dstWidth * display.length;
  }

  const cycle = element.source.cycle;
  let animRow = 0;
  if (divy > 1 && cycle > 0) {
    const frameMs = cycle / divy;
    animRow = Math.floor((Math.max(0, elapsedMs) % cycle) / Math.max(1, frameMs)) % divy;
  }
  for (let index = 0; index < display.length; index += 1) {
    const digit = Number.parseInt(display[index]!, 10);
    if (!Number.isFinite(digit) || digit < 0 || digit >= divx) {
      continue;
    }
    const cellTexture = createCroppedTexture(baseTexture, {
      x: element.source.x + cellWidth * digit,
      y: element.source.y + cellHeight * animRow,
      w: cellWidth,
      h: cellHeight,
    });
    if (!cellTexture) {
      continue;
    }
    const sprite = new Sprite(cellTexture);
    sprite.label = `nowcombo[digit=${digit}]`;
    sprite.position.set(startX + dstWidth * index, absY);
    sprite.width = dstWidth;
    sprite.height = dst.h;
    applyDestinationToSprite(sprite, dst);
    layer.addChild(sprite);
  }
}

export function renderGrooveGaugeElement(
  layer: Container,
  gauge: Lr2GrooveGaugeElement,
  percent: number,
  textures: ReadonlyMap<string, Texture>,
  dst: Lr2DestinationRect,
  options: { peakPercent?: number; elapsedMs?: number } = {},
): void {
  if (dst.w === 0 || dst.h === 0) {
    return;
  }
  const baseTexture = textures.get(gauge.source.imagePath);
  if (!baseTexture) {
    return;
  }
  // LR2 spec (`docs/LR2SkinHelp.md` 8975 / 9012):
  //
  //   ゲージ点灯時の赤・緑、ゲージ消灯時の赤・緑の順に並べて
  //   src分割を行ってください。4の倍数でcycle>0ならちゃんと
  //   アニメーションします
  //
  // So `divx × divy` cells decompose into `frames = N / 4`
  // animation frames; each frame is a contiguous group of 4
  // cells in declaration order (active-red / active-green /
  // inactive-red / inactive-green). The frame index advances
  // by one every `cycle` ms relative to the SRC's `timer`.
  // For LR2 default 7K (`divx=4, divy=1, cycle=0`) this is a
  // single static 4-cell frame; for skins with multi-frame
  // gauges (Quinine, etc.) the renderer cycles over time so
  // the lit-tip "highlight" animation reaches every bead.
  const divx = Math.max(1, gauge.source.divx);
  const divy = Math.max(1, gauge.source.divy);
  const totalCells = divx * divy;
  if (totalCells < 4) {
    return;
  }
  const frames = Math.max(1, Math.floor(totalCells / 4));
  const cycleMs = Math.max(0, gauge.source.cycle);
  const elapsed = Math.max(0, options.elapsedMs ?? 0);
  const frameIndex = cycleMs > 0 && frames > 1 ? Math.floor(elapsed / cycleMs) % frames : 0;
  const cellWidth = gauge.source.w / divx;
  const cellHeight = gauge.source.h / divy;
  if (cellWidth <= 0 || cellHeight <= 0) {
    return;
  }

  const totalUnits = 50;
  const clearThresholdUnit = Math.round((80 / 100) * totalUnits);
  const activeUnits = Math.round((percent / 100) * totalUnits);
  // Peak-hold indicator: the bead AT the peak position is
  // painted with the "active" cell variant even when the live
  // fill has dropped below it. Skin-agnostic — uses the same
  // 4-cell sprite group, just at the peak's bead position.
  const peakPercent = Math.max(0, Math.min(100, options.peakPercent ?? percent));
  const peakIndex = Math.round((peakPercent / 100) * totalUnits) - 1;
  for (let unitIndex = 0; unitIndex < totalUnits; unitIndex += 1) {
    const isActive = unitIndex < activeUnits;
    const isPeakIndicator = !isActive && unitIndex === peakIndex && peakIndex >= activeUnits;
    const useActiveCell = isActive || isPeakIndicator;
    const isClearZone = unitIndex >= clearThresholdUnit;
    // LR2 spec ordering inside each 4-cell frame:
    //   offset 0: 表赤 (active red, clear-zone)
    //   offset 1: 表緑 (active green, normal)
    //   offset 2: 裏赤 (inactive red, clear-zone)
    //   offset 3: 裏緑 (inactive green, normal)
    const offsetWithinFrame = (useActiveCell ? 0 : 2) + (isClearZone ? 0 : 1);
    const cellIndex = frameIndex * 4 + offsetWithinFrame;
    const cellX = cellIndex % divx;
    const cellY = Math.floor(cellIndex / divx);
    const cellTexture = createCroppedTexture(baseTexture, {
      x: gauge.source.x + cellWidth * cellX,
      y: gauge.source.y + cellHeight * cellY,
      w: cellWidth,
      h: cellHeight,
    });
    if (!cellTexture) {
      continue;
    }
    const sprite = new Sprite(cellTexture);
    sprite.label = `gauge-bead[idx=${unitIndex},frame=${frameIndex},cell=${cellIndex}${isPeakIndicator ? ',peak' : ''}]`;
    sprite.position.set(dst.x + gauge.addX * unitIndex, dst.y + gauge.addY * unitIndex);
    sprite.width = dst.w;
    sprite.height = dst.h;
    applyDestinationToSprite(sprite, dst);
    layer.addChild(sprite);
  }
}

export function resolveJudgeSkinKind(judge: string): keyof Lr2Skin['judges'] | undefined {
  switch (judge) {
    case 'PERFECT':
      return 'perfect';
    case 'GREAT':
      return 'great';
    case 'GOOD':
      return 'good';
    case 'BAD':
      return 'bad';
    case 'POOR':
      return 'poor';
    default:
      return undefined;
  }
}

export function computeFullComboDurationMs(skin: Lr2Skin): number {
  let max = 0;
  const visit = (entry: { destination?: Lr2DestinationRect; keyframes?: Lr2DestinationRect[] }): void => {
    const dst = entry.destination;
    if (!dst) return;
    if (dst.timer !== 48 && dst.timer !== 49) return;
    const frames = entry.keyframes && entry.keyframes.length > 0 ? entry.keyframes : [dst];
    for (const frame of frames) {
      if (Number.isFinite(frame.time) && frame.time > max) {
        max = frame.time;
      }
    }
  };
  for (const image of skin.images) visit(image);
  for (const number of skin.numbers) visit(number);
  for (const text of skin.texts) visit(text);
  for (const bargraph of skin.bargraphs) visit(bargraph);
  for (const slider of skin.sliders) visit(slider);
  return max > 0 ? max : 3000;
}

/**
 * Walks the skin's elements and returns the longest keyframe `time`
 * (in ms) attached to each LR2 key-on timer (100..117). The value
 * is used as the lane-laser release fade duration so the decay
 * matches the skin's authored animation length instead of a hard-
 * coded fallback. Timers without any element default to the
 * caller's fallback (typically `KEY_ON_FADE_OUT_MS`).
 *
 * Mirrors the {@link computeFullComboDurationMs} pattern: visits
 * every keyframe-bearing element type, picks the maximum `time`
 * per timer slot, and reuses `destination` when `keyframes` is
 * empty so static (single-keyframe) elements still report a span.
 */
export function computeKeyOnFadeDurationsMs(skin: Lr2Skin): Map<number, number> {
  return collectMaxKeyframeTimePerTimer(skin, 100, 117);
}

/**
 * Walks the skin's elements and returns the longest keyframe `time`
 * (in ms) attached to each LR2 bomb timer (50..69 — 1P 50..59 / 2P
 * 60..69, per the LR2 default 7-keys layout). `cleanupBombTimers`
 * uses the value to retire the corresponding `bombStartedAt` /
 * `timerStartedAt` entries once the skin's authored explosion
 * animation has finished, instead of pinning every chart to a
 * hard-coded "LR2 default 150 ms" cycle.
 */
export function computeBombDurationsMs(skin: Lr2Skin): Map<number, number> {
  return collectMaxKeyframeTimePerTimer(skin, 50, 69);
}

/**
 * LR2 LN-hold-effect timers (`70..89` — 1P 70..79 / 2P 80..89).
 * These fire while a long note is being held and stop on release;
 * `releaseLnHoldTimer` consults the returned span to fade out any
 * sustain-glow / hold-sparkle elements gated on the timer.
 */
export function computeLnHoldDurationsMs(skin: Lr2Skin): Map<number, number> {
  return collectMaxKeyframeTimePerTimer(skin, 70, 89);
}

/**
 * LR2 gauge-rise / gauge-max timers (`42` 1P up, `43` 2P up, `44`
 * 1P max, `45` 2P max). The "up" timers are flash-style one-shots
 * fired every time the gauge increases; the gameplay code retires
 * them after the returned span via `setTimeout`. Max timers stay
 * active for as long as the gauge sits at 100 %; they never auto-
 * retire so this duration map is only consulted for the rise
 * variants in practice — but we expose all four for symmetry with
 * the bomb / FC / key-on / LN-hold helpers.
 */
export function computeGaugeTimerDurationsMs(skin: Lr2Skin): Map<number, number> {
  return collectMaxKeyframeTimePerTimer(skin, 42, 45);
}

/**
 * Internal helper for {@link computeKeyOnFadeDurationsMs} /
 * {@link computeBombDurationsMs}: scan every keyframe-bearing
 * element type and report the longest `time` per timer id within
 * the given inclusive range. Single-keyframe elements report
 * `destination.time` so static authored placements still produce
 * a span (otherwise the caller would never see them).
 */
function collectMaxKeyframeTimePerTimer(skin: Lr2Skin, minTimer: number, maxTimer: number): Map<number, number> {
  const result = new Map<number, number>();
  const visit = (entry: { destination?: Lr2DestinationRect; keyframes?: Lr2DestinationRect[] }): void => {
    const dst = entry.destination;
    if (!dst) return;
    const t = dst.timer;
    if (t < minTimer || t > maxTimer) return;
    const frames = entry.keyframes && entry.keyframes.length > 0 ? entry.keyframes : [dst];
    let span = result.get(t) ?? 0;
    for (const frame of frames) {
      if (Number.isFinite(frame.time) && frame.time > span) {
        span = frame.time;
      }
    }
    if (span > 0) result.set(t, span);
  };
  for (const image of skin.images) visit(image);
  for (const number of skin.numbers) visit(number);
  for (const text of skin.texts) visit(text);
  for (const bargraph of skin.bargraphs) visit(bargraph);
  for (const slider of skin.sliders) visit(slider);
  return result;
}

export { createEmptyScore };

export function formatTime(seconds: number): string {
  const minute = Math.floor(seconds / 60);
  const second = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${minute}:${second}`;
}

export function resolveDifficultyName(difficulty: number | undefined): string {
  switch (difficulty) {
    case 1:
      return 'BEGINNER';
    case 2:
      return 'NORMAL';
    case 3:
      return 'HYPER';
    case 4:
      return 'ANOTHER';
    case 5:
      return 'INSANE';
    default:
      return '';
  }
}
