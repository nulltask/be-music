import { hasResultJingle, resolveResultJingles, type SystemSound, type SystemSoundSet } from '@be-music/scene-model';
import type { BeatorajaThemeBGM, SkinFamilyId } from '@be-music/player-web/skin';

/** An LR2 theme's result jingles (`Sound/<theme>/clear.wav` and the rest). */
export interface LR2ResultJingles {
  clear?: Uint8Array | undefined;
  fail?: Uint8Array | undefined;
  result?: Uint8Array | undefined;
  courseClear?: Uint8Array | undefined;
  courseFail?: Uint8Array | undefined;
}

/** A result's jingles by slot (`clearBGM` / `failBGM` / `resultBGM`), as the test hook names the one played. */
export interface ResultViewJingles {
  clearBGM?: Uint8Array;
  failBGM?: Uint8Array;
  resultBGM?: Uint8Array;
}

/** A theme's result jingles as the result slots of a system sound set. */
function resultJingleSet(jingles: LR2ResultJingles | BeatorajaThemeBGM): SystemSoundSet {
  const set: { -readonly [S in keyof SystemSoundSet]: SystemSound } = {};
  if (jingles.clear !== undefined) set.clear = { bytes: jingles.clear };
  if (jingles.fail !== undefined) set.fail = { bytes: jingles.fail };
  if (jingles.result !== undefined) set.result = { bytes: jingles.result };
  if (jingles.courseClear !== undefined) set.courseClear = { bytes: jingles.courseClear };
  if (jingles.courseFail !== undefined) set.courseFail = { bytes: jingles.courseFail };
  return set;
}

/**
 * The sound set a result shown on the LR2 or built-in result view plays its jingles from: the theme whose result skin
 * is active (`family`, the family picked for the result scene). A result that falls back to the built-in view while a
 * beatoraja theme is active (a NONSTOP course has no beatoraja scene) plays that theme's set, as beatoraja plays every
 * result from its one set, and the LR2 set only when the beatoraja theme has no result jingle at all. The result scene
 * picks the jingle from it (`resolveResultJingles` of `@be-music/scene-model`).
 */
export function resolveResultSoundSet(
  family: SkinFamilyId,
  sets: { lr2: LR2ResultJingles; beatoraja: BeatorajaThemeBGM },
): SystemSoundSet {
  const lr2 = resultJingleSet(sets.lr2);
  if (family !== 'beatoraja') return lr2;
  const beatoraja = resultJingleSet(sets.beatoraja);
  return hasResultJingle(beatoraja) ? beatoraja : lr2;
}

/**
 * The jingles a result shown on the LR2 or built-in result screen picks from, out of {@link resolveResultSoundSet}'s
 * set, for the test hook to name the one played. `courseJingles` takes the course-result ones, falling back to the
 * clear / fail ones.
 */
export function resolveResultViewJingles(
  family: SkinFamilyId,
  courseJingles: boolean,
  sets: { lr2: LR2ResultJingles; beatoraja: BeatorajaThemeBGM },
): ResultViewJingles {
  const jingles = resolveResultJingles([resolveResultSoundSet(family, sets)], courseJingles);
  const out: ResultViewJingles = {};
  if (jingles.clear?.bytes !== undefined) out.clearBGM = jingles.clear.bytes;
  if (jingles.fail?.bytes !== undefined) out.failBGM = jingles.fail.bytes;
  if (jingles.result?.bytes !== undefined) out.resultBGM = jingles.result.bytes;
  return out;
}
