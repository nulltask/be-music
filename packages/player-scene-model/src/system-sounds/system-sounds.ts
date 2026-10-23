import type { BrowseCommand, BrowseEvent } from '../browse/state.ts';
import type { LibraryEntry } from '../library/entries.ts';

/**
 * The sounds a theme gives the screens, whatever skin family it is: the select screen's cues (cursor, decide, cancel,
 * folders, option panels and changes), the looping select BGM and the decide jingle, and the result jingles (clear,
 * fail, the generic result one, and a course run's).
 */
export type SystemSoundSlot =
  | 'cursor'
  | 'decide'
  | 'cancel'
  | 'playStop'
  | 'folderOpen'
  | 'folderClose'
  | 'optionOpen'
  | 'optionClose'
  | 'optionChange'
  | 'selectBGM'
  | 'decideBGM'
  | 'clear'
  | 'fail'
  | 'result'
  | 'courseClear'
  | 'courseFail';

/** Every system sound slot. */
export const SYSTEM_SOUND_SLOTS: readonly SystemSoundSlot[] = [
  'cursor',
  'decide',
  'cancel',
  'playStop',
  'folderOpen',
  'folderClose',
  'optionOpen',
  'optionClose',
  'optionChange',
  'selectBGM',
  'decideBGM',
  'clear',
  'fail',
  'result',
  'courseClear',
  'courseFail',
];

/**
 * One system sound, resolved: its bytes (an LR2 theme's sounds are read up front), or its path in the theme's files to
 * play through the theme's audio (a beatoraja theme's cues), or both.
 */
export type SystemSound =
  | { readonly bytes: Uint8Array; readonly path?: string }
  | { readonly path: string; readonly bytes?: undefined };

/** A theme's system sounds, by slot; a slot the theme does not fill stays silent. */
export type SystemSoundSet = { readonly [S in SystemSoundSlot]?: SystemSound };

/**
 * The slot each command of an LR2 sound set (`LR2files/Sound/*.lr2ss`) fills: `SCRATCH` is the cursor cue, `PANEL_*`
 * the option panel ones, `SELECT` / `DECIDE` the select BGM and the decide jingle. LR2 has no cancel cue and no
 * generic result jingle command.
 */
export const LR2_SOUND_SET_SLOTS: Readonly<Record<string, SystemSoundSlot>> = {
  SELECT: 'selectBGM',
  DECIDE: 'decideBGM',
  FOLDER_OPEN: 'folderOpen',
  FOLDER_CLOSE: 'folderClose',
  PANEL_OPEN: 'optionOpen',
  PANEL_CLOSE: 'optionClose',
  OPTION_CHANGE: 'optionChange',
  CLEAR: 'clear',
  FAIL: 'fail',
  SCRATCH: 'cursor',
  STOP: 'playStop',
  COURSECLEAR: 'courseClear',
  COURSEFAIL: 'courseFail',
};

function compact(entries: ReadonlyArray<readonly [SystemSoundSlot, SystemSound | undefined]>): SystemSoundSet {
  const set: { [S in SystemSoundSlot]?: SystemSound } = {};
  for (const [slot, sound] of entries) {
    if (sound !== undefined) set[slot] = sound;
  }
  return set;
}

/** What a beatoraja theme gives: its cue paths, its select BGM path and its jingles (`BeatorajaThemeBGM`). */
export interface BeatorajaThemeSounds {
  /** The cue paths found in the theme's files (`BeatorajaSelectSystemSoundPaths`). */
  readonly paths?: {
    readonly cursor?: string;
    readonly playStop?: string;
    readonly decide?: string;
    readonly cancel?: string;
    readonly folderOpen?: string;
    readonly folderClose?: string;
    readonly optionChange?: string;
  };
  readonly selectBGMPath?: string;
  /** The jingles read up front, by bytes. */
  readonly bgm?: {
    readonly decide?: Uint8Array;
    readonly clear?: Uint8Array;
    readonly fail?: Uint8Array;
    readonly result?: Uint8Array;
    readonly courseClear?: Uint8Array;
    readonly courseFail?: Uint8Array;
  };
}

function fromPath(path: string | undefined): SystemSound | undefined {
  return path === undefined || path.length === 0 ? undefined : { path };
}

function fromBytes(bytes: Uint8Array | undefined): SystemSound | undefined {
  return bytes === undefined ? undefined : { bytes };
}

