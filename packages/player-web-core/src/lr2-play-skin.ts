import { normalizePath, resolveChartPlayVariant } from './library.ts';
import { loadLr2SkinFromFiles, type Lr2PlayVariant, type Lr2Skin } from './lr2-skin.ts';
import type { BrowserSongEntry, LoadProgressCallback } from './types.ts';

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
  // Total = play variants (one per LR2_PLAY_VARIANTS entry) +
  // select skin + result skin + decide skin + 2 theme BGMs +
  // 6 system sounds (cursor-move + folder open/close + option
  // open/close/change). Hard-coding it to the structural shape
  // below keeps the count honest if anyone adds another
  // sub-task later (compile breaks when the awaited tuple
  // disagrees with this constant).
  const totalSubTasks = LR2_PLAY_VARIANTS.length + 11;
  let completed = 0;
  onProgress?.({ phase: 'theme', current: 0, total: totalSubTasks });
  const track = <T>(label: string, task: Promise<T>): Promise<T> =>
    task.then((value) => {
      completed += 1;
      onProgress?.({ phase: 'theme', current: completed, total: totalSubTasks, label });
      return value;
    });
  const playSkinTasks = LR2_PLAY_VARIANTS.map((variant) =>
    track(`play/${variant}K`, loadLr2SkinFromFiles(sourceFiles, { kind: 'play', playVariant: variant })),
  );
  const [
    variantSkins,
    selectSkin,
    resultSkin,
    decideSkin,
    selectBgm,
    decideBgm,
    cursorMove,
    folderOpen,
    folderClose,
    optionOpen,
    optionClose,
    optionChange,
  ] = await Promise.all([
    Promise.all(playSkinTasks),
    track('select', loadLr2SkinFromFiles(sourceFiles, { kind: 'select' })),
    track('result', loadLr2SkinFromFiles(sourceFiles, { kind: 'result' })),
    track('decide', loadLr2SkinFromFiles(sourceFiles, { kind: 'decide' })),
    track('bgm/select', loadLr2ThemeBgm(sourceFiles, 'select')),
    track('bgm/decide', loadLr2ThemeBgm(sourceFiles, 'decide')),
    track('sound/scratch', loadLr2SystemSound(sourceFiles, 'scratch')),
    track('sound/f-open', loadLr2SystemSound(sourceFiles, 'f-open')),
    track('sound/f-close', loadLr2SystemSound(sourceFiles, 'f-close')),
    track('sound/o-open', loadLr2SystemSound(sourceFiles, 'o-open')),
    track('sound/o-close', loadLr2SystemSound(sourceFiles, 'o-close')),
    track('sound/o-change', loadLr2SystemSound(sourceFiles, 'o-change')),
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
  role: 'select' | 'decide',
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
export function pickLr2ThemeBgmFile(files: readonly File[], role: 'select' | 'decide'): File | undefined {
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
