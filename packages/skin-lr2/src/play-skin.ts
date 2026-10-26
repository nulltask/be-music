import { type ChartPlayVariant, resolveChartPlayVariant } from '@be-music/chart-model';
import type { BattleMode } from '@be-music/player-engine/lanes';
import { normalizePath } from '@be-music/shared-utils/core';
import { extractDxaArchivesAsFlatFiles } from './dxa.ts';
import { asLoadedBytes, readFilesIntoBytesMap, type LR2SkinFileEntry } from './file-lookup.ts';
import type { LR2SkinInputFile } from './file-lookup.ts';
import { informationTypeToPlayVariant, peekLR2SkinInformationType } from './paths.ts';
import { loadLR2SkinFromSourceFiles, type LoadLR2SkinOptions, type LR2PlayVariant, type LR2Skin } from './skin.ts';
import { readLR2SoundSet, resolveLR2SoundSetPath, type LR2SoundSet, type LR2SoundSetKey } from './sound-set.ts';

export const LR2_PLAY_VARIANTS: readonly LR2PlayVariant[] = ['7', '14', '10', '5', '9'];

/** LR2's BATTLE play skins, loaded beside {@link LR2_PLAY_VARIANTS} when a theme declares one (types 12 / 13). */
export const LR2_BATTLE_PLAY_VARIANTS: readonly LR2PlayVariant[] = ['7-battle', '5-battle'];

export type LR2PlaySkinMap = Partial<Record<LR2PlayVariant, LR2Skin>>;

export interface LR2ThemeLoadProgress {
  phase: 'theme';
  /** 1-based "items completed so far"; 0 when theme loading starts. */
  current: number;
  total: number;
  label?: string;
}

export type LR2ThemeLoadProgressCallback = (progress: LR2ThemeLoadProgress) => void;

export interface LR2PlaySkinChart {
  chartPath?: string;
  chart: {
    events: ReadonlyArray<{ channel: string }>;
    bms?: { player?: number };
    bmson?: { info?: { modeHint?: string } };
  };
}

/**
 * Background-music file extracted from a dropped LR2 theme. Used for the song-select / decide screens — `select.wav`
 * loops while the player is browsing songs, `decide.wav` is a one-shot played when a song is picked.
 *
 * Path is the original case-preserved path the file was dropped at (e.g. `LR2files/BGM/LR2 ver sta/select.wav`);
 * `bytes` is the raw file bytes ready for `AudioContext.decodeAudioData`.
 */
export interface LR2ThemeBGM {
  path: string;
  bytes: Uint8Array;
}

