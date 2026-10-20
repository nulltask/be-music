// The LR2 theme the LR2 family draws with: every theme the drops brought (the Debug Menu's "LR2 theme" picker lists
// them), the one mounted, and its skins, BGM and system sounds.

import {
  discoverLR2Themes,
  loadLR2ThemeSkinsFromFiles,
  type LR2DiscoveredTheme,
  type LR2PlaySkinMap,
  type LR2PlayVariant,
  type LR2Skin,
  type LR2ThemeSkins,
} from '@be-music/skin-lr2';
import { resolveLR2CourseOps } from '@be-music/skin-lr2/state';
import type { CourseView, SystemSoundSet } from '@be-music/player-scene-model';
import { applyLoadProgress, type LoadingOverlayElements } from '../../loading-overlay.ts';
import type { LR2ResultJingles } from '../../result-jingles.ts';

export interface LR2ThemeServiceOptions {
  /** The loading overlay a theme load reports its progress on. */
  readonly elements: LoadingOverlayElements;
  readonly setStatus: (text: string) => void;
  /** Rebuilds the Debug Menu's "Skin system" picker, which offers LR2 once a theme is mounted. */
  readonly rebuildSkinFamilyPicker: () => void;
  /** Rebuilds the Debug Menu's "LR2 theme" picker from {@link LR2ThemeService.availableLR2Themes}. */
  readonly rebuildLR2ThemePicker: () => void;
}

/** The LR2 themes dropped so far and the one mounted: its skins for every screen, its BGM and its system sounds. */
export class LR2ThemeService {
  /**
   * Per-variant play skins, keyed by `LR2PlayVariant`. Loaded once at theme-drop time so a DP chart can pick
   * `playSkins['14']` while a regular SP chart picks `playSkins['7']`.
   */
  public readonly playSkins: LR2PlaySkinMap = {};
  /**
   * LR2 themes detected in the most recent drop, scoped to `LR2files/Theme/<name>/` subdirs that contain at least
   * one `.lr2skin`. Populated by {@link loadTheme}; the Debug Menu's "LR2 theme" picker reads from here and lets
   * the user swap between themes without re-dropping. Empty when no LR2 theme is loaded.
   */
  public availableLR2Themes: ReadonlyArray<LR2DiscoveredTheme<File>> = [];
  /**
   * Name of the LR2 theme currently mounted into the `playSkins` / `selectSkin` / … slots. Used by the picker to
   * (a) compute the initial selection on rebuild and (b) preserve the user's chosen theme across drops that ship
   * the same theme name. `undefined` when no LR2 theme is loaded.
   */
  public activeLR2ThemeName: string | undefined;
  public selectSkin: LR2Skin | undefined;
  public resultSkin: LR2Skin | undefined;
  /** LR2 course-result skin (`#INFORMATION` type 15); the course result falls back to {@link resultSkin} without it. */
  public courseResultSkin: LR2Skin | undefined;
  /**
   * Re-parses one of the mounted LR2 theme's skins with extra parse-time ops (`LR2ThemeSkins.loadSkin`): a course stage
   * plays on its skins parsed with the course ops, as LR2 reads a skin at each scene start.
   */
  private loadLR2ThemeSkin: LR2ThemeSkins['loadSkin'] | undefined;
  /**
   * LR2 Decide-screen skin (the brief splash between song select and gameplay). Loaded from
   * `Theme/<name>/Decide/decide.lr2skin` by `loadLR2ThemeSkinsFromFiles`. When undefined, the host skips the splash and
   * transitions directly to gameplay.
   */
  public decideSkin: LR2Skin | undefined;
  /**
   * Loop-playable BGM bytes for the song-select scene (`LR2files/BGM/<theme>/select.wav` from the dropped theme), handed
   * to the select screen in its sound set (`selectSoundSet`).
   */
  private selectBGMBytes: Uint8Array | undefined;
  /** LR2 result jingles (`clear` / `fail` / `result`); the result scene picks one per outcome (`resolveResultJingle`). */
  private clearBGMBytes: Uint8Array | undefined;
  private failBGMBytes: Uint8Array | undefined;
  private resultBGMBytes: Uint8Array | undefined;
  /** LR2 course-result jingles (`courseclear` / `coursefail`); the course result falls back to the clear / fail ones. */
  private courseClearBGMBytes: Uint8Array | undefined;
  private courseFailBGMBytes: Uint8Array | undefined;
  /**
   * One-shot song-decided sound bytes (`LR2files/BGM/<theme>/decide.wav`): the select screen's decide jingle, played as a
   * chart or a course starts a play (`selectSoundSet`).
   */
  private decideBGMBytes: Uint8Array | undefined;
  /**
   * LR2 system sound-effect bundle (`LR2files/Sound/lr2/<name>.wav`): the select screen's cues, in its sound set
   * (`selectSoundSet`).
   */
  private systemSoundBundle: {
    cursorMove?: Uint8Array;
    folderOpen?: Uint8Array;
    folderClose?: Uint8Array;
    optionOpen?: Uint8Array;
    optionClose?: Uint8Array;
    optionChange?: Uint8Array;
  } = {};
  private readonly elements: LR2ThemeServiceOptions['elements'];
  private readonly setStatus: LR2ThemeServiceOptions['setStatus'];
  private readonly rebuildSkinFamilyPicker: LR2ThemeServiceOptions['rebuildSkinFamilyPicker'];
  private readonly rebuildLR2ThemePicker: LR2ThemeServiceOptions['rebuildLR2ThemePicker'];

