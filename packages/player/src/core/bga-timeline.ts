import { type BGACue } from '@be-music/chart';

// The BGA cue builders (`buildBGATimelines`, `buildBmsBGATimeline`) live in `@be-music/chart`; this module only picks
// the cue on screen, for `@be-music/player/display`.

/**
 * How long a POOR / miss BGA layer stays visible after a miss before the normal base/layer composite returns.
 * 500 ms is the shipped default of both LR2 (`<poorbga>500</poorbga>` in its `config.xml`) and beatoraja
 * (`PlayerConfig.misslayerDuration`, which `BGAProcessor.drawBGA` shows the miss layer for from the miss); both expose
 * it as a per-user setting, this implementation does not yet. Shared by the renderers that time the miss layer out
 * (TUI compositor, web built-in / LR2 scene, web beatoraja scene) so the miss-layer feel is identical across them —
 * change it here, not per frontend.
 */
export const DEFAULT_POOR_BGA_DISPLAY_SECONDS = 0.5;

export function pickActiveBGACue<T extends { seconds: number }>(
  cues: ReadonlyArray<T>,
  seconds: number,
): T | undefined {
  let low = 0;
  let high = cues.length - 1;
  let answer = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (cues[mid]!.seconds <= seconds) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return answer < 0 ? undefined : cues[answer];
}

export function pickActiveBGAKey(cues: ReadonlyArray<BGACue>, seconds: number): string | undefined {
  return pickActiveBGACue(cues, seconds)?.key;
}