export interface LR2ThemeSkins {
  playSkins: LR2PlaySkinMap;
  selectSkin?: LR2Skin;
  resultSkin?: LR2Skin;
  /**
   * Decide-screen skin (the brief "song confirmation" splash that plays between the select view and gameplay).
   * Conventionally lives at `LR2files/Theme/<name>/Decide/decide.lr2skin`. Undefined when the theme bundle has no
   * Decide directory — the player simply skips the splash and moves straight from select to play in that case.
   */
  decideSkin?: LR2Skin;
  /**
   * Course-result skin (`#INFORMATION` type 15, conventionally `LR2files/Theme/<name>/CourseResult/*.lr2skin`): the
   * result of a whole course. Undefined when the theme has none; hosts then show the course on the result skin.
   */
  courseResultSkin?: LR2Skin;
  /**
   * Parses one of the theme's skins again with extra parse-time ops (see {@link LoadLR2SkinOptions.parseOps}), from
   * the files already read for the theme. LR2 reads a skin at each scene start, so a host re-parses the play skin for
   * a course stage to take the `#IF` blocks gated on the course ops.
   */
  loadSkin: (options: LoadLR2SkinOptions) => LR2Skin | undefined;
  /**
   * Looping song-select screen BGM, conventionally `LR2files/BGM/<theme>/select.wav`. Undefined when the theme bundle
   * didn't ship a matching file.
   */
  selectBGM?: LR2ThemeBGM;
  /**
   * One-shot song-decided BGM, conventionally `LR2files/BGM/<theme>/decide.wav`. Played when transitioning from select
   * to gameplay.
   */
  decideBGM?: LR2ThemeBGM;
  /**
   * Result-screen audio played when the chart was cleared, conventionally `LR2files/Sound/<theme>/clear.wav`. LR2 keeps
   * these alongside the system sound effects (`scratch.wav`, `mine.wav`, …) under `Sound/`, NOT in `BGM/` — `BGM/` is
   * reserved for the looping select / decide tracks. Falls back to {@link resultBGM} when missing so themes that ship a
   * single generic result loop still play something.
   */
  clearBGM?: LR2ThemeBGM;
  /**
   * Result-screen audio played when the chart was failed, conventionally `LR2files/Sound/<theme>/fail.wav`. Same
   * fallback chain as {@link clearBGM}.
   */
  failBGM?: LR2ThemeBGM;
  /**
   * Generic result-screen audio (`LR2files/Sound/<theme>/result.wav`) used as the fallback when {@link clearBGM} /
   * {@link failBGM} are absent. Themes that ship just one result jingle populate this slot only.
   */
  resultBGM?: LR2ThemeBGM;
  /**
   * Course-result audio when the course was cleared: the sound set's `#COURSECLEAR` (stock
   * `LR2files/Sound/lr2/course_clear.wav`), else `course_clear` / `courseclear` under `Sound/lr2/`. Hosts fall back to
   * {@link clearBGM} when missing, as LR2 does.
   */
  courseClearBGM?: LR2ThemeBGM;
  /**
   * Course-result audio when the course was failed: `#COURSEFAIL` (stock `course_fail.wav`), else `course_fail` /
   * `coursefail`, falling back to {@link failBGM}.
   */
  courseFailBGM?: LR2ThemeBGM;
  /**
   * LR2 system sound effects from `LR2files/Sound/lr2/*.wav`. Each slot is independently optional — themes that don't
   * ship a particular effect just leave that field undefined, and the consuming view silences that cue.
   */
  systemSounds: LR2ThemeSystemSounds;
}

export interface LR2ThemeSystemSounds {
  /** Stage-failure stop cue (`#STOP`, conventionally `playstop.wav`). */
  playStop?: LR2ThemeBGM;
  /** Bar / cursor-move click (`scratch.wav` in the LR2 default theme). */
  cursorMove?: LR2ThemeBGM;
  /** Folder-enter cue (`f-open.wav`). */
  folderOpen?: LR2ThemeBGM;
  /** Folder-back cue (`f-close.wav`). */
  folderClose?: LR2ThemeBGM;
  /** Option-panel open cue (`o-open.wav`). */
  optionOpen?: LR2ThemeBGM;
  /** Option-panel close cue (`o-close.wav`). */
  optionClose?: LR2ThemeBGM;
  /** Option-value change cue (`o-change.wav`). */
  optionChange?: LR2ThemeBGM;
}

/**
 * Play-skin preference order per chart variant. LR2 never shipped a keyboard-mode skin, so `'24'` / `'48'` borrow the
 * SP / DP That-Which-Must-Not-Be-Named chains — the mounted skin supplies the frame, gauge, and judge graphics while the 26 lanes themselves
 * fall through to the host's fallback playfield (see `resolveLR2LaneIndex`, which returns `-1` for these variants).
 */
const PLAY_SKIN_FALLBACKS: Record<ChartPlayVariant, readonly LR2PlayVariant[]> = {
  '14': ['14', '10', '7', '5', '9'],
  '10': ['10', '14', '7', '5', '9'],
  '7': ['7', '14', '5', '10', '9'],
  '5': ['5', '7', '14', '10', '9'],
  '9': ['9', '7', '14', '5', '10'],
  '24': ['7', '14', '5', '10', '9'],
  '48': ['14', '10', '7', '5', '9'],
};

export interface LoadLR2ThemeOptions {
  /**
   * Optional progress hook fired as each skin / BGM / system-sound sub-task lands. Useful for the host UI to advance a
   * determinate progress bar — without this, theme loading on a heavy LR2 bundle (multiple play variants + BGM + ~5
   * system effects) just shows a static "Loading…" for several seconds while `decodeAudioData` chews through every
   * audio file.
   *
   * The total is the count of internal sub-tasks (play variants + select + result + select-bgm + decide-bgm + 3 system
   * sounds). Sub-tasks fire in parallel; the callback receives the running "completed so far" tally.
   */
  onProgress?: LR2ThemeLoadProgressCallback;
}

