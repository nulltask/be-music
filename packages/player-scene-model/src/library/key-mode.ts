import { resolveGenericBmsonKeyCount, resolveChartPlayVariant, type ChartPlayVariant } from '@be-music/chart-model';
import type { BeMusicJSON } from '@be-music/chart-source';
import type { LibraryChart } from './entries.ts';

/**
 * Play variant per chart object. Select screens filter the whole library by key mode, and library charts keep their
 * events packed, so recomputing the variant would unpack every chart on each filter pass. Keyed by chart identity plus
 * the path the answer was computed for, since the variant also depends on the file extension.
 */
const PLAY_VARIANT_BY_CHART = new WeakMap<BeMusicJSON, { chartPath: string; variant: ChartPlayVariant }>();

/**
 * A library chart's play variant (`5` / `7` / `9` / `10` / `14` / `24` / `48`), which picks the play skin and lane
 * layout: `@be-music/chart-model`'s `resolveChartPlayVariant` (the lane-mode rule the engine and the CLI use too) fed with the
 * chart's path (for the `.pms` extension rule), events and `#PLAYER`, cached per chart.
 *
 * `chart` defaults to the parsed chart, which is what the select screen sees before any `#RANDOM` roll. A gameplay
 * scene passes the chart it resolved for the play instead, so lanes added by the chosen `#RANDOM` / `#SWITCH` branch
 * count toward the variant.
 */
export function resolveLibraryChartPlayVariant(
  entry: LibraryChart,
  chart: BeMusicJSON = entry.chart,
): ChartPlayVariant {
  const cached = PLAY_VARIANT_BY_CHART.get(chart);
  if (cached !== undefined && cached.chartPath === entry.chartPath) return cached.variant;
  const variant = resolveChartPlayVariant({
    chartPath: entry.chartPath,
    events: chart.events,
    bms: chart.bms,
    bmson: chart.bmson,
  });
  PLAY_VARIANT_BY_CHART.set(chart, { chartPath: entry.chartPath, variant });
  return variant;
}

/**
 * Records a chart's play variant worked out elsewhere, so the first {@link resolveLibraryChartPlayVariant} of it does
 * not resolve it again: a library loader that resolved it while counting the notes keeps the answer before it packs the
 * chart's events.
 */
export function seedLibraryChartPlayVariant(
  entry: Pick<LibraryChart, 'chartPath' | 'chart'>,
  variant: ChartPlayVariant,
): void {
  PLAY_VARIANT_BY_CHART.set(entry.chart, { chartPath: entry.chartPath, variant });
}

/** How many keys a chart is played with: the key mode a key-mode filter lists it under. */
export type KeyMode = number;

/** The key counts a bmson `mode_hint` can name (`beat-7k`, `popn-9k`, `beat-14k`, …), in the order they are tried. */
const MODE_HINT_KEY_MODES: ReadonlyArray<readonly [string, KeyMode]> = [
  ['14k', 14],
  ['10k', 10],
  ['9k', 9],
  ['7k', 7],
  ['5k', 5],
];

const PLAY_VARIANT_KEY_MODES: Readonly<Record<ChartPlayVariant, KeyMode>> = {
  '5': 5,
  '7': 7,
  '9': 9,
  '10': 10,
  '14': 14,
  '24': 24,
  '48': 48,
};

/**
 * The key mode a library chart is listed under: the one a bmson chart's `mode_hint` names (`beat-7k`, `popn-9k`, …),
 * else its play variant ({@link resolveLibraryChartPlayVariant}). A 24-key chart is its own mode (24, or 48 for double
 * play) rather than folded onto 7 keys.
 */
export function resolveLibraryChartKeyMode(entry: LibraryChart): KeyMode {
  const genericKeys = resolveGenericBmsonKeyCount(entry.chart.bmson.info?.modeHint);
  if (genericKeys !== undefined) return genericKeys;
  const hint = entry.chart.bmson.info?.modeHint?.toLowerCase() ?? '';
  for (const [needle, keyMode] of MODE_HINT_KEY_MODES) {
    if (hint.includes(needle)) return keyMode;
  }
  return PLAY_VARIANT_KEY_MODES[resolveLibraryChartPlayVariant(entry)];
}
