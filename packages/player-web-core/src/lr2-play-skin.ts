import { normalizePath, readFilesIntoBytesMap, resolveChartPlayVariant } from './library.ts';
import { loadLr2SkinFromSourceFiles, type Lr2PlayVariant, type Lr2Skin } from './lr2-skin.ts';
import type { BrowserSongAssetEntry, BrowserSongEntry, LoadProgressCallback } from './types.ts';

export const LR2_PLAY_VARIANTS = ['7', '14', '10', '5', '9'] as const satisfies readonly Lr2PlayVariant[];

export type Lr2PlaySkinMap = Partial<Record<Lr2PlayVariant, Lr2Skin>>;

/**
 * Background-music file extracted from a dropped LR2 theme. Used
 * for the song-select / decide screens — `select.wav` loops while
 * the player is browsing songs, `decide.wav` is a one-shot played
 * when a song is picked.
 *
 * Path is the original case-preserved path the file was dropped at
 * (e.g. `LR2files/Bgm/LR2 ver sta/select.wav`); `bytes` is the raw
 * file bytes ready for `AudioContext.decodeAudioData`.
 */
export interface Lr2ThemeBgm {
  path: string;
  bytes: Uint8Array;
}

export interface Lr2ThemeSkins {
  playSkins: Lr2PlaySkinMap;
  selectSkin?: Lr2Skin;
  resultSkin?: Lr2Skin;
  /**
   * Decide-screen skin (the brief "song confirmation" splash that
   * plays between the select view and gameplay). Conventionally
   * lives at `LR2files/Theme/<name>/Decide/decide.lr2skin`.
   * Undefined when the theme bundle has no Decide directory —
   * the demo simply skips the splash and moves straight from
   * select to play in that case.
   */
  decideSkin?: Lr2Skin;
  /**
   * Looping song-select screen BGM, conventionally
   * `LR2files/Bgm/<theme>/select.wav`. Undefined when the theme
   * bundle didn't ship a matching file.
   */
  selectBgm?: Lr2ThemeBgm;
  /**
   * One-shot song-decided BGM, conventionally
   * `LR2files/Bgm/<theme>/decide.wav`. Played when transitioning
   * from select to gameplay.
   */
  decideBgm?: Lr2ThemeBgm;
  /**
   * Result-screen BGM played when the chart was cleared,
   * conventionally `LR2files/Bgm/<theme>/clear.wav` (some
   * themes name it `result_clear.wav`). Falls back to
   * {@link resultBgm} when missing so themes that ship a single
   * generic result loop still play something.
   */
  clearBgm?: Lr2ThemeBgm;
  /**
   * Result-screen BGM played when the chart was failed,
   * conventionally `LR2files/Bgm/<theme>/fail.wav`. Same
   * fallback chain as {@link clearBgm}.
   */
  failBgm?: Lr2ThemeBgm;
  /**
   * Generic result-screen BGM (`LR2files/Bgm/<theme>/result.wav`)
   * used as the fallback when {@link clearBgm} / {@link failBgm}
   * are absent. Themes that ship just one result loop populate
   * this slot only.
   */
  resultBgm?: Lr2ThemeBgm;
  /**
   * LR2 system sound effects from `LR2files/Sound/lr2/*.wav`.
   * Each slot is independently optional — themes that don't
   * ship a particular effect just leave that field undefined,
   * and the consuming view silences that cue.
   */
  systemSounds: Lr2ThemeSystemSounds;
}

export interface Lr2ThemeSystemSounds {
  /** Bar / cursor-move click (`scratch.wav` in the LR2 default theme). */
  cursorMove?: Lr2ThemeBgm;
  /** Folder-enter cue (`f-open.wav`). */
  folderOpen?: Lr2ThemeBgm;
  /** Folder-back cue (`f-close.wav`). */
  folderClose?: Lr2ThemeBgm;
  /** Option-panel open cue (`o-open.wav`). */
  optionOpen?: Lr2ThemeBgm;
  /** Option-panel close cue (`o-close.wav`). */
  optionClose?: Lr2ThemeBgm;
  /** Option-value change cue (`o-change.wav`). */
  optionChange?: Lr2ThemeBgm;
}

const PLAY_SKIN_FALLBACKS: Record<Lr2PlayVariant, readonly Lr2PlayVariant[]> = {
  '14': ['14', '10', '7', '5', '9'],
  '10': ['10', '14', '7', '5', '9'],
  '7': ['7', '14', '5', '10', '9'],
  '5': ['5', '7', '14', '10', '9'],
  '9': ['9', '7', '14', '5', '10'],
};

