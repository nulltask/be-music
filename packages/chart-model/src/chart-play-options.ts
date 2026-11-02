import type { ChartOptionTimeline } from './chart-options.ts';
import { resolveChartLegacyOptionAlias } from './chart-option-legacy.ts';

/**
 * Chart-authored gameplay options (#844): nanasigroove's `774:RANDOM_*` arrangement and the judgment-related
 * `774:CRAZY_*` options (`GOOD2BAD`, `GREAT2BAD`, `HELLJUDGE`, `ADDMINE`). The source makes them initial-only
 * (`#OPTION`, never A6), so they compile to one fixed set for the whole play, not to a timed program. A chart that sets
 * one wins over the player's own setting of the same item (docs/adr/0033-chart-authored-gameplay-options.md).
 *
 * `NOTES_*` (DOUBLE / COPY / DBLCOPY) is not compiled here: it changes the play variant and lane layout, and stays
 * diagnosed as unsupported.
 */

export const CHART_RANDOM_OPTIONS = ['MIRROR', 'RANDOM', 'RANDOM+', 'ALL', 'ALL+'] as const;
export type ChartRandomOption = (typeof CHART_RANDOM_OPTIONS)[number];
/** `GOOD2BAD` makes the GOOD window a BAD; `GREAT2BAD` the GREAT and GOOD windows. A later one replaces an earlier one. */
export const CHART_JUDGE_MODIFIERS = ['GOOD2BAD', 'GREAT2BAD'] as const;
export type ChartJudgeModifier = (typeof CHART_JUDGE_MODIFIERS)[number];

/** The effective chart-authored gameplay options of one play. */
export interface ChartPlayOptions {
  /** The lane arrangement the chart forces, replacing the player's lane options on both sides. */
  random?: ChartRandomOption;
  /** The judge-window modifier the chart forces. */
  judge?: ChartJudgeModifier;
  /** `HELLJUDGE`: every judge window at half its width. */
  hellJudge?: true;
  /** `ADDMINE`: landmines added at random blank cells, replacing the player's mine option. */
  addMine?: true;
}

/** The recorded form: versioned, so a later profile never reinterprets an older replay. */
export interface ChartPlayOptionProgram {
  version: 1;
  options: ChartPlayOptions;
}

export const CHART_PLAY_OPTION_PROGRAM_VERSION = 1;

type Patch = (options: ChartPlayOptions) => ChartPlayOptions;

function without<K extends keyof ChartPlayOptions>(options: ChartPlayOptions, ...keys: K[]): ChartPlayOptions {
  const next = { ...options };
  for (const key of keys) delete next[key];
  return next;
}

/**
 * How one exact-case modern declaration changes the gameplay options, or `undefined` when it is not one of these.
 * `RANDOM_OFF` clears the arrangement; `CRAZY_OFF` clears every gameplay CRAZY declared before it.
 */
export function parseChartPlayOption(declaration: string): Patch | undefined {
  const random = /^774:RANDOM_(.+)$/.exec(declaration)?.[1];
  if (random !== undefined) {
    if (random === 'OFF') return (options) => without(options, 'random');
    return (CHART_RANDOM_OPTIONS as readonly string[]).includes(random)
      ? (options) => ({ ...options, random: random as ChartRandomOption })
      : undefined;
  }
  const crazy = /^774:CRAZY_(.+)$/.exec(declaration)?.[1];
  switch (crazy) {
    case 'GOOD2BAD':
    case 'GREAT2BAD':
      return (options) => ({ ...options, judge: crazy });
    case 'HELLJUDGE':
      return (options) => ({ ...options, hellJudge: true });
    case 'ADDMINE':
      return (options) => ({ ...options, addMine: true });
    case 'OFF':
      return (options) => without(options, 'judge', 'hellJudge', 'addMine');
    default:
      return undefined;
  }
}

/** True for a declaration this module consumes (so the display compiler does not diagnose it as unsupported). */
export function isChartPlayOptionDeclaration(declaration: string): boolean {
  return parseChartPlayOption(declaration) !== undefined;
}

/**
 * Compile the initial gameplay declarations in source order, later ones winning within a family. Timed (A6) uses are
 * the display compiler's to diagnose as `initial-only-option` (`initial-only-alias` for a legacy ID); they never change
 * this set.
 */
export function compileChartPlayOptions(timeline: Pick<ChartOptionTimeline, 'initial'>): ChartPlayOptionProgram {
  let options: ChartPlayOptions = {};
  for (const declaration of timeline.initial) {
    // Legacy CRA-HARD1 / CRA-HARD2 / CRA-ULTHARD / CRA-2JUDGE / CRA-NORMAL stand for their modern IDs here (#931).
    const patch = parseChartPlayOption(resolveChartLegacyOptionAlias(declaration) ?? declaration);
    if (patch !== undefined) options = patch(options);
  }
  return { version: CHART_PLAY_OPTION_PROGRAM_VERSION, options };
}

/** True when `program` forces anything. */
export function hasChartPlayOptions(program: ChartPlayOptionProgram | undefined): boolean {
  return program !== undefined && Object.keys(program.options).length > 0;
}