export async function loadLR2ThemeSkinsFromFiles(
  files: Iterable<LR2SkinInputFile>,
  options: LoadLR2ThemeOptions = {},
): Promise<LR2ThemeSkins> {
  const sourceFiles = [...files];
  const onProgress = options.onProgress;
  // Read every theme file into a single shared byte map ONCE, up-front, with a worker-pool. The previous implementation
  // re-read the entire file list inside each of the 11 sub-task calls (each `loadLR2SkinFromFiles` walked the full list
  // and awaited every `arrayBuffer()` serially). On a 388-file LR2 default-theme drop that meant ~4300 sequential file
  // reads, dominating the load time. Reading once and dispatching against the resulting `Map<path, bytes>` removes that
  // duplication entirely; the play / select / result / decide skins all share the same map by reference, so memory cost
  // is also lower.
  const sharedFiles = await readFilesIntoBytesMap(sourceFiles);
  // DXA flattening pass. Themes like LITONE4 pack most of their textures + bitmap fonts into `.dxa` archives sitting
  // beside the bare `.dds` / `.lr2font` files (`Play/parts/common.dxa` containing `default.dds`, etc.). The skin's
  // CSV directives reference those inner paths as if the DXA were a folder (`#IMAGE,Play/parts/common/default.dds`),
  // so the asset resolver needs to see the unpacked contents.
  //
  // We expand here, once per theme load, into the same map every downstream consumer reads. On-disk files always win
  // over DXA-internal candidates so an explicitly extracted folder (LR2 default ships `parts/normal/lane/default.dds`
  // both as a bare file AND inside `parts/normal.dxa`) doesn't get shadowed by stale bytes from inside the archive.
  // Failures during DXA decode are silent — a malformed archive simply contributes no virtual entries.
  const dxaSeed: Array<readonly [string, Uint8Array]> = [];
  for (const [path, entry] of sharedFiles) {
    if (!path.toLowerCase().endsWith('.dxa')) continue;
    const bytes = asLoadedBytes(entry);
    if (bytes) dxaSeed.push([path, bytes]);
  }
  for (const { path, bytes } of extractDxaArchivesAsFlatFiles(dxaSeed)) {
    if (sharedFiles.has(path)) continue;
    // The asset map is `Map<string, LR2SkinFileEntry>` where `AssetFileEntry = Uint8Array | InputFile`. The Uint8Array
    // branch is the eager-loaded one that `asLoadedBytes` returns directly, so DXA-extracted bytes can go in as-is.
    (sharedFiles as Map<string, LR2SkinFileEntry>).set(path, bytes);
  }
  // Total = play variants (one per LR2_PLAY_VARIANTS entry) + select skin + result skin + decide skin + course-result
  // skin + 7 theme BGMs (select / decide / clear / fail / result / course clear / course fail) + 7 system sounds
  // (play-stop + cursor-move + folder open/close + option open/close/change). The progress regression test
  // checks the final task count against this total.
  const totalSubTasks = LR2_PLAY_VARIANTS.length + 18;
  let completed = 0;
  onProgress?.({ phase: 'theme', current: 0, total: totalSubTasks });
  const track = <T>(label: string, task: Promise<T>): Promise<T> =>
    task.then((value) => {
      completed += 1;
      onProgress?.({ phase: 'theme', current: completed, total: totalSubTasks, label });
      return value;
    });
  // LR2 finds its system sounds through the sound set (`LR2files/Sound/lr2.lr2ss`), which names each file; the
  // stems below are only the fallback for a drop that has no sound set or lacks the file it names.
  const soundSet = readLR2SoundSet(sharedFiles, (path) => asLoadedBytes(sharedFiles.get(path)));
  const pickSound = (key: LR2SoundSetKey, stems: readonly string[]): LR2ThemeAudioRef | undefined =>
    pickFromSoundSet(sharedFiles, soundSet, key) ??
    stems.reduce<LR2ThemeAudioRef | undefined>(
      (found, stem) => found ?? pickLR2SystemSoundFromMap(sharedFiles, stem),
      undefined,
    );
  const pickBGM = (key: LR2SoundSetKey, role: 'select' | 'decide'): LR2ThemeAudioRef | undefined =>
    pickFromSoundSet(sharedFiles, soundSet, key) ?? pickLR2ThemeBGMFromMap(sharedFiles, role);
  // Each task wraps a synchronous parse / pick in `Promise.resolve` so the existing progress-tracking + parallel-await
  // shape continues to work — no semantic change beyond the up-front batched read.
  // Seed every variant independently from the scene preceding gameplay; parsing DP must not overwrite SP slots.
  const initialSelect = loadLR2SkinFromSourceFiles(sharedFiles, { kind: 'select' });
  const initialDecide = loadLR2SkinFromSourceFiles(sharedFiles, {
    kind: 'decide',
    resources: initialSelect?.resources,
  });
  const beforePlay = initialDecide?.resources ?? initialSelect?.resources;
  const initialPlaySkins = LR2_PLAY_VARIANTS.map((playVariant) =>
    loadLR2SkinFromSourceFiles(sharedFiles, { kind: 'play', playVariant, resources: beforePlay }),
  );
  // A BATTLE play skin only from a theme that declares one: the loader would otherwise borrow an SP skin for it. A 5KEY
  // BATTLE takes the 7KEY one when the theme has no 5KEY one.
  const declaredBattleVariants = new Set<LR2PlayVariant>();
  for (const [path, entry] of sharedFiles) {
    if (!path.toLowerCase().endsWith('.lr2skin')) continue;
    const declared = informationTypeToPlayVariant(peekLR2SkinInformationType(asLoadedBytes(entry)) ?? -1);
    if (declared === '7-battle') declaredBattleVariants.add('7-battle').add('5-battle');
    if (declared === '5-battle') declaredBattleVariants.add('5-battle');
  }
  const battlePlaySkins = LR2_BATTLE_PLAY_VARIANTS.map((playVariant) =>
    declaredBattleVariants.has(playVariant)
      ? loadLR2SkinFromSourceFiles(sharedFiles, { kind: 'play', playVariant, resources: beforePlay })
      : undefined,
  );
  const initialResult = loadLR2SkinFromSourceFiles(sharedFiles, {
    kind: 'result',
    resources: initialPlaySkins[0]?.resources ?? beforePlay,
  });
  const initialCourseResult = loadLR2SkinFromSourceFiles(sharedFiles, {
    kind: 'courseResult',
    resources: initialResult?.resources,
  });
  const playSkinTasks = LR2_PLAY_VARIANTS.map((variant, index) =>
    track(`play/${variant}K`, Promise.resolve(initialPlaySkins[index])),
  );
  const [
    variantSkins,
    selectSkin,
    resultSkin,
    decideSkin,
    courseResultSkin,
    selectBGM,
    decideBGM,
    clearBGM,
    failBGM,
    resultBGM,
    courseClearBGM,
    courseFailBGM,
    playStop,
    cursorMove,
    folderOpen,
    folderClose,
    optionOpen,
    optionClose,
    optionChange,
  ] = await Promise.all([
    Promise.all(playSkinTasks),
    track('select', Promise.resolve(initialSelect)),
    track('result', Promise.resolve(initialResult)),
    track('decide', Promise.resolve(initialDecide)),
    track('courseResult', Promise.resolve(initialCourseResult)),
    // Theme audio (BGM + system sounds) goes through `materializeLR2ThemeAudio` so the lazy file branch from
    // `readFilesIntoBytesMap`'s `deferAudio: true` default is unwrapped here. The rest of the pack stays lazy — only
    // the theme's small handful of audio files (BGM + 7 cues) is forced eager up front, since they need to be ready
    // the moment the user lands on the select scene.
    track('bgm/select', materializeLR2ThemeAudio(pickBGM('SELECT', 'select'))),
    track('bgm/decide', materializeLR2ThemeAudio(pickBGM('DECIDE', 'decide'))),
    // `clear` / `fail` / `result` jingles live alongside the LR2 system sound effects (scratch / mine / o-change …)
    // under `LR2files/Sound/<theme>/`, NOT in `LR2files/BGM/`. The BGM/ directory is reserved for the looping select /
    // decide tracks — picking from there would silently miss the result audio since LR2 default ships these stems only
    // under Sound/lr2/. The sound set names each file (`#COURSECLEAR` → `course_clear.wav`); the stems are the
    // fallback for a drop without one. `result` has no sound-set command.
    track('sound/clear', materializeLR2ThemeAudio(pickSound('CLEAR', ['clear']))),
    track('sound/fail', materializeLR2ThemeAudio(pickSound('FAIL', ['fail']))),
    track('sound/result', materializeLR2ThemeAudio(pickLR2SystemSoundFromMap(sharedFiles, 'result'))),
    track('sound/courseclear', materializeLR2ThemeAudio(pickSound('COURSECLEAR', ['course_clear', 'courseclear']))),
    track('sound/coursefail', materializeLR2ThemeAudio(pickSound('COURSEFAIL', ['course_fail', 'coursefail']))),
    track('sound/playstop', materializeLR2ThemeAudio(pickSound('STOP', ['playstop']))),
    track('sound/scratch', materializeLR2ThemeAudio(pickSound('SCRATCH', ['scratch']))),
    track('sound/f-open', materializeLR2ThemeAudio(pickSound('FOLDER_OPEN', ['f-open']))),
    track('sound/f-close', materializeLR2ThemeAudio(pickSound('FOLDER_CLOSE', ['f-close']))),
    track('sound/o-open', materializeLR2ThemeAudio(pickSound('PANEL_OPEN', ['o-open']))),
    track('sound/o-close', materializeLR2ThemeAudio(pickSound('PANEL_CLOSE', ['o-close']))),
    track('sound/o-change', materializeLR2ThemeAudio(pickSound('OPTION_CHANGE', ['o-change']))),
  ]);

  const playSkins: LR2PlaySkinMap = {};
  LR2_PLAY_VARIANTS.forEach((variant, index) => {
    const skin = variantSkins[index];
    if (skin) {
      playSkins[variant] = skin;
    }
  });
  LR2_BATTLE_PLAY_VARIANTS.forEach((variant, index) => {
    const skin = battlePlaySkins[index];
    if (skin) playSkins[variant] = skin;
  });
  return {
    playSkins,
    selectSkin,
    resultSkin,
    decideSkin,
    courseResultSkin,
    loadSkin: (skinOptions) => {
      let resources = beforePlay;
      switch (skinOptions.kind) {
        case 'select':
          resources = undefined;
          break;
        case 'decide':
          resources = selectSkin?.resources;
          break;
        case 'result':
          resources = playSkins[skinOptions.playVariant ?? '7']?.resources ?? beforePlay;
          break;
        case 'courseResult':
          resources = resultSkin?.resources;
          break;
      }
      return loadLR2SkinFromSourceFiles(sharedFiles, { ...skinOptions, resources: skinOptions.resources ?? resources });
    },
    selectBGM,
    decideBGM,
    clearBGM,
    failBGM,
    resultBGM,
    courseClearBGM,
    courseFailBGM,
    systemSounds: {
      playStop,
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
 * Returns the best-matching theme BGM (`<role>.wav` / `<role>.ogg` / `<role>.mp3` etc.) inside `LR2files/BGM/...`, or
 * `undefined` when the dropped bundle doesn't ship one. Match is case-insensitive and accepts any audio extension
 * supported by the browser's `AudioContext.decodeAudioData` (`.opus` / `.ogg` / `.mp3` / `.wav` / `.flac`);
 * `select.wav` is by far the most common form in real LR2 themes.
 *
 * Exported for testability — most callers should use `loadLR2ThemeSkinsFromFiles` which wires both `select` and
 * `decide` slots in parallel.
 */
export async function loadLR2ThemeBGM(
  files: Iterable<LR2SkinInputFile>,
  role: 'select' | 'decide',
): Promise<LR2ThemeBGM | undefined> {
  const match = pickLR2ThemeBGMFile([...files], role);
  if (!match) return undefined;
  const buffer = await match.arrayBuffer();
  return {
    path: normalizePath(match.webkitRelativePath || match.name),
    bytes: new Uint8Array(buffer),
  };
}

const LR2_THEME_BGM_EXTENSIONS = ['.wav', '.ogg', '.mp3', '.opus', '.flac', '.oga'] as const;

/**
 * Generic theme-audio file picker. Returns the first input-order file whose path satisfies `pathTest`
 * (case-insensitive) AND whose basename is exactly `<stem>.<audio-ext>` for one of the supported codecs. Returns
 * `undefined` when no candidate matches.
 *
 * Used as the underlying matcher for both {@link pickLR2ThemeBGMFile} (filters on `bgm/` in the path) and {@link
 * pickLR2SystemSoundFile} (filters on `sound/lr2/`).
 */
function pickThemeAudioFile(
  files: readonly LR2SkinInputFile[],
  pathTest: (lower: string) => boolean,
  stem: string,
): LR2SkinInputFile | undefined {
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
 * Pure file picker — separated from {@link loadLR2ThemeBGM} so a unit test can verify the matching rules without
 * invoking `arrayBuffer()`. Returns the file from the dropped bundle that best matches
 * `LR2files/BGM/<theme>/<role>.<audio-ext>`. The heuristic, in order:
 *
 * 1. Path includes `bgm/` (case-insensitive) and basename matches `<role>.<ext>` for one of the supported audio
 *    extensions.
 * 2. If multiple match, the first one in the input order wins — LR2 default ships three theme variants (`LR2 ver sta` /
 *    etc.) so picking the first deterministic variant is fine.
 *
 * Returns `undefined` when no candidate exists.
 */
export function pickLR2ThemeBGMFile(
  files: readonly LR2SkinInputFile[],
  role: 'select' | 'decide',
): LR2SkinInputFile | undefined {
  return pickThemeAudioFile(files, (path) => path.includes('bgm/') || path.includes('bgm\\'), role);
}

/**
 * Returns the dropped file matching `LR2files/Sound/lr2/<stem>.<ext>` (case-insensitive on path / basename). Used for
 * LR2 system sound effects: `scratch` (cursor move click), `f-open` / `f-close` (folder enter / back), `o-open` /
 * `o-close` / `o-change` (option panel — UI not yet implemented), `mine` (gameplay mine note), `clear` / `fail`
 * (result), etc.
 *
 * Strict path filter on `sound/lr2/` keeps a per-song WAV named `scratch.wav` from accidentally being picked as the
 * system cursor sound; only files inside the `Sound/lr2/` subtree qualify.
 */
export function pickLR2SystemSoundFile(files: readonly LR2SkinInputFile[], stem: string): LR2SkinInputFile | undefined {
  return pickThemeAudioFile(files, (path) => path.includes('sound/lr2/') || path.includes('sound\\lr2\\'), stem);
}

/**
 * Map-keyed counterpart to {@link pickThemeAudioFile} — same rules (case-insensitive path filter + exact-stem +
 * supported codec) but consumes a pre-read `Map<path, bytes>` so the caller doesn't have to re-issue `arrayBuffer()`
 * reads it already paid for. Used by `loadLR2ThemeSkinsFromFiles` after the up-front shared read.
 */
function pickThemeAudioBytes(
  files: ReadonlyMap<string, LR2SkinFileEntry>,
  pathTest: (lower: string) => boolean,
  stem: string,
): LR2ThemeAudioRef | undefined {
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

interface LR2ThemeAudioRef {
  path: string;
  entry: LR2SkinFileEntry;
}

async function materializeLR2ThemeAudio(ref: LR2ThemeAudioRef | undefined): Promise<LR2ThemeBGM | undefined> {
  if (!ref) return undefined;
  const bytes = ref.entry instanceof Uint8Array ? ref.entry : new Uint8Array(await ref.entry.arrayBuffer());
  return { path: ref.path, bytes };
}

function pickLR2ThemeBGMFromMap(
  files: ReadonlyMap<string, LR2SkinFileEntry>,
  role: 'select' | 'decide',
): LR2ThemeAudioRef | undefined {
  return pickThemeAudioBytes(files, (path) => path.includes('bgm/') || path.includes('bgm\\'), role);
}

function pickFromSoundSet(
  files: ReadonlyMap<string, LR2SkinFileEntry>,
  soundSet: LR2SoundSet | undefined,
  key: LR2SoundSetKey,
): LR2ThemeAudioRef | undefined {
  if (!soundSet) return undefined;
  const path = resolveLR2SoundSetPath(files.keys(), soundSet, key);
  const entry = path === undefined ? undefined : files.get(path);
  return path === undefined || entry === undefined ? undefined : { path, entry };
}

function pickLR2SystemSoundFromMap(
  files: ReadonlyMap<string, LR2SkinFileEntry>,
  stem: string,
): LR2ThemeAudioRef | undefined {
  return pickThemeAudioBytes(files, (path) => path.includes('sound/lr2/') || path.includes('sound\\lr2\\'), stem);
}

/**
 * Loads the named LR2 system sound effect (e.g. `scratch`, `f-open`, `f-close`) from the dropped bundle. Returns
 * `undefined` when the theme doesn't ship that effect.
 */
export async function loadLR2SystemSound(
  files: Iterable<LR2SkinInputFile>,
  stem: string,
): Promise<LR2ThemeBGM | undefined> {
  const match = pickLR2SystemSoundFile([...files], stem);
  if (!match) return undefined;
  const buffer = await match.arrayBuffer();
  return {
    path: normalizePath(match.webkitRelativePath || match.name),
    bytes: new Uint8Array(buffer),
  };
}

/**
 * How a play converts its chart, for the play skin it runs on: the battle mode selected and whether the play is a
 * course stage (where LR2 skips BATTLE and SP TO DP).
 */
export interface LR2PlaySkinBattle {
  readonly battleMode?: BattleMode;
  readonly course?: boolean;
}

export function pickLR2PlaySkin(
  playSkins: LR2PlaySkinMap,
  chartEntry: LR2PlaySkinChart,
  battle?: LR2PlaySkinBattle,
): LR2Skin | undefined {
  const variant = pickLR2PlaySkinVariant(playSkins, chartEntry, battle);
  return variant !== undefined ? playSkins[variant] : undefined;
}

/** The play variant a battle mode turns a chart of `source` into: the copied or merged chart's lanes. */
const BATTLE_PLAY_VARIANTS: Partial<Record<BattleMode, Partial<Record<ChartPlayVariant, ChartPlayVariant>>>> = {
  'SP-TO-DP': { '5': '10', '7': '14', '9': '7', '10': '5', '14': '7' },
  'D-BATTLE': { '5': '10', '7': '14' },
  BATTLE: { '5': '10', '7': '14', '24': '48' },
  'BATTLE-AS': { '5': '10', '7': '14', '24': '48' },
};

/**
 * The play skins a chart plays on, best first: a two-player BATTLE of a 5/7KEY chart on LR2's BATTLE play skin (a DP
 * one without it, for its 2P lanes), D-BATTLE / SP TO DP and the other battle modes on the converted chart's lanes,
 * and anything else on the chart's own.
 */
function playSkinOrder(source: ChartPlayVariant, battle: LR2PlaySkinBattle | undefined): readonly LR2PlayVariant[] {
  const mode = battle?.battleMode ?? 'OFF';
  const course = battle?.course === true;
  if (mode === 'TWO-PLAYER' && !course && (source === '5' || source === '7')) {
    const battleSkins: readonly LR2PlayVariant[] = source === '7' ? ['7-battle'] : ['5-battle', '7-battle'];
    return [...battleSkins, ...PLAY_SKIN_FALLBACKS[source === '7' ? '14' : '10']];
  }
  const converted = mode === 'SP-TO-DP' && course ? undefined : BATTLE_PLAY_VARIANTS[mode]?.[source];
  return PLAY_SKIN_FALLBACKS[converted ?? source];
}

/**
 * The play-skin variant {@link pickLR2PlaySkin} plays a chart on, so a host can parse that skin again (for a course
 * stage's parse-time ops, see {@link LR2ThemeSkins.loadSkin}).
 */
export function pickLR2PlaySkinVariant(
  playSkins: LR2PlaySkinMap,
  chartEntry: LR2PlaySkinChart,
  battle?: LR2PlaySkinBattle,
): LR2PlayVariant | undefined {
  const target = resolveChartPlayVariant({
    chartPath: chartEntry.chartPath,
    events: chartEntry.chart.events,
    bms: chartEntry.chart.bms,
    bmson: chartEntry.chart.bmson,
  });
  return playSkinOrder(target, battle).find((variant) => playSkins[variant] !== undefined);
}

export function summarizeLR2PlaySkins(playSkins: LR2PlaySkinMap, separator = ','): string {
  return (Object.entries(playSkins) as Array<[LR2PlayVariant, LR2Skin]>)
    .map(([variant, value]) => `${variant.replace('-battle', 'K-BATTLE').replace(/^(\d+)$/u, '$1K')}=${value.name}`)
    .join(separator);
}