export interface LoadLr2ThemeOptions {
  /**
   * Optional progress hook fired as each skin / BGM / system-sound
   * sub-task lands. Useful for the host UI to advance a determinate
   * progress bar — without this, theme loading on a heavy LR2
   * bundle (multiple play variants + BGM + ~5 system effects) just
   * shows a static "Loading…" for several seconds while
   * `decodeAudioData` chews through every audio file.
   *
   * The total is the count of internal sub-tasks (play variants +
   * select + result + select-bgm + decide-bgm + 3 system sounds).
   * Sub-tasks fire in parallel; the callback receives the running
   * "completed so far" tally.
   */
  onProgress?: LoadProgressCallback;
}

export async function loadLr2ThemeSkinsFromFiles(
  files: Iterable<File>,
  options: LoadLr2ThemeOptions = {},
): Promise<Lr2ThemeSkins> {
  const sourceFiles = [...files];
  const onProgress = options.onProgress;
  // Read every theme file into a single shared byte map ONCE,
  // up-front, with a worker-pool. The previous implementation
  // re-read the entire file list inside each of the 11 sub-task
  // calls (each `loadLr2SkinFromFiles` walked the full list and
  // awaited every `arrayBuffer()` serially). On a 388-file LR2
  // default-theme drop that meant ~4300 sequential file reads,
  // dominating the load time. Reading once and dispatching
  // against the resulting `Map<path, bytes>` removes that
  // duplication entirely; the play / select / result / decide
  // skins all share the same map by reference, so memory cost
  // is also lower.
  const sharedFiles = await readFilesIntoBytesMap(sourceFiles);
  // Total = play variants (one per LR2_PLAY_VARIANTS entry) +
  // select skin + result skin + decide skin + 5 theme BGMs
  // (select / decide / clear / fail / result) + 6 system
  // sounds (cursor-move + folder open/close + option
  // open/close/change). Hard-coding it to the structural shape
  // below keeps the count honest if anyone adds another
  // sub-task later (compile breaks when the awaited tuple
  // disagrees with this constant).
  const totalSubTasks = LR2_PLAY_VARIANTS.length + 14;
  let completed = 0;
  onProgress?.({ phase: 'theme', current: 0, total: totalSubTasks });
  const track = <T>(label: string, task: Promise<T>): Promise<T> =>
    task.then((value) => {
      completed += 1;
      onProgress?.({ phase: 'theme', current: completed, total: totalSubTasks, label });
      return value;
    });
  // Each task wraps a synchronous parse / pick in `Promise.resolve`
  // so the existing progress-tracking + parallel-await shape
  // continues to work — no semantic change beyond the up-front
  // batched read.
  const playSkinTasks = LR2_PLAY_VARIANTS.map((variant) =>
    track(
      `play/${variant}K`,
      Promise.resolve(loadLr2SkinFromSourceFiles(sharedFiles, { kind: 'play', playVariant: variant })),
    ),
  );
  const [
    variantSkins,
    selectSkin,
    resultSkin,
    decideSkin,
    selectBgm,
    decideBgm,
    clearBgm,
    failBgm,
    resultBgm,
    cursorMove,
    folderOpen,
    folderClose,
    optionOpen,
    optionClose,
    optionChange,
  ] = await Promise.all([
    Promise.all(playSkinTasks),
    track('select', Promise.resolve(loadLr2SkinFromSourceFiles(sharedFiles, { kind: 'select' }))),
    track('result', Promise.resolve(loadLr2SkinFromSourceFiles(sharedFiles, { kind: 'result' }))),
    track('decide', Promise.resolve(loadLr2SkinFromSourceFiles(sharedFiles, { kind: 'decide' }))),
    // Theme audio (BGM + system sounds) goes through
    // `materialiseLr2ThemeAudio` so the lazy `File` branch from
    // `readFilesIntoBytesMap`'s `deferAudio: true` default is
    // unwrapped here. The rest of the pack stays lazy — only the
    // theme's small handful of audio files (BGM + ~6 cues) is
    // forced eager up front, since they need to be ready the
    // moment the user lands on the select scene.
    track('bgm/select', materialiseLr2ThemeAudio(pickLr2ThemeBgmFromMap(sharedFiles, 'select'))),
    track('bgm/decide', materialiseLr2ThemeAudio(pickLr2ThemeBgmFromMap(sharedFiles, 'decide'))),
    track('bgm/clear', materialiseLr2ThemeAudio(pickLr2ThemeBgmFromMap(sharedFiles, 'clear'))),
    track('bgm/fail', materialiseLr2ThemeAudio(pickLr2ThemeBgmFromMap(sharedFiles, 'fail'))),
    track('bgm/result', materialiseLr2ThemeAudio(pickLr2ThemeBgmFromMap(sharedFiles, 'result'))),
    track('sound/scratch', materialiseLr2ThemeAudio(pickLr2SystemSoundFromMap(sharedFiles, 'scratch'))),
    track('sound/f-open', materialiseLr2ThemeAudio(pickLr2SystemSoundFromMap(sharedFiles, 'f-open'))),
    track('sound/f-close', materialiseLr2ThemeAudio(pickLr2SystemSoundFromMap(sharedFiles, 'f-close'))),
    track('sound/o-open', materialiseLr2ThemeAudio(pickLr2SystemSoundFromMap(sharedFiles, 'o-open'))),
    track('sound/o-close', materialiseLr2ThemeAudio(pickLr2SystemSoundFromMap(sharedFiles, 'o-close'))),
    track('sound/o-change', materialiseLr2ThemeAudio(pickLr2SystemSoundFromMap(sharedFiles, 'o-change'))),
  ]);

  const playSkins: Lr2PlaySkinMap = {};
  LR2_PLAY_VARIANTS.forEach((variant, index) => {
    const skin = variantSkins[index];
    if (skin) {
      playSkins[variant] = skin;
    }
  });
  return {
    playSkins,
    selectSkin,
    resultSkin,
    decideSkin,
    selectBgm,
    decideBgm,
    clearBgm,
    failBgm,
    resultBgm,
    systemSounds: {
      cursorMove,
      folderOpen,
      folderClose,
      optionOpen,
      optionClose,
      optionChange,
    },
  };
}

