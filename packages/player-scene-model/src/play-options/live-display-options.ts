/**
 * The play options a running play takes at once: the ones that only change what is drawn, so switching them mid-play
 * moves no note, judgment or record. Every other option is read when the play starts.
 */
import { resolvePlayOptionValue } from './choices.ts';
import type { PlayOptions } from './options.ts';

/** The display-only play options a running play follows live. */
export const LIVE_DISPLAY_PLAY_OPTION_KEYS: readonly (keyof PlayOptions)[] = [
  'autoScratchNotes',
  'judgeCounts',
  'judgeDetail',
  'judgeDetailSplit',
  'judgeDisplay',
  'judgePosition',
  'laneBrightness',
  'lr2Acceleration',
  'lr2Char',
  'lr2Earthquake',
  'lr2Heartbeat',
  'lr2Nabeatsu',
  'lr2SideJump',
  'lr2SinCurve',
  'lr2SpiralEffect',
  'lr2SuperLoop',
  'lr2Tornado',
  'lr2Wave',
  'markProcessedNotes',
  'scoreTarget',
  'scoreTargetRate',
  'showJudgeArea',
];

const LIVE_KEYS: ReadonlySet<string> = new Set(LIVE_DISPLAY_PLAY_OPTION_KEYS);

/**
 * The part of `changes` a running play takes at once: its live display options, each validated as a stored value is
 * (`resolvePlayOptionValue`). `undefined` when nothing in `changes` is one.
 */
export function pickLiveDisplayPlayOptions(changes: Partial<PlayOptions>): Partial<PlayOptions> | undefined {
  const picked: Record<string, unknown> = {};
  let any = false;
  for (const [key, value] of Object.entries(changes)) {
    if (!LIVE_KEYS.has(key)) continue;
    const resolved = resolvePlayOptionValue(key as keyof PlayOptions, value);
    if (resolved === undefined) continue;
    picked[key] = resolved;
    any = true;
  }
  return any ? (picked as Partial<PlayOptions>) : undefined;
}
