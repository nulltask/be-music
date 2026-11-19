import { PLAY_MODE_LAYOUTS, type PlayModeLayoutId } from '@be-music/chart-model';

const LAYOUT_BY_KEY_COUNT: Readonly<Record<string, PlayModeLayoutId>> = {
  '5': '5',
  '7': '7',
  '9': '9-pms',
  '10': '10',
  '14': '14',
  '24': '24',
  '48': '48',
};

/** Resolved scratch lanes per lane-mode label; the play-mode table is constant, so a label resolves once. */
const SCRATCH_CHANNELS_BY_LANE_MODE = new Map<string, ReadonlySet<string>>();
/** Bounds the cache, since a replay file may carry any lane-mode spelling. */
const SCRATCH_CHANNELS_CACHE_LIMIT = 64;

/**
 * The scratch lanes of a recorded lane mode: the lanes the play-mode table marks `scratch` in the layout the engine
 * played (`ReplayChart.laneMode` is its label), the same set the engine binds as scratch. Other spellings resolve by
 * their leading key count, as the ruleset reads the lane mode, with 7 KEY for anything else.
 */
export function resolveScratchChannels(laneMode: string): ReadonlySet<string> {
  let channels = SCRATCH_CHANNELS_BY_LANE_MODE.get(laneMode);
  if (channels === undefined) {
    const layout =
      Object.values(PLAY_MODE_LAYOUTS).find((candidate) => candidate.label === laneMode) ??
      PLAY_MODE_LAYOUTS[LAYOUT_BY_KEY_COUNT[/^\d+/.exec(laneMode)?.[0] ?? ''] ?? '7'];
    channels = new Set(layout.lanes.filter((lane) => lane.kind === 'scratch').map((lane) => lane.channel));
    if (SCRATCH_CHANNELS_BY_LANE_MODE.size >= SCRATCH_CHANNELS_CACHE_LIMIT) SCRATCH_CHANNELS_BY_LANE_MODE.clear();
    SCRATCH_CHANNELS_BY_LANE_MODE.set(laneMode, channels);
  }
  return channels;
}