  public constructor(options: LR2ThemeServiceOptions) {
    this.elements = options.elements;
    this.setStatus = options.setStatus;
    this.rebuildSkinFamilyPicker = options.rebuildSkinFamilyPicker;
    this.rebuildLR2ThemePicker = options.rebuildLR2ThemePicker;
  }

  /**
   * Loads a drop's LR2 theme files: every `LR2files/Theme/<name>/` it carries joins the themes dropped so far, and one
   * of them is mounted (see {@link mountLR2Theme}).
   */
  public async loadTheme(files: File[]): Promise<void> {
    // Themes are discovered first so a multi-theme drop (e.g. `LR2files/Theme/{default,LITONE4}/...`) surfaces every
    // subtree to the picker. The picker UI then lets the user pick which one to mount; the rest of the dropped
    // files (BGM / Sound under `LR2files/`) stay accessible to the selected theme via the loader's shared file map.
    const discovered = discoverLR2Themes(files);
    if (discovered.length === 0) {
      // Drop carried a `.lr2skin` but no `LR2files/Theme/<name>/` shape (rare — handcrafted bundle or zip flattened
      // without keeping the parent dirs). Fall back to "treat everything as one theme" so the legacy single-bundle
      // path keeps working — the picker stays empty in this case.
      this.availableLR2Themes = [];
      await this.mountLR2Theme(files, undefined);
      return;
    }
    // Accumulate themes across drops — mirrors how the song collection store appends rather than replaces. Newer
    // drops replace same-named entries (so the user can refresh a theme's files by re-dropping), older drops stay
    // visible in the picker. Without this the user would need to keep ALL themes in a single drop to switch
    // between them, defeating the picker's purpose.
    const mergedByName = new Map<string, LR2DiscoveredTheme<File>>();
    for (const existing of this.availableLR2Themes) {
      mergedByName.set(existing.name, existing);
    }
    for (const incoming of discovered) {
      mergedByName.set(incoming.name, incoming);
    }
    this.availableLR2Themes = [...mergedByName.values()].sort((a, b) => a.name.localeCompare(b.name));
    // Pick the theme to mount this drop. Priority order:
    //   1. The currently-active theme if THIS drop covered it (= the user re-dropped to refresh its assets).
    //   2. The first theme from the new drop (alphabetic) — gives a sensible default for fresh drops.
    //   3. Fall back to whatever was active before this drop, in case the user dropped a non-active theme just to
    //      populate the picker without forcing a swap.
    const active = this.activeLR2ThemeName;
    const refreshedActive = active !== undefined ? discovered.find((theme) => theme.name === active) : undefined;
    const next = refreshedActive ?? discovered[0]!;
    // Union the theme's own files with shared LR2files siblings (`WallPaper/`, `BGM/`, `Sound/`, etc.) so the loader
    // can resolve `#CUSTOMFILE`-style wildcard assets like `LR2files/WallPaper/Select/*.bmp` — those live OUTSIDE
    // `LR2files/Theme/<name>/` and are dropped by `discoverLR2Themes`, which intentionally scopes its return to the
    // theme subtree. Without this union the LR2 default select skin's main backdrop (decoded from `WallPaper/Select/`)
    // never reaches `skin.files`, so the wildcard `resolveLR2AssetBytes` lookup misses and the chrome paints with a
    // black background.
    const themeFileSet = new Set(next.files);
    const otherLR2Files = files.filter((file) => {
      if (themeFileSet.has(file)) return false;
      const lower = (file.webkitRelativePath || file.name).toLowerCase();
      // Keep anything under `lr2files/` that isn't under any theme subtree. We deliberately don't restrict to
      // `lr2files/{wallpaper,bgm,sound}/` so future LR2 shared-asset directories (e.g. a `Common/` folder some skins
      // reference) automatically come along.
      const idx = lower.indexOf('lr2files/');
      if (idx === -1) return false;
      const afterLR2Files = lower.slice(idx + 'lr2files/'.length);
      return !afterLR2Files.startsWith('theme/');
    });
    await this.mountLR2Theme([...next.files, ...otherLR2Files], next.name);
  }

