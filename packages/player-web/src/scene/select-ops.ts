import { dirname } from '@be-music/utils/core';
import { resolveChartPlayVariant, resolveSongSource } from '../collection/collection.ts';
import type { BrowserSongCollection, BrowserSongEntry } from '../collection/types.ts';
import type { Lr2BarLampKind } from '@be-music/lr2-skin';
import { LR2_BAR_LAMP_KINDS, LR2_OP } from '@be-music/lr2-skin/ids';
import type { ClearLamp, GaugeType } from '@be-music/player/ruleset';
import type { PixiPlayOptions } from './core/select.ts';

/**
 * Globally-true ops that hold regardless of which song is focused: filter / mode toggles, gauge defaults, "no rival"
 * fallbacks, etc.
 */
export const SELECT_BASE_OPS: ReadonlySet<number> = new Set<number>([
  LR2_OP.AUTOPLAY_OFF,
  LR2_OP.GHOST_OFF,
  // No internet-ranking connection yet.
  LR2_OP.OFFLINE,
  LR2_OP.EXTRA_MODE_OFF,
  // No persistence yet: neither the score nor the clear lamp can be saved.
  LR2_OP.SCORE_SAVE_OFF,
  LR2_OP.CLEAR_SAVE_OFF,
  LR2_OP.LOADED,
  LR2_OP.REPLAY_OFF,
]);

/**
 * Mapping from select key filter → LR2 keymode op. LR2's op space stops at 14 keys, so the 24-key filters (beatoraja's)
 * fold onto the same-shape ops, as {@link resolveKeyModeOp} folds the 24-key charts.
 */
export const SELECT_KEYS_FILTER_TO_OP = {
  KEYS_5: LR2_OP.KEYS_5,
  KEYS_7: LR2_OP.KEYS_7,
  KEYS_9: LR2_OP.KEYS_9,
  KEYS_10: LR2_OP.KEYS_10,
  KEYS_14: LR2_OP.KEYS_14,
  KEYS_24: LR2_OP.KEYS_7,
  KEYS_48: LR2_OP.KEYS_14,
} as const;

/**
 * Builds the full op set used to gate select-screen DST elements. `songLamp` is the best lamp of the player's record on
 * `song` (ops 100-105); without one the song reads as never played.
 */
export function computeSelectOps(
  song: BrowserSongEntry | undefined,
  panelStates: ReadonlySet<number>,
  playOptions: PixiPlayOptions,
  customOptions: ReadonlyArray<{ defaultOp: number }> = [],
  collection?: BrowserSongCollection,
  songLamp?: ClearLamp,
): ReadonlySet<number> {
  const ops = new Set<number>(SELECT_BASE_OPS);
  for (const which of panelStates) {
    if (which >= 1 && which <= 9) ops.add(which);
  }
  for (const option of customOptions) {
    ops.add(option.defaultOp);
  }

  const bgaActive = playOptions.bga === 'ON' || (playOptions.bga === 'AUTOPLAY_ONLY' && playOptions.autoPlay);
  ops.add(bgaActive ? LR2_OP.BGA_ON : LR2_OP.BGA_OFF);
  ops.add(playOptions.bgaSize === 'EXTEND' ? LR2_OP.BGA_EXTEND : LR2_OP.BGA_NORMAL);
  ops.add(playOptions.scoreGraph ? LR2_OP.SCORE_GRAPH_ON : LR2_OP.SCORE_GRAPH_OFF);
  ops.add(playOptions.autoScratch1P ? LR2_OP.AUTO_SCRATCH_1P_ON : LR2_OP.AUTO_SCRATCH_1P_OFF);
  ops.add(playOptions.autoScratch2P ? LR2_OP.AUTO_SCRATCH_2P_ON : LR2_OP.AUTO_SCRATCH_2P_OFF);
  ops.add(isRedGauge(playOptions.gauge1P) ? LR2_OP.GAUGE_1P_RED : LR2_OP.GAUGE_1P_NORMAL);
  ops.add(isRedGauge(playOptions.gauge2P) ? LR2_OP.GAUGE_2P_RED : LR2_OP.GAUGE_2P_NORMAL);
  ops.add(playOptions.difficultyFilter !== 'ALL' ? LR2_OP.DIFFICULTY_FILTER_ON : LR2_OP.DIFFICULTY_FILTER_OFF);

  if (!song) {
    addAbsentSongOps(ops);
    return ops;
  }

  ops.add(LR2_OP.SONG_BAR);
  ops.add(LR2_OP.PLAYABLE_BAR);
  ops.add(resolveKeyModeOp(song));

  const features = detectChartFeatures(song);
  ops.add(features.bga ? LR2_OP.HAS_BGA : LR2_OP.NO_BGA);
  ops.add(features.longNote ? LR2_OP.HAS_LN : LR2_OP.NO_LN);
  const hasReadtext = collection !== undefined && hasReadtextForSong(collection, song);
  ops.add(hasReadtext ? LR2_OP.HAS_TEXT : LR2_OP.NO_TEXT);
  ops.add(features.bpmChange ? LR2_OP.HAS_BPM_CHANGE : LR2_OP.NO_BPM_CHANGE);
  ops.add(features.random ? LR2_OP.HAS_RANDOM : LR2_OP.NO_RANDOM);

  ops.add(resolveJudgeRankOp(song));
  ops.add(resolveDifficultyOp(song));
  ops.add(song.chart.metadata.stageFile ? LR2_OP.HAS_STAGEFILE : LR2_OP.NO_STAGEFILE);
  ops.add(song.chart.metadata.banner ? LR2_OP.HAS_BANNER : LR2_OP.NO_BANNER);
  ops.add(song.chart.metadata.backBmp ? LR2_OP.HAS_BACKBMP : LR2_OP.NO_BACKBMP);
  ops.add(LR2_OP.NO_REPLAY);
  ops.add(resolveLr2LampOp(songLamp));

  return ops;
}

