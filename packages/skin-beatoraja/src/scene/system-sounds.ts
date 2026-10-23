import { findCaseInsensitivePath, type BeatorajaSkinFileEntry } from '../file-lookup.ts';

// beatoraja reads its system sounds from `config.json` (`sound_cursor`, `sound_select`, …) and a sound set folder
// (`SystemSoundManager`). A theme dropped into the browser player has neither, so its files are probed for the names
// those sounds conventionally have, the first match winning, case-insensitively; the path returned keeps the file
// map's casing so it plays from the same cache entry as a Lua `audio_play` of it.

/**
 * The select screen's cue paths in a theme's files (bundle-relative), by what each plays on: the cursor moving, a
 * folder opening or closing, a chart or course decided, the sort or a filter changing the list, and backing out at the
 * root. A theme without a file for a cue has none.
 */
export interface BeatorajaSystemSoundPaths {
  /** Stage-failure stop cue. */
  playStop?: string;
  cursor?: string;
  folderOpen?: string;
  folderClose?: string;
  decide?: string;
  optionChange?: string;
  cancel?: string;
}

/**
 * Candidate files per cue, first match first: beatoraja's own names, the That-Which-Must-Not-Be-Named-derived and LR2-derived ones, and LR2's
 * `LR2files/Sound/lr2/*.wav` layout for LR2-compatible themes.
 */
const CUE_CANDIDATES: Readonly<Record<keyof BeatorajaSystemSoundPaths, readonly string[]>> = {
  playStop: ['sound/playstop.wav', 'sound/playstop.ogg', 'LR2files/Sound/lr2/playstop.wav'],
  cursor: [
    'sound/cursor.wav',
    'sound/cursor.ogg',
    'sound/scratch.wav',
    'sound/scratch.ogg',
    'sound/move.wav',
    'sound/move.ogg',
    'LR2files/Sound/lr2/scratch.wav',
  ],
  decide: [
    'sound/decide.wav',
    'sound/decide.ogg',
    'sound/select.wav',
    'sound/select.ogg',
    'sound/start.wav',
    'sound/start.ogg',
    'LR2files/BGM/_common/decide.wav',
  ],
  cancel: ['sound/cancel.wav', 'sound/cancel.ogg', 'sound/back.wav', 'sound/back.ogg', 'LR2files/Sound/lr2/back.wav'],
  folderOpen: [
    'sound/folder_open.wav',
    'sound/folder_open.ogg',
    'sound/f-open.wav',
    'sound/f-open.ogg',
    'sound/open.wav',
    'sound/open.ogg',
    'LR2files/Sound/lr2/f-open.wav',
  ],
  folderClose: [
    'sound/folder_close.wav',
    'sound/folder_close.ogg',
    'sound/f-close.wav',
    'sound/f-close.ogg',
    'sound/close.wav',
    'sound/close.ogg',
    'LR2files/Sound/lr2/f-close.wav',
  ],
  optionChange: [
    'sound/option.wav',
    'sound/option.ogg',
    'sound/o-change.wav',
    'sound/o-change.ogg',
    'sound/change.wav',
    'sound/change.ogg',
    'LR2files/Sound/lr2/o-change.wav',
  ],
};

/** The select screen's cue paths found in a theme's files; a cue without a file is left out. */
export function discoverBeatorajaSystemSoundPaths(
  files: ReadonlyMap<string, BeatorajaSkinFileEntry>,
): BeatorajaSystemSoundPaths {
  const paths: BeatorajaSystemSoundPaths = {};
  for (const cue of Object.keys(CUE_CANDIDATES) as (keyof BeatorajaSystemSoundPaths)[]) {
    for (const candidate of CUE_CANDIDATES[cue]) {
      const found = findCaseInsensitivePath(files, candidate);
      if (found !== undefined) {
        paths[cue] = found;
        break;
      }
    }
  }
  return paths;
}

const SELECT_BGM_CANDIDATES: readonly string[] = [
  'BGM/select.wav',
  'BGM/select.ogg',
  'BGM/select.mp3',
  'bgm/select.wav',
  'bgm/select.ogg',
  'bgm/select.mp3',
  'sound/select_loop.wav',
  'sound/select_loop.ogg',
  'sound/bgm_select.wav',
  'sound/bgm_select.ogg',
  'LR2files/BGM/_common/select.wav',
];

