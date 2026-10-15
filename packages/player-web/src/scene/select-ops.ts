import { dirname } from '@be-music/utils/core';
import { resolveChartPlayVariant, resolveSongSource } from '../collection/collection.ts';
import type { BrowserSongCollection, BrowserSongEntry } from '../collection/types.ts';
import type { Lr2BarLampKind } from '@be-music/lr2-skin';
import type { BeMusicClearLamp } from '../skin/be-music/types.ts';
import type { PixiGaugeType, PixiPlayOptions } from './core/select.ts';

/**
 * Globally-true ops that hold regardless of which song is focused: filter / mode toggles, gauge defaults, "no rival"
 * fallbacks, etc.
 */
export const SELECT_BASE_OPS: ReadonlySet<number> = new Set<number>([
  32, // autoplay off
  34, // ghost off
  50, // offline (no IR connection yet)
  52, // EXTRA MODE OFF
  60, // save impossible (no persistence yet)
  62, // clear save impossible (no persistence yet)
  81, // load complete
  82, // replay off
]);

/**
 * Op slots that LR2 select skins flip per-song. The numeric values match `dst_option` in `docs/LR2SkinHelp.md`.
 */
export const SELECT_DYNAMIC_OPS = {
  BAR_IS_FOLDER: 1,
  BAR_IS_SONG: 2,
  BAR_IS_COURSE: 3,
  BAR_IS_NEW_COURSE: 4,
  BAR_IS_PLAYABLE: 5,
  KEYS_7: 160,
  KEYS_5: 161,
  KEYS_14: 162,
  KEYS_10: 163,
  KEYS_9: 164,
  BGA_ABSENT: 170,
  BGA_PRESENT: 171,
  LN_ABSENT: 172,
  LN_PRESENT: 173,
  TEXT_ABSENT: 174,
  TEXT_PRESENT: 175,
  BPM_CHANGE_ABSENT: 176,
  BPM_CHANGE_PRESENT: 177,
  RANDOM_ABSENT: 178,
  RANDOM_PRESENT: 179,
  JUDGE_VERY_HARD: 180,
  JUDGE_HARD: 181,
  JUDGE_NORMAL: 182,
  JUDGE_EASY: 183,
  STAGEFILE_ABSENT: 190,
  STAGEFILE_PRESENT: 191,
  BANNER_ABSENT: 192,
  BANNER_PRESENT: 193,
  BACKBMP_ABSENT: 194,
  BACKBMP_PRESENT: 195,
  REPLAY_ABSENT: 196,
  REPLAY_PRESENT: 197,
  LAMP_NOT_PLAYED: 100,
  LAMP_FAILED: 101,
  LAMP_EASY: 102,
  LAMP_NORMAL: 103,
  LAMP_HARD: 104,
  LAMP_FULL_COMBO: 105,
  RANK_AAA: 110,
  RANK_AA: 111,
  RANK_A: 112,
  RANK_B: 113,
  RANK_C: 114,
  RANK_D: 115,
  RANK_E: 116,
  RANK_F: 117,
  DIFFICULTY_UNDEFINED: 150,
  DIFFICULTY_EASY: 151,
  DIFFICULTY_NORMAL: 152,
  DIFFICULTY_HYPER: 153,
  DIFFICULTY_ANOTHER: 154,
  DIFFICULTY_INSANE: 155,
} as const;

/**
 * Mapping from select key filter → LR2 keymode op.
 */