/** The key count each LR2 key-mode op stands for. */
const KEY_MODE_OP_KEYS: Readonly<Record<number, number>> = {
  [LR2_OP.KEYS_7]: 7,
  [LR2_OP.KEYS_5]: 5,
  [LR2_OP.KEYS_14]: 14,
  [LR2_OP.KEYS_10]: 10,
  [LR2_OP.KEYS_9]: 9,
};

/**
 * Whether a course bar stays listed under a key-mode filter (its LR2 op, {@link SELECT_KEYS_FILTER_TO_OP}): LR2 lists
 * only the courses of the filter's key mode (OpenLR2 L18030-L18053, `WHERE line=…`). A course that names no key mode
 * (`definition.keyMode`, e.g. a beatoraja course) and a NEW COURSE bar stay listed.
 */
export function courseMatchesKeysFilter(
  course: { definition: { keyMode?: number }; newCourse?: true },
  filterOp: number,
): boolean {
  const keyMode = course.definition.keyMode;
  if (keyMode === undefined || course.newCourse === true) return true;
  return KEY_MODE_OP_KEYS[filterOp] === keyMode;
}

export function resolveKeyModeOp(song: BrowserSongEntry): number {
  const cached = KEY_MODE_OP_CACHE.get(song);
  if (cached !== undefined) return cached;
  const computed = computeKeyModeOp(song);
  KEY_MODE_OP_CACHE.set(song, computed);
  return computed;
}

export function detectChartFeatures(song: BrowserSongEntry): {
  bga: boolean;
  longNote: boolean;
  bpmChange: boolean;
  random: boolean;
} {
  const chart = song.chart;
  const bga = chart.events.some((event) => /^(04|06|07|0a)$/iu.test(event.channel));
  const longNote =
    (chart.bms.lnObjs?.length ?? 0) > 0 ||
    chart.events.some((event) => event.channel.startsWith('5') || event.channel.startsWith('6'));
  const bpmChange = chart.events.some((event) => event.channel === '03' || event.channel === '08');
  const random = chart.bms.controlFlow.some(
    (entry) => entry.kind === 'directive' && (entry.command === 'RANDOM' || entry.command === 'SETRANDOM'),
  );
  return { bga, longNote, bpmChange, random };
}

function addAbsentSongOps(ops: Set<number>): void {
  ops.add(LR2_OP.NO_BGA);
  ops.add(LR2_OP.NO_LN);
  ops.add(LR2_OP.NO_TEXT);
  ops.add(LR2_OP.NO_BPM_CHANGE);
  ops.add(LR2_OP.NO_RANDOM);
  ops.add(LR2_OP.NO_STAGEFILE);
  ops.add(LR2_OP.NO_BANNER);
  ops.add(LR2_OP.NO_BACKBMP);
  ops.add(LR2_OP.NO_REPLAY);
  ops.add(LR2_OP.JUDGE_NORMAL);
  ops.add(LR2_OP.LAMP_NO_PLAY);
  ops.add(LR2_OP.DIFFICULTY_UNDEFINED);
  ops.add(LR2_OP.KEYS_7);
}

