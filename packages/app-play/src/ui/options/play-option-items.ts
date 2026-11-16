import {
  optionValueSources,
  qualifyGaugePick,
  qualifyPracticeGaugePick,
  resolveGaugeTypes,
  resolvePracticeGaugeTypes,
  splitGaugePick,
  splitPracticeGaugePick,
  splitOptionSource,
  type GaugePick,
  type GaugeType,
  type RulesetId,
} from '@be-music/player-engine/ruleset';
import {
  formatGaugeLabel,
  laneCoversFromPlayOptions,
  resolveRandomModes,
  type LaneCoverState,
  type PlayOptions,
  type PracticeGaugePick,
  type PracticeGaugeType,
  type RandomMode,
} from '@be-music/player-scene-model';

/** One choice of an Options dialog list: its label and the value it sets. */
export interface PlayOptionItem<T> {
  text: string;
  value: T;
  /** Shown dimmed and not selectable (`OptionChoice.disabled`). */
  disabled?: boolean;
}

/** How the Options dialog names each source. */
const SOURCE_LABELS: Readonly<Record<RulesetId, string>> = { lr2: 'LR2', beatoraja: 'beatoraja', ____: '????' };

/** The source of each lane option only one source defines (ADR 0019's registry, as the Options dialog groups them). */
const LANE_OPTION_SOURCES: Readonly<Record<string, RulesetId>> = {
  'R-RANDOM': 'beatoraja',
  SPIRAL: 'beatoraja',
  'H-RANDOM': 'beatoraja',
  'ALL-SCR': 'beatoraja',
  'RANDOM-EX': 'beatoraja',
  'S-RANDOM-EX': 'beatoraja',
  RANDOM_PLAYABLE: 'beatoraja',
  S_RANDOM_PLAYABLE: 'beatoraja',
  SCATTER: 'lr2',
  'SCATTER-CORRECTED': 'lr2',
  'S-RANDOM-CORRECTED': 'lr2',
  'CONVERGE-CORRECTED': 'lr2',
  'SYNCHRONIZE-RANDOM': '____',
  'SYMMETRY-RANDOM': '____',
};

/** How the Options dialog spells a lane option's name. */
const LANE_OPTION_NAMES: Readonly<Record<string, string>> = {
  'SCATTER-CORRECTED': 'SCATTER 9KEY corrected',
  'S-RANDOM-CORRECTED': 'S-RANDOM 9KEY corrected',
  'CONVERGE-CORRECTED': 'CONVERGE corrected',
  RANDOM_PLAYABLE: 'RANDOM PLAYABLE',
  S_RANDOM_PLAYABLE: 'S-RANDOM PLAYABLE',
  'SYNCHRONIZE-RANDOM': 'SYNCHRONIZE RANDOM',
  'SYMMETRY-RANDOM': 'SYMMETRY RANDOM',
};

/** The sources in the order the Options dialog groups them: the judge ruleset's own first. */
function sourceOrder(ruleset: RulesetId): RulesetId[] {
  return [ruleset, ...(['lr2', 'beatoraja', '____'] as const).filter((source) => source !== ruleset)];
}

/**
 * The source a lane option value comes from; `undefined` for OFF, MIRROR and RANDOM, which every source defines alike.
 */
export function laneOptionSource(mode: RandomMode): RulesetId | undefined {
  return splitOptionSource(mode).source ?? LANE_OPTION_SOURCES[mode];
}

/** The sources that define a lane option value as it runs: its source, and those sharing it (AC's S-RANDOM is LR2's). */
function laneOptionSources(mode: RandomMode): readonly RulesetId[] {
  const shared = optionValueSources(mode);
  if (shared.length > 0) return shared;
  const source = laneOptionSource(mode);
  return source === undefined ? [] : [source];
}

/**
 * The Options dialog's lane options under `ruleset`, grouped by source (ADR 0019): OFF, MIRROR and RANDOM, then the judge
 * ruleset's own source's options, then the other sources'. Each source-specific option names its sources, so
 * `lr2:S-RANDOM` reads `S-RANDOM (LR2 / ????)` and `beatoraja:S-RANDOM` reads `S-RANDOM (beatoraja)`; a shared one sits
 * in the group of the first source in that order.
 */
export function laneOptionItems(ruleset: RulesetId, duplicatedBattle1P = false): PlayOptionItem<RandomMode>[] {
  const modes = resolveRandomModes(ruleset, duplicatedBattle1P);
  const order = sourceOrder(ruleset);
  const item = (mode: RandomMode): PlayOptionItem<RandomMode> => {
    const sources = laneOptionSources(mode);
    const name = splitOptionSource(mode).name;
    const text = LANE_OPTION_NAMES[name] ?? name;
    const label = sources.map((source) => SOURCE_LABELS[source]).join(' / ');
    return { text: sources.length === 0 ? text : `${text} (${label})`, value: mode };
  };
  const group = (mode: RandomMode): RulesetId | undefined =>
    order.find((source) => laneOptionSources(mode).includes(source));
  return [
    ...modes.filter((mode) => group(mode) === undefined),
    ...order.flatMap((source) => modes.filter((mode) => group(mode) === source)),
  ].map(item);
}

