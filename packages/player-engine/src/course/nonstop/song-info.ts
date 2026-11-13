/*
 * The song a stitched NONSTOP play shows (its title, artist and genre) as the play moves from stage to stage, and the
 * crossfade from the previous stage's song to the next one's. LR2 and beatoraja skins keep their own rules (an LR2 skin
 * moves its title only after a BLANK connection); this is what Be-Music's own skins read.
 */

/** A stage's song as the play screen names it. */
export interface NonstopSongInfo {
  title?: string;
  subtitle?: string;
  artist?: string;
  genre?: string;
}

/** How long the song info takes to crossfade into the next stage's, in seconds. */
export const NONSTOP_SONG_INFO_FADE_SECONDS = 0.6;

/** Which stage's song a stitched play shows at a moment, and the stage it is crossfading from. */
export interface NonstopSongInfoState {
  /** The stage whose song is shown: the last one whose window has started. */
  stage: number;
  /** While the crossfade runs: the stage before it, fading out. */
  previous?: number;
  /** How far the crossfade is, 0 (the previous stage's song alone) to 1 (this stage's alone). */
  progress: number;
}

/**
 * The song info a stitched play shows at `seconds` (stitched seconds): the stage whose window (`windowStart`) has
 * started last, crossfading in over `fadeSeconds` from the stage before it as its window starts. Before any window
 * starts, the first stage's.
 */
export function resolveNonstopSongInfoState(
  stages: ReadonlyArray<{ readonly windowStart: number }>,
  seconds: number,
  fadeSeconds: number = NONSTOP_SONG_INFO_FADE_SECONDS,
): NonstopSongInfoState {
  let stage = 0;
  for (let index = 1; index < stages.length; index += 1) {
    if (stages[index]!.windowStart <= seconds) stage = index;
  }
  if (stage === 0 || !(fadeSeconds > 0)) return { stage, progress: 1 };
  const progress = (seconds - stages[stage]!.windowStart) / fadeSeconds;
  return progress >= 1 ? { stage, progress: 1 } : { stage, previous: stage - 1, progress: Math.max(0, progress) };
}
