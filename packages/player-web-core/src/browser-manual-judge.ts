import { normalizeObjectKey, type BeMusicEvent } from '../../json/src/index.ts';
import type { JudgeWindowsMs } from '../../player/src/core/judge-window.ts';

export type BrowserJudgeKind = 'PERFECT' | 'GREAT' | 'GOOD' | 'BAD' | 'POOR';

export interface BrowserLandmineGaugeEffect {
  objectValue: string;
  damage: number;
  gaugeDelta: number;
}

export function resolveBrowserJudgeFromDeltaMs(signedDeltaMs: number, judgeWindows: JudgeWindowsMs): BrowserJudgeKind {
  const deltaMs = Math.abs(signedDeltaMs);
  if (deltaMs <= judgeWindows.pgreat) {
    return 'PERFECT';
  }
  if (deltaMs <= judgeWindows.great) {
    return 'GREAT';
  }
  if (deltaMs <= judgeWindows.good) {
    return 'GOOD';
  }
  if (deltaMs <= judgeWindows.bad) {
    return 'BAD';
  }
  return 'POOR';
}

export function applyFastSlowForBrowserJudge(
  counters: { fast: number; slow: number },
  judge: BrowserJudgeKind,
  signedDeltaMs: number,
): void {
  if (judge !== 'GREAT' && judge !== 'GOOD') {
    return;
  }
  if (signedDeltaMs < 0) {
    counters.fast += 1;
  } else if (signedDeltaMs > 0) {
    counters.slow += 1;
  }
}

export function resolveLandmineGaugeEffect(event: Pick<BeMusicEvent, 'value'>): BrowserLandmineGaugeEffect {
  const objectValue = normalizeObjectKey(event.value);
  const damage = Number.parseInt(objectValue, 36) / 2;
  return {
    objectValue,
    damage,
    gaugeDelta: -damage,
  };
}

export function isBrowserScoreTargetChannel(channel: string): boolean {
  return channel !== '17' && channel !== '27';
}
