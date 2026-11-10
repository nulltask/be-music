import { isRulesetId, type RulesetId } from './definitions.ts';

/*
 * Source-qualified option values (ADR 0019): a name that two sources define with different behavior carries its source
 * as `<source>:<NAME>` (`lr2:S-RANDOM`, `beatoraja:BATTLE`). A bare colliding value is ruleset-relative: it means the
 * judging ruleset's own. Names only one source defines stay bare.
 */

/** The names two sources define with different behavior, with the sources that define each. */
export const QUALIFIED_OPTION_SOURCES: {
  readonly 'S-RANDOM': readonly ['lr2', 'beatoraja'];
  readonly CONVERGE: readonly ['lr2', 'beatoraja'];
  readonly BATTLE: readonly ['beatoraja', '____'];
} = {
  /** LR2's free-lane draw, which AC's matches (no jack avoidance), and beatoraja's 40 ms jack avoidance. */
  'S-RANDOM': ['lr2', 'beatoraja'],
  /** LR2's concentration on one lane and beatoraja's PMS jack-streak arrangement. */
  CONVERGE: ['lr2', 'beatoraja'],
  /**
   * One player on both sides: beatoraja's BATTLE (5/7/24 KEY, LIGHT_ASSIST) and AC's DP BATTLE (7 KEY, no score saved).
   * LR2's BATTLE is two-player play, stored as `TWO-PLAYER`.
   */
  BATTLE: ['beatoraja', '____'],
} as const satisfies Record<string, readonly RulesetId[]>;

/**
 * The source whose value a ruleset's bare colliding name runs where that ruleset defines the name alike to another
 * source: AC's S-RANDOM places notes as LR2's does, so `____` reads a bare S-RANDOM as `lr2:S-RANDOM`.
 */
const SHARED_OPTION_SOURCES: Readonly<Partial<Record<QualifiedOptionName, Partial<Record<RulesetId, RulesetId>>>>> = {
  'S-RANDOM': { ____: 'lr2' },
};

/**
 * Qualified values that are no longer separate options, with the value each now reads as. LR2, beatoraja and AC define
 * RANDOM alike (one chart-wide shuffle of the keys), so it is one bare RANDOM; AC's S-RANDOM is LR2's. Settings and
 * replays that hold the old values keep working.
 */
const MERGED_OPTION_VALUES: Readonly<Record<string, string>> = {
  'lr2:RANDOM': 'RANDOM',
  'beatoraja:RANDOM': 'RANDOM',
  '____:RANDOM': 'RANDOM',
  '____:S-RANDOM': 'lr2:S-RANDOM',
};

/** The value `value` reads as now: a merged qualified value becomes its current value; any other stays as it is. */
export function canonicalOptionValue(value: string): string {
  return Object.hasOwn(MERGED_OPTION_VALUES, value) ? MERGED_OPTION_VALUES[value]! : value;
}

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
 * bare colliding value is the ruleset's own (or the source whose value the ruleset shares). A merged value reads as its
 * current one, so `lr2:RANDOM` is the bare RANDOM. A value no source qualifies keeps `source` undefined.
 */
export function resolveOptionSource(value: string, ruleset: RulesetId): OptionSourceParts {
  const parts = splitOptionSource(canonicalOptionValue(value));
  if (parts.source !== undefined || !isQualifiedOptionName(parts.name)) return parts;
  return { source: SHARED_OPTION_SOURCES[parts.name]?.[ruleset] ?? ruleset, name: parts.name };
}

/**
 * `name` qualified with `source` when the name collides and `source` defines it, or with the source whose value
 * `source` shares (`____`'s S-RANDOM is `lr2:S-RANDOM`); the bare name otherwise (a name only one source defines, or a
 * source that does not define it).
 */
export function qualifyOptionValue(source: RulesetId, name: string): string {
  if (!isQualifiedOptionName(name)) return name;
  const shared = SHARED_OPTION_SOURCES[name]?.[source] ?? source;
  return (QUALIFIED_OPTION_SOURCES[name] as readonly RulesetId[]).includes(shared) ? `${shared}:${name}` : name;
}

/**
 * The qualified form of a stored value, read as `ruleset`'s own when it is bare, and a merged value as its current one:
 * what a settings migration writes (ADR 0019). A qualified value, a name no source qualifies, and a bare name `ruleset` does not define stay as they are.
 */
export function migrateOptionValue(value: string, ruleset: RulesetId): string {
  const current = canonicalOptionValue(value);
  const parts = splitOptionSource(current);
  return parts.source === undefined ? qualifyOptionValue(ruleset, parts.name) : current;
}

/**
 * The sources whose option `value` is, its own first: `lr2:S-RANDOM` is LR2's and AC's (`['lr2', '____']`),
 * `beatoraja:CONVERGE` beatoraja's. A bare value has none.
 */
export function optionValueSources(value: string): RulesetId[] {
  const { source, name } = splitOptionSource(canonicalOptionValue(value));
  if (source === undefined) return [];
  const shared = isQualifiedOptionName(name) ? SHARED_OPTION_SOURCES[name] : undefined;
  return [
    source,
    ...Object.entries(shared ?? {})
      .filter(([, target]) => target === source)
      .map(([ruleset]) => ruleset as RulesetId),
  ];
}

/** Whether `value` names a source that defines it: a bare value, or a qualified one whose source defines the name. */
export function isKnownOptionSource(value: string): boolean {
  const parts = splitOptionSource(canonicalOptionValue(value));
  if (parts.source === undefined) return true;
  return (
    isQualifiedOptionName(parts.name) &&
    (QUALIFIED_OPTION_SOURCES[parts.name] as readonly RulesetId[]).includes(parts.source)
  );
}
