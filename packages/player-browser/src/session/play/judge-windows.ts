import type { JudgeWindowSetUs, RulesetWindowTables, WindowPairUs } from '@be-music/player-engine/ruleset';
import type { BeMusicJudgeWindow, BeMusicJudgeWindowSet, BeMusicJudgeWindows } from '@be-music/player-skin-sdk';

/**
 * One engine window pair (µs, `[lateBound <= 0, earlyBound >= 0]` in the ruleset's `noteTime - inputTime`
 * convention) as the skin SDK's pair of positive ms reaches.
 */
function toJudgeWindow([lateBoundUs, earlyBoundUs]: WindowPairUs): BeMusicJudgeWindow {
  // `Math.max` folds an early-only window's `-0` late reach into `0`.
  return { earlyMs: Math.max(0, earlyBoundUs) / 1000, lateMs: Math.max(0, -lateBoundUs) / 1000 };
}

function toJudgeWindowSet(set: JudgeWindowSetUs): BeMusicJudgeWindowSet {
  const [perfect, great, good, bad] = set.judges;
  const windows: BeMusicJudgeWindowSet = {
    perfect: toJudgeWindow(perfect),
    great: toJudgeWindow(great),
    good: toJudgeWindow(good),
    bad: toJudgeWindow(bad),
  };
  if (set.ms !== undefined) windows.emptyPoor = toJudgeWindow(set.ms);
  return windows;
}

/**
 * The engine's resolved window tables (µs) as the {@link BeMusicJudgeWindows} a be-music skin reads (ms). The
 * scratch lane's long-note end has its own table in the engine; the SDK carries one `longNoteEnd`, so the key lanes'
 * table stands for both.
 */
export function toBeMusicJudgeWindows(tables: RulesetWindowTables): BeMusicJudgeWindows {
  return {
    note: toJudgeWindowSet(tables.note),
    scratch: toJudgeWindowSet(tables.scratch),
    longNoteEnd: toJudgeWindowSet(tables.longNoteEnd),
  };
}
