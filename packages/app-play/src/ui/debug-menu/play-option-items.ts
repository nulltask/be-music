import { resolvePracticeGaugeTypes, splitOptionSource, type RulesetId } from '@be-music/player-engine/ruleset';
import {
  laneCoversFromPlayOptions,
  resolveRandomModes,
  type LaneCoverState,
  type PlayOptions,
  type PracticeGaugeType,
  type RandomMode,
} from '@be-music/player-scene-model';

/** One choice of a Debug Menu list: its label and the value it sets. */
export interface PlayOptionItem<T> {
  text: string;
  value: T;
}

/** How the Debug Menu names each source. */
const SOURCE_LABELS: Readonly<Record<RulesetId, string>> = { lr2: 'LR2', beatoraja: 'beatoraja', ____: '????' };

/** The source of each lane option only one source defines (ADR 0019's registry, as the Debug Menu groups them). */
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
  'SYNCHRONIZE-RANDOM': '____',
  'SYMMETRY-RANDOM': '____',
};

/** How the Debug Menu spells a lane option's name. */
const LANE_OPTION_NAMES: Readonly<Record<string, string>> = {
  'SCATTER-CORRECTED': 'SCATTER 9KEY corrected',
  RANDOM_PLAYABLE: 'RANDOM PLAYABLE',
  S_RANDOM_PLAYABLE: 'S-RANDOM PLAYABLE',
  'SYNCHRONIZE-RANDOM': 'SYNCHRONIZE RANDOM',
  'SYMMETRY-RANDOM': 'SYMMETRY RANDOM',
};

/** The sources in the order the Debug Menu groups them: the judge ruleset's own first. */
function sourceOrder(ruleset: RulesetId): RulesetId[] {
  return [ruleset, ...(['lr2', 'beatoraja', '____'] as const).filter((source) => source !== ruleset)];
}

/** The source a lane option value comes from; `undefined` for OFF and MIRROR, which every source defines alike. */
export function laneOptionSource(mode: RandomMode): RulesetId | undefined {
  return splitOptionSource(mode).source ?? LANE_OPTION_SOURCES[mode];
}

/**
 * The Debug Menu's lane options under `ruleset`, grouped by source (ADR 0019): OFF and MIRROR, then the judge ruleset's
 * own source's options, then the other sources'. Each source-specific option names its source, so `lr2:RANDOM` reads
 * `RANDOM (LR2)` and `beatoraja:RANDOM` reads `RANDOM (beatoraja)`.
 */
export function laneOptionItems(ruleset: RulesetId, duplicatedBattle1P = false): PlayOptionItem<RandomMode>[] {
  const modes = resolveRandomModes(ruleset, duplicatedBattle1P);
  const item = (mode: RandomMode): PlayOptionItem<RandomMode> => {
    const source = laneOptionSource(mode);
    const name = splitOptionSource(mode).name;
    const text = LANE_OPTION_NAMES[name] ?? name;
    return { text: source === undefined ? text : `${text} (${SOURCE_LABELS[source]})`, value: mode };
  };
  return [
    ...modes.filter((mode) => laneOptionSource(mode) === undefined),
    ...sourceOrder(ruleset).flatMap((source) => modes.filter((mode) => laneOptionSource(mode) === source)),
  ].map(item);
}

/**
 * The Debug Menu's battle and conversion modes under `ruleset`, grouped by source like the lane options. BATTLE names
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

/** How the Debug Menu spells each PRACTICE gauge id. */
const PRACTICE_GAUGE_NAMES: Readonly<Partial<Record<PracticeGaugeType, string>>> = {
  'ASSIST-EASY': 'ASSIST EASY',
  'ASSISTED-EASY': 'ASSISTED EASY',
  CLASS: 'GRADE',
  EXCLASS: 'EX GRADE',
  EXHARDCLASS: 'EXHARD GRADE',
  'P-ATTACK': 'P.ATTACK',
  'G-ATTACK': 'G.ATTACK',
};

/**
 * PRACTICE's GAUGE TYPE under `ruleset`: the judge ruleset's own gauges (#933), named as that ruleset names them (LR2's
 * DEATH is its HAZARD).
 */
export function practiceGaugeItems(ruleset: RulesetId): PlayOptionItem<PracticeGaugeType>[] {
  return resolvePracticeGaugeTypes(ruleset).map((value) => ({
    text: ruleset === 'lr2' && value === 'DEATH' ? 'HAZARD' : (PRACTICE_GAUGE_NAMES[value] ?? value),
    value,
  }));
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