/**
 * Returns the best-matching theme BGM (`<role>.wav` /
 * `<role>.ogg` / `<role>.mp3` etc.) inside `LR2files/Bgm/...`, or
 * `undefined` when the dropped bundle doesn't ship one. Match is
 * case-insensitive and accepts any audio extension supported by
 * the browser's `AudioContext.decodeAudioData` (`.opus` / `.ogg`
 * / `.mp3` / `.wav` / `.flac`); `select.wav` is by far the most
 * common form in real LR2 themes.
 *
 * Exported for testability — most callers should use
 * `loadLr2ThemeSkinsFromFiles` which wires both `select` and
 * `decide` slots in parallel.
 */
export async function loadLr2ThemeBgm(
  files: Iterable<File>,
  role: 'select' | 'decide' | 'clear' | 'fail' | 'result',
): Promise<Lr2ThemeBgm | undefined> {
  const match = pickLr2ThemeBgmFile([...files], role);
  if (!match) return undefined;
  const buffer = await match.arrayBuffer();
  return {
    path: normalizePath(match.webkitRelativePath || match.name),
    bytes: new Uint8Array(buffer),
  };
}

const LR2_THEME_BGM_EXTENSIONS = ['.wav', '.ogg', '.mp3', '.opus', '.flac', '.oga'] as const;

/**
 * Generic theme-audio file picker. Returns the first input-order
 * file whose path satisfies `pathTest` (case-insensitive) AND
 * whose basename is exactly `<stem>.<audio-ext>` for one of the
 * supported codecs. Returns `undefined` when no candidate matches.
 *
 * Used as the underlying matcher for both
 * {@link pickLr2ThemeBgmFile} (filters on `bgm/` in the path) and
 * {@link pickLr2SystemSoundFile} (filters on `sound/lr2/`).
 */
function pickThemeAudioFile(
  files: readonly File[],
  pathTest: (lower: string) => boolean,
  stem: string,
): File | undefined {
  for (const file of files) {
    const path = (file.webkitRelativePath || file.name).toLowerCase();
    if (!pathTest(path)) continue;
    const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    const baseName = slash >= 0 ? path.slice(slash + 1) : path;
    const dot = baseName.lastIndexOf('.');
    if (dot < 0) continue;
    const fileStem = baseName.slice(0, dot);
    const ext = baseName.slice(dot);
    if (fileStem !== stem) continue;
    if (!LR2_THEME_BGM_EXTENSIONS.includes(ext as (typeof LR2_THEME_BGM_EXTENSIONS)[number])) continue;
    return file;
  }
  return undefined;
}

/**
 * Pure file picker — separated from {@link loadLr2ThemeBgm} so a
 * unit test can verify the matching rules without invoking
 * `arrayBuffer()`. Returns the file from the dropped bundle that
 * best matches `LR2files/Bgm/<theme>/<role>.<audio-ext>`. The
 * heuristic, in order:
 *
 * 1. Path includes `bgm/` (case-insensitive) and basename matches
 *    `<role>.<ext>` for one of the supported audio extensions.
 * 2. If multiple match, the first one in the input order wins —
 *    LR2 default ships three theme variants (`LR2 ver sta` / etc.)
 *    so picking the first deterministic variant is fine.
 *
 * Returns `undefined` when no candidate exists.
 */
export function pickLr2ThemeBgmFile(
  files: readonly File[],
  role: 'select' | 'decide' | 'clear' | 'fail' | 'result',
): File | undefined {
  return pickThemeAudioFile(files, (path) => path.includes('bgm/') || path.includes('bgm\\'), role);
}