export const SELECT_KEYS_FILTER_TO_OP = {
  KEYS_5: SELECT_DYNAMIC_OPS.KEYS_5,
  KEYS_7: SELECT_DYNAMIC_OPS.KEYS_7,
  KEYS_9: SELECT_DYNAMIC_OPS.KEYS_9,
  KEYS_10: SELECT_DYNAMIC_OPS.KEYS_10,
  KEYS_14: SELECT_DYNAMIC_OPS.KEYS_14,
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
  songLamp?: BeMusicClearLamp,
): ReadonlySet<number> {
  const ops = new Set<number>(SELECT_BASE_OPS);
  for (const which of panelStates) {
    if (which >= 1 && which <= 9) ops.add(which);
  }
  for (const option of customOptions) {
    ops.add(option.defaultOp);
  }

  const bgaActive = playOptions.bga === 'ON' || (playOptions.bga === 'AUTOPLAY_ONLY' && playOptions.autoPlay);
  ops.add(bgaActive ? 41 : 40);
  ops.add(playOptions.bgaSize === 'EXTEND' ? 31 : 30);
  ops.add(playOptions.scoreGraph ? 39 : 38);
  ops.add(playOptions.autoScratch1P ? 55 : 54);
  ops.add(playOptions.autoScratch2P ? 57 : 56);
  ops.add(isRedGauge(playOptions.gauge1P) ? 43 : 42);
  ops.add(isRedGauge(playOptions.gauge2P) ? 45 : 44);
  ops.add(playOptions.difficultyFilter !== 'ALL' ? 46 : 47);

  if (!song) {
    addAbsentSongOps(ops);
    return ops;
  }

  ops.add(SELECT_DYNAMIC_OPS.BAR_IS_SONG);
  ops.add(SELECT_DYNAMIC_OPS.BAR_IS_PLAYABLE);
  ops.add(resolveKeyModeOp(song));

  const features = detectChartFeatures(song);
  ops.add(features.bga ? SELECT_DYNAMIC_OPS.BGA_PRESENT : SELECT_DYNAMIC_OPS.BGA_ABSENT);
  ops.add(features.longNote ? SELECT_DYNAMIC_OPS.LN_PRESENT : SELECT_DYNAMIC_OPS.LN_ABSENT);
  const hasReadtext = collection !== undefined && hasReadtextForSong(collection, song);
  ops.add(hasReadtext ? SELECT_DYNAMIC_OPS.TEXT_PRESENT : SELECT_DYNAMIC_OPS.TEXT_ABSENT);
  ops.add(features.bpmChange ? SELECT_DYNAMIC_OPS.BPM_CHANGE_PRESENT : SELECT_DYNAMIC_OPS.BPM_CHANGE_ABSENT);
  ops.add(features.random ? SELECT_DYNAMIC_OPS.RANDOM_PRESENT : SELECT_DYNAMIC_OPS.RANDOM_ABSENT);

  ops.add(resolveJudgeRankOp(song));
  ops.add(resolveDifficultyOp(song));
  ops.add(song.chart.metadata.stageFile ? SELECT_DYNAMIC_OPS.STAGEFILE_PRESENT : SELECT_DYNAMIC_OPS.STAGEFILE_ABSENT);
  ops.add(song.chart.metadata.banner ? SELECT_DYNAMIC_OPS.BANNER_PRESENT : SELECT_DYNAMIC_OPS.BANNER_ABSENT);
  ops.add(song.chart.metadata.backBmp ? SELECT_DYNAMIC_OPS.BACKBMP_PRESENT : SELECT_DYNAMIC_OPS.BACKBMP_ABSENT);
  ops.add(SELECT_DYNAMIC_OPS.REPLAY_ABSENT);
  ops.add(resolveLr2LampOp(songLamp));

  return ops;
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
  ops.add(SELECT_DYNAMIC_OPS.BGA_ABSENT);
  ops.add(SELECT_DYNAMIC_OPS.LN_ABSENT);
  ops.add(SELECT_DYNAMIC_OPS.TEXT_ABSENT);
  ops.add(SELECT_DYNAMIC_OPS.BPM_CHANGE_ABSENT);
  ops.add(SELECT_DYNAMIC_OPS.RANDOM_ABSENT);
  ops.add(SELECT_DYNAMIC_OPS.STAGEFILE_ABSENT);
  ops.add(SELECT_DYNAMIC_OPS.BANNER_ABSENT);
  ops.add(SELECT_DYNAMIC_OPS.BACKBMP_ABSENT);
  ops.add(SELECT_DYNAMIC_OPS.REPLAY_ABSENT);
  ops.add(SELECT_DYNAMIC_OPS.JUDGE_NORMAL);
  ops.add(SELECT_DYNAMIC_OPS.LAMP_NOT_PLAYED);
  ops.add(SELECT_DYNAMIC_OPS.DIFFICULTY_UNDEFINED);
  ops.add(SELECT_DYNAMIC_OPS.KEYS_7);
}

