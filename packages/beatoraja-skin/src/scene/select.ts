import {
  resolveCourseView,
  type BrowseListOptions,
  type BrowseSort,
  type CourseView,
  type KeysFilter,
  type LibraryCourse,
  type LibraryEntry,
} from '@be-music/scene-model';
import { BEATORAJA_BUTTON, BEATORAJA_NUM, BEATORAJA_OP, BEATORAJA_TEXT } from '../runtime-ids.ts';
import { beatorajaMissingCourseStages, resolveBeatorajaCourseBarOps, resolveBeatorajaCourseText } from './course.ts';
import type { BeatorajaNoteBreakdown, BeatorajaWallClock } from './inputs.ts';
import { beatorajaKeysongOp, resolveBeatorajaChartTraitOps, type BeatorajaChartTraits } from './play-ops.ts';
import {
  resolveBeatorajaSkinText,
  resolveBeatorajaSongText,
  joinBeatorajaText,
  type BeatorajaSkinTextInput,
} from './song-text.ts';

/** The key-mode filters in the order of beatoraja's MODE button (`BUTTON_MODE`), which its `modeset` images follow. */
export const BEATORAJA_KEYS_FILTERS: readonly KeysFilter[] = [
  'ALL',
  'KEYS_5',
  'KEYS_7',
  'KEYS_10',
  'KEYS_14',
  'KEYS_9',
  'KEYS_24',
  'KEYS_48',
];

/** The sorts in the order of beatoraja's SORT button (`BUTTON_SORT`), which its `sortset` images follow. */
export const BEATORAJA_SORTS: readonly BrowseSort[] = [
  'OFF',
  'TITLE',
  'ARTIST',
  'GENRE',
  'LEVEL',
  'BPM',
  'NOTES',
  'LASTPLAY',
];

/** A key-mode filter's place on beatoraja's MODE button (0 ALL … 7 24 KEYS DOUBLE). */
export function beatorajaKeysFilterIndex(filter: KeysFilter): number {
  return Math.max(0, BEATORAJA_KEYS_FILTERS.indexOf(filter));
}

/** A sort's place on beatoraja's SORT button; 0 (the library's order) for a sort it does not have (`CLEAR`). */
export function beatorajaSortIndex(sort: BrowseSort): number {
  return Math.max(0, BEATORAJA_SORTS.indexOf(sort));
}

const KEYS_FILTER_BY_VARIANT: Readonly<Record<string, KeysFilter>> = {
  '5': 'KEYS_5',
  '7': 'KEYS_7',
  '9': 'KEYS_9',
  '10': 'KEYS_10',
  '14': 'KEYS_14',
  '24': 'KEYS_24',
  '48': 'KEYS_48',
};

/**
 * A play variant's place on beatoraja's MODE button (`'5'` 1, `'7'` 2, `'10'` 3, `'14'` 4, `'9'` 5, `'24'` 6, `'48'`
 * 7): the filter that lists a chart of that variant. 0 (ALL) for an unknown variant.
 */
export function beatorajaKeyModeIndex(playVariant: string | undefined): number {
  const filter = playVariant !== undefined ? KEYS_FILTER_BY_VARIANT[playVariant] : undefined;
  return filter !== undefined ? beatorajaKeysFilterIndex(filter) : 0;
}

/**
 * The LNMODE button's index (0 LN, 1 CN, 2 HCN) for a chart's `#LNMODE`, which counts from 1 (1 LN, 2 CN, 3 HCN).
 * Charts without the directive, or with a value outside 1..3, read as LN.
 */
export function beatorajaLnModeIndex(lnMode: number | undefined): 0 | 1 | 2 {
  if (lnMode === 2) return 1;
  if (lnMode === 3) return 2;
  return 0;
}

/**
 * The difficulty ops of a chart's `#DIFFICULTY` (1 BEGINNER … 5 INSANE): beatoraja's `LEVEL_*` op (70-74) and LR2's
 * `DIFFICULTY_*` one (151-155), which skins gate on either of. Without a difficulty only `DIFFICULTY_UNDEFINED` (150).
 */
export function beatorajaDifficultyOps(difficulty: number | undefined): number[] {
  switch (difficulty) {
    case 1:
      return [BEATORAJA_OP.LEVEL_BEGINNER, BEATORAJA_OP.DIFFICULTY_BEGINNER];
    case 2:
      return [BEATORAJA_OP.LEVEL_NORMAL, BEATORAJA_OP.DIFFICULTY_NORMAL];
    case 3:
      return [BEATORAJA_OP.LEVEL_HYPER, BEATORAJA_OP.DIFFICULTY_HYPER];
    case 4:
      return [BEATORAJA_OP.LEVEL_ANOTHER, BEATORAJA_OP.DIFFICULTY_ANOTHER];
    case 5:
      return [BEATORAJA_OP.LEVEL_INSANE, BEATORAJA_OP.DIFFICULTY_INSANE];
    default:
      return [BEATORAJA_OP.DIFFICULTY_UNDEFINED];
  }
}