/**
 * A beatoraja theme's sounds as a system sound set: the cues and the select BGM by path (they play through the theme's
 * audio, which beatoraja's skins also drive), the jingles by bytes. beatoraja has no option panel cues.
 */
export function systemSoundSetFromBeatoraja(theme: BeatorajaThemeSounds): SystemSoundSet {
  const paths = theme.paths ?? {};
  const bgm = theme.bgm ?? {};
  return compact([
    ['cursor', fromPath(paths.cursor)],
    ['playStop', fromPath(paths.playStop)],
    ['decide', fromPath(paths.decide)],
    ['cancel', fromPath(paths.cancel)],
    ['folderOpen', fromPath(paths.folderOpen)],
    ['folderClose', fromPath(paths.folderClose)],
    ['optionChange', fromPath(paths.optionChange)],
    ['selectBGM', fromPath(theme.selectBGMPath)],
    ['decideBGM', fromBytes(bgm.decide)],
    ['clear', fromBytes(bgm.clear)],
    ['fail', fromBytes(bgm.fail)],
    ['result', fromBytes(bgm.result)],
    ['courseClear', fromBytes(bgm.courseClear)],
    ['courseFail', fromBytes(bgm.courseFail)],
  ]);
}

/** Whether a set has any result jingle (clear, fail, the generic one or a course run's). */
export function hasResultJingle(set: SystemSoundSet): boolean {
  return (
    set.clear !== undefined ||
    set.fail !== undefined ||
    set.result !== undefined ||
    set.courseClear !== undefined ||
    set.courseFail !== undefined
  );
}

/** The jingles a result screen plays: on a clear, on a failure, and the generic one either falls back to. */
export interface ResultJingles {
  readonly clear?: SystemSound;
  readonly fail?: SystemSound;
  readonly result?: SystemSound;
}

/**
 * The jingles a result plays, from the first of `sets` (in order of preference: the theme whose result skin is shown,
 * then the others) that has any result jingle, kept whole as beatoraja plays every result from its one set.
 * `courseJingles` (a course run's result) plays the course-clear / course-fail jingles, falling back to the clear /
 * fail ones as LR2 and beatoraja do.
 */
export function resolveResultJingles(
  sets: readonly (SystemSoundSet | undefined)[],
  courseJingles: boolean,
): ResultJingles {
  const set = sets.find((candidate) => candidate !== undefined && hasResultJingle(candidate)) ?? {};
  const clear = (courseJingles ? set.courseClear : undefined) ?? set.clear;
  const fail = (courseJingles ? set.courseFail : undefined) ?? set.fail;
  return {
    ...(clear !== undefined ? { clear } : {}),
    ...(fail !== undefined ? { fail } : {}),
    ...(set.result !== undefined ? { result: set.result } : {}),
  };
}

/** The jingle a result plays: the clear or the fail one by its verdict, else the generic one. */
export function resolveResultJingle(jingles: ResultJingles, cleared: boolean): SystemSound | undefined {
  return (cleared ? jingles.clear : jingles.fail) ?? jingles.result;
}

/**
 * The cue a select screen plays for a browse command and what it did: the cursor cue on a cursor move, the folder cues
 * on opening and closing a folder, the cancel cue on backing out at the root (beatoraja's), and the option-change cue
 * when the sort or a filter changed the list. A search, a favourite or a command that changed nothing plays none.
 */
export function browseSystemSound(command: BrowseCommand, event: BrowseEvent): SystemSoundSlot | undefined {
  switch (event.kind) {
    case 'cursor':
      return 'cursor';
    case 'folder-opened':
      return 'folderOpen';
    case 'folder-closed':
      return 'folderClose';
    case 'at-root':
      return 'cancel';
    case 'list-changed':
      return command.type === 'list' ? 'optionChange' : undefined;
    case 'favorite':
    case 'none':
      return undefined;
  }
}

/**
 * The cue a select screen plays when the player starts the bar under the cursor: the decide cue for a chart or a
 * playable course, the cancel cue for a course with a stage missing (beatoraja's `MusicSelector` refuses it so), none
 * for a folder (opening it plays the folder cue).
 */
export function startSystemSound(entry: LibraryEntry): SystemSoundSlot | undefined {
  switch (entry.kind) {
    case 'chart':
      return 'decide';
    case 'course':
      return entry.course.playable || entry.course.newCourse === true ? 'decide' : 'cancel';
    case 'folder':
      return undefined;
  }
}