function resolveJudgeRankOp(song: BrowserSongEntry): number {
  const rank = song.chart.metadata.rank;
  switch (rank) {
    case 0:
      return SELECT_DYNAMIC_OPS.JUDGE_VERY_HARD;
    case 1:
      return SELECT_DYNAMIC_OPS.JUDGE_HARD;
    case 2:
      return SELECT_DYNAMIC_OPS.JUDGE_NORMAL;
    case 3:
      return SELECT_DYNAMIC_OPS.JUDGE_EASY;
    default:
      return SELECT_DYNAMIC_OPS.JUDGE_NORMAL;
  }
}

function resolveDifficultyOp(song: BrowserSongEntry): number {
  switch (song.chart.metadata.difficulty) {
    case 1:
      return SELECT_DYNAMIC_OPS.DIFFICULTY_EASY;
    case 2:
      return SELECT_DYNAMIC_OPS.DIFFICULTY_NORMAL;
    case 3:
      return SELECT_DYNAMIC_OPS.DIFFICULTY_HYPER;
    case 4:
      return SELECT_DYNAMIC_OPS.DIFFICULTY_ANOTHER;
    case 5:
      return SELECT_DYNAMIC_OPS.DIFFICULTY_INSANE;
    default:
      return SELECT_DYNAMIC_OPS.DIFFICULTY_UNDEFINED;
  }
}

const KEY_MODE_OP_CACHE = new WeakMap<BrowserSongEntry, number>();

function computeKeyModeOp(song: BrowserSongEntry): number {
  const modeHint = song.chart.bmson.info?.modeHint?.toLowerCase() ?? '';
  if (modeHint.includes('14k')) return SELECT_DYNAMIC_OPS.KEYS_14;
  if (modeHint.includes('10k')) return SELECT_DYNAMIC_OPS.KEYS_10;
  if (modeHint.includes('9k')) return SELECT_DYNAMIC_OPS.KEYS_9;
  if (modeHint.includes('7k')) return SELECT_DYNAMIC_OPS.KEYS_7;
  if (modeHint.includes('5k')) return SELECT_DYNAMIC_OPS.KEYS_5;

  const variant = resolveChartPlayVariant(song);
  switch (variant) {
    case '5':
      return SELECT_DYNAMIC_OPS.KEYS_5;
    case '7':
      return SELECT_DYNAMIC_OPS.KEYS_7;
    case '9':
      return SELECT_DYNAMIC_OPS.KEYS_9;
    case '10':
      return SELECT_DYNAMIC_OPS.KEYS_10;
    case '14':
      return SELECT_DYNAMIC_OPS.KEYS_14;
    // LR2's `#OP` space stops at 5 / 7 / 9 / 10 / 14 keys — it predates the Keyboardmania modes entirely. Fold them
    // onto the closest same-shape op (SP → 7 keys, DP → 14 keys) so themes keep lighting a keys badge instead of
    // rendering none; the same SP / DP pairing drives `pickLr2PlaySkin`'s fallback chain.
    case '24':
      return SELECT_DYNAMIC_OPS.KEYS_7;
    case '48':
      return SELECT_DYNAMIC_OPS.KEYS_14;
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

function isRedGauge(type: PixiGaugeType): boolean {
  return type === 'HARD' || type === 'DEATH';
}

/** LR2's six clear lamps (`#SRC_BAR_LAMP` kinds, ops 100-105) for each of the host's lamps. */
const LR2_LAMP_KINDS: Readonly<Record<BeMusicClearLamp, Lr2BarLampKind>> = {
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

const LR2_LAMP_KIND_ORDER: readonly Lr2BarLampKind[] = ['noplay', 'failed', 'easy', 'clear', 'hard', 'fullcombo'];

/**
 * The LR2 clear lamp of a best record (`#SRC_BAR_LAMP` kind): LR2 has one lamp below NORMAL (EASY, which ASSIST EASY
 * joins), one above it (HARD, which EX HARD joins) and FULL COMBO for PERFECT and MAX too. No record reads `noplay`.
 */
export function resolveLr2BarLampKind(lamp: BeMusicClearLamp | undefined): Lr2BarLampKind {
  return lamp === undefined ? 'noplay' : LR2_LAMP_KINDS[lamp];
}

/** LR2's select op for the selected bar's clear lamp (100 NO PLAY … 105 FULL COMBO). */
export function resolveLr2LampOp(lamp: BeMusicClearLamp | undefined): number {
  return SELECT_DYNAMIC_OPS.LAMP_NOT_PLAYED + LR2_LAMP_KIND_ORDER.indexOf(resolveLr2BarLampKind(lamp));
}
