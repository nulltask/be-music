import type { BeMusicJSON } from '@be-music/chart-source';
import type { CourseConstraint } from './definition.ts';

/**
 * Applies a course's long-note constraint (`ln` / `cn` / `hcn`) to a stage chart that leaves its long-note mode
 * undefined, as beatoraja forces `lnmode` for such charts. A chart that names its own mode (`#LNMODE`, bmson `ln_type`)
 * keeps it. Returns the chart unchanged when nothing applies, else a copy. Hosts apply it to each stage chart they play,
 * and the Leaderboard to the stage charts it stitches a NONSTOP run from again, so both get the same chart.
 */
export function applyCourseLongNoteConstraint(
  json: BeMusicJSON,
  constraints: readonly CourseConstraint[],
): BeMusicJSON {
  const mode = constraints.includes('ln')
    ? 1
    : constraints.includes('cn')
      ? 2
      : constraints.includes('hcn')
        ? 3
        : undefined;
  if (mode === undefined) return json;
  if (json.sourceFormat === 'bms') {
    if (json.bms.lnMode !== undefined) return json;
    return { ...json, bms: { ...json.bms, lnMode: mode } };
  }
  const lnType = json.bmson.info.lnType;
  if (lnType !== undefined && lnType !== 0) return json;
  return { ...json, bmson: { ...json.bmson, info: { ...json.bmson.info, lnType: mode } } };
}
