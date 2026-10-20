// The beatoraja theme the beatoraja family draws with: the bundle the last drop brought, its BGM and system sounds, and
// its entries loaded as scene kits, each by the entry the Debug Menu picked for its skin type and with the player's
// options for it. One set of kit caches serves the whole session, since PixiJS textures are never destroyed.

import { logger } from '@be-music/player-browser';
import type { AudioOwner, AudioService } from '@be-music/player-browser/audio';
import type { BeatorajaKit, DecideSceneKit, PlayScene, SelectScene } from '@be-music/player-browser/host';
import {
  createBeatorajaSceneKitCaches,
  createBeatorajaSkinLoadContext,
  findBeatorajaThemeBGM,
  loadBeatorajaSceneKit,
  loadBeatorajaThemeFromFiles,
  pickBeatorajaPlayableVariant,
  releaseBeatorajaSceneKitAssets,
  resolveBeatorajaSkinConfig,
  summarizeBeatorajaPlaySkins,
  type BeatorajaPlayableVariant,
  type BeatorajaSceneKitCaches,
  type BeatorajaThemeBGM,
  type BeatorajaThemeBundle,
} from '@be-music/player-browser/skin';
import {
  discoverBeatorajaSelectBGMPath,
  discoverBeatorajaSystemSoundPaths,
  type BeatorajaSystemSoundPaths,
} from '@be-music/skin-beatoraja/scene';
import {
  BEATORAJA_SKIN_TYPE,
  expandBeatorajaWildcard,
  type BeatorajaSkinConfig,
  type BeatorajaSkinEntry,
  type BeatorajaSkinHeader,
} from '@be-music/skin-beatoraja';
import { systemSoundSetFromBeatoraja, type LibraryChart, type SystemSoundSet } from '@be-music/player-scene-model';
import { chartShapeFor, resolveBeatorajaSkinVariant } from '../../chart-shape.ts';
import { playSkinTypeForVariant } from '../../demo-utils.ts';
import { applyLoadProgress, type LoadingOverlayElements } from '../../loading-overlay.ts';

const dropLog = logger('drop');
const gamereplay = logger('gameplay');

export interface BeatorajaThemeServiceOptions {
  /** The loading overlay a theme load reports its progress on. */
  readonly elements: LoadingOverlayElements;
  /**
   * The audio service: it reads the skin sounds from the theme's files (`setTheme`), and plays the ones a decide or
   * result skin starts as it loads, owned by the theme.
   */
  readonly audio: Pick<AudioService, 'setTheme' | 'stopOwned' | 'skinSounds'>;
  readonly setStatus: (text: string) => void;
  /** The select screen the router keeps, on the stage or off it; `undefined` before the first. */
  readonly selectView: () => SelectScene | undefined;
  /** The play, loading behind a decide screen or on the stage. */
  readonly gameplayView: () => PlayScene | undefined;
  /** Rebuilds the Debug Menu's skin pickers, one per skin type the theme ships. */
  readonly rebuildBeatorajaSkinPickers: () => void;
  /** Rebuilds the Debug Menu's "Skin system" picker, which offers beatoraja once a theme is loaded. */
  readonly rebuildSkinFamilyPicker: () => void;
  /** Shows the beatoraja play's entry in the skin-options panel. */
  readonly refreshBeatorajaPlaySkinOptions: () => void;
  /** Shows the beatoraja select entry in the skin-options panel. */
  readonly refreshBeatorajaSelectSkinOptions: () => void;
}

/** A beatoraja theme's play entry a play is drawn with: its path, its header and the key mode it is for. */
export interface BeatorajaPlayEntry {
  readonly entryPath: string;
  readonly header: BeatorajaSkinHeader;
  readonly variant: BeatorajaPlayableVariant;
}