  /**
   * Loads a specific LR2 theme's files through the underlying `loadLR2ThemeSkinsFromFiles` and stamps the result
   * onto the host's skin / BGM / system-sound slots. Centralised so both the initial drop path
   * ({@link loadTheme}) and the Debug Menu's theme-picker path go through the same wiring — without this split the
   * picker would have to re-implement the slot assignment block.
   */
  public async mountLR2Theme(files: ReadonlyArray<File>, themeName: string | undefined): Promise<void> {
    this.setStatus(themeName ? `Loading LR2 theme "${themeName}"...` : 'Loading LR2 theme...');
    const loadedTheme = await loadLR2ThemeSkinsFromFiles([...files], {
      onProgress: (progress) => applyLoadProgress(this.elements, progress),
    });
    for (const variant of Object.keys(this.playSkins) as LR2PlayVariant[]) {
      delete this.playSkins[variant];
    }
    Object.assign(this.playSkins, loadedTheme.playSkins);
    this.selectSkin = loadedTheme.selectSkin;
    this.resultSkin = loadedTheme.resultSkin;
    this.courseResultSkin = loadedTheme.courseResultSkin;
    this.loadLR2ThemeSkin = loadedTheme.loadSkin;
    this.decideSkin = loadedTheme.decideSkin;
    this.selectBGMBytes = loadedTheme.selectBGM?.bytes;
    this.decideBGMBytes = loadedTheme.decideBGM?.bytes;
    this.clearBGMBytes = loadedTheme.clearBGM?.bytes;
    this.failBGMBytes = loadedTheme.failBGM?.bytes;
    this.resultBGMBytes = loadedTheme.resultBGM?.bytes;
    this.courseClearBGMBytes = loadedTheme.courseClearBGM?.bytes;
    this.courseFailBGMBytes = loadedTheme.courseFailBGM?.bytes;
    this.systemSoundBundle = {
      cursorMove: loadedTheme.systemSounds.cursorMove?.bytes,
      folderOpen: loadedTheme.systemSounds.folderOpen?.bytes,
      folderClose: loadedTheme.systemSounds.folderClose?.bytes,
      optionOpen: loadedTheme.systemSounds.optionOpen?.bytes,
      optionClose: loadedTheme.systemSounds.optionClose?.bytes,
      optionChange: loadedTheme.systemSounds.optionChange?.bytes,
    };
    this.activeLR2ThemeName = themeName;
    // BGM / decide / system-sound bytes are stashed on the host here, but NOT pushed onto the live select view yet —
    // that happens in `showSelect()` once every load task has resolved. Otherwise the small theme bundle would land
    // first and start BGM playing before the larger song collection has even finished parsing, which felt jarring with
    // a loading overlay still on screen.
    //
    // We deliberately don't paint a per-skin "Play: 7K=… / 14K=…" status here. The skin is observable in-canvas the
    // moment the user enters song-select; spelling it out in the toolbar status panel was redundant and made the
    // toolbar wider than it needed to be. `handleDrop` writes a terse "Theme loaded" / "N charts loaded" once
    // everything lands.
    // Refresh the Debug Menu's "Skin family" dropdown so the LR2 entry becomes selectable now that the theme has
    // contributed at least one LR2 skin asset. Also rebuild the LR2 theme picker so it reflects the new options.
    this.rebuildSkinFamilyPicker();
    this.rebuildLR2ThemePicker();
  }

  /**
   * An LR2 skin for a course scene: the theme's skin parsed again with the course ops (290 + kind, 280-289 for a stage),
   * so its `#IF` blocks gated on them are taken as LR2 would. Falls back to the skin as mounted.
   */
  public courseLR2Skin(
    mounted: LR2Skin | undefined,
    courseInfo: CourseView,
    options: Omit<Parameters<LR2ThemeSkins['loadSkin']>[0], 'parseOps'>,
  ): LR2Skin | undefined {
    if (mounted === undefined || this.loadLR2ThemeSkin === undefined) return mounted;
    return this.loadLR2ThemeSkin({ ...options, parseOps: resolveLR2CourseOps(courseInfo) }) ?? mounted;
  }

  /** The select screen's sounds from the LR2 theme: its select BGM, decide jingle and cues (by bytes); none without one. */
  public selectSoundSet(): SystemSoundSet {
    const set: { -readonly [S in keyof SystemSoundSet]: SystemSoundSet[S] } = {};
    const add = (slot: keyof SystemSoundSet, bytes: Uint8Array | undefined): void => {
      if (bytes !== undefined) set[slot] = { bytes };
    };
    add('selectBGM', this.selectBGMBytes);
    add('decideBGM', this.decideBGMBytes);
    add('cursor', this.systemSoundBundle.cursorMove);
    add('folderOpen', this.systemSoundBundle.folderOpen);
    add('folderClose', this.systemSoundBundle.folderClose);
    add('optionOpen', this.systemSoundBundle.optionOpen);
    add('optionClose', this.systemSoundBundle.optionClose);
    add('optionChange', this.systemSoundBundle.optionChange);
    return set;
  }

  /** The theme's result jingles by slot: a result plays one of them, and the test hook names it by its slot. */
  public resultJingles(): Readonly<LR2ResultJingles> {
    return {
      clear: this.clearBGMBytes,
      fail: this.failBGMBytes,
      result: this.resultBGMBytes,
      courseClear: this.courseClearBGMBytes,
      courseFail: this.courseFailBGMBytes,
    };
  }
}