/**
 * The judge-rank op of a chart's `#RANK` (0 VERY HARD … 4 VERY EASY, `JUDGE_*` 180-184); NORMAL for a chart without one
 * or with another value, as beatoraja reads a chart without `#RANK`.
 */
export function beatorajaJudgeRankOp(rank: number | undefined): number {
  switch (rank) {
    case 0:
      return BEATORAJA_OP.JUDGE_VERYHARD;
    case 1:
      return BEATORAJA_OP.JUDGE_HARD;
    case 3:
      return BEATORAJA_OP.JUDGE_EASY;
    case 4:
      return BEATORAJA_OP.JUDGE_VERYEASY;
    default:
      return BEATORAJA_OP.JUDGE_NORMAL;
  }
}

/** Notes per second, as a whole number and its first decimal (numbers 360-365). */
export interface BeatorajaDensityReadout {
  readonly whole: number;
  readonly afterDot: number;
}

/** What the select screen reads of the focused chart beyond its library entry. */
export interface BeatorajaSelectChartFacts {
  readonly playVariant?: string;
  readonly traits: BeatorajaChartTraits;
  /** `#DIFFICULTY`. */
  readonly difficulty?: number;
  /** `#RANK`. */
  readonly judgeRank?: number;
  /** `#TOTAL` as written. */
  readonly total?: number;
  /** `#LNMODE` as written (1 LN, 2 CN, 3 HCN). */
  readonly lnMode?: number;
  /** The sub-artist line. */
  readonly subartist: string;
  readonly noteBreakdown: BeatorajaNoteBreakdown;
  readonly density: {
    readonly peak: BeatorajaDensityReadout;
    readonly end: BeatorajaDensityReadout;
    readonly average: BeatorajaDensityReadout;
  };
  /** The chart's length in seconds. */
  readonly lengthSeconds: number;
  /** The lowest and highest BPM; absent without a positive one. */
  readonly bpmRange?: { readonly min: number; readonly max: number };
}

/**
 * What the select screen's skin reads: the bar under the cursor (with its chart's facts when it is a chart bar), where
 * the list is and how it is shaped, the options the screen keeps, the focused bar's record, and the clock.
 */
export interface BeatorajaSelectInput {
  readonly focused?: LibraryEntry;
  /** The facts of the focused chart; read only on a chart bar. */
  readonly chart?: BeatorajaSelectChartFacts;
  /** The label of the folder the list is in; empty at the root. */
  readonly folderLabel: string;
  /** The search text as typed. */
  readonly searchText: string;
  readonly list: Pick<BrowseListOptions, 'keysFilter' | 'sort'>;
  /** The LNMODE button's choice; the focused chart's `#LNMODE` when absent. */
  readonly lnMode?: 0 | 1 | 2;
  readonly skin?: BeatorajaSkinTextInput;
  /** The skin config's judge timing offset (ms). */
  readonly judgeTiming: number;
  /** The focused bar's best clear lamp, as its op (`beatorajaClearLampOp`); NO PLAY when absent. */
  readonly lampOp?: number;
  readonly wallClock?: BeatorajaWallClock;
}

/**
 * The ops the select screen lights for the bar under the cursor, none without one. With a bar: the screen's fixed state
 * (`LOADED`, `OFFLINE`, `REPLAY_OFF`, `DISABLE_SAVE_SCORE`, `NO_SAVE_CLEAR`, `BGA_ON`), and `FOLDERBAR` on a folder bar,
 * the course bar ops on a course bar ({@link resolveBeatorajaCourseBarOps}), and on a chart bar `SONGBAR`,
 * `PLAYABLEBAR`, its key-mode, trait, difficulty and judge-rank ops and its clear lamp.
 */
