import { decodeText, parseRows } from './csv.ts';

/**
 * The commands of an LR2 sound set (`LR2files/Sound/*.lr2ss`) that name a file the theme loaders use. The sound set
 * maps each system sound to a path relative to the LR2 folder (`#COURSECLEAR,LR2files\Sound\lr2\course_clear.wav`), so
 * a file's name does not have to match the command: the stock set names the course jingles `course_clear.wav` /
 * `course_fail.wav`.
 */
export type LR2SoundSetKey =
  | 'SELECT'
  | 'DECIDE'
  | 'FOLDER_OPEN'
  | 'FOLDER_CLOSE'
  | 'PANEL_OPEN'
  | 'PANEL_CLOSE'
  | 'OPTION_CHANGE'
  | 'CLEAR'
  | 'FAIL'
  | 'SCRATCH'
  | 'STOP'
  | 'COURSECLEAR'
  | 'COURSEFAIL';

export interface LR2SoundSet {
  /** Each command's paths in file order, `\` turned into `/`. A later one is LR2's fallback for an earlier one. */
  readonly paths: ReadonlyMap<string, readonly string[]>;
  /** `#CUSTOMFILE` folder patterns (`LR2files/BGM/*`) with their default choice (`LR2 ver sta`). */
  readonly customFiles: ReadonlyArray<{ readonly pattern: string; readonly defaultValue: string }>;
}

const AUDIO_EXTENSIONS = ['.wav', '.ogg', '.mp3', '.opus', '.flac', '.oga'] as const;

/** Parses an `.lr2ss` sound-set definition (Shift_JIS text, CSV rows starting with `#`). */
export function parseLR2SoundSet(text: string): LR2SoundSet {
  const paths = new Map<string, string[]>();
  const customFiles: Array<{ pattern: string; defaultValue: string }> = [];
  for (const row of parseRows(text)) {
    const command = row[0]?.slice(1).toUpperCase();
    if (!command) continue;
    if (command === 'CUSTOMFILE') {
      const pattern = normalizeSoundSetPath(row[2] ?? '');
      if (pattern) customFiles.push({ pattern, defaultValue: row[3] ?? '' });
      continue;
    }
    const path = normalizeSoundSetPath(row[1] ?? '');
    if (!path || command === 'INFORMATION') continue;
    const list = paths.get(command);
    if (list) list.push(path);
    else paths.set(command, [path]);
  }
  return { paths, customFiles };
}

/** Reads the sound set from a dropped theme's files, preferring the stock `lr2.lr2ss`. */
export function readLR2SoundSet(
  files: ReadonlyMap<string, unknown>,
  bytesOf: (path: string) => Uint8Array | undefined,
): LR2SoundSet | undefined {
  let chosen: string | undefined;
  for (const path of files.keys()) {
    const lower = path.toLowerCase();
    if (!lower.endsWith('.lr2ss')) continue;
    if (chosen === undefined) chosen = path;
    if (baseName(lower) === 'lr2.lr2ss') {
      chosen = path;
      break;
    }
  }
  if (chosen === undefined) return undefined;
  const bytes = bytesOf(chosen);
  return bytes ? parseLR2SoundSet(decodeText(bytes)) : undefined;
}

/**
 * Returns the dropped path of the file the sound set names for `key`, or `undefined` when it names none or none of
 * its files were dropped. A path matches when it ends with the definition's path below `LR2files/`, so a drop of
 * `LR2files/` or of `Sound/` both resolve. A `*` folder takes the `#CUSTOMFILE` default first and then any folder. A
 * file with another audio extension stands in for a missing one (`clear.ogg` for `clear.wav`).
 */
export function resolveLR2SoundSetPath(
  paths: Iterable<string>,
  soundSet: LR2SoundSet,
  key: LR2SoundSetKey,
): string | undefined {
  const definitions = soundSet.paths.get(key);
  if (!definitions) return undefined;
  const candidates = [...paths].map((path) => ({ path, lower: normalizeSoundSetPath(path).toLowerCase() }));
  for (const definition of definitions) {
    for (const pattern of expandCustomFiles(definition, soundSet)) {
      const found = findMatchingPath(candidates, pattern);
      if (found) return found;
    }
  }
  return undefined;
}

function expandCustomFiles(definition: string, soundSet: LR2SoundSet): string[] {
  const star = definition.indexOf('*');
  if (star < 0) return [definition];
  const prefix = definition.slice(0, star).toLowerCase();
  const chosen = soundSet.customFiles
    .filter((custom) => custom.defaultValue && custom.pattern.toLowerCase() === `${prefix}*`)
    .map((custom) => definition.slice(0, star) + custom.defaultValue + definition.slice(star + 1));
  return [...chosen, definition];
}

function findMatchingPath(
  candidates: ReadonlyArray<{ path: string; lower: string }>,
  pattern: string,
): string | undefined {
  const relative = stripLR2FilesPrefix(pattern.toLowerCase());
  const dot = relative.lastIndexOf('.');
  const slash = relative.lastIndexOf('/');
  const hasExtension = dot > slash;
  const stem = hasExtension ? relative.slice(0, dot) : relative;
  const extension = hasExtension ? relative.slice(dot) : '';
  const stemPattern = stem
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, '\\$&'))
    .join('[^/]+');
  const matcher = new RegExp(`(?:^|/)${stemPattern}(\\.[^./]+)$`, 'u');
  let fallback: string | undefined;
  for (const candidate of candidates) {
    const match = matcher.exec(candidate.lower);
    if (!match) continue;
    const candidateExtension = match[1]!;
    if (candidateExtension === extension) return candidate.path;
    if (fallback === undefined && (AUDIO_EXTENSIONS as readonly string[]).includes(candidateExtension)) {
      fallback = candidate.path;
    }
  }
  return fallback;
}

function normalizeSoundSetPath(path: string): string {
  // Shift_JIS decodes LR2's `¥` separator as `\`; some editors save it as U+00A5 instead.
  return path
    .trim()
    .replace(/[\\¥]/gu, '/')
    .replace(/^\.\//u, '')
    .replace(/\/{2,}/gu, '/');
}

function stripLR2FilesPrefix(lower: string): string {
  return lower.startsWith('lr2files/') ? lower.slice('lr2files/'.length) : lower;
}

function baseName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
}