function resolveJudgeRankOp(song: BrowserSongEntry): number {
  const rank = song.chart.metadata.rank;
  switch (rank) {
    case 0:
      return LR2_OP.JUDGE_VERY_HARD;
    case 1:
      return LR2_OP.JUDGE_HARD;
    case 2:
      return LR2_OP.JUDGE_NORMAL;
    case 3:
      return LR2_OP.JUDGE_EASY;
    default:
      return LR2_OP.JUDGE_NORMAL;
  }
}

function resolveDifficultyOp(song: BrowserSongEntry): number {
  switch (song.chart.metadata.difficulty) {
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

const KEY_MODE_OP_CACHE = new WeakMap<BrowserSongEntry, number>();

function computeKeyModeOp(song: BrowserSongEntry): number {
  const modeHint = song.chart.bmson.info?.modeHint?.toLowerCase() ?? '';
  if (modeHint.includes('14k')) return LR2_OP.KEYS_14;
  if (modeHint.includes('10k')) return LR2_OP.KEYS_10;
  if (modeHint.includes('9k')) return LR2_OP.KEYS_9;
  if (modeHint.includes('7k')) return LR2_OP.KEYS_7;
  if (modeHint.includes('5k')) return LR2_OP.KEYS_5;

  const variant = resolveChartPlayVariant(song);
  switch (variant) {
    case '5':
      return LR2_OP.KEYS_5;
    case '7':
      return LR2_OP.KEYS_7;
    case '9':
      return LR2_OP.KEYS_9;
    case '10':
      return LR2_OP.KEYS_10;
    case '14':
      return LR2_OP.KEYS_14;
    // LR2's `#OP` space stops at 5 / 7 / 9 / 10 / 14 keys — it predates the Keyboardmania modes entirely. Fold them
    // onto the closest same-shape op (SP → 7 keys, DP → 14 keys) so themes keep lighting a keys badge instead of
    // rendering none; the same SP / DP pairing drives `pickLr2PlaySkin`'s fallback chain.
    case '24':
      return LR2_OP.KEYS_7;
    case '48':
      return LR2_OP.KEYS_14;
  }
}

function hasReadtextForSong(collection: BrowserSongCollection, song: BrowserSongEntry): boolean {
  const source = resolveSongSource(collection, song);
  if (!source) return false;
  const dir = dirname(song.chartPath).toLowerCase();
  for (const path of source.files.keys()) {
    if (!path.toLowerCase().endsWith('.txt')) continue;
    if (dirname(path).toLowerCase() === dir) return true;
  }
  return false;
}

function isRedGauge(type: GaugeType): boolean {
  return type === 'HARD' || type === 'DEATH';
}

/** LR2's six clear lamps (`#SRC_BAR_LAMP` kinds, ops 100-105) for each of the host's lamps. */
const LR2_LAMP_KINDS: Readonly<Record<ClearLamp, Lr2BarLampKind>> = {
  NO_PLAY: 'noplay',
  FAILED: 'failed',
  ASSIST_EASY: 'easy',
  EASY: 'easy',
  NORMAL: 'clear',
  HARD: 'hard',
  EX_HARD: 'hard',
  FULL_COMBO: 'fullcombo',
  PERFECT: 'fullcombo',
  MAX: 'fullcombo',
};

/**
 * The LR2 clear lamp of a best record (`#SRC_BAR_LAMP` kind): LR2 has one lamp below NORMAL (EASY, which ASSIST EASY
 * joins), one above it (HARD, which EX HARD joins) and FULL COMBO for PERFECT and MAX too. No record reads `noplay`.
 */
export function resolveLr2BarLampKind(lamp: ClearLamp | undefined): Lr2BarLampKind {
  return lamp === undefined ? 'noplay' : LR2_LAMP_KINDS[lamp];
}

/** LR2's select op for the selected bar's clear lamp (100 NO PLAY … 105 FULL COMBO). */
export function resolveLr2LampOp(lamp: ClearLamp | undefined): number {
  return LR2_OP.LAMP_NO_PLAY + LR2_BAR_LAMP_KINDS.indexOf(resolveLr2BarLampKind(lamp));
}
