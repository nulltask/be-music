import { isRulesetId, type RulesetId } from './definitions.ts';

/*
 * Source-qualified option values (ADR 0019): a name that two sources define with different behavior carries its source
 * as `<source>:<NAME>` (`lr2:S-RANDOM`, `beatoraja:BATTLE`). A bare colliding value is ruleset-relative: it means the
 * judging ruleset's own. Names only one source defines stay bare.
 */

/** The names two sources define with different behavior, with the sources that define each. */
export const QUALIFIED_OPTION_SOURCES: {
  readonly RANDOM: readonly ['lr2', 'beatoraja', '____'];
  readonly 'S-RANDOM': readonly ['lr2', 'beatoraja', '____'];
  readonly CONVERGE: readonly ['lr2', 'beatoraja'];
  readonly BATTLE: readonly ['beatoraja', '____'];
} = {
  /** LR2's randFix shuffle, beatoraja's per-lane draw on Java `Random`, and AC's (LR2's, provisionally). */
  RANDOM: ['lr2', 'beatoraja', '____'],
  /** LR2's free-lane draw, beatoraja's 40 ms jack avoidance, and AC's (LR2's, provisionally). */
  'S-RANDOM': ['lr2', 'beatoraja', '____'],
  /** LR2's concentration on one lane and beatoraja's PMS jack-streak arrangement. */
  CONVERGE: ['lr2', 'beatoraja'],
  /**
   * One player on both sides: beatoraja's BATTLE (5/7/24 KEY, LIGHT_ASSIST) and AC's DP BATTLE (7 KEY, no score saved).
   * LR2's BATTLE is two-player play, stored as `TWO-PLAYER`.
   */
  BATTLE: ['beatoraja', '____'],
} as const satisfies Record<string, readonly RulesetId[]>;

/** A name {@link QUALIFIED_OPTION_SOURCES} lists. */
export type QualifiedOptionName = keyof typeof QUALIFIED_OPTION_SOURCES;

/** A source-qualified value of `Name`, for each source that defines it. */
export type QualifiedOptionValue<Name extends QualifiedOptionName = QualifiedOptionName> = {
  [N in Name]: `${(typeof QUALIFIED_OPTION_SOURCES)[N][number]}:${N}`;
}[Name];

/** An option value with its source: the qualified one, or `undefined` for a bare value. */
export interface OptionSourceParts {
  source: RulesetId | undefined;
  name: string;
}

/** Whether `name` collides between sources and takes a source qualifier. */
export function isQualifiedOptionName(name: string): name is QualifiedOptionName {
  return Object.hasOwn(QUALIFIED_OPTION_SOURCES, name);
}

/**
 * Splits `value` into its source and bare name: `lr2:S-RANDOM` is `{ source: 'lr2', name: 'S-RANDOM' }`, and a bare
 * value or an unknown prefix keeps the whole value as its name.
 */
export function splitOptionSource(value: string): OptionSourceParts {
  const colon = value.indexOf(':');
  if (colon < 0) return { source: undefined, name: value };
  const source = value.slice(0, colon);
  return isRulesetId(source) ? { source, name: value.slice(colon + 1) } : { source: undefined, name: value };
}

/** The bare name of an option value: what a skin's label reads (`beatoraja:S-RANDOM` reads as S-RANDOM). */
export function optionValueName(value: string): string {
  return splitOptionSource(value).name;
}

/**
 * The source whose behavior `value` runs under the judge ruleset `ruleset`: a qualified value keeps its source, and a
 * bare colliding value is the ruleset's own. A value no source qualifies keeps `source` undefined.
 */
export function resolveOptionSource(value: string, ruleset: RulesetId): OptionSourceParts {
  const parts = splitOptionSource(value);
  if (parts.source !== undefined || !isQualifiedOptionName(parts.name)) return parts;
  return { source: ruleset, name: parts.name };
}

/**
 * `name` qualified with `source` when the name collides and `source` defines it; the bare name otherwise (a name only
 * one source defines, or a source that does not define it).
 */
export function qualifyOptionValue(source: RulesetId, name: string): string {
  if (!isQualifiedOptionName(name)) return name;
  return (QUALIFIED_OPTION_SOURCES[name] as readonly RulesetId[]).includes(source) ? `${source}:${name}` : name;
}

/**
 * The qualified form of a stored value, read as `ruleset`'s own when it is bare: what a settings migration writes
 * (ADR 0019). A qualified value, a name no source qualifies, and a bare name `ruleset` does not define stay as they are.
 */
export function migrateOptionValue(value: string, ruleset: RulesetId): string {
  const parts = splitOptionSource(value);
  return parts.source === undefined ? qualifyOptionValue(ruleset, parts.name) : value;
}

/** Whether `value` names a source that defines it: a bare value, or a qualified one whose source defines the name. */
export function isKnownOptionSource(value: string): boolean {
  const parts = splitOptionSource(value);
  if (parts.source === undefined) return true;
  return (
    isQualifiedOptionName(parts.name) &&
    (QUALIFIED_OPTION_SOURCES[parts.name] as readonly RulesetId[]).includes(parts.source)
  );
}
