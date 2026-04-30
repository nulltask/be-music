import { normalizePath, resolveChartPlayVariant } from './library.ts';
import { loadLr2SkinFromFiles, type Lr2PlayVariant, type Lr2Skin } from './lr2-skin.ts';
import type { BrowserSongEntry } from './types.ts';

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
}

const PLAY_SKIN_FALLBACKS: Record<Lr2PlayVariant, readonly Lr2PlayVariant[]> = {
  '14': ['14', '10', '7', '5', '9'],
  '10': ['10', '14', '7', '5', '9'],
  '7': ['7', '14', '5', '10', '9'],
  '5': ['5', '7', '14', '10', '9'],
  '9': ['9', '7', '14', '5', '10'],
};

export async function loadLr2ThemeSkinsFromFiles(files: Iterable<File>): Promise<Lr2ThemeSkins> {
  const sourceFiles = [...files];
  const [variantSkins, selectSkin, resultSkin, selectBgm, decideBgm] = await Promise.all([
    Promise.all(
      LR2_PLAY_VARIANTS.map((variant) => loadLr2SkinFromFiles(sourceFiles, { kind: 'play', playVariant: variant })),
    ),
    loadLr2SkinFromFiles(sourceFiles, { kind: 'select' }),
    loadLr2SkinFromFiles(sourceFiles, { kind: 'result' }),
    loadLr2ThemeBgm(sourceFiles, 'select'),
    loadLr2ThemeBgm(sourceFiles, 'decide'),
  ]);

  const playSkins: Lr2PlaySkinMap = {};
  LR2_PLAY_VARIANTS.forEach((variant, index) => {
    const skin = variantSkins[index];
    if (skin) {
      playSkins[variant] = skin;
    }
  });
  return { playSkins, selectSkin, resultSkin, selectBgm, decideBgm };
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
  for (const file of files) {
    const path = (file.webkitRelativePath || file.name).toLowerCase();
    if (!path.includes('bgm/') && !path.includes('bgm\\')) continue;
    const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    const baseName = slash >= 0 ? path.slice(slash + 1) : path;
    const dot = baseName.lastIndexOf('.');
    if (dot < 0) continue;
    const stem = baseName.slice(0, dot);
    const ext = baseName.slice(dot);
    if (stem !== role) continue;
    if (!LR2_THEME_BGM_EXTENSIONS.includes(ext as (typeof LR2_THEME_BGM_EXTENSIONS)[number])) continue;
    return file;
  }
  return undefined;
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
