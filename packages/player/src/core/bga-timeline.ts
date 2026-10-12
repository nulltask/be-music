import { type BgaCue } from '@be-music/chart';

// The BGA cue builders live in `@be-music/chart` (the resolved-chart layer); re-exported so
// `@be-music/player/core/bga-timeline` keeps its public API.
export {
  buildBgaTimelines,
  buildBmsBgaTimeline,
  type BgaCue,
  type BgaTimelines,
  type BgaTimingResolver,
} from '@be-music/chart';

/**
 * How long a POOR / miss BGA layer stays visible after a miss before the normal base/layer composite returns.
 * 500 ms is LR2's shipped default (`<poorbga>500</poorbga>` in its `config.xml`; LR2 exposes it as a per-user
 * setting, this implementation does not yet). Shared by the renderers that time the miss layer out (TUI
 * compositor, web LR2 scene) so the miss-layer feel is identical across them — change it here, not per frontend.
 * The beatoraja web scene instead holds its miss layer until the next non-POOR judge, as beatoraja skins expect.
 */
export const DEFAULT_POOR_BGA_DISPLAY_SECONDS = 0.5;

export function pickActiveBgaCue<T extends { seconds: number }>(
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

export function pickActiveBgaKey(cues: ReadonlyArray<BgaCue>, seconds: number): string | undefined {
  return pickActiveBgaCue(cues, seconds)?.key;
}