/** The beatoraja theme loaded, and its entries loaded as the kits the beatoraja screens are drawn with. */
export class BeatorajaThemeService {
  /**
   * The beatoraja theme bundle the last beatoraja drop brought, held in parallel with the LR2 theme: its entries are
   * loaded as kits for the beatoraja scenes.
   */
  public beatorajaTheme: BeatorajaThemeBundle | undefined;
  /**
   * BGM bytes discovered inside the loaded beatoraja theme bundle (`decide.wav` / `clear.wav` /
   * `fail.wav` / `result.wav`). Populated alongside `beatorajaTheme` after a successful drop.
   * The decide / result scenes consume these directly — no separate caching layer needed since
   * decoding happens lazily inside each scene's audio context.
   */
  public beatorajaThemeBGM: BeatorajaThemeBGM = {};
  /**
   * Owns the skin sounds a beatoraja decide / result skin starts while its `main()` runs at load time
   * (`main_state.audio_*`, e.g. ModernChic's `Root/customsound.lua`). They play through the audio service, which reads
   * them from the theme's files; a new theme stops them with `stopOwned`.
   */
  private readonly themeOwner: AudioOwner = {};
  /**
   * System-sound paths discovered from the active theme bundle. Re-probed every theme load
   * via {@link discoverBeatorajaSystemSoundPaths}; the beatoraja select screen's sound set (`selectSoundSet`) plays
   * them for its cursor / decide / folder / option cues. Stays empty (`{}`)
   * for stripped LR2 themes that don't ship a `sound/` subdirectory.
   */
  private beatorajaSystemSoundPaths: BeatorajaSystemSoundPaths = {};
  /**
   * Looping select-scene BGM path discovered from the active theme bundle. Re-probed on
   * every theme load via {@link discoverBeatorajaSelectBGMPath}; the beatoraja select screen's sound set plays it as its
   * BGM, started on enter and stopped on exit. `undefined` for themes
   * that don't ship a select BGM (the scene runs silent in the background then, just chart
   * preview clips and navigation cues).
   */
  private beatorajaSelectBGMPath: string | undefined;
  /**
   * The beatoraja theme's play entry the play on the stage is drawn with, when it plays on a beatoraja theme: the Debug
   * Menu's "Play 7K / Play 5K / …" skin pickers and the skin-options panel apply to it while that play is up. It is
   * set as the play takes the stage and belongs to that play: once the router holds another play (one loading behind
   * a decide screen included) or none, there is none.
   */
  public get activeBeatorajaPlay(): BeatorajaPlayEntry | undefined {
    const active = this.activePlay;
    return active !== undefined && active.view === this.gameplayView() ? active.entry : undefined;
  }
  public set activeBeatorajaPlay(entry: BeatorajaPlayEntry | undefined) {
    this.activePlay = entry === undefined ? undefined : { view: this.gameplayView(), entry };
  }
  /** {@link activeBeatorajaPlay}, with the play it was set for. */
  private activePlay: { readonly view: PlayScene | undefined; readonly entry: BeatorajaPlayEntry } | undefined;
  /**
   * The beatoraja theme's select entry as last loaded (`loadBeatorajaSelectKit`): the select screen takes it again on
   * every return to it while the theme and the entry stay the same, rather than loading the skin again.
   */
  public beatorajaSelectKit:
    | {
        readonly bundle: BeatorajaThemeBundle;
        readonly entryPath: string;
        readonly kit: BeatorajaKit;
        readonly header: BeatorajaSkinHeader;
      }
    | undefined;
  /**
   * What each beatoraja skin entry is loaded with (`loadBeatorajaSceneKit`), keyed by its entry path:
   * - `textures`: never destroyed in this session — disposing beatoraja textures and re-decoding the same bytes
   *   crashes PixiJS v8's bind-group cache (see `textures.ts`). A new theme only forgets them.
   * - `fonts`: reused while the same theme is active, then disposed when a new theme is dropped so `document.fonts`
   *   and Pixi's bitmap-font cache don't accumulate old entries.
   * - `skinConfigs`: the config picks. The skin-options panel mutates these and the active scene re-mounts with the
   *   updated values. Survives scene transitions so navigating away and back preserves the user's choices for each
   *   skin (a select skin and a play skin can carry independent configs).
   */
  public readonly beatorajaKitCaches: BeatorajaSceneKitCaches = createBeatorajaSceneKitCaches();
  /**
   * Per-`SkinType` user-picked entry override. Lets the user choose between multiple discovered
   * skins for a given scene type from the Debug Menu. Keyed by the numeric `header.type` so
   * each scene (`MUSIC_SELECT = 5`, `PLAY_7KEYS = 0`, etc.) tracks its own override.
   */
  public readonly beatorajaSkinOverridesByType: Map<number, string> = new Map<number, string>();
  private readonly elements: BeatorajaThemeServiceOptions['elements'];
  private readonly audio: BeatorajaThemeServiceOptions['audio'];
  private readonly setStatus: BeatorajaThemeServiceOptions['setStatus'];
  private readonly selectView: BeatorajaThemeServiceOptions['selectView'];
  private readonly gameplayView: BeatorajaThemeServiceOptions['gameplayView'];
  private readonly rebuildBeatorajaSkinPickers: BeatorajaThemeServiceOptions['rebuildBeatorajaSkinPickers'];
  private readonly rebuildSkinFamilyPicker: BeatorajaThemeServiceOptions['rebuildSkinFamilyPicker'];
  private readonly refreshBeatorajaPlaySkinOptions: BeatorajaThemeServiceOptions['refreshBeatorajaPlaySkinOptions'];
  private readonly refreshBeatorajaSelectSkinOptions: BeatorajaThemeServiceOptions['refreshBeatorajaSelectSkinOptions'];

