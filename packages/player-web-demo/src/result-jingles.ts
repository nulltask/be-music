import { resolveResultJingles, type SystemSound, type SystemSoundSet } from '@be-music/scene-model';
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

/** A theme's result jingles as the result slots of a system sound set. */
function resultJingleSet(jingles: Lr2ResultJingles | BeatorajaThemeBgm): SystemSoundSet {
  const set: { -readonly [S in keyof SystemSoundSet]: SystemSound } = {};
  if (jingles.clear !== undefined) set.clear = { bytes: jingles.clear };
  if (jingles.fail !== undefined) set.fail = { bytes: jingles.fail };
  if (jingles.result !== undefined) set.result = { bytes: jingles.result };
  if (jingles.courseClear !== undefined) set.courseClear = { bytes: jingles.courseClear };
  if (jingles.courseFail !== undefined) set.courseFail = { bytes: jingles.courseFail };
  return set;
}

/**
 * The jingles a result shown on the LR2 or built-in result view plays (`resolveResultJingles` of
 * `@be-music/scene-model`). They come from the theme whose result skin is active (`family`, the family picked for the
 * result scene): a result that falls back to the built-in view while a beatoraja theme is active (a NONSTOP course has
 * no beatoraja scene) plays that theme's sound set, as beatoraja plays every result from its one set, and the LR2 set
 * only when the beatoraja theme has no result jingle at all. `courseJingles` plays the course-result ones, falling back
 * to the clear / fail ones.
 */
export function resolveResultViewJingles(
  family: SkinFamilyId,
  courseJingles: boolean,
  sets: { lr2: Lr2ResultJingles; beatoraja: BeatorajaThemeBgm },
): ResultViewJingles {
  const lr2 = resultJingleSet(sets.lr2);
  const beatoraja = resultJingleSet(sets.beatoraja);
  const jingles = resolveResultJingles(family === 'beatoraja' ? [beatoraja, lr2] : [lr2], courseJingles);
  const out: ResultViewJingles = {};
  if (jingles.clear?.bytes !== undefined) out.clearBgm = jingles.clear.bytes;
  if (jingles.fail?.bytes !== undefined) out.failBgm = jingles.fail.bytes;
  if (jingles.result?.bytes !== undefined) out.resultBgm = jingles.result.bytes;
  return out;
}