/**
 * The Options dialog's battle and conversion modes under `ruleset`, grouped by source like the lane options. BATTLE names
 * LR2's two-player play (`TWO-PLAYER`, offered under every ruleset; That-Which-Must-Not-Be-Named calls it 2P PLAY) and
 * the beatoraja and That-Which-Must-Not-Be-Named one-player copies (`beatoraja:BATTLE`, `____:BATTLE`), so each
 * carries its source. COUPLE stays with LR2 rules.
 */
export function battleModeItems(ruleset: RulesetId): PlayOptionItem<PlayOptions['battleMode']>[] {
  const groups: Record<RulesetId, PlayOptionItem<PlayOptions['battleMode']>[]> = {
    lr2: [
      ...(ruleset === '____' ? [] : [{ text: 'BATTLE (LR2)', value: 'TWO-PLAYER' as const }]),
      ...(ruleset === 'lr2' ? [{ text: 'COUPLE (LR2)', value: 'COUPLE' as const }] : []),
      { text: 'D-BATTLE (LR2)', value: 'D-BATTLE' },
      { text: 'SP TO DP (LR2)', value: 'SP-TO-DP' },
      { text: 'SP TO DP corrected (LR2)', value: 'SP-TO-DP-CORRECTED' },
    ],
    beatoraja: [
      { text: 'BATTLE (beatoraja)', value: 'beatoraja:BATTLE' },
      { text: 'BATTLE AS (beatoraja)', value: 'BATTLE-AS' },
    ],
    ____: [
      { text: 'BATTLE (????)', value: '____:BATTLE' },
      ...(ruleset === '____' ? [{ text: '2P PLAY (????)', value: 'TWO-PLAYER' as const }] : []),
    ],
  };
  return [
    { text: 'OFF', value: 'OFF' },
    { text: 'CHART HEADER', value: 'AUTO' },
    ...sourceOrder(ruleset).flatMap((source) => groups[source]),
  ];
}

/** A gauge's name as its source spells it: beatoraja's and AC's GROOVE is NORMAL, beatoraja's DEATH its HAZARD. */
function gaugeName(source: RulesetId, type: GaugeType): string {
  if (type === 'ASSIST-EASY') return source === '____' ? 'ASSISTED EASY' : 'ASSIST EASY';
  if (type === 'DEATH' && source === 'beatoraja') return 'HAZARD';
  if (type === 'GROOVE' && source !== 'lr2') return 'NORMAL';
  return formatGaugeLabel(type) ?? type;
}

/**
 * The Options dialog's gauges under `ruleset`, grouped by source like the lane options (ADR 0019, #1171): the judge
 * ruleset's own gauges as bare values, then each other source's gauges as qualified picks named with their source, so
 * `lr2:HARD` reads `HARD (LR2)` under beatoraja. A qualified pick keeps its source's gauge whichever ruleset judges.
 *
 * `selected` are the picks the dialog holds. One qualified with the judge ruleset itself (`lr2:HARD` under LR2, kept
 * across a ruleset change) plays as the bare gauge does, so it is listed after the own gauges only while it is selected.
 */
export function gaugeItems(ruleset: RulesetId, selected: readonly GaugePick[] = []): PlayOptionItem<GaugePick>[] {
  const qualified = (source: RulesetId, type: GaugeType): PlayOptionItem<GaugePick> => ({
    text: `${gaugeName(source, type)} (${SOURCE_LABELS[source]})`,
    value: qualifyGaugePick(source, type),
  });
  const kept = resolveGaugeTypes(ruleset).filter((type) =>
    selected.some((pick) => {
      const parts = splitGaugePick(pick);
      return parts?.source === ruleset && parts.type === type;
    }),
  );
  return [
    ...resolveGaugeTypes(ruleset).map((type) => ({ text: gaugeName(ruleset, type), value: type })),
    ...kept.map((type) => qualified(ruleset, type)),
    ...sourceOrder(ruleset)
      .slice(1)
      .flatMap((source) => resolveGaugeTypes(source).map((type) => qualified(source, type))),
  ];
}

/** {@link gaugeItems} for the dialog's state, as a select's label-to-value choices. */
export function gaugeChoices(state: {
  judgeRuleset: RulesetId;
  gauge: GaugePick;
  gauge2P: GaugePick;
}): Record<string, GaugePick> {
  return Object.fromEntries(
    gaugeItems(state.judgeRuleset, [state.gauge, state.gauge2P]).map((item) => [item.text, item.value]),
  );
}