export function resolveBeatorajaSelectBarOps(input: BeatorajaSelectInput): number[] {
  const entry = input.focused;
  if (entry === undefined) return [];
  const ops: number[] = [
    BEATORAJA_OP.LOADED,
    BEATORAJA_OP.OFFLINE,
    BEATORAJA_OP.REPLAY_OFF,
    BEATORAJA_OP.DISABLE_SAVE_SCORE,
    BEATORAJA_OP.NO_SAVE_CLEAR,
    BEATORAJA_OP.BGA_ON,
  ];
  switch (entry.kind) {
    case 'folder':
      ops.push(BEATORAJA_OP.FOLDERBAR);
      break;
    case 'course':
      ops.push(...resolveBeatorajaCourseBarOps(entry.course, input.lampOp));
      break;
    case 'song': {
      ops.push(BEATORAJA_OP.SONGBAR, BEATORAJA_OP.PLAYABLEBAR);
      const chart = input.chart;
      const keysong = beatorajaKeysongOp(chart?.playVariant);
      if (keysong !== undefined) ops.push(keysong);
      if (chart !== undefined) {
        ops.push(...resolveBeatorajaChartTraitOps(chart.traits));
        ops.push(...beatorajaDifficultyOps(chart.difficulty));
        ops.push(beatorajaJudgeRankOp(chart.judgeRank));
      }
      ops.push(input.lampOp ?? BEATORAJA_OP.CLEAR_LAMP_NOPLAY);
      break;
    }
  }
  return ops;
}

const COURSE_VIEWS = new WeakMap<LibraryCourse, { view: CourseView; missing: ReadonlySet<number> }>();

function courseView(course: LibraryCourse): { view: CourseView; missing: ReadonlySet<number> } {
  let cached = COURSE_VIEWS.get(course);
  if (cached === undefined) {
    cached = { view: resolveCourseView(course), missing: beatorajaMissingCourseStages(course) };
    COURSE_VIEWS.set(course, cached);
  }
  return cached;
}

/**
 * The select screen's text for the bar under the cursor. A course bar names its stages on 150-159, marking the ones the
 * library lacks. The title and full title read a folder bar's label (`StringPropertyFactory`'s `DirectoryBar` case);
 * the other song texts read empty off a chart bar. The folder text is the chart's folder, else the folder the list is
 * in; the search word is the search text; the difficulty-table texts read empty.
 */
export function resolveBeatorajaSelectText(id: number, input: BeatorajaSelectInput): string | undefined {
  const entry = input.focused;
  if (entry?.kind === 'course') {
    const { view, missing } = courseView(entry.course);
    const courseText = resolveBeatorajaCourseText(id, view, { missingStages: missing });
    if (courseText !== undefined) return courseText;
  }
  const song = entry?.kind === 'song' ? entry.song : undefined;
  const folderLabel = entry?.kind === 'folder' ? entry.folder.label : undefined;
  switch (id) {
    case BEATORAJA_TEXT.TITLE:
      return folderLabel ?? song?.title ?? '';
    case BEATORAJA_TEXT.FULLTITLE:
      return folderLabel ?? joinBeatorajaText(song?.title, song?.subtitle);
    case BEATORAJA_TEXT.SEARCHWORD:
      return input.searchText;
    case BEATORAJA_TEXT.TABLE_NAME:
    case BEATORAJA_TEXT.TABLE_LEVEL:
    case BEATORAJA_TEXT.TABLE_FULL:
      return '';
  }
  const songText = resolveBeatorajaSongText(id, {
    title: song?.title,
    subtitle: song?.subtitle,
    genre: song?.genre,
    artist: song?.artist,
    subartist: song !== undefined ? input.chart?.subartist : undefined,
    directory: song?.directoryLabel ?? input.folderLabel,
  });
  return songText ?? resolveBeatorajaSkinText(id, input.skin);
}

