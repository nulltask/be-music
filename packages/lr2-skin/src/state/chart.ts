import type { BeMusicJSON } from '@be-music/json';
import { resolveLibraryChartKeyMode, type KeyMode, type LibraryChart } from '@be-music/scene-model';
import { LR2_OP, LR2_TEXT } from '../ids/index.ts';

/** What a chart has that LR2's ops 170-179 report. */
export interface LR2ChartFeatures {
  /** A BGA: channel `04`, `06`, `07` or `0A` objects (ops 170 / 171). */
  readonly bga: boolean;
  /** Long notes: `#LNOBJ`, or channel `5x` / `6x` objects (ops 172 / 173). */
  readonly longNote: boolean;
  /** A BPM change: channel `03` or `08` objects (ops 176 / 177). */
  readonly bpmChange: boolean;
  /** A `#RANDOM` or `#SETRANDOM` (ops 178 / 179). */
  readonly random: boolean;
}

const FEATURES_BY_CHART = new WeakMap<BeMusicJSON, LR2ChartFeatures>();

/**
 * The features of a chart LR2's chart ops report, read off its objects and control flow. Kept per chart, since a select
 * screen asks again on every frame.
 */
export function resolveLR2ChartFeatures(chart: BeMusicJSON): LR2ChartFeatures {
  const cached = FEATURES_BY_CHART.get(chart);
  if (cached !== undefined) return cached;
  const features: LR2ChartFeatures = {
    bga: chart.events.some((event) => /^(04|06|07|0a)$/iu.test(event.channel)),
    longNote:
      (chart.bms.lnObjs?.length ?? 0) > 0 ||
      chart.events.some((event) => event.channel.startsWith('5') || event.channel.startsWith('6')),
    bpmChange: chart.events.some((event) => event.channel === '03' || event.channel === '08'),
    random: chart.bms.controlFlow.some(
      (entry) => entry.kind === 'directive' && (entry.command === 'RANDOM' || entry.command === 'SETRANDOM'),
    ),
  };
  FEATURES_BY_CHART.set(chart, features);
  return features;
}

/**
 * LR2's key-mode op for each key mode (160 7 KEYS … 164 9 KEYS). LR2's ops stop at 14 keys — it predates the
 * keyboard modes — so the 24-key modes fold onto the same-shape op (single play onto 7 keys, double onto 14), as the
 * play skins fall back (`PLAY_SKIN_FALLBACKS`), and themes still light a key-mode badge.
 */
const KEY_MODE_OPS: Readonly<Record<KeyMode, number>> = {
  5: LR2_OP.KEYS_5,
  7: LR2_OP.KEYS_7,
  9: LR2_OP.KEYS_9,
  10: LR2_OP.KEYS_10,
  14: LR2_OP.KEYS_14,
  24: LR2_OP.KEYS_7,
  48: LR2_OP.KEYS_14,
};

/** LR2's key-mode op (160-164) for a library chart: its key mode (`resolveLibraryChartKeyMode`), 24-key ones folded. */
export function resolveLR2KeyModeOp(chart: LibraryChart): number {
  return KEY_MODE_OPS[resolveLibraryChartKeyMode(chart)];
}

/** LR2's `#DIFFICULTY` op (150 undefined, 151 BEGINNER … 155 INSANE); a missing or unknown difficulty is undefined. */
export function resolveLR2DifficultyOp(difficulty: number | undefined): number {
  switch (difficulty) {
    case 1:
      return LR2_OP.DIFFICULTY_BEGINNER;
    case 2:
      return LR2_OP.DIFFICULTY_NORMAL;
    case 3:
      return LR2_OP.DIFFICULTY_HYPER;
    case 4:
      return LR2_OP.DIFFICULTY_ANOTHER;
    case 5:
      return LR2_OP.DIFFICULTY_INSANE;
    default:
      return LR2_OP.DIFFICULTY_UNDEFINED;
  }
}

/** LR2's judge-rank op (180 VERY HARD … 183 EASY) for a `#RANK`; a chart without one reads NORMAL. */
export function resolveLR2JudgeRankOp(rank: number | undefined): number {
  switch (rank) {
    case 0:
      return LR2_OP.JUDGE_VERY_HARD;
    case 1:
      return LR2_OP.JUDGE_HARD;
    case 3:
      return LR2_OP.JUDGE_EASY;
    default:
      return LR2_OP.JUDGE_NORMAL;
  }
}

/** A chart's `#PLAYLEVEL` as a number, `undefined` when it has none or it is not a number. */
export function lr2PlayLevel(chart: Pick<LibraryChart, 'playLevel'>): number | undefined {
  const level =
    typeof chart.playLevel === 'number' ? chart.playLevel : Number.parseInt(String(chart.playLevel ?? ''), 10);
  return Number.isFinite(level) ? level : undefined;
}

/**
 * The chart texts LR2 draws for a library chart: the title, subtitle, genre, artist, subartist (bmson `subartists`),
 * tag (empty: be-music keeps no tags), play level and difficulty number (10-18; texts 20-28 repeat them) and the INSANE
 * level (29). `undefined` for any other text.
 */
export function resolveLR2ChartText(st: number, chart: LibraryChart): string | undefined {
  switch (st) {
    case LR2_TEXT.TITLE:
    case LR2_TEXT.TITLE_ALT:
      return chart.title;
    case LR2_TEXT.SUBTITLE:
    case LR2_TEXT.SUBTITLE_ALT:
      return chart.subtitle ?? '';
    case LR2_TEXT.FULL_TITLE:
    case LR2_TEXT.FULL_TITLE_ALT:
      return [chart.title, chart.subtitle].filter((value): value is string => Boolean(value)).join(' ');
    case LR2_TEXT.GENRE:
    case LR2_TEXT.GENRE_ALT:
      return chart.genre ?? '';
    case LR2_TEXT.ARTIST:
    case LR2_TEXT.ARTIST_ALT:
      return chart.artist ?? '';
    case LR2_TEXT.SUBARTIST:
    case LR2_TEXT.SUBARTIST_ALT:
      return chart.chart.bmson.info?.subartists?.join(' / ') ?? '';
    case LR2_TEXT.TAG:
    case LR2_TEXT.TAG_ALT:
      // LR2's song database tag: be-music keeps none.
      return '';
    case LR2_TEXT.PLAY_LEVEL:
    case LR2_TEXT.PLAY_LEVEL_ALT:
      return chart.playLevel?.toString() ?? '';
    case LR2_TEXT.DIFFICULTY:
    case LR2_TEXT.DIFFICULTY_ALT:
      // The `#DIFFICULTY` number, as LR2 draws it; the difficulty ops (150-155) name it.
      return chart.chart.metadata.difficulty?.toString() ?? '';
    case LR2_TEXT.INSANE_LEVEL:
      // No insane-table level of its own: an INSANE chart's play level.
      return chart.chart.metadata.difficulty === 5 ? (chart.playLevel?.toString() ?? '') : '';
    default:
      return undefined;
  }
}