/** How the Options dialog spells each PRACTICE gauge id. */
const PRACTICE_GAUGE_NAMES: Readonly<Partial<Record<PracticeGaugeType, string>>> = {
  'ASSIST-EASY': 'ASSIST EASY',
  'ASSISTED-EASY': 'ASSISTED EASY',
  CLASS: 'GRADE',
  EXCLASS: 'EX GRADE',
  EXHARDCLASS: 'EXHARD GRADE',
};

/** A PRACTICE gauge's name as its source spells it (LR2's DEATH is its HAZARD). */
function practiceGaugeName(source: RulesetId, type: PracticeGaugeType): string {
  return source === 'lr2' && type === 'DEATH'
    ? 'HAZARD'
    : (PRACTICE_GAUGE_NAMES[type] ?? formatGaugeLabel(type) ?? type);
}

/**
 * PRACTICE's GAUGE TYPE under `ruleset`, grouped by source like the play's gauges (ADR 0019): the judge ruleset's own
 * gauges (#933) as bare values, named as that ruleset names them, then each other source's PRACTICE gauges as qualified
 * picks named with their source (`ASSIST EASY (beatoraja)` under LR2), which keep that source's gauge.
 *
 * `selected` is the pick the dialog holds: one qualified with the judge ruleset itself (kept across a ruleset change)
 * plays as the bare gauge does, so it is listed after the own gauges only while it is selected.
 */
export function practiceGaugeItems(
  ruleset: RulesetId,
  selected?: PracticeGaugePick,
): PlayOptionItem<PracticeGaugePick>[] {
  const qualified = (source: RulesetId, type: PracticeGaugeType): PlayOptionItem<PracticeGaugePick> => ({
    text: `${practiceGaugeName(source, type)} (${SOURCE_LABELS[source]})`,
    value: qualifyPracticeGaugePick(source, type),
  });
  const kept = splitPracticeGaugePick(selected);
  return [
    ...resolvePracticeGaugeTypes(ruleset).map((type) => ({ text: practiceGaugeName(ruleset, type), value: type })),
    ...(kept?.source === ruleset ? [qualified(ruleset, kept.type)] : []),
    ...sourceOrder(ruleset)
      .slice(1)
      .flatMap((source) => resolvePracticeGaugeTypes(source).map((type) => qualified(source, type))),
  ];
}

/**
 * The lowest auto-shift gauge under `ruleset`, named as the ruleset's own gauges (#933). LR2 has no ASSIST EASY, so its
 * lowest choice is EASY.
 */
export function bottomShiftableGaugeItems(ruleset: RulesetId): PlayOptionItem<PlayOptions['bottomShiftableGauge']>[] {
  if (ruleset === 'lr2')
    return [
      { text: 'EASY', value: 'EASY' },
      { text: 'GROOVE', value: 'GROOVE' },
    ];
  return [
    { text: ruleset === '____' ? 'ASSISTED EASY' : 'ASSIST EASY', value: 'ASSIST-EASY' },
    { text: 'EASY', value: 'EASY' },
    { text: 'NORMAL', value: 'GROOVE' },
  ];
}

/**
 * The SUDDEN+ and HIDDEN+ covers the menu's Effect, Lane cover and Cover height set, for a running play to take as a
 * `cover-set`. The LIFT stays the play's own, so it is left out.
 */
export function menuLaneCovers(
  options: Pick<PlayOptions, 'hiddenSudden1P' | 'hiddenSudden2P' | 'shutter' | 'laneCover'>,
): Pick<LaneCoverState, 'side' | 'sudden' | 'suddenOn' | 'hidden' | 'hiddenOn'>[] {
  return laneCoversFromPlayOptions(options, ['1P', '2P']).map(({ side, sudden, suddenOn, hidden, hiddenOn }) => ({
    side,
    sudden,
    suddenOn,
    hidden,
    hiddenOn,
  }));
}

/**
 * nanasigroove's NOTES choices for the bar under the cursor. A course keeps one key mode, so a course stage leaves COPY
 * out and DBLCOPY keeps its DOUBLE (ADR 0035): on a course bar COPY and DBLCOPY are shown but cannot be picked, while
 * DOUBLE, which a stage still plays, stays offered. A pick made on a chart bar is kept, so it returns with the chart.
 */
export function crazyNotesItems(course: boolean): PlayOptionItem<PlayOptions['crazyNotes']>[] {
  return [
    { text: 'OFF', value: 'OFF' },
    { text: 'DOUBLE', value: 'DOUBLE' },
    { text: 'COPY', value: 'COPY', ...(course ? { disabled: true } : {}) },
    { text: 'DBLCOPY', value: 'DBLCOPY', ...(course ? { disabled: true } : {}) },
  ];
}