/** `#PLAYLEVEL` as a number: a number as it is, text parsed; `undefined` without a readable one. */
function playLevelNumber(level: number | string | undefined): number | undefined {
  if (typeof level === 'number') return Number.isFinite(level) ? level : undefined;
  if (typeof level === 'string' && level.length > 0) {
    const parsed = Number.parseInt(level, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * The select screen's number for the bar under the cursor, `undefined` to hide it. The folder bar's chart count (300)
 * and the clock (21-26) read on any bar; the rest on a chart bar only: its `#TOTAL` (368), note kinds (350-353),
 * densities (360-365), notes, BPMs and `#PLAYLEVEL`, length (1163 / 1164), and the judge timing offset (12). The
 * play's live numbers read 0 (there is no play on the select screen).
 */
export function resolveBeatorajaSelectNumber(id: number, input: BeatorajaSelectInput): number | undefined {
  const entry = input.focused;
  switch (id) {
    case BEATORAJA_NUM.FOLDER_TOTALSONGS:
      return entry?.kind === 'folder' ? entry.folder.songs.length : undefined;
    case BEATORAJA_NUM.TIME_YEAR:
      return input.wallClock?.year;
    case BEATORAJA_NUM.TIME_MONTH:
      return input.wallClock?.month;
    case BEATORAJA_NUM.TIME_DAY:
      return input.wallClock?.day;
    case BEATORAJA_NUM.TIME_HOUR:
      return input.wallClock?.hour;
    case BEATORAJA_NUM.TIME_MINUTE:
      return input.wallClock?.minute;
    case BEATORAJA_NUM.TIME_SECOND:
      return input.wallClock?.second;
  }
  if (entry?.kind !== 'song') return undefined;
  const song = entry.song;
  const chart = input.chart;
  switch (id) {
    case BEATORAJA_NUM.BMS_TOTAL:
      return chart?.total !== undefined && Number.isFinite(chart.total) ? Math.floor(chart.total) : undefined;
    case BEATORAJA_NUM.TOTALNOTE_NORMAL:
      return chart?.noteBreakdown.normal;
    case BEATORAJA_NUM.TOTALNOTE_LN:
      return chart?.noteBreakdown.ln;
    case BEATORAJA_NUM.TOTALNOTE_SCRATCH:
      return chart?.noteBreakdown.scratch;
    case BEATORAJA_NUM.TOTALNOTE_BSS:
      return chart?.noteBreakdown.bss;
    case BEATORAJA_NUM.DENSITY_PEAK:
      return chart?.density.peak.whole;
    case BEATORAJA_NUM.DENSITY_PEAK_AFTERDOT:
      return chart?.density.peak.afterDot;
    case BEATORAJA_NUM.DENSITY_END:
      return chart?.density.end.whole;
    case BEATORAJA_NUM.DENSITY_END_AFTERDOT:
      return chart?.density.end.afterDot;
    case BEATORAJA_NUM.DENSITY_AVERAGE:
      return chart?.density.average.whole;
    case BEATORAJA_NUM.DENSITY_AVERAGE_AFTERDOT:
      return chart?.density.average.afterDot;
    case BEATORAJA_NUM.TOTALNOTES:
    case BEATORAJA_NUM.TOTALNOTES_LIVE:
      return song.totalNotes;
    case BEATORAJA_NUM.MAINBPM:
    case BEATORAJA_NUM.NOWBPM:
      return song.bpm !== undefined ? Math.round(song.bpm) : undefined;
    case BEATORAJA_NUM.MAXBPM:
      return chart?.bpmRange?.max;
    case BEATORAJA_NUM.MINBPM:
      return chart?.bpmRange?.min;
    case BEATORAJA_NUM.PLAYLEVEL:
      return playLevelNumber(song.playLevel);
    case BEATORAJA_NUM.JUDGETIMING:
      return input.judgeTiming;
    case BEATORAJA_NUM.SONGLENGTH_MINUTE:
      return chart !== undefined ? Math.floor(chart.lengthSeconds / 60) : undefined;
    case BEATORAJA_NUM.SONGLENGTH_SECOND:
      return chart !== undefined ? Math.floor(chart.lengthSeconds) % 60 : undefined;
    case BEATORAJA_NUM.POINT:
    case BEATORAJA_NUM.SCORE2:
    case BEATORAJA_NUM.SCORE_RATE:
    case BEATORAJA_NUM.SCORE_RATE_AFTERDOT:
    case BEATORAJA_NUM.COMBO:
    case BEATORAJA_NUM.MAXCOMBO_LIVE:
    case BEATORAJA_NUM.GROOVEGAUGE:
    case BEATORAJA_NUM.PERFECT:
    case BEATORAJA_NUM.GREAT:
    case BEATORAJA_NUM.GOOD:
    case BEATORAJA_NUM.BAD:
    case BEATORAJA_NUM.POOR:
      return 0;
    default:
      return undefined;
  }
}

/**
 * The image an image set with a `ref` picks on the select screen: the MODE button's filter (11), the SORT button's sort
 * (12), the LNMODE button's choice (308, else the focused chart's `#LNMODE`) and the best clear lamp (370, NO PLAY: no
 * records feed it yet). 0 (the first image) for any other ref.
 */
export function resolveBeatorajaSelectRefValue(ref: number, input: BeatorajaSelectInput): number {
  switch (ref) {
    case BEATORAJA_BUTTON.MODE:
      return beatorajaKeysFilterIndex(input.list.keysFilter);
    case BEATORAJA_BUTTON.SORT:
      return beatorajaSortIndex(input.list.sort);
    case BEATORAJA_BUTTON.LNMODE:
      return input.lnMode ?? beatorajaLnModeIndex(input.focused?.kind === 'song' ? input.chart?.lnMode : undefined);
    case BEATORAJA_NUM.CLEAR:
      return 0;
    default:
      return 0;
  }
}

/**
 * The select screen's slider positions: the volume sliders (17-19) at full, as there is no volume to show yet.
 * `undefined` (the slider at its home) for the others.
 */
export function resolveBeatorajaSelectSliderValue(type: number): number | undefined {
  return type === 17 || type === 18 || type === 19 ? 1 : undefined;
}
