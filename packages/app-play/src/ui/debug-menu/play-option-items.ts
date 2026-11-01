import { splitOptionSource, type RulesetId } from '@be-music/player-engine/ruleset';
import { resolveRandomModes, type PlayOptions, type RandomMode } from '@be-music/player-scene-model';

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