/**
 * The select screen's looping BGM in a theme's files (beatoraja's `bgm_select`): `BGM/select.*`, a `sound/` loop, or
 * LR2's `LR2files/BGM/_common/select.wav`. `undefined` when the theme has none.
 */
export function discoverBeatorajaSelectBGMPath(files: ReadonlyMap<string, BeatorajaSkinFileEntry>): string | undefined {
  for (const candidate of SELECT_BGM_CANDIDATES) {
    const found = findCaseInsensitivePath(files, candidate);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** A jingle a beatoraja theme can ship: the decide splash and the result and course-result ones. */
export type BeatorajaThemeJingle = 'decide' | 'clear' | 'fail' | 'result' | 'courseClear' | 'courseFail';

const JINGLE_AUDIO_EXTENSIONS = ['.wav', '.ogg', '.mp3', '.flac'] as const;

/** Each jingle's file stem; the course ones are beatoraja's `course_clear` / `course_fail`. */
const JINGLE_STEMS: Readonly<Record<BeatorajaThemeJingle, string>> = {
  decide: 'decide',
  clear: 'clear',
  fail: 'fail',
  result: 'result',
  courseClear: 'course_clear',
  courseFail: 'course_fail',
};

/**
 * Picks the file for each jingle from a theme's audio file paths: a stem equal to the jingle's name wins, else the
 * first stem containing it (`decide_v2`, `clear_loop`). A course stem (`course_*`) never stands in for the plain result
 * jingles, and a file taken by one jingle is not reused for another, so `course_clear.wav` or `resultclose.wav` listed
 * before `clear.wav` / `result.wav` cannot take their place. beatoraja plays them from one sound set folder
 * (`SystemSoundManager`), so a stem that turns up in several folders goes to the one holding the most of the jingles'
 * files, then to the shallowest.
 */
export function pickBeatorajaThemeBGMPaths(paths: Iterable<string>): Partial<Record<BeatorajaThemeJingle, string>> {
  const audio: { path: string; stem: string; dir: string; depth: number }[] = [];
  for (const path of paths) {
    const lower = path.toLowerCase();
    if (!JINGLE_AUDIO_EXTENSIONS.some((extension) => lower.endsWith(extension))) continue;
    // Match on the file's basename: `sound/decide.wav`, `<theme-root>/decide.wav` and `LR2files/Sound/<theme>/decide.wav`
    // all count.
    const slash = lower.lastIndexOf('/');
    const base = lower.slice(slash + 1);
    const dir = slash >= 0 ? lower.slice(0, slash) : '';
    audio.push({ path, stem: base.slice(0, base.lastIndexOf('.')), dir, depth: lower.split('/').length });
  }
  const jingles = Object.keys(JINGLE_STEMS) as BeatorajaThemeJingle[];
  const jingleStems = new Set(Object.values(JINGLE_STEMS));
  const stemsByDir = new Map<string, Set<string>>();
  for (const file of audio) {
    if (!jingleStems.has(file.stem)) continue;
    const stems = stemsByDir.get(file.dir) ?? new Set<string>();
    stems.add(file.stem);
    stemsByDir.set(file.dir, stems);
  }
  const setSize = (file: { dir: string }): number => stemsByDir.get(file.dir)?.size ?? 0;
  const picked: Partial<Record<BeatorajaThemeJingle, string>> = {};
  const taken = new Set<string>();
  // Exact stems first, across every jingle, so a loose match can never claim a file another jingle names exactly.
  for (const jingle of jingles) {
    let match: (typeof audio)[number] | undefined;
    for (const file of audio) {
      if (file.stem !== JINGLE_STEMS[jingle] || taken.has(file.path)) continue;
      if (
        match === undefined ||
        setSize(file) > setSize(match) ||
        (setSize(file) === setSize(match) && file.depth < match.depth)
      ) {
        match = file;
      }
    }
    if (match === undefined) continue;
    picked[jingle] = match.path;
    taken.add(match.path);
  }
  for (const jingle of jingles) {
    if (picked[jingle] !== undefined) continue;
    const name = JINGLE_STEMS[jingle];
    const course = name.startsWith('course_');
    const match = audio.find(
      (file) => !taken.has(file.path) && file.stem.includes(name) && (course || !file.stem.startsWith('course')),
    );
    if (match === undefined) continue;
    picked[jingle] = match.path;
    taken.add(match.path);
  }
  return picked;
}