/**
 * Returns the dropped file matching `LR2files/Sound/lr2/<stem>.<ext>`
 * (case-insensitive on path / basename). Used for LR2 system
 * sound effects: `scratch` (cursor move click), `f-open` /
 * `f-close` (folder enter / back), `o-open` / `o-close` /
 * `o-change` (option panel — UI not yet implemented), `mine`
 * (gameplay mine note), `clear` / `fail` (result), etc.
 *
 * Strict path filter on `sound/lr2/` keeps a per-song WAV named
 * `scratch.wav` from accidentally being picked as the system
 * cursor sound; only files inside the `Sound/lr2/` subtree
 * qualify.
 */
export function pickLr2SystemSoundFile(files: readonly File[], stem: string): File | undefined {
  return pickThemeAudioFile(files, (path) => path.includes('sound/lr2/') || path.includes('sound\\lr2\\'), stem);
}

/**
 * Map-keyed counterpart to {@link pickThemeAudioFile} — same rules
 * (case-insensitive path filter + exact-stem + supported codec)
 * but consumes a pre-read `Map<path, bytes>` so the caller doesn't
 * have to re-issue `arrayBuffer()` reads it already paid for.
 * Used by `loadLr2ThemeSkinsFromFiles` after the up-front shared
 * read.
 */
function pickThemeAudioBytes(
  files: ReadonlyMap<string, BrowserSongAssetEntry>,
  pathTest: (lower: string) => boolean,
  stem: string,
): Lr2ThemeAudioRef | undefined {
  for (const [path, entry] of files) {
    const lower = path.toLowerCase();
    if (!pathTest(lower)) continue;
    const slash = Math.max(lower.lastIndexOf('/'), lower.lastIndexOf('\\'));
    const baseName = slash >= 0 ? lower.slice(slash + 1) : lower;
    const dot = baseName.lastIndexOf('.');
    if (dot < 0) continue;
    const fileStem = baseName.slice(0, dot);
    const ext = baseName.slice(dot);
    if (fileStem !== stem) continue;
    if (!LR2_THEME_BGM_EXTENSIONS.includes(ext as (typeof LR2_THEME_BGM_EXTENSIONS)[number])) continue;
    return { path, entry };
  }
  return undefined;
}

interface Lr2ThemeAudioRef {
  path: string;
  entry: BrowserSongAssetEntry;
}

async function materialiseLr2ThemeAudio(ref: Lr2ThemeAudioRef | undefined): Promise<Lr2ThemeBgm | undefined> {
  if (!ref) return undefined;
  const bytes = ref.entry instanceof Uint8Array ? ref.entry : new Uint8Array(await ref.entry.arrayBuffer());
  return { path: ref.path, bytes };
}

function pickLr2ThemeBgmFromMap(
  files: ReadonlyMap<string, BrowserSongAssetEntry>,
  role: 'select' | 'decide' | 'clear' | 'fail' | 'result',
): Lr2ThemeAudioRef | undefined {
  return pickThemeAudioBytes(files, (path) => path.includes('bgm/') || path.includes('bgm\\'), role);
}

function pickLr2SystemSoundFromMap(
  files: ReadonlyMap<string, BrowserSongAssetEntry>,
  stem: string,
): Lr2ThemeAudioRef | undefined {
  return pickThemeAudioBytes(files, (path) => path.includes('sound/lr2/') || path.includes('sound\\lr2\\'), stem);
}

/**
 * Loads the named LR2 system sound effect (e.g. `scratch`,
 * `f-open`, `f-close`) from the dropped bundle. Returns
 * `undefined` when the theme doesn't ship that effect.
 */
export async function loadLr2SystemSound(files: Iterable<File>, stem: string): Promise<Lr2ThemeBgm | undefined> {
  const match = pickLr2SystemSoundFile([...files], stem);
  if (!match) return undefined;
  const buffer = await match.arrayBuffer();
  return {
    path: normalizePath(match.webkitRelativePath || match.name),
    bytes: new Uint8Array(buffer),
  };
}

export function pickLr2PlaySkin(playSkins: Lr2PlaySkinMap, song: BrowserSongEntry): Lr2Skin | undefined {
  const target = resolveChartPlayVariant(song);
  for (const variant of PLAY_SKIN_FALLBACKS[target]) {
    const candidate = playSkins[variant];
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
}

export function summarizeLr2PlaySkins(playSkins: Lr2PlaySkinMap, separator = ','): string {
  return (Object.entries(playSkins) as Array<[Lr2PlayVariant, Lr2Skin]>)
    .map(([variant, value]) => `${variant}K=${value.name}`)
    .join(separator);
}
