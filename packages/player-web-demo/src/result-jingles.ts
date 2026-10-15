import type { BeatorajaThemeBgm, SkinFamilyId } from '@be-music/player-web/skin';

/** An LR2 theme's result jingles (`Sound/<theme>/clear.wav` and the rest). */
export interface Lr2ResultJingles {
  clear?: Uint8Array | undefined;
  fail?: Uint8Array | undefined;
  result?: Uint8Array | undefined;
  courseClear?: Uint8Array | undefined;
  courseFail?: Uint8Array | undefined;
}

/** The jingle slots the LR2 / built-in result view takes (`clearBgm` / `failBgm` / `resultBgm`). */
export interface ResultViewJingles {
  clearBgm?: Uint8Array;
  failBgm?: Uint8Array;
  resultBgm?: Uint8Array;
}

/**
 * The jingles a result shown on the LR2 or built-in result view plays. They come from the theme whose result skin is
 * active (`family`, the family picked for the result scene): a result that falls back to the built-in view while a
 * beatoraja theme is active (a NONSTOP course has no beatoraja scene) plays that theme's sound set, as beatoraja plays
 * every result from its one set, and the LR2 set only when the beatoraja theme has no result jingle at all.
 * `courseJingles` plays the course-result ones, falling back to the clear / fail ones.
 */
export function resolveResultViewJingles(
  family: SkinFamilyId,
  courseJingles: boolean,
  sets: { lr2: Lr2ResultJingles; beatoraja: BeatorajaThemeBgm },
): ResultViewJingles {
  const { beatoraja } = sets;
  const beatorajaHasJingles =
    beatoraja.clear !== undefined ||
    beatoraja.fail !== undefined ||
    beatoraja.result !== undefined ||
    beatoraja.courseClear !== undefined ||
    beatoraja.courseFail !== undefined;
  const set = family === 'beatoraja' && beatorajaHasJingles ? beatoraja : sets.lr2;
  const jingles: ResultViewJingles = {};
  const clear = (courseJingles ? set.courseClear : undefined) ?? set.clear;
  const fail = (courseJingles ? set.courseFail : undefined) ?? set.fail;
  if (clear !== undefined) jingles.clearBgm = clear;
  if (fail !== undefined) jingles.failBgm = fail;
  if (set.result !== undefined) jingles.resultBgm = set.result;
  return jingles;
}