  public constructor(options: BeatorajaThemeServiceOptions) {
    this.elements = options.elements;
    this.audio = options.audio;
    this.setStatus = options.setStatus;
    this.selectView = options.selectView;
    this.gameplayView = options.gameplayView;
    this.rebuildBeatorajaSkinPickers = options.rebuildBeatorajaSkinPickers;
    this.rebuildSkinFamilyPicker = options.rebuildSkinFamilyPicker;
    this.refreshBeatorajaPlaySkinOptions = options.refreshBeatorajaPlaySkinOptions;
    this.refreshBeatorajaSelectSkinOptions = options.refreshBeatorajaSelectSkinOptions;
  }

  /**
   * Load a beatoraja theme drop in parallel with the LR2 path. The beatoraja loader is independent of `loadTheme` —
   * both states coexist so the user can drop both formats and switch between them later.
   */
  public async loadBeatorajaTheme(files: File[]): Promise<void> {
    this.setStatus('Loading beatoraja theme...');
    try {
      const bundle = await loadBeatorajaThemeFromFiles(files, {
        onProgress: (progress) => applyLoadProgress(this.elements, progress),
      });
      // Drop the per-entry texture caches from the previous theme (we don't destroy individual
      // beatoraja textures in this session — see `beatorajaKitCaches`'s field comment) and dispose its fonts.
      // Clearing the map releases the only reference to the old theme's decoded bytes; the
      // underlying Pixi textures stay allocated until page reload, but they're unreachable from
      // the renderer once the new theme replaces `beatorajaTheme`.
      releaseBeatorajaSceneKitAssets(this.beatorajaKitCaches);
      // Stop the skin sounds the previous theme's skins started at load time (a loop would otherwise keep playing).
      this.audio.stopOwned(this.themeOwner);
      // Probe the bundle for navigation system sounds (cursor / decide / cancel / folder /
      // option). The discovery walks well-known filenames inside the theme's `sound/` subdir
      // (and an LR2-compatible `LR2files/Sound/lr2/*.wav` fallback) — slots without a match
      // stay undefined and the select scene runs silent for those events. Beatoraja's own
      // engine reads these paths from `config.json`; the web port uses convention-based
      // probing instead since we don't load the user's beatoraja config.
      this.beatorajaSystemSoundPaths = discoverBeatorajaSystemSoundPaths(bundle.files);
      // Looping select BGM path. Probes the standard `BGM/select.*` locations plus an LR2-
      // compatible fallback. Stays `undefined` for themes without a select BGM file (the
      // scene runs silent in the background then).
      this.beatorajaSelectBGMPath = discoverBeatorajaSelectBGMPath(bundle.files);
      this.beatorajaTheme = bundle;
      // The skin sounds (`main_state.audio_*`) play through the audio service, which reads them from the theme's files:
      // those of the scenes made with `create*Scene` and those a skin starts at load time.
      this.audio.setTheme({ files: bundle.files });
      // Drop overrides from the previous theme — entryPaths from the old bundle will no longer
      // resolve against the new entries. Without this `pickBeatorajaSkinEntryWithOverride`'s
      // self-clearing fallback would still kick in, but the picker dropdowns would briefly show
      // stale labels until the user opened a scene that hit that fallback. Clearing eagerly keeps
      // the GUI honest.
      this.beatorajaSkinOverridesByType.clear();
      this.rebuildBeatorajaSkinPickers();
      // The beatoraja entry just became selectable in the top-level "Skin family" dropdown.
      this.rebuildSkinFamilyPicker();
      // Scan the dropped bundle for decide / clear / fail / result BGM. Heuristic by basename —
      // see `findBeatorajaThemeBGM` for the rules. Awaited because some entries are read lazily;
      // the load is small (<1 MiB) and serialized so it doesn't add visible latency.
      this.beatorajaThemeBGM = await findBeatorajaThemeBGM(bundle);
      const summary = summarizeBeatorajaPlaySkins(bundle.theme.playSkins) || 'none';
      const sceneSummary = [
        bundle.theme.selectSkin ? 'select' : null,
        bundle.theme.decideSkin ? 'decide' : null,
        bundle.theme.resultSkin ? 'result' : null,
        bundle.theme.courseResultSkin ? 'course-result' : null,
      ]
        .filter((s): s is string => s !== null)
        .join('+');
      dropLog.info(
        `beatoraja theme loaded · files=${bundle.files.size} · play=${summary}${sceneSummary ? ` · scenes=${sceneSummary}` : ''}${
          bundle.warnings.length > 0 ? ` · warnings=${bundle.warnings.length}` : ''
        }`,
      );
      if (bundle.warnings.length > 0) {
        for (const w of bundle.warnings) {
          dropLog.warn(`beatoraja skin warning: ${w.entryPath}: ${w.message}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dropLog.warn(`beatoraja theme load failed: ${message}`);
    }
  }

  /**
   * The beatoraja theme's play entry for `song`, loaded as a kit (`loadBeatorajaSceneKit`), with the entry the skin
   * pickers and the skin-options panel apply to; `undefined`, with the status saying why, when the theme has no play
   * skin for the chart or it fails to load.
   *
   * Two variants are in play: the skin's, which `play_*` entry to load (a theme without the chart's own falls back
   * through `pickBeatorajaPlayableSkinVariant`'s chain, `9 → 7 → 14 → 5 → 10`), and the chart's, which the play session
   * lays the lanes out for (`resolveLibraryChartPlayVariant`), so a 9 KEY chart keeps its POPN lanes on a 7 KEY
   * skin.
   */
  public async loadBeatorajaPlayKit(chartEntry: LibraryChart): Promise<
    | {
        readonly kit: BeatorajaKit;
        readonly entryPath: string;
        readonly header: BeatorajaSkinHeader;
        readonly variant: BeatorajaPlayableVariant;
      }
    | undefined
  > {
    const bundle = this.beatorajaTheme;
    if (bundle === undefined) return undefined;
    const variant = resolveBeatorajaSkinVariant(bundle, chartEntry);
    const chartVariant = pickBeatorajaPlayableVariant(chartShapeFor(chartEntry));
    if (variant === undefined || chartVariant === undefined) {
      this.setStatus(`Beatoraja gameplay unavailable: no play skin for ${chartEntry.title}`);
      return undefined;
    }
    if (variant !== chartVariant) {
      // The skin's lane count differs from the chart's; the play keeps the chart's lanes.
      gamereplay.warn(
        `beatoraja gameplay: theme has no '${chartVariant}' skin — falling back to '${variant}' (lane chrome may not match chart key count)`,
      );
    }
    // The entry for the variant, as the Debug Menu's skin picker overrides it.
    const playTypeCode = playSkinTypeForVariant(variant);
    const playCandidates = bundle.theme.entries.filter((entry) => entry.header.type === playTypeCode);
    const selectedEntry = this.pickBeatorajaSkinEntryWithOverride(
      playTypeCode,
      playCandidates,
      bundle.theme.playSkins[variant],
    );
    if (selectedEntry === undefined) {
      gamereplay.warn(`beatoraja gameplay: no skin entry for variant '${variant}'`);
      this.setStatus(`Beatoraja gameplay unavailable: no '${variant}' skin`);
      return undefined;
    }
    // Two-pass evaluation, as the select scene's; textures and fonts are reused when the entry's were decoded before. A
    // play skin's `main()` gets no load-time `main_state`: play skins gate on ops at draw time.
    const load = await loadBeatorajaSceneKit({
      files: bundle.files,
      entryPath: selectedEntry.entryPath,
      caches: this.beatorajaKitCaches,
      onSources: (sourceBundle) => {
        gamereplay.info(
          `beatoraja gameplay source bundle: resolved=${sourceBundle.assets.length} unresolved=${sourceBundle.unresolved.length} (entry=${selectedEntry.entryPath})`,
        );
        for (const u of sourceBundle.unresolved) {
          gamereplay.warn(`beatoraja gameplay unresolved source[${u.id}] '${u.path}': ${u.reason}`);
        }
      },
      onFonts: (loaded, declared) => {
        gamereplay.info(
          `beatoraja gameplay fonts: declared=${declared} loaded=${loaded.values().length} (entry=${selectedEntry.entryPath})`,
        );
      },
    });
    if (!load.ok) {
      gamereplay.warn(`beatoraja gameplay${load.stage === 'header' ? ' header' : ''}: ${load.message}`);
      this.setStatus(`Beatoraja gameplay unavailable: ${load.message}`);
      return undefined;
    }
    return {
      kit: { family: 'beatoraja', kit: load.kit },
      entryPath: selectedEntry.entryPath,
      header: load.header,
      variant,
    };
  }

  /**
   * Applies new skin options (or another play entry the Debug Menu picked) to the beatoraja play on the stage without
   * restarting the chart: the entry is loaded again with them (its textures decoded again, as an option can change
   * `source[]`) and handed to the play (`PlayScene.updateKit`), which rebuilds its skin and keeps its state.
   */
  public async applyBeatorajaPlaySkinConfig(entryPath: string, config: BeatorajaSkinConfig): Promise<void> {
    const bundle = this.beatorajaTheme;
    const view = this.gameplayView();
    const active = this.activeBeatorajaPlay;
    if (bundle === undefined || view === undefined || view.identity.family !== 'beatoraja' || active === undefined) {
      return;
    }
    const load = await loadBeatorajaSceneKit({
      files: bundle.files,
      entryPath,
      caches: this.beatorajaKitCaches,
      skinConfig: config,
      reloadTextures: true,
    });
    if (!load.ok || this.gameplayView() !== view) return;
    view.updateKit({ family: 'beatoraja', kit: { ...load.kit, skinConfig: config } });
    this.activeBeatorajaPlay = { entryPath, header: load.header, variant: active.variant };
    this.refreshBeatorajaPlaySkinOptions();
  }

  /**
   * The beatoraja theme's select entry as a select kit, or `undefined` when there is none to show: no select skin in the
   * theme, or one that failed to load (the status says why). The player's pick in the Debug Menu wins over the
   * discovery's (`theme.selectSkin`). The entry is loaded with the player's options for it (`loadBeatorajaSceneKit`:
   * the header pass seeds them the first time), or the kit last loaded is taken again while the theme and the entry stay
   * the same.
   */
  public async loadBeatorajaSelectKit(): Promise<BeatorajaKit | undefined> {
    const bundle = this.beatorajaTheme;
    if (bundle === undefined) return undefined;
    const selectCandidates = bundle.theme.entries.filter(
      (entry) => entry.header.type === BEATORAJA_SKIN_TYPE.MUSIC_SELECT,
    );
    const selectedEntry = this.pickBeatorajaSkinEntryWithOverride(
      BEATORAJA_SKIN_TYPE.MUSIC_SELECT,
      selectCandidates,
      bundle.theme.selectSkin,
    );
    if (selectedEntry === undefined) {
      gamereplay.warn('beatoraja select: no select skin in theme');
      this.setStatus('Beatoraja select unavailable: no select skin');
      return undefined;
    }
    const kept = this.beatorajaSelectKit;
    if (kept !== undefined && kept.bundle === bundle && kept.entryPath === selectedEntry.entryPath) return kept.kit;
    // The options' `filepath[]` picks (the header's default file of each wildcard the first time) choose the files of
    // `source[]`, as on the other screens.
    const load = await loadBeatorajaSceneKit({
      files: bundle.files,
      entryPath: selectedEntry.entryPath,
      caches: this.beatorajaKitCaches,
      onSources: (sourceBundle) => {
        gamereplay.info(
          `beatoraja select source bundle: resolved=${sourceBundle.assets.length} unresolved=${sourceBundle.unresolved.length} (entry=${selectedEntry.entryPath})`,
        );
        for (const u of sourceBundle.unresolved) {
          gamereplay.warn(`beatoraja select unresolved source[${u.id}] '${u.path}': ${u.reason}`);
        }
      },
    });
    if (!load.ok) {
      gamereplay.warn(`beatoraja select: ${load.message}`);
      this.setStatus(`Beatoraja select unavailable: ${load.message}`);
      return undefined;
    }
    const kit: BeatorajaKit = { family: 'beatoraja', kit: load.kit };
    this.beatorajaSelectKit = { bundle, entryPath: selectedEntry.entryPath, kit, header: load.header };
    return kit;
  }

  /**
   * Applies the player's new options for a beatoraja select entry to the select screen shown, without making it again:
   * the skin's Lua `main()` runs again (or its JSON is parsed again) with them, its textures are decoded again (other
   * options can build another `source[]`), and the screen takes the kit (`updateKit`), keeping its place.
   */
  public async applyBeatorajaSelectSkinConfig(entryPath: string, config: BeatorajaSkinConfig): Promise<void> {
    const bundle = this.beatorajaTheme;
    if (!bundle || this.selectView()?.identity.family !== 'beatoraja') return;
    // Load the SPECIFIC entry — different from the discovery's "best" pick when the user picked an alternate skin from
    // the Debug Menu's skin-picker dropdown. A font cache miss (fonts may differ between skins) loads them fresh.
    const load = await loadBeatorajaSceneKit({
      files: bundle.files,
      entryPath,
      caches: this.beatorajaKitCaches,
      skinConfig: config,
      reloadTextures: true,
    });
    if (!load.ok || this.beatorajaTheme !== bundle) return;
    const kit: BeatorajaKit = { family: 'beatoraja', kit: load.kit };
    this.beatorajaSelectKit = { bundle, entryPath, kit, header: load.header };
    const select = this.selectView();
    if (select?.identity.family !== 'beatoraja') return;
    select.updateKit(kit);
    // The panel follows the entry's header, so its property dropdowns show the new skin's `property[]` schema.
    this.refreshBeatorajaSelectSkinOptions();
  }

  /**
   * The beatoraja theme's decide skin for `song`, loaded as a scene kit, or `undefined` when there is none to show: no
   * beatoraja theme, no decide skin in it, or one that failed to load. The player's pick in the Debug Menu wins over the
   * discovery's (`theme.decideSkin`, not `decideCandidates[0]`, which is only the first in the file walk).
   */
  public async loadBeatorajaDecideKit(chartEntry: LibraryChart): Promise<DecideSceneKit | undefined> {
    const bundle = this.beatorajaTheme;
    if (bundle === undefined) return undefined;
    const decideCandidates = bundle.theme.entries.filter((entry) => entry.header.type === BEATORAJA_SKIN_TYPE.DECIDE);
    const selectedEntry = this.pickBeatorajaSkinEntryWithOverride(
      BEATORAJA_SKIN_TYPE.DECIDE,
      decideCandidates,
      bundle.theme.decideSkin,
    );
    if (selectedEntry === undefined) return undefined;
    // The skin's `main()` runs with the chart's difficulty ops, so themes that work out per-difficulty values as they
    // load (ModernChic's `CUSTOM.NUM.diffRGB()`) see one instead of crashing on `nil`. Textures and fonts reuse the
    // entry's cached ones or are decoded and registered fresh.
    const load = await loadBeatorajaSceneKit({
      files: bundle.files,
      entryPath: selectedEntry.entryPath,
      caches: this.beatorajaKitCaches,
      runtimeContext: (skinConfig) => this.buildBeatorajaSkinLoadContext(chartEntry, skinConfig),
    });
    if (!load.ok) {
      gamereplay.warn(`beatoraja decide: ${load.message}`);
      return undefined;
    }
    return { family: 'beatoraja', kit: load.kit };
  }

  /**
   * The beatoraja theme's result skin for `song`, loaded as a kit, or `undefined` when there is none to show: no
   * beatoraja theme, no result skin in it, or one that failed to load. A course run's result (`courseResult`) takes the
   * theme's COURSE_RESULT skin, falling back to its result skin. The player's pick in the Debug Menu wins over the
   * discovery's.
   */
  public async loadBeatorajaResultKit(
    chartEntry: LibraryChart,
    courseResult: boolean,
  ): Promise<BeatorajaKit | undefined> {
    const bundle = this.beatorajaTheme;
    if (bundle === undefined) return undefined;
    // Same fix as decide — fall back to the discovery's `theme.resultSkin` rather than
    // `resultCandidates[0]` (= file-walk iteration order), so picking the discovery default
    // in the Debug Menu (which clears the override) actually mounts the discovery default
    // instead of silently picking whatever theme happens to iterate first.
    const resultType =
      courseResult && bundle.theme.courseResultSkin !== undefined
        ? BEATORAJA_SKIN_TYPE.COURSE_RESULT
        : BEATORAJA_SKIN_TYPE.RESULT;
    const resultCandidates = bundle.theme.entries.filter((entry) => entry.header.type === resultType);
    const selectedEntry = this.pickBeatorajaSkinEntryWithOverride(
      resultType,
      resultCandidates,
      resultType === BEATORAJA_SKIN_TYPE.COURSE_RESULT ? bundle.theme.courseResultSkin : bundle.theme.resultSkin,
    );
    if (selectedEntry === undefined) return undefined;

    // Phase-2 eval gets the chart's difficulty ops via `runtimeContext` so result themes that
    // pre-compute per-difficulty values at load time (mirroring the decide path's
    // ModernChic-style `diffRGB()` pattern) don't crash on `nil` indexing.
    const load = await loadBeatorajaSceneKit({
      files: bundle.files,
      entryPath: selectedEntry.entryPath,
      caches: this.beatorajaKitCaches,
      runtimeContext: (skinConfig) => this.buildBeatorajaSkinLoadContext(chartEntry, skinConfig),
    });
    if (!load.ok) {
      gamereplay.warn(`beatoraja result: ${load.message}`);
      return undefined;
    }
    return { family: 'beatoraja', kit: load.kit };
  }

  /**
   * Pick the actual skin entry to mount for a scene, honoring the user's override when one was
   * recorded. Falls back to `fallback` (the discovery's "best" pick) when no override exists or
   * when the override no longer points at a valid entry (e.g., the user dropped a different theme).
   */
  private pickBeatorajaSkinEntryWithOverride(
    typeCode: number,
    candidates: ReadonlyArray<BeatorajaSkinEntry>,
    fallback: BeatorajaSkinEntry | undefined,
  ): BeatorajaSkinEntry | undefined {
    const override = this.beatorajaSkinOverridesByType.get(typeCode);
    if (override !== undefined) {
      const found = candidates.find((entry) => entry.entryPath === override);
      if (found !== undefined) return found;
      // Override stale (theme rotated) — drop it so the fallback takes over.
      this.beatorajaSkinOverridesByType.delete(typeCode);
    }
    return fallback;
  }

  /**
   * Pick the cached skin config for an entry — falling back to a fresh defaults-fill from the
   * header's `property[]` / `filepath[]` schema (`resolveBeatorajaSkinConfig`). Mutating the returned object directly
   * mutates the cache, but the skin-options panel emits fresh copies on change so the cached state never becomes
   * accidentally shared with downstream consumers.
   */
  public beatorajaSkinConfig(entryPath: string, header: BeatorajaSkinHeader): BeatorajaSkinConfig {
    return resolveBeatorajaSkinConfig(
      this.beatorajaKitCaches,
      entryPath,
      header,
      this.beatorajaTheme?.files ?? new Map(),
    );
  }

  /**
   * The `main_state` a decide / result skin sees while its `main()` runs: the chart's difficulty ops and the skin
   * config's ops, with `main_state.audio_*` wired to the audio service's skin sounds, owned by the theme
   * (`createBeatorajaSkinLoadContext`).
   * ModernChic's decide.lua crashes its whole `main()` without the difficulty ops, and its `Root/customsound.lua` calls
   * the audio accessors from every panel toggle.
   */
  private buildBeatorajaSkinLoadContext(chartEntry: LibraryChart, skinConfig: BeatorajaSkinConfig) {
    return createBeatorajaSkinLoadContext({
      difficulty: chartEntry.chart.metadata.difficulty,
      skinConfig,
      skinAudio: this.audio.skinSounds.owned(this.themeOwner),
    });
  }

  /**
   * Pre-resolve `filepath[]` candidate lists for the skin-options panel. Each entry's `path` field
   * is a wildcard relative to the skin directory; `expandBeatorajaWildcard` walks the dropped file
   * map and returns every match. The panel hands these to lil-gui as dropdown options so the user
   * can pick a specific file by name rather than guessing.
   */
  public collectBeatorajaFileCandidates(
    entryPath: string,
    header: BeatorajaSkinHeader,
  ): ReadonlyMap<string, ReadonlyArray<string>> {
    const map = new Map<string, ReadonlyArray<string>>();
    const bundle = this.beatorajaTheme;
    if (bundle === undefined) return map;
    for (const fp of header.filepath ?? []) {
      const matches = expandBeatorajaWildcard(bundle.files, entryPath, fp.path);
      map.set(fp.name, matches);
    }
    return map;
  }

  /**
   * The select screen's sounds from the beatoraja theme: its cues and select BGM, by path, read from the theme's files
   * (its decide sound plays on its decide screen).
   */
  public selectSoundSet(): SystemSoundSet {
    return systemSoundSetFromBeatoraja({
      paths: this.beatorajaSystemSoundPaths,
      ...(this.beatorajaSelectBGMPath !== undefined ? { selectBGMPath: this.beatorajaSelectBGMPath } : {}),
    });
  }
}
