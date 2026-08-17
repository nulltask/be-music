// Imports are split across `@be-music/player-web`'s per-area subpaths so the dependency surface of this demo is
// explicit at the file top. The main `@be-music/player-web` entry is reserved for symbols that don't belong to any
// single area (`logger`, `Rectangle`).
import {
  DefaultPixiGameplayView,
  DefaultPixiResultView,
  DefaultPixiSongSelectView,
  PixiBeatorajaDecideScene,
  PixiBeatorajaGameplayView,
  PixiBeatorajaResultScene,
  PixiBeatorajaSelectScene,
  PixiDecideView,
  PixiGameplayView,
  PixiResultView,
  PixiSceneHost,
  PixiSongSelectView,
  type BeatorajaSelectSystemSoundPaths,
  type PixiGameplayResultData,
  type PixiSongSelectNavigation,
} from '@be-music/player-web/scenes';
import {
  BeatorajaSkinAudioPlayer,
  discoverBeatorajaSelectBgmPath,
  discoverBeatorajaSystemSoundPaths,
  findBeatorajaThemeBgm,
  loadBeatorajaFonts,
  loadBeatorajaTexturesFromBundle,
  loadBeatorajaThemeFromFiles,
  loadTextureFromBytes,
  pickBeatorajaPlayableVariant,
  skinFamilyRegistry,
  summarizeBeatorajaPlaySkins,
  type BeatorajaFontCache,
  type BeatorajaPlayableVariant,
  type BeatorajaTextureCache,
  type BeatorajaThemeBgm,
  type BeatorajaThemeBundle,
} from '@be-music/player-web/skin';
import { prepareBeatorajaGameplayChart, type PreparedBeatorajaGameplayChart } from '@be-music/player-web/chart';
import {
  BrowserSongCollectionStore,
  checkBrowserCompat,
  describeSongCollection,
  loadAssetBytes,
  readDroppedFiles,
  resolveSongSource,
  splitDroppedSongAndThemeFiles,
  type BrowserSongCollection,
  type BrowserSongEntry,
} from '@be-music/player-web/collection';
import {
  downloadBlob,
  parseCompressorMode,
  resolvePlaylogFilename,
  serializePlaylog,
  type BeMusicPlaylog,
  type CompressorMode,
} from '@be-music/player-web/runtime';
import { logger } from '@be-music/player-web';
import {
  discoverLr2Themes,
  loadLr2ThemeSkinsFromFiles,
  pickLr2PlaySkin,
  summarizeLr2PlaySkins,
  type Lr2DiscoveredTheme,
  type Lr2PlaySkinMap,
  type Lr2PlayVariant,
  type Lr2Skin,
} from '@be-music/lr2-skin';
import {
  BEATORAJA_OP,
  BEATORAJA_SKIN_TYPE,
  buildBaseOpSet,
  buildDefaultSkinConfigFiles,
  buildDefaultSkinConfigOptions,
  bundleBeatorajaSources,
  computeClearLampOp,
  expandBeatorajaWildcard,
  loadBeatorajaSkin,
  normalizeBeatorajaFonts,
  type BeatorajaLuaRuntimeContext,
  type BeatorajaSkinConfig,
  type BeatorajaSkinEntry,
  type BeatorajaSkinHeader,
} from '@be-music/beatoraja-skin';
import { BeatorajaSkinOptionsGui } from './beatoraja-skin-options-gui.ts';
import type { BeMusicJson } from '@be-music/json';
import { resolveBmsControlFlow } from '@be-music/parser';
import type { PlayerSummary } from '@be-music/player/core/engine';

const dropLog = logger('drop');
const recordLog = logger('record');
const gameplayLog = logger('gameplay');
// lil-gui auto-injects its stylesheet at construction time (see `injectStyles` option, default `true`), so we don't
// import its CSS explicitly — its package.json doesn't expose the file via `exports` anyway.
import GUI, { type Controller } from 'lil-gui';
import { wireHelpModal } from './help-modal.ts';
import { DEMO_APP_HTML } from './dom-template.ts';
import { renderBrowserCompatPanel } from './compat-panel.ts';
import { decodeText, showReadtextOverlay } from './readtext-overlay.ts';
import { playSkinTypeForVariant, sanitizeFilenameStem } from './demo-utils.ts';
import { chartShapeFor, resolveBeatorajaSkinVariant } from './chart-shape.ts';
import { hasAnyLr2Skin, pickActiveFamilyForScene, type FamilyDispatchState } from './family-dispatch.ts';
import { applyLoadProgress, hideLoadingOverlay, showLoadingOverlay } from './loading-overlay.ts';
import { fetchZipAsFile, fetchZipAsFiles, parseUrlMediaParams } from './url-load.ts';
import {
  captureScreenshot,
  finalizeRecordingIfActive,
  toggleRecording,
  type RecordingDeps,
} from './recording-controller.ts';
import type { ChartImageTexture, DemoGuiState, PlayerWebDemoElements, SkinFamilyOverride } from './types.ts';
import './styles.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('missing #app');
}

app.innerHTML = DEMO_APP_HTML;

const DEFAULT_UI_FONT_LOADS = ['400 22px "LINE Seed JP"', '700 18px "LINE Seed JP"', '900 32px "Azeret Mono"'] as const;

async function waitForDefaultUiFonts(): Promise<void> {
  if (!('fonts' in document)) return;
  try {
    await Promise.race([
      Promise.all(DEFAULT_UI_FONT_LOADS.map((font) => document.fonts.load(font))),
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, 1500);
      }),
    ]);
  } catch {
    // The stylesheet uses font-display=swap, so the app can still start with browser fallbacks if Google Fonts is blocked.
  }
}

class PlayerWebDemoApp {
  private readonly collectionStore = new BrowserSongCollectionStore();
  /**
   * Per-variant play skins, keyed by `Lr2PlayVariant`. Loaded once at theme-drop time so a DP chart can pick
   * `playSkins['14']` while a regular SP chart picks `playSkins['7']`.
   */
  private readonly playSkins: Lr2PlaySkinMap = {};
  /**
   * LR2 themes detected in the most recent drop, scoped to `LR2files/Theme/<name>/` subdirs that contain at least
   * one `.lr2skin`. Populated by {@link loadTheme}; the Debug Menu's "LR2 theme" picker reads from here and lets
   * the user swap between themes without re-dropping. Empty when no LR2 theme is loaded.
   */
  private availableLr2Themes: ReadonlyArray<Lr2DiscoveredTheme<File>> = [];
  /**
   * Name of the LR2 theme currently mounted into the `playSkins` / `selectSkin` / … slots. Used by the picker to
   * (a) compute the initial selection on rebuild and (b) preserve the user's chosen theme across drops that ship
   * the same theme name. `undefined` when no LR2 theme is loaded.
   */
  private activeLr2ThemeName: string | undefined;
  /**
   * Single PixiJS host shared by every scene (select / gameplay / result). Scenes are attached and detached through
   * `PixiSceneHost` instead of constructing a separate Pixi `Application` per view.
   */
  private readonly sceneHost = new PixiSceneHost();
  private collection: BrowserSongCollection = { sources: [], songs: [], errors: [] };
  private selectSkin: Lr2Skin | undefined;
  private resultSkin: Lr2Skin | undefined;
  /**
   * LR2 Decide-screen skin (the brief splash between song select and gameplay). Loaded from
   * `Theme/<name>/Decide/decide.lr2skin` by `loadLr2ThemeSkinsFromFiles`. When undefined, the host skips the splash and
   * transitions directly to gameplay.
   */
  private decideSkin: Lr2Skin | undefined;
  /**
   * beatoraja theme bundle held in parallel with the LR2 state. We don't render beatoraja scenes yet — that PixiJS
   * wiring is a follow-up — but we DO want to detect a beatoraja theme drop so the user gets a clear log line and
   * the parser path stays exercised end-to-end.
   */
  private beatorajaTheme: BeatorajaThemeBundle | undefined;
  /**
   * BGM bytes discovered inside the loaded beatoraja theme bundle (`decide.wav` / `clear.wav` /
   * `fail.wav` / `result.wav`). Populated alongside `beatorajaTheme` after a successful drop.
   * The decide / result scenes consume these directly — no separate caching layer needed since
   * decoding happens lazily inside each scene's audio context.
   */
  private beatorajaThemeBgm: BeatorajaThemeBgm = {};
  /**
   * Audio player driving `main_state.audio_play / loop / stop` from Lua. One per theme bundle —
   * the path → AudioBuffer cache is keyed against the bundle's file map, so a fresh theme drop
   * disposes the old player and creates a new one. Without this wired in, the Lua API surface
   * exists but every call returns false (silent), so ModernChic's panel SE were dead even though
   * the eval no longer crashed.
   */
  private beatorajaSkinAudio: BeatorajaSkinAudioPlayer | undefined;
  /**
   * System-sound paths discovered from the active theme bundle. Re-probed every theme load
   * via {@link discoverBeatorajaSystemSoundPaths}; passed to {@link PixiBeatorajaSelectScene}
   * so cursor / decide / folder / option events fire the matching cues. Stays empty (`{}`)
   * for stripped LR2 themes that don't ship a `sound/` subdirectory.
   */
  private beatorajaSystemSoundPaths: BeatorajaSelectSystemSoundPaths = {};
  /**
   * Looping select-scene BGM path discovered from the active theme bundle. Re-probed on
   * every theme load via {@link discoverBeatorajaSelectBgmPath}; passed to the select scene
   * as `selectBgmPath` so the BGM starts on enter and stops on exit. `undefined` for themes
   * that don't ship a select BGM (the scene runs silent in the background then, just chart
   * preview clips and navigation cues).
   */
  private beatorajaSelectBgmPath: string | undefined;
  /**
   * In-session per-song clear-lamp memory (audit 2.18). Keyed by `BrowserSongEntry.id` so
   * each completed run updates the lamp the next time the user lands on that song in the
   * select list. We don't persist across page reloads (no score DB on the web port today),
   * but within a session the lamp icons gradually populate as the user plays charts.
   *
   * Stored as the resolved `BEATORAJA_OP.CLEAR_LAMP_*` op rather than a domain enum so the
   * select scene's lookup stays a single map read with no per-frame translation.
   */
  private readonly beatorajaSessionLampOps = new Map<string, number>();
  /**
   * Loop-playable BGM bytes for the song-select scene (`LR2files/Bgm/<theme>/select.wav` from the dropped theme).
   * Forwarded to `PixiSongSelectView` via the constructor option on first mount and via `setSelectBgm` on subsequent
   * theme drops mid-session.
   */
  private selectBgmBytes: Uint8Array | undefined;
  /** Result-screen BGM bytes — picked per outcome inside `PixiResultView`. */
  private clearBgmBytes: Uint8Array | undefined;
  private failBgmBytes: Uint8Array | undefined;
  private resultBgmBytes: Uint8Array | undefined;
  /**
   * One-shot song-decided sound bytes (`LR2files/Bgm/<theme>/decide.wav`). Played by
   * `PixiSongSelectView.playDecideSound` on the select → gameplay transition.
   */
  private decideBgmBytes: Uint8Array | undefined;
  /**
   * LR2 system sound-effect bundle (`LR2files/Sound/lr2/<name>.wav`). Each slot maps to a `PixiSongSelectView`
   * system-sound name (cursorMove / folderOpen / folderClose). Forwarded via the constructor option on first mount and
   * via `setSystemSounds` on subsequent theme drops.
   */
  private systemSoundBundle: {
    cursorMove?: Uint8Array;
    folderOpen?: Uint8Array;
    folderClose?: Uint8Array;
    optionOpen?: Uint8Array;
    optionClose?: Uint8Array;
    optionChange?: Uint8Array;
  } = {};
  private selectView: PixiSongSelectView | undefined;
  private gameplayView: PixiGameplayView | undefined;
  /**
   * Beatoraja gameplay view. Active in place of `gameplayView` when the user toggles
   * `useBeatorajaGameplay` and the loaded theme has a skin variant matching the chart shape. Held
   * separately because the two views don't share an interface — the LR2 view manages its own audio
   * decoding internally, while this one consumes a `PreparedBeatorajaGameplayChart` from the
   * `prepareBeatorajaGameplayChart` helper.
   */
  private beatorajaGameplayView: PixiBeatorajaGameplayView | undefined;
  /**
   * The variant the active gameplay view is mounted against. Held alongside
   * {@link beatorajaGameplayView} so the Debug Menu's "Play 7K / Play 5K / …" dropdowns can
   * resolve their type-code → live-apply call without reaching into the view internals. Cleared
   * on dispose so a stale value can never cause the next dropdown change to no-op silently.
   */
  private currentBeatorajaPlayVariant: BeatorajaPlayableVariant | undefined;
  /** The current chart's prepared assets (audio + BGA). Disposed alongside the gameplay view. */
  private beatorajaGameplayPrep: PreparedBeatorajaGameplayChart | undefined;
  /**
   * The most recently resolved chart for a beatoraja run, paired with the song's `chartPath` so
   * subsequent stages can verify the cached chart still matches the song they're handling.
   *
   * Lifecycle:
   *   1. The decide scene resolves `#IF` / `#RANDOM` once at entry and stores the result here so
   *      the bpmgraph (and the gameplay prep that follows) sees the SAME branches.
   *   2. `playSongBeatoraja` reads it via `preResolvedChart` — only when `chartPath` matches the
   *      song being played. Mismatched paths fall back to a fresh resolve (= the user reached
   *      gameplay without going through decide; rare but possible via debug paths).
   *   3. `disposeBeatorajaGameplay` re-stamps it from `prep.chart` so the result scene gets the
   *      same chart for its bpmgraph.
   *
   * `chart` is a plain JSON object so retaining the reference is cheap.
   */
  private lastBeatorajaChart: { chart: BeMusicJson; chartPath: string } | undefined;
  /** Beatoraja-skinned song select scene. Active when a beatoraja theme with a select skin is loaded. */
  private beatorajaSelectScene: PixiBeatorajaSelectScene | undefined;
  /**
   * Beatoraja-skinned decide splash. Active during the select → gameplay handoff when the loaded
   * theme ships a decide skin (`type = 6`). Disposed before the gameplay scene mounts.
   */
  private beatorajaDecideScene: PixiBeatorajaDecideScene | undefined;
  /**
   * Beatoraja-skinned result scene. Active after gameplay completes when the loaded theme ships a
   * result skin (`type = 7`). The chart's final `PlayerSummary` is forwarded so the skin's value
   * destinations can render frozen score / judge / combo readouts.
   */
  private beatorajaResultScene: PixiBeatorajaResultScene | undefined;
  /**
   * Bottom-right lil-gui panel exposing the active beatoraja skin's `property[]` / `filepath[]` /
   * note-offset for live editing. Lazily constructed once `start()` mounts the host (the panel is
   * absolute-positioned inside the demo shell so the shell needs to exist first).
   */
  private beatorajaSkinOptionsGui: BeatorajaSkinOptionsGui | undefined;
  /**
   * Per-skin-entry config picks. The skin-options panel mutates these and the active scene re-mounts
   * with the updated values. Survives scene transitions so navigating away and back preserves the
   * user's choices for each skin (a select skin and a play skin can carry independent configs).
   */
  private readonly beatorajaSkinConfigByEntry = new Map<string, BeatorajaSkinConfig>();
  /**
   * Per-`SkinType` user-picked entry override. Lets the user choose between multiple discovered
   * skins for a given scene type from the Debug Menu. Keyed by the numeric `header.type` so
   * each scene (`MUSIC_SELECT = 5`, `PLAY_7KEYS = 0`, etc.) tracks its own override.
   */
  private readonly beatorajaSkinOverridesByType = new Map<number, string>();
  /**
   * Debug-menu folder hosting one dropdown per skin scene type (Play 5K / 7K / 9K / 10K / 14K /
   * 24K / 24Kdp / Music Select / Decide / Result / etc.). Empty until a beatoraja theme is
   * dropped — `rebuildBeatorajaSkinPickers` (re-)populates it from `beatorajaTheme.entries`.
   */
  private beatorajaSkinPickerFolder: GUI | undefined;
  /**
   * Active controllers inside {@link beatorajaSkinPickerFolder}, keyed by scene type. Cleared
   * and rebuilt on each `rebuildBeatorajaSkinPickers` call so dropdown options stay in sync with
   * the latest theme drop.
   */
  private readonly beatorajaSkinPickerControllers: Map<number, Controller> = new Map();
  /**
   * Last beatoraja-select highlighted index — survives scene tear-down so coming back from gameplay
   * lands on the same song the user just played.
   *
   * Subsumed by {@link beatorajaSelectSnapshot} for richer restore (folder / sort / filter / favorites).
   * Kept for backward compatibility with code paths that haven't been migrated to the snapshot yet.
   */
  private beatorajaSelectIndex = 0;
  /**
   * Last beatoraja-select scene state captured at scene-exit. Re-applied on the next mount so the
   * user lands on the same folder, cursor, sort, filter, and favorites set they left — not just
   * the focused song. Captured via `selectScene.captureSnapshot()` at every dispose site that
   * represents a "coming back later" transition (PLAY entry, decide entry, theme reload). Cleared
   * by `onExit` (ESC at root) since that's the user explicitly leaving the select altogether.
   */
  private beatorajaSelectSnapshot: import('@be-music/player-web').PixiBeatorajaSelectSceneSnapshot | undefined;
  private resultView: PixiResultView | undefined;
  private decideView: PixiDecideView | undefined;
  private hostMounted = false;
  /**
   * Last-known cursor / folder state of the select view, captured before gameplay so returning to song select restores
   * the user's position.
   */
  private lastSelectNavigation: PixiSongSelectNavigation | undefined;
  /**
   * Compressor architecture for `audioCompressorMode` on every gameplay mount. Defaults to `'split'` (the new 3-stage
   * bus — see `audio-bus.ts` for the design rationale); the demo accepts a `?compressor=legacy` URL flag for A/B
   * comparison against the old single-compressor topology, and `?compressor=off` to spawn gameplay with the bypass path
   * active out of the gate (the checkbox can also reach `off` mid-session).
   */
  private compressorMode: 'split' | 'legacy' = 'split';
  /**
   * GUI state object the lil-gui controllers read / write. Held on the instance so the GUI build code and the runtime
   * handlers (`toggleRecording` etc.) share a single source of truth — programmatic updates go through `state.foo = …`
   * + `controller.updateDisplay()`.
   */
  private readonly guiState: DemoGuiState;
  /**
   * lil-gui handles for controllers we need to address by name after construction — toggling the per-stage folder
   * visibility, renaming the record button, and reflecting URL- flag-driven compressor changes back into the GUI.
   */
  private gui: GUI | undefined;
  private compressorStageFolder: GUI | undefined;
  private recordController: Controller | undefined;
  /**
   * Top-level "Skin family" dropdown. Rebuilt via {@link rebuildSkinFamilyPicker} on every theme load / wipe so its
   * option list reflects which families are actually selectable (LR2 only shows up once an `.lr2skin` has been
   * dropped; beatoraja only after a `.luaskin` / `skin/*.json` drop; Auto + Default always present). Holding the
   * controller reference lets `rebuildSkinFamilyPicker` swap the options in-place via lil-gui's
   * `Controller#options` API without disturbing the insertion order of subsequent controllers.
   */
  private skinFamilyController: Controller | undefined;
  /**
   * "LR2 theme" picker. Visible only when {@link availableLr2Themes} has 2+ entries; rebuilt on each theme drop so
   * its option list tracks what was just loaded. The lil-gui option-controller pattern (`Controller#options(...)`)
   * preserves the previously-attached `onChange` listener across rebuilds — see {@link rebuildSkinFamilyPicker}
   * for the same idiom.
   */
  private lr2ThemeController: Controller | undefined;
  /**
   * Disabled string controller used as the read-only status row inside the lil-gui panel. We hold a reference so {@link
   * setStatus} can call `updateDisplay()` directly rather than relying on lil-gui's `.listen()` polling.
   */
  private statusController: Controller | undefined;
  /**
   * `true` after the user clicks Record on the song-select screen but before they actually pick a song. Consumed (and
   * cleared) by `playSong` immediately after the gameplay view mounts, kicking off `startRecording()` so the very first
   * frame of the chart is captured.
   *
   * A second click on Record before picking a song flips this back to `false` ("disarm"), and any non-pick path that
   * leaves the select view (e.g. dropping a new folder mid- armed) is responsible for clearing it via {@link
   * disarmAutoRecord} so the flag doesn't survive into a future session that shouldn't be auto-captured.
   */
  private autoRecordArmed = false;
  public constructor(private readonly elements: PlayerWebDemoElements) {
    this.guiState = {
      autoPlay: false,
      autoPauseOnBlur: false,
      // Compressor stack ON by default — without it, multiple simultaneous `#WAV` samples sum past full scale and
      // digital- clip at the destination. The `MIXER_HEADROOM_GAIN_LINEAR` attenuation in `audio-bus.ts` buys a little
      // headroom but the master limiter is what reliably prevents audible clipping on dense charts. Power users wanting
      // an unprocessed signal path can still flip it via `?compressor=off` or the GUI.
      compressor: true,
      compressorKey: true,
      compressorBgm: true,
      compressorMaster: true,
      // BGA resize is OFF by default — original-resolution transcode is the safe choice for visual parity. Power users
      // hitting long encode times on HD BGA can pick a pixel cap from the GUI dropdown without rebuilding. `0` means
      // "preserve resolution"; any positive integer activates the resize path with that long-edge cap.
      bgaResizeMaxEdgePx: 0,
      // WebCodecs encode defaults ON when the browser exposes `VideoEncoder` — typically a 5-20× encode-side speedup
      // over the single-threaded wasm libx264 fallback, and the runtime silently falls back to ffmpeg if the encoder
      // rejects the configured codec parameters or any step throws. Browsers without `VideoEncoder` (Safari < 17, older
      // Firefox) keep the toggle disabled in the GUI and the seed stays `false`.
      bgaUseWebCodecs: typeof globalThis !== 'undefined' && 'VideoEncoder' in globalThis,
      // Debug overlay for invisible / keysound notes — off by default. Power users investigating chart authoring (or
      // diagnosing missing keysound triggers) flip it on; the regular gameplay surface stays clean otherwise.
      showInvisibleNotes: false,
      // Default to LR2 / beatoraja's stock behavior (judged notes disappear at the judge line) — matches what most
      // users coming from those players expect. The dropdown lets users opt into the `'KEEP_SCROLLING'` mode (≈
      // beatoraja LANEEFFECT ON) for timing-learning play.
      judgedNoteDisplay: 'HIDE',
      // Play-history auto-save defaults ON: every finished play downloads its play-log (`*.bmplay.json`) when the
      // result scene mounts, so the input replay is preserved without the user having to remember anything. The
      // Debug Menu checkbox turns the download off for users who don't want per-play files piling up.
      autoSavePlaylog: true,
      // Skin-family routing defaults to `'auto'`: beatoraja > LR2 > default, picked per-scene from what's loaded.
      // The Debug Menu's "Skin family" dropdown lets users force a specific family; LR2 / beatoraja entries appear
      // in the dropdown only when their theme is loaded (see {@link rebuildSkinFamilyPicker}).
      skinFamilyOverride: 'auto',
      status: 'Ready',
      openFolder: () => this.elements.songInput.click(),
      record: () => {
        void toggleRecording(this.recordingDeps());
      },
      screenshot: () => {
        void captureScreenshot(this.recordingDeps());
      },
    };
    // Pick up the `?compressor=split|legacy|off` URL flag once at boot. We resolve it through `parseCompressorMode`
    // (the same helper exported from `audio-bus.ts`) so the recognized values stay synced with the runtime API.
    // Unrecognized / missing flag → fall through to defaults: architecture `'split'`, GUI checkbox checked (compressor
    // on, see the `compressor: true` seed above for the rationale).
    //
    // `?compressor=split|legacy` is an explicit opt-in to that architecture and keeps the checkbox checked.
    // `?compressor=off` unchecks it for an unprocessed-signal A/B comparison.
    const flag: CompressorMode | undefined = parseCompressorMode(
      new URL(window.location.href).searchParams.get('compressor'),
    );
    if (flag === 'split' || flag === 'legacy') {
      this.compressorMode = flag;
      this.guiState.compressor = true;
    } else if (flag === 'off') {
      this.guiState.compressor = false;
    }
  }

  public start(): void {
    this.buildGui();
    // Keep the initial mount's promise so URL auto-load (below) can wait for the Pixi host to finish initializing
    // before it drives its own `showSelect` — two concurrent first-mounts race and read the renderer before it exists.
    const initialSelectReady = this.showSelect();

    this.elements.songInput.addEventListener('change', () => {
      const files = this.elements.songInput.files;
      if (!files || files.length === 0) {
        return;
      }
      const fileList = [...files];
      // Reset the input value immediately so picking the SAME folder a second time still fires `change`. Browsers
      // suppress repeat `change` events when the new selection matches the previous value — without this, a user
      // re-picking after a misclick or an interrupted load would see the input silently ignore them.
      this.elements.songInput.value = '';
      void (async () => {
        // Browser file-picker drops go through the same loading overlay as drag-drop so a folder picked via the GUI
        // shows progress too. Hide the select scene up-front so its rendering / BGM stays paused while we read + parse
        // — the user shouldn't see the song list flicker mid-load.
        showLoadingOverlay(this.elements);
        this.selectView?.setVisible(false);
        try {
          // Route through the same post-enumeration pipeline as drag-drop so the picker's selection produces a theme +
          // songs split (handy when a user hand-picks a folder whose root carries both an LR2 theme and a BMS pack),
          // instead of the previous `loadSongs`-only path that quietly skipped any LR2 assets in the selection.
          await this.processIncomingFiles(fileList);
        } finally {
          hideLoadingOverlay(this.elements);
        }
      })();
    });

    // Global `/` shortcut focuses the search input. Standard editor convention — same as GitHub / Slack / Discord. We
    // suppress the actual `/` character so it doesn't end up in the input field.
    window.addEventListener('keydown', (event) => {
      if (event.key !== '/') return;
      const target = event.target as HTMLElement | null;
      // Don't hijack `/` when the user is already typing into some other input.
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      event.preventDefault();
      this.elements.searchInput.focus();
      this.elements.searchInput.select();
    });
    // Search input: forward every keystroke to the select view so the bar list filters live. Escape clears the filter
    // and returns focus to the canvas (so arrow-key navigation works again immediately).
    this.elements.searchInput.addEventListener('input', () => {
      this.selectView?.setSearchQuery(this.elements.searchInput.value);
    });
    this.elements.searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.elements.searchInput.value = '';
        this.selectView?.setSearchQuery('');
        this.elements.searchInput.blur();
      } else if (event.key === 'Enter') {
        // Pressing Enter while typing should let the user pick the currently-focused (filtered) result without leaving
        // the input first. `keydown` on the window won't fire on the select view (the input has focus), so route the
        // action explicitly.
        event.preventDefault();
        // No public "trigger Enter" API on the view; setSearchQuery already moved the cursor to 0 after each keystroke,
        // so closing the input + giving focus back to the canvas is enough for the user's next Enter press to pick that
        // song.
        this.elements.searchInput.blur();
      }
    });

    // Drag state via a depth counter rather than a plain add/remove pair on dragover/dragleave. The browser fires
    // `dragleave` not just when the cursor exits the window but also every time it crosses into a child element —
    // without counting, the `.dragging` class flickers off whenever the user drags across the canvas → toolbar
    // boundary, so the overlay would strobe (or, with `dragleave` firing once at the end, disappear before the user can
    // read the hint).
    //
    // Increment on every `dragenter`, decrement on every `dragleave`. We're truly outside the window once the counter
    // hits zero, at which point the class comes off. `drop` and the rare `dragend` reset the counter so a pathological
    // event sequence (browser quirk, devtools overlay, etc.) can't leave the class stuck on.
    let dragDepth = 0;
    const setDragging = (active: boolean): void => {
      document.body.classList.toggle('dragging', active);
    };
    window.addEventListener('dragenter', (event) => {
      event.preventDefault();
      dragDepth += 1;
      if (dragDepth === 1) {
        setDragging(true);
      }
    });
    // `dragover` still has to call `preventDefault` for the browser to treat the page as a valid drop target. We don't
    // toggle state here — that's `dragenter` / `dragleave`'s job — but skipping the preventDefault would silently turn
    // drops into "open file in browser" navigations.
    window.addEventListener('dragover', (event) => {
      event.preventDefault();
    });
    window.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) {
        setDragging(false);
      }
    });
    window.addEventListener('drop', (event) => {
      event.preventDefault();
      dragDepth = 0;
      setDragging(false);
      if (event.dataTransfer) {
        void this.handleDrop(event.dataTransfer);
      }
    });
    // Belt-and-braces: the spec lets `dragend` fire on the source element when a drag is canceled (Esc, drop on a
    // non-target). For files dragged in from the OS it shouldn't normally fire on `window`, but if a custom source ever
    // does we still want to clear state.
    window.addEventListener('dragend', () => {
      dragDepth = 0;
      setDragging(false);
    });

    // `?music=<url.zip>` / `?skin=<url.zip>` auto-load: fetch + expand the archives at boot and run them through the
    // same pipeline as a drag-drop, so the select screen lists the archive's charts (with any skin already applied).
    // Sequenced after the initial mount so it doesn't race the Pixi host's first-time renderer init.
    const mediaParams = parseUrlMediaParams(window.location.href);
    if (mediaParams.musicUrl || mediaParams.skinUrl) {
      void initialSelectReady.then(() => this.loadFromUrl(mediaParams));
    } else {
      void initialSelectReady;
    }
  }

  private async ensureHostMounted(): Promise<void> {
    if (this.hostMounted) return;
    this.hostMounted = true;
    await this.sceneHost.mount(this.elements.stage);
  }

  /**
   * Hide the per-stage `Key` / `BGM` / `Master` folder when it doesn't apply to the current state:
   *
   * - Compressor checkbox unchecked → bus is in `'off'` mode, every stage is bypassed already.
   * - `?compressor=legacy` → the legacy architecture has just one compressor; per-stage toggles don't map onto it.
   *
   * lil-gui's `show(false)` collapses the folder out of the panel entirely, matching the previous `display: none`
   * behavior.
   */
  private refreshCompressorStageVisibility(): void {
    const visible = this.guiState.compressor && this.compressorMode === 'split';
    this.compressorStageFolder?.show(visible);
  }

  /**
   * Builds the floating lil-gui control panel and wires every controller to the gameplay / scene state. Centralizing
   * this in one method lets us bind handles to specific controllers (`recordController`, `compressorStageFolder`)
   * up-front, so runtime code can address them by name (renaming the record button when capture starts, hiding the
   * per-stage folder on compressor mode change) without re-querying the DOM.
   */
  private buildGui(): void {
    // Start the panel itself collapsed so it doesn't cover the select-screen / gameplay canvas the moment a user lands
    // on the demo. The nested folders (Compressor stages / BGA video transcode) stay open by default — once the user
    // opens the top-level panel, every controller is one click away rather than hidden behind another folder header.
    const gui = new GUI({ title: 'Debug Menu', width: 280 });
    gui.close();
    this.gui = gui;
    // Status row pinned to the top of the panel — first thing the user sees, so a glance at the GUI is enough to tell
    // whether a load is in flight, what's currently playing, or where a saved recording landed. Disabled so the field
    // reads as a passive read-out instead of an editable input. Updates are pushed explicitly via `setStatus`; cheaper
    // than lil-gui's `.listen()` polling and the only writer is this class anyway.
    this.statusController = gui.add(this.guiState, 'status').name('Status').disable();
    this.statusController.domElement.classList.add('status-row');
    gui.add(this.guiState, 'openFolder').name('Open Folder');
    // Skin family override — picks the active rendering family (LR2 / beatoraja / default) regardless of what's
    // loaded. First-time build seeds with `Auto` + `Default` only; `rebuildSkinFamilyPicker` swaps the option list
    // in place once a theme drop adds LR2 / beatoraja to the pool. Parked here (right after Open Folder) so the
    // family pick reads as a top-level navigation control, above per-family detail folders.
    this.rebuildSkinFamilyPicker();
    // LR2 theme picker — visible only when the most recent drop covered multiple themes (e.g. someone dropped the
    // entire `LR2files/Theme/` parent). Single-theme drops keep this hidden so the panel doesn't grow a useless
    // 1-option dropdown.
    this.rebuildLr2ThemePicker();
    // Per-scene skin picker. Empty (= no controllers visible) until a beatoraja theme is
    // dropped — `rebuildBeatorajaSkinPickers()` re-populates it on each load. Selecting a
    // non-default entry for a scene records it on `beatorajaSkinOverridesByType`; the next
    // mount picks it up via `pickBeatorajaSkinEntryWithOverride`. The folder is OPEN by
    // default so the picker dropdowns are visible the moment a theme finishes loading
    // — having the user hunt through a collapsed panel for a control they need on every
    // theme drop didn't justify the extra click.
    this.beatorajaSkinPickerFolder = gui.addFolder('Beatoraja skins').open();
    // Auto play used to be a lil-gui checkbox here too, but the in-scene PLAY OPTIONS panel (LR2 button_type 33 / 32 on
    // the select skin) already exposes it — the duplicate toolbar controller just added another surface to keep in
    // sync. The `guiState.autoPlay` field stays as the seed/fallback value until the select panel publishes its own
    // choice.
    gui
      .add(this.guiState, 'autoPauseOnBlur')
      .name('Auto pause on blur')
      .onChange((value: boolean) => {
        this.guiState.autoPauseOnBlur = value;
        // Push live so a chart already in flight starts honoring the new policy on its next visibility / blur event,
        // without forcing the user to restart the song.
        this.gameplayView?.setAutoPauseOnBlur(value);
      });
    gui
      .add(this.guiState, 'compressor')
      .name('Compressor')
      .onChange((value: boolean) => {
        this.gameplayView?.setAudioCompressor(value);
        this.refreshCompressorStageVisibility();
      });
    const stages = gui.addFolder('Compressor stages');
    this.compressorStageFolder = stages;
    stages
      .add(this.guiState, 'compressorKey')
      .name('Key')
      .onChange((value: boolean) => {
        this.gameplayView?.setAudioCompressorStageEnabled('key', value);
      });
    stages
      .add(this.guiState, 'compressorBgm')
      .name('BGM')
      .onChange((value: boolean) => {
        this.gameplayView?.setAudioCompressorStageEnabled('bgm', value);
      });
    stages
      .add(this.guiState, 'compressorMaster')
      .name('Master')
      .onChange((value: boolean) => {
        this.gameplayView?.setAudioCompressorStageEnabled('master', value);
      });
    // BGA video transcode controls. Both settings are seeded into the next `PixiGameplayView` constructor (see
    // `preloadGameplay` / `playSong` for the wiring), so changing them mid-session takes effect on the next chart mount
    // — no need to rebuild gameplay if the user is between songs. We don't push live into the running gameplay because
    // BGA assets are loaded once at chart- prepare time and the codec / resize decisions are encoded into the cached
    // video bytes.
    //
    // Both controls are dropdowns rather than free-form fields: the meaningful options cluster around standard video
    // heights (SD / 720p / 1080p / 4K) and a discrete codec pick. `0` in the resize dropdown is the magic "Off" value —
    // the consumer treats anything `≤ 0` as "preserve resolution". Earlier iterations split resize into a checkbox +
    // size pair, but users would change the size without realizing they also had to flip the checkbox — the resize was
    // silently a no-op. Folding both into one control with an explicit `Off` row removes that footgun.
    const transcode = gui.addFolder('BGA video transcode');
    // WebCodecs `VideoEncoder` is a browser feature; gate the checkbox on its existence so the user can't toggle a
    // state the runtime can't honor. On unsupported browsers (Safari < 17, older Firefox builds) the controller is
    // disabled and the seed value stays at `false`.
    const webCodecsSupported = typeof window !== 'undefined' && 'VideoEncoder' in window;
    const webCodecsController = transcode
      .add(this.guiState, 'bgaUseWebCodecs')
      .name(webCodecsSupported ? 'Use WebCodecs encoder' : 'Use WebCodecs encoder (unsupported)')
      .onChange((value: boolean) => {
        this.guiState.bgaUseWebCodecs = value;
      });
    if (!webCodecsSupported) {
      webCodecsController.disable();
    }
    transcode
      .add(this.guiState, 'bgaResizeMaxEdgePx', {
        'Off (preserve resolution)': 0,
        '256 px (BMS spec)': 256,
        '360 px (≈ SD)': 360,
        '480 px (SD)': 480,
        '512 px': 512,
        '720 px (HD)': 720,
        '1080 px (FHD)': 1080,
        '1440 px (QHD)': 1440,
        '2160 px (4K)': 2160,
      })
      .name('Resize')
      .onChange((value: number) => {
        this.guiState.bgaResizeMaxEdgePx = value;
      });
    // Chart-authoring debug overlay — paints invisible / keysound notes (BMS channels `3x` / `4x`) as thin green bars
    // in their playable lane. Seeded into the next `PixiGameplayView` constructor; toggling mid-song waits until the
    // next chart load to take effect (the invisible-note array is built once at chart-prepare time). Live-toggleable —
    // the gameplay view always extracts the invisible-note array and preloads the green sprite, so flipping this flag
    // flips the per-frame render branch on the very next paint.
    gui
      .add(this.guiState, 'showInvisibleNotes')
      .name('Show invisible notes')
      .onChange((value: boolean) => {
        this.guiState.showInvisibleNotes = value;
        this.gameplayView?.setShowInvisibleNotes(value);
      });
    // Picks between LR2-faithful "judged note disappears at the judge line" and our historical "keep scrolling past it"
    // behavior. Pushed live into the running gameplay view so a mid-song toggle takes effect on the very next paint —
    // the visibility check is a single per-frame branch with no backing state to rebuild.
    gui
      .add(this.guiState, 'judgedNoteDisplay', {
        'Keep scrolling (LANEEFFECT ON)': 'KEEP_SCROLLING',
        'Hide on judge (LR2 default)': 'HIDE',
      })
      .name('Judged notes')
      .onChange((value: 'KEEP_SCROLLING' | 'HIDE') => {
        this.guiState.judgedNoteDisplay = value;
        this.gameplayView?.setJudgedNoteDisplay(value);
      });
    // Play-history auto-save — ON by default. When enabled, every finished play downloads its play-log
    // (`*.bmplay.json`, the raw input replay defined in `@be-music/player/playlog`) as soon as the result scene
    // mounts. The file feeds the `bms-playlog` CLI, which re-derives LR2 / beatoraja / IIDX scores from the replay.
    gui
      .add(this.guiState, 'autoSavePlaylog')
      .name('Auto-save play history')
      .onChange((value: boolean) => {
        this.guiState.autoSavePlaylog = value;
      });
    this.recordController = gui.add(this.guiState, 'record').name('● Record');
    // Screenshot button — captures the Pixi stage at its native size (= the renderer's
    // current screen dimensions; matches what the user sees in the canvas, downloaded as
    // PNG). See `captureScreenshot` for the extract pipeline.
    gui.add(this.guiState, 'screenshot').name('📸 Screenshot');
    this.refreshCompressorStageVisibility();
  }

  /**
   * Single chokepoint for status-text updates. Writes the new value into `guiState` and refreshes the lil-gui
   * controller so the read-only row repaints with the new text.
   */
  private setStatus(text: string): void {
    this.guiState.status = text;
    this.statusController?.updateDisplay();
  }

  /**
   * Filename base for the next saved recording. Derived from the currently-playing song's title (sanitized for
   * filesystem safety) or `gameplay-<timestamp>` when no song info is available. Updated on every `playSong` so
   * back-to-back recordings don't overwrite each other in the user's downloads folder.
   *
   * Read by `toggleRecording` (in `./recording-controller.ts`) when assembling the download filename; mutated in
   * `playSong` / `playSongBeatoraja` / `preloadGameplay` as each chart starts.
   */
  private recordingFilenameBase = 'gameplay';

  /**
   * Bundle the demo's recording-related fields into the `RecordingDeps` shape that
   * `./recording-controller.ts` consumes. Built as a getter-based bundle (rather than a structural copy of `this`) so
   * `RecordingDeps` can stay an interface of getter / setter functions — TypeScript otherwise refuses to satisfy a
   * structural `RecordingHost` from a class whose backing fields are `private`. Cheap to allocate per call; called at
   * most a handful of times per session (record toggle / screenshot / chart-end recording finalize).
   */
  private recordingDeps(): RecordingDeps {
    return {
      sceneHost: this.sceneHost,
      recordController: this.recordController,
      getActiveGameplay: () => this.gameplayView ?? this.beatorajaGameplayView,
      isLr2GameplayRecording: () => this.gameplayView?.isRecording() ?? false,
      getAutoRecordArmed: () => this.autoRecordArmed,
      setAutoRecordArmed: (value) => {
        this.autoRecordArmed = value;
      },
      getRecordingFilenameBase: () => this.recordingFilenameBase,
      setStatus: (text) => this.setStatus(text),
    };
  }

  private async handleDrop(dataTransfer: DataTransfer): Promise<void> {
    // Show the overlay before we even start enumerating files — walking a deep `webkitGetAsEntry` tree on a chart pack
    // with tens of thousands of WAVs visibly stalls the UI for several seconds, and we want the user to see "we're
    // working on it" immediately rather than after the slow phase finishes.
    showLoadingOverlay(this.elements);
    // Take the select scene offline for the duration of the load. `setVisible(false)` pauses BGM + the rAF tick + the
    // song list rendering, so:
    //
    // - the loaded LR2 theme's `select.wav` doesn't start the moment the (small) theme bundle finishes parsing while
    //   the (large) song collection is still being read,
    // - the song list doesn't visually shuffle as new entries land,
    // - and the user only sees the overlay until everything is ready — not a half-rendered scene behind it.
    //
    // `showSelect()` at the end of the try block re-enables the scene with the freshly populated state in one shot.
    this.selectView?.setVisible(false);
    try {
      const files = await readDroppedFiles(dataTransfer, {
        onProgress: (progress) => applyLoadProgress(this.elements, progress),
      });
      await this.processIncomingFiles(files);
    } finally {
      // Always tear the overlay down — even when one of the sub-loaders threw or `splitDroppedSongAndThemeFiles`
      // produced an empty bucket. Otherwise a failed drop would leave the UI permanently masked.
      hideLoadingOverlay(this.elements);
    }
  }

  /**
   * Shared post-enumeration pipeline for both drag-drop and the Debug Menu's "Open Folder" picker. Routes the incoming
   * file list through {@link splitDroppedSongAndThemeFiles}, dispatches theme + song loaders in parallel, then mounts
   * the freshly populated select view.
   *
   * The caller is responsible for showing / hiding the loading overlay and pausing the select view — both entry points
   * handle that around their own enumeration phase.
   *
   * `loadSongs` appends to the existing collection so a second / third invocation of this routine accumulates entries
   * rather than wiping the previous pack — the host can call this multiple times in succession (e.g. Open Folder
   * pressed twice with two different folders) and every drop's charts stay uniquely addressable through the collection
   * per-source prefixing.
   */
  private async processIncomingFiles(files: File[]): Promise<void> {
    if (files.length === 0) {
      return;
    }
    const { themeFiles, songFiles } = splitDroppedSongAndThemeFiles(files);
    // `splitDroppedSongAndThemeFiles` routes any non-chart files outside a chart directory into `themeFiles`. That
    // includes stray `readme.txt` / `info.json` / album-art images sitting at the root of a BMS pack that isn't a real
    // theme bundle. Funnel the detection through `skinFamilyRegistry` so each family's `matchesThemeFile` predicate
    // owns its own decision — this keeps "what counts as an LR2 theme file?" colocated with the LR2 family metadata
    // (and the same for beatoraja). Adding a fourth family in the future is a one-line registry edit instead of an
    // edit here.
    const themeFamilies = skinFamilyRegistry.detectThemeFamilies(
      themeFiles.map((file) => file.webkitRelativePath || file.name),
    );
    const carriesLr2Theme = themeFamilies.has('lr2');
    const carriesBeatorajaTheme = themeFamilies.has('beatoraja');
    const themeMarkers = [...themeFamilies];
    dropLog.info(
      `received ${files.length} file(s) · theme=${themeFiles.length}${
        themeMarkers.length > 0 ? ` (${themeMarkers.join('+')})` : ' (no skin entry → preserving current theme)'
      } · songs=${songFiles.length}`,
    );
    const tasks: Array<Promise<unknown>> = [];
    if (carriesLr2Theme) {
      tasks.push(this.loadTheme(themeFiles));
    }
    if (carriesBeatorajaTheme) {
      tasks.push(this.loadBeatorajaTheme(themeFiles));
    }
    if (songFiles.length > 0) {
      tasks.push(this.loadSongs(songFiles));
    }
    if (tasks.length === 0) {
      dropLog.warn('nothing to load — neither theme nor chart files matched');
      return;
    }
    await Promise.all(tasks);
    const playSkinSummary = summarizeLr2PlaySkins(this.playSkins);
    const beatorajaSummary = this.beatorajaTheme
      ? summarizeBeatorajaPlaySkins(this.beatorajaTheme.theme.playSkins) || 'none'
      : 'none';
    dropLog.info(
      `loaded · songs=${this.collection.songs.length} · errors=${
        this.collection.errors.length
      } · play-skins=${playSkinSummary || 'none'} · select-skin=${this.selectSkin?.name ?? 'none'}${
        this.beatorajaTheme ? ` · beatoraja-skins=${beatorajaSummary}` : ''
      }`,
    );
    if (this.collection.errors.length > 0) {
      dropLog.warn('parse errors:', this.collection.errors);
    }
    // Status panel stays terse on purpose — only show "loaded" when there's something to celebrate, and skip the
    // per-key-mode skin enumeration since the user can see the active skin in-canvas. "0 charts loaded" is suppressed
    // so a theme-only drop doesn't read like an error.
    if (this.collection.songs.length > 0) {
      this.setStatus(describeSongCollection(this.collection));
    } else if (this.selectSkin || this.resultSkin || Object.keys(this.playSkins).length > 0) {
      this.setStatus('Theme loaded');
    }
    await this.showSelect();
  }

  /**
   * Auto-loads a music and/or skin archive named by the `?music=` / `?skin=` URL parameters at boot, reusing the drop
   * pipeline so nothing about song listing or skin application is special-cased.
   *
   * - The skin archive is expanded into per-file `File`s and handed to {@link processIncomingFiles}, which detects the
   *   LR2 / beatoraja family and mounts it (it carries no charts, so it routes entirely to the theme loaders).
   * - The music archive is passed as a single `.zip` to {@link loadSongs}, letting the player-web loader expand it via
   *   its own guarded `unzipSync`; the select scene then lists every chart inside.
   *
   * Skin is loaded first so the select screen that follows is already themed. Failures (bad link, CORS, HTTP error)
   * surface as a status line rather than throwing, so a broken URL never wedges the boot.
   */
  private async loadFromUrl(params: { musicUrl: string | undefined; skinUrl: string | undefined }): Promise<void> {
    if (!params.musicUrl && !params.skinUrl) {
      return;
    }
    showLoadingOverlay(this.elements);
    this.selectView?.setVisible(false);
    try {
      if (params.skinUrl) {
        this.setStatus('Fetching skin…');
        await this.processIncomingFiles(await fetchZipAsFiles(params.skinUrl));
      }
      if (params.musicUrl) {
        this.setStatus('Fetching music…');
        await this.loadSongs([await fetchZipAsFile(params.musicUrl)]);
        await this.showSelect();
      }
      if (this.collection.songs.length > 0) {
        this.setStatus(describeSongCollection(this.collection));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dropLog.error('URL auto-load failed', error);
      this.setStatus(`URL load failed: ${message}`);
    } finally {
      hideLoadingOverlay(this.elements);
    }
  }

  private async loadSongs(files: File[]): Promise<void> {
    this.setStatus('Loading songs...');
    // Append rather than replace so a second / third folder drop adds to the existing collection instead of wiping the
    // previous pack. The store re-prefixes source / song IDs so each drop's entries stay uniquely addressable. The
    // very first drop is just `append onto an empty collection`, which produces the same result as `loadFromFiles`
    // would have.
    this.collection = await this.collectionStore.appendFromFiles(files, {
      onProgress: (progress) => applyLoadProgress(this.elements, progress),
    });
    // Suppress the "0 charts loaded" reading — that text reads like a parse error to the user. The post-load status
    // text is set by `handleDrop` once both theme + songs land, so a mid-flight transient is plenty.
    if (this.collection.songs.length > 0) {
      this.setStatus(describeSongCollection(this.collection));
    }
  }

  private async loadTheme(files: File[]): Promise<void> {
    // Themes are discovered first so a multi-theme drop (e.g. `LR2files/Theme/{default,LITONE4}/...`) surfaces every
    // subtree to the picker. The picker UI then lets the user pick which one to mount; the rest of the dropped
    // files (Bgm / Sound under `LR2files/`) stay accessible to the selected theme via the loader's shared file map.
    const discovered = discoverLr2Themes(files);
    if (discovered.length === 0) {
      // Drop carried a `.lr2skin` but no `LR2files/Theme/<name>/` shape (rare — handcrafted bundle or zip flattened
      // without keeping the parent dirs). Fall back to "treat everything as one theme" so the legacy single-bundle
      // path keeps working — the picker stays empty in this case.
      this.availableLr2Themes = [];
      await this.mountLr2Theme(files, undefined);
      return;
    }
    // Accumulate themes across drops — mirrors how the song collection store appends rather than replaces. Newer
    // drops replace same-named entries (so the user can refresh a theme's files by re-dropping), older drops stay
    // visible in the picker. Without this the user would need to keep ALL themes in a single drop to switch
    // between them, defeating the picker's purpose.
    const mergedByName = new Map<string, Lr2DiscoveredTheme<File>>();
    for (const existing of this.availableLr2Themes) {
      mergedByName.set(existing.name, existing);
    }
    for (const incoming of discovered) {
      mergedByName.set(incoming.name, incoming);
    }
    this.availableLr2Themes = [...mergedByName.values()].sort((a, b) => a.name.localeCompare(b.name));
    // Pick the theme to mount this drop. Priority order:
    //   1. The currently-active theme if THIS drop covered it (= the user re-dropped to refresh its assets).
    //   2. The first theme from the new drop (alphabetic) — gives a sensible default for fresh drops.
    //   3. Fall back to whatever was active before this drop, in case the user dropped a non-active theme just to
    //      populate the picker without forcing a swap.
    const active = this.activeLr2ThemeName;
    const refreshedActive = active !== undefined ? discovered.find((theme) => theme.name === active) : undefined;
    const next = refreshedActive ?? discovered[0]!;
    // Union the theme's own files with shared LR2files siblings (`WallPaper/`, `Bgm/`, `Sound/`, etc.) so the loader
    // can resolve `#CUSTOMFILE`-style wildcard assets like `LR2files/WallPaper/Select/*.bmp` — those live OUTSIDE
    // `LR2files/Theme/<name>/` and are dropped by `discoverLr2Themes`, which intentionally scopes its return to the
    // theme subtree. Without this union the LR2 default select skin's main backdrop (decoded from `WallPaper/Select/`)
    // never reaches `skin.files`, so the wildcard `resolveLr2AssetBytes` lookup misses and the chrome paints with a
    // black background.
    const themeFileSet = new Set(next.files);
    const otherLr2Files = files.filter((file) => {
      if (themeFileSet.has(file)) return false;
      const lower = (file.webkitRelativePath || file.name).toLowerCase();
      // Keep anything under `lr2files/` that isn't under any theme subtree. We deliberately don't restrict to
      // `lr2files/{wallpaper,bgm,sound}/` so future LR2 shared-asset directories (e.g. a `Common/` folder some skins
      // reference) automatically come along.
      const idx = lower.indexOf('lr2files/');
      if (idx === -1) return false;
      const afterLr2Files = lower.slice(idx + 'lr2files/'.length);
      return !afterLr2Files.startsWith('theme/');
    });
    await this.mountLr2Theme([...next.files, ...otherLr2Files], next.name);
  }

  /**
   * Loads a specific LR2 theme's files through the underlying `loadLr2ThemeSkinsFromFiles` and stamps the result
   * onto the host's skin / BGM / system-sound slots. Centralised so both the initial drop path
   * ({@link loadTheme}) and the Debug Menu's theme-picker path go through the same wiring — without this split the
   * picker would have to re-implement the slot assignment block.
   */
  private async mountLr2Theme(files: ReadonlyArray<File>, themeName: string | undefined): Promise<void> {
    this.setStatus(themeName ? `Loading LR2 theme "${themeName}"...` : 'Loading LR2 theme...');
    const loadedTheme = await loadLr2ThemeSkinsFromFiles([...files], {
      onProgress: (progress) => applyLoadProgress(this.elements, progress),
    });
    for (const variant of Object.keys(this.playSkins) as Lr2PlayVariant[]) {
      delete this.playSkins[variant];
    }
    Object.assign(this.playSkins, loadedTheme.playSkins);
    this.selectSkin = loadedTheme.selectSkin;
    this.resultSkin = loadedTheme.resultSkin;
    this.decideSkin = loadedTheme.decideSkin;
    this.selectBgmBytes = loadedTheme.selectBgm?.bytes;
    this.decideBgmBytes = loadedTheme.decideBgm?.bytes;
    this.clearBgmBytes = loadedTheme.clearBgm?.bytes;
    this.failBgmBytes = loadedTheme.failBgm?.bytes;
    this.resultBgmBytes = loadedTheme.resultBgm?.bytes;
    this.systemSoundBundle = {
      cursorMove: loadedTheme.systemSounds.cursorMove?.bytes,
      folderOpen: loadedTheme.systemSounds.folderOpen?.bytes,
      folderClose: loadedTheme.systemSounds.folderClose?.bytes,
      optionOpen: loadedTheme.systemSounds.optionOpen?.bytes,
      optionClose: loadedTheme.systemSounds.optionClose?.bytes,
      optionChange: loadedTheme.systemSounds.optionChange?.bytes,
    };
    this.activeLr2ThemeName = themeName;
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
    this.rebuildLr2ThemePicker();
  }

  /**
   * Apply a user-picked LR2 theme. Disposes the persistent select view so it gets reconstructed against the new
   * skin on the next `showSelect`, mounts the theme into the slot fields, and returns to song-select.
   */
  private async applyLr2ThemeByName(name: string): Promise<void> {
    const theme = this.availableLr2Themes.find((entry) => entry.name === name);
    if (theme === undefined) return;
    if (this.lastSelectNavigation === undefined && this.selectView !== undefined) {
      this.lastSelectNavigation = this.selectView.getNavigation();
    }
    this.selectView?.dispose();
    this.selectView = undefined;
    await this.mountLr2Theme(theme.files, theme.name);
    await this.showSelect();
  }

  /**
   * Builds (or rebuilds in place) the Debug Menu's "LR2 theme" dropdown. Visible whenever at least one theme has
   * been discovered from the dropped tree — a single-theme drop still gets the picker (with one option) so the
   * user can SEE which theme is active, and subsequent drops that add more themes flip it into a real switcher
   * without the picker disappearing and reappearing.
   *
   * Implementation detail: lil-gui's `OptionController#options(values)` updates the option list in-place on an
   * existing option controller (returns the same instance, preserves the attached `onChange` listener). Same
   * pattern the skin-family picker uses — keeps the controller's position in the panel stable across rebuilds.
   */
  private rebuildLr2ThemePicker(): void {
    const gui = this.gui;
    if (gui === undefined) return;
    const themes = this.availableLr2Themes;
    if (themes.length === 0) {
      // No discovered theme (drop didn't carry an `LR2files/Theme/<name>/` shape, OR LR2 isn't loaded at all).
      // Tear the controller down so the panel doesn't show a stale picker with options that no longer resolve.
      this.lr2ThemeController?.destroy();
      this.lr2ThemeController = undefined;
      return;
    }
    // `themes` is already alphabetised by `discoverLr2Themes`. Use the theme name as both the dropdown label and
    // the bound value — the picker proxy stores the name and `applyLr2ThemeByName` resolves it back to the files.
    const options: Record<string, string> = {};
    for (const theme of themes) {
      options[theme.name] = theme.name;
    }
    if (this.lr2ThemeController !== undefined) {
      this.lr2ThemeController.options(options).updateDisplay();
      return;
    }
    const proxy = { lr2Theme: this.activeLr2ThemeName ?? themes[0]!.name };
    this.lr2ThemeController = gui
      .add(proxy, 'lr2Theme', options)
      .name('LR2 theme')
      .onChange((value: string) => {
        // Hosting the proxy on a literal lets us re-read the picked name without leaking a separate `guiState`
        // field — the theme name is fully redundant with `activeLr2ThemeName`, which `mountLr2Theme` writes.
        // No-op when the user "picks" the already-active theme — `applyLr2ThemeByName` early-returns inside
        // `mountLr2Theme` since the same files re-mount to the same slots, but we still call through so a
        // hypothetical future code path that observes the picker change has a single chokepoint to subscribe to.
        void this.applyLr2ThemeByName(value);
      });
  }

  /**
   * Load a beatoraja theme drop in parallel with the LR2 path. We currently parse the bundle and stash it on the
   * host for inspection; PixiJS rendering for beatoraja skins is implemented in a follow-up patch. The beatoraja
   * loader is independent of `loadTheme` — both states coexist so the user can drop both formats and switch between
   * them later.
   */
  private async loadBeatorajaTheme(files: File[]): Promise<void> {
    this.setStatus('Loading beatoraja theme...');
    try {
      const bundle = await loadBeatorajaThemeFromFiles(files, {
        onProgress: (progress) => applyLoadProgress(this.elements, progress),
      });
      // Drop the per-entry texture caches from the previous theme (we don't destroy individual
      // beatoraja textures in this session — see `beatorajaTextureCachesByEntry`'s field comment).
      // Clearing the map releases the only reference to the old theme's decoded bytes; the
      // underlying Pixi textures stay allocated until page reload, but they're unreachable from
      // the renderer once the new theme replaces `beatorajaTheme`.
      this.beatorajaTextureCachesByEntry.clear();
      this.disposeBeatorajaFontCaches();
      // Tear down the previous theme's audio player — its file-map cache references bytes from
      // the old bundle that we're about to replace. A fresh player gets created below tied to
      // the new bundle.
      this.beatorajaSkinAudio?.dispose();
      this.beatorajaSkinAudio = new BeatorajaSkinAudioPlayer({ files: bundle.files });
      // Probe the bundle for navigation system sounds (cursor / decide / cancel / folder /
      // option). The discovery walks well-known filenames inside the theme's `sound/` subdir
      // (and an LR2-compatible `LR2files/Sound/lr2/*.wav` fallback) — slots without a match
      // stay undefined and the select scene runs silent for those events. Beatoraja's own
      // engine reads these paths from `config.json`; the web port uses convention-based
      // probing instead since we don't load the user's beatoraja config.
      this.beatorajaSystemSoundPaths = discoverBeatorajaSystemSoundPaths(bundle.files);
      // Looping select BGM path. Probes the standard `Bgm/select.*` locations plus an LR2-
      // compatible fallback. Stays `undefined` for themes without a select BGM file (the
      // scene runs silent in the background then).
      this.beatorajaSelectBgmPath = discoverBeatorajaSelectBgmPath(bundle.files);
      this.beatorajaTheme = bundle;
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
      // see `findBeatorajaThemeBgm` for the rules. Awaited because some entries are read lazily;
      // the load is small (<1 MiB) and serialized so it doesn't add visible latency.
      this.beatorajaThemeBgm = await findBeatorajaThemeBgm(bundle);
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
   * Per-entry-path memoized texture caches. Never destroyed in this session — see `beatoraja-textures.ts` for
   * why disposing beatoraja textures and re-decoding the same bytes crashes PixiJS v8's bind-group cache.
   * The same hazard is technically present in the LR2 path but LR2's flow doesn't re-mount the same skin.
   */
  private readonly beatorajaTextureCachesByEntry = new Map<string, BeatorajaTextureCache>();
  /**
   * Per-entry skin font cache. Reused while the same theme is active, then disposed when a new
   * theme is dropped so `document.fonts` and Pixi's bitmap-font cache don't accumulate old entries.
   */
  private readonly beatorajaFontCachesByEntry = new Map<string, BeatorajaFontCache>();

  private disposeBeatorajaFontCaches(): void {
    for (const cache of this.beatorajaFontCachesByEntry.values()) {
      (cache as BeatorajaFontCache & { dispose?: () => void }).dispose?.();
    }
    this.beatorajaFontCachesByEntry.clear();
  }

  /**
   * Bundle the demo's theme / skin / override fields into the {@link FamilyDispatchState} shape consumed by
   * `./family-dispatch.ts`. Built per call (cheap — a half-dozen direct references) so the pure helpers can stay
   * unaware of the demo's private state layout.
   */
  private familyDispatchState(): FamilyDispatchState {
    return {
      beatorajaTheme: this.beatorajaTheme,
      selectSkin: this.selectSkin,
      decideSkin: this.decideSkin,
      resultSkin: this.resultSkin,
      playSkins: this.playSkins,
      skinFamilyOverride: this.guiState.skinFamilyOverride,
    };
  }

  /**
   * Rebuilds (or first-builds) the Debug Menu's "Skin family" dropdown. Called once during `buildGui` and again
   * after every theme load / wipe so the available options track the loaded asset state. When the user's
   * previously-selected override becomes unavailable, silently resets to `'auto'` before swapping options in so
   * the dropdown never displays a value that wouldn't actually be honoured.
   *
   * Implementation detail: lil-gui's `Controller#options(values)` destroys the underlying controller and
   * recreates it in place — same approach the beatoraja per-scene skin picker uses, see
   * `rebuildBeatorajaSkinPickers`. The replacement preserves insertion order, so the dropdown stays where
   * `buildGui` parked it (right after `Open Folder`).
   */
  private rebuildSkinFamilyPicker(): void {
    const gui = this.gui;
    if (gui === undefined) return;
    const lr2Available = hasAnyLr2Skin(this.familyDispatchState());
    const beatorajaAvailable = this.beatorajaTheme !== undefined;
    // Snap back to 'auto' BEFORE rebuilding options so the freshly-built controller initialises to a valid value.
    // Without this guard a user-picked LR2 / beatoraja override that became unavailable mid-session would render
    // as a phantom dropdown value the runtime silently ignored.
    const override = this.guiState.skinFamilyOverride;
    if ((override === 'lr2' && !lr2Available) || (override === 'beatoraja' && !beatorajaAvailable)) {
      this.guiState.skinFamilyOverride = 'auto';
    }
    const options: Record<string, SkinFamilyOverride> = { 'Auto (prefer loaded theme)': 'auto' };
    if (lr2Available) options['LR2'] = 'lr2';
    if (beatorajaAvailable) options['beatoraja'] = 'beatoraja';
    options['Default (no skin)'] = 'default';
    if (this.skinFamilyController !== undefined) {
      // `OptionController#options(values)` updates the option list **in place** on an existing option controller
      // (see lil-gui v0.21.0 source: the subclass override mutates `_values` / `_names` + replaces the `<option>`
      // DOM nodes, returning `this`). The previously-attached `onChange` listener stays bound to the same
      // controller instance — re-attaching here would stack a second handler and fire `handleSkinFamilyOverrideChange`
      // twice per user pick. `updateDisplay()` is enough to snap the visible label to whatever value
      // `rebuildSkinFamilyPicker` just settled on (e.g. the silent revert to `'auto'` when the prior pick became
      // unavailable).
      this.skinFamilyController.options(options).updateDisplay();
      return;
    }
    // First-time build (called from `buildGui` before any theme has been loaded).
    this.skinFamilyController = gui
      .add(this.guiState, 'skinFamilyOverride', options)
      .name('Skin family')
      .onChange((value: SkinFamilyOverride) => {
        this.handleSkinFamilyOverrideChange(value);
      });
  }

  /**
   * Apply a Debug Menu skin-family change. The persistent select scene needs an explicit dispose-and-rebuild
   * (the underlying class differs across families — `PixiSongSelectView` vs `DefaultPixiSongSelectView` vs the
   * beatoraja scene), then `showSelect` reconstructs whichever family the new override resolves to. The gameplay
   * / decide / result scenes pick up the new override on their next mount — they're transient and there's
   * nothing on screen to swap at the moment the user changes the dropdown (they'd have to be in song-select to
   * even reach the GUI).
   */
  private handleSkinFamilyOverrideChange(value: SkinFamilyOverride): void {
    this.guiState.skinFamilyOverride = value;
    if (this.lastSelectNavigation === undefined && this.selectView !== undefined) {
      this.lastSelectNavigation = this.selectView.getNavigation();
    }
    this.selectView?.dispose();
    this.selectView = undefined;
    if (this.beatorajaSelectScene !== undefined) {
      this.beatorajaSelectSnapshot = this.beatorajaSelectScene.captureSnapshot();
    }
    this.beatorajaSelectScene?.dispose();
    this.beatorajaSelectScene = undefined;
    void this.showSelect();
  }

  /**
   * Beatoraja gameplay flow. Mirrors the LR2 `playSong` lifecycle (mount + audio decode → run engine →
   * route exit / completion to result / select), but routes audio through `runEngineDriver` and the
   * scene through `PixiBeatorajaGameplayView` instead of the LR2 view's bespoke render pipeline.
   *
   * The view assumes pre-decoded audio + BGA — those come from `prepareBeatorajaGameplayChart`. Each
   * play awaits the prep promise before constructing the view; if the prep fails, we surface the
   * status and bail back to song select rather than silently falling back to LR2 (the user explicitly
   * opted into the beatoraja path).
   */
  private async playSongBeatoraja(song: BrowserSongEntry, overrides: { autoPlay?: boolean }): Promise<void> {
    const bundle = this.beatorajaTheme;
    if (!bundle) return;
    // **TWO distinct variants** flow into the gameplay scene:
    //   - `skinVariant`: which `play_*` skin file to load. The theme may not ship every
    //     variant (a popular 7-only theme lacks a `play_9` skin, etc.), so this falls back
    //     through `pickBeatorajaPlayableSkinVariant`'s chain (`9 → 7 → 14 → 5 → 10`).
    //   - `chartVariant`: what the chart ACTUALLY is. Drives the engine's lane mode
    //     (channel → lane mapping), the runtime adapter's lane-timer resolution, and the
    //     note layer's `channel → lane index` math. This MUST match what the chart's
    //     channels declare; falling back to the skin's variant here would route a 9-key
    //     chart's `f`/`v`/`g`/`b` inputs through the IIDX 7-key key bindings and the
    //     engine's IIDX free-zone clamp would drop the corresponding `scorableNotes`.
    //
    // Pre-fix the gameplay view received `skinVariant` for everything, so a 9-key
    // chart played on a 7-key skin had:
    //   - 7-key adapter `chartPlayVariant` → lanes 6..9 of channels 16/17/18/19
    //     misclassified as scratch / free-zone / 6key / 7key
    //   - 7-key note-layer `variant` → channel 16 routed to lane 7 (the IIDX scratch
    //     slot), channels 17 / 18 / 19 routed to lanes -1 / 5 / 6
    //   - engine's `laneModeExtension`-only fallback never reached `9-key` because
    //     `resolveLaneMode` only escalates to 9-key when the chart is `.pms` or
    //     `#PLAYER=3` with channel `17` — and most 9-key BMEs that authored f/v/g/b
    //     inputs satisfy neither
    // User report: 9 KEY charts wouldn't accept input on lanes 6-9 (f,v,g,b keys
    // unresponsive). c0da7b5 partially
    // addressed this by forwarding the chart's filename to the engine for the
    // extension-based heuristic, but skipped the variant separation here.
    const skinVariant = resolveBeatorajaSkinVariant(this.beatorajaTheme, song);
    if (skinVariant === undefined) return;
    const chartVariant = pickBeatorajaPlayableVariant(chartShapeFor(song));
    if (chartVariant === undefined) return;
    if (skinVariant !== chartVariant) {
      // Theme doesn't ship the chart's native skin variant (e.g. a 9-key chart on a
      // 7-keys-only theme). We load the fallback skin chrome but keep the engine /
      // adapter / note-layer pinned to the chart's variant so input + judging stay
      // correct; the visible mismatch is the SKIN's lane count differing from the
      // CHART's. Warn so the mismatch is visible in the console.
      gameplayLog.warn(
        `beatoraja gameplay: theme has no '${chartVariant}' skin — falling back to '${skinVariant}' (lane chrome may not match chart key count)`,
      );
    }
    // Alias retained to minimize churn in the rest of this function. Use `skinVariant` for
    // skin lookups (`playSkinTypeForVariant`, the skin entry pick chain) and `chartVariant`
    // for runtime-driving prop wiring (`variant` on the gameplay view).
    const variant = skinVariant;

    this.elements.shell.classList.add('playing');
    await this.ensureHostMounted();
    this.lastSelectNavigation = this.selectView?.getNavigation();
    this.selectView?.setVisible(false);
    this.decideView?.dispose();
    this.decideView = undefined;
    this.gameplayView?.dispose();
    this.gameplayView = undefined;
    this.disposeBeatorajaGameplay();
    this.recordingFilenameBase = sanitizeFilenameStem(song.title) || `gameplay-${Date.now()}`;

    // 1. Pick the actual skin entry for this variant, honoring any user override from the
    // Debug Menu's skin-picker dropdown. Falls back to `pickBeatorajaPlaySkin`'s discovery result.
    const playTypeCode = playSkinTypeForVariant(variant);
    const playCandidates = bundle.theme.entries.filter((entry) => entry.header.type === playTypeCode);
    const fallbackEntry = bundle.theme.playSkins[variant];
    const selectedEntry = this.pickBeatorajaSkinEntryWithOverride(playTypeCode, playCandidates, fallbackEntry);
    if (selectedEntry === undefined) {
      gameplayLog.warn(`beatoraja gameplay: no skin entry for variant '${variant}'`);
      this.setStatus(`Beatoraja gameplay unavailable: no '${variant}' skin`);
      void this.showSelect();
      return;
    }

    // Two-pass evaluation — same contract as the select scene.
    const headerLoad = loadBeatorajaSkin({ entryPath: selectedEntry.entryPath, files: bundle.files });
    if (!headerLoad.ok) {
      gameplayLog.warn(`beatoraja gameplay header: ${headerLoad.error.message}`);
      this.setStatus(`Beatoraja gameplay unavailable: ${headerLoad.error.message}`);
      void this.showSelect();
      return;
    }
    const config = this.resolveBeatorajaSkinConfig(selectedEntry.entryPath, headerLoad.header);
    // Gameplay skins don't crash without runtimeContext (the load-time `main_state.option`
    // pattern is unique to ModernChic decide; play scenes use op gates on destinations,
    // evaluated at render time with a fresh per-frame context). Skip the load-time
    // injection here — its earlier addition was "for consistency" and downstream gameplay
    // skins reacted unexpectedly to mid-load `main_state.option` returning chart-aware
    // values where they previously got `false`. Decide / result still inject because
    // ModernChic specifically pre-computes per-difficulty values during `main()`.
    const result = loadBeatorajaSkin({
      entryPath: selectedEntry.entryPath,
      files: bundle.files,
      skinConfig: config,
    });
    if (!result.ok || !result.skin) {
      const reason = result.ok ? 'skin payload missing' : result.error.message;
      gameplayLog.warn(`beatoraja gameplay: ${reason}`);
      this.setStatus(`Beatoraja gameplay unavailable: ${reason}`);
      void this.showSelect();
      return;
    }
    // Narrow the union by extracting the (now-known-defined) `skin` reference; subsequent uses
    // type-check without `!` operators.
    const skin = result.skin;
    const skinLoad = { entry: selectedEntry, skin };

    // 2. Texture cache for the skin variant — reuse if previously decoded.
    let textures = this.beatorajaTextureCachesByEntry.get(skinLoad.entry.entryPath);
    if (textures === undefined) {
      const sourceBundle = bundleBeatorajaSources({
        files: bundle.files,
        entryPath: skinLoad.entry.entryPath,
        sources: (skinLoad.skin.source ?? []) as unknown as ReadonlyArray<Readonly<Record<string, unknown>>>,
        filepathSchema: skinLoad.skin.filepath,
        filepathOverrides: config.file,
      });
      gameplayLog.info(
        `beatoraja gameplay source bundle: resolved=${sourceBundle.assets.length} unresolved=${sourceBundle.unresolved.length} (entry=${skinLoad.entry.entryPath})`,
      );
      for (const u of sourceBundle.unresolved) {
        gameplayLog.warn(`beatoraja gameplay unresolved source[${u.id}] '${u.path}': ${u.reason}`);
      }
      textures = await loadBeatorajaTexturesFromBundle(sourceBundle);
      this.beatorajaTextureCachesByEntry.set(skinLoad.entry.entryPath, textures);
    }

    // 2b. Skin font cache. Same per-entry memoization as textures — TTFs are tiny (≤ a few hundred KB)
    // and the registered FontFace outlives every scene anyway.
    let fonts = this.beatorajaFontCachesByEntry.get(skinLoad.entry.entryPath);
    if (fonts === undefined) {
      const fontDeclarations = normalizeBeatorajaFonts(skinLoad.skin.font);
      fonts = await loadBeatorajaFonts({
        files: bundle.files,
        entryPath: skinLoad.entry.entryPath,
        fonts: fontDeclarations,
      });
      gameplayLog.info(
        `beatoraja gameplay fonts: declared=${fontDeclarations.length} loaded=${fonts.values().length} (entry=${skinLoad.entry.entryPath})`,
      );
      this.beatorajaFontCachesByEntry.set(skinLoad.entry.entryPath, fonts);
    }

    // 3. Audio + BGA prep — owns the AudioContext for this play.
    const source = resolveSongSource(this.collection, song);
    if (!source) {
      this.setStatus(`Beatoraja gameplay: no source for ${song.title}`);
      void this.showSelect();
      return;
    }
    let prep: PreparedBeatorajaGameplayChart;
    try {
      // Reuse the chart the decide scene resolved IFF it belongs to the song we're about to play
      // — `#RANDOM` rolls fresh per `resolveBmsControlFlow` call, so resolving twice would pick
      // different branches between decide and gameplay. When the cached chart is for a
      // different `chartPath` (= the player reached gameplay via a path that bypassed decide),
      // we fall through to a fresh resolve inside `prepareBeatorajaGameplayChart`.
      const preResolvedChart =
        this.lastBeatorajaChart?.chartPath === song.chartPath ? this.lastBeatorajaChart.chart : undefined;
      prep = await prepareBeatorajaGameplayChart({
        song,
        source,
        audioCompressorMode: this.guiState.compressor === false ? 'off' : this.compressorMode,
        preResolvedChart,
      });
    } catch (error) {
      gameplayLog.warn('beatoraja prep failed', error);
      this.setStatus(`Beatoraja prep failed: ${(error as Error).message}`);
      void this.showSelect();
      return;
    }
    this.beatorajaGameplayPrep = prep;

    // Decode the chart's #STAGEFILE / #BACKBMP / #BANNER bitmaps so play-scene destinations
    // referencing the synthetic ids (-100 / -101 / -102) can paint them. ModernChic's lane
    // cover uses the stagefile as a frosted backdrop; default skin's loading panel anchors
    // on it during the intro chrome.
    const chartImages = await this.loadBeatorajaChartImages(song);

    // 4. Mount the gameplay view.
    this.beatorajaGameplayView = new PixiBeatorajaGameplayView({
      skin: skinLoad.skin,
      textures,
      fonts,
      skinConfig: config,
      // CHART variant drives the engine's lane mode + adapter's `chartPlayVariant` + note
      // layer's channel → lane math. Skin lookups above used `skinVariant` (= the fallback
      // chain pick) because the theme may not ship the chart's exact variant — but the
      // runtime stays pinned to the CHART so f/v/g/b stay bound to channels 16/17/18/19
      // on 9-key POPN charts even when the loaded skin chrome is a 7-key fallback.
      variant: chartVariant,
      chart: prep.chart,
      audio: prep.audio,
      skinAudio: this.beatorajaSkinAudio,
      mode: (overrides.autoPlay ?? this.guiState.autoPlay) ? 'auto' : 'manual',
      // DP flip — when the user enabled it via the play-options panel AND the chart is a
      // DP variant (10 / 14 keys), the chart's lane channels mirror at construction. SP
      // charts pass through unchanged because they have no 2P channels to swap with.
      // Reads from the LR2 select view's persisted play options (the same surface that
      // already drives `dpFlip` on the LR2 path).
      dpFlip: this.selectView?.getPlayOptions().dpFlip,
      bgaTextures: prep.bga.textures,
      bgaVideoElements: prep.bga.videoElements,
      bgaCues: prep.bga.cues,
      chartImages,
      // Directory label drives `BEATORAJA_TEXT.DIRECTORY = 1000` on the play scene. The browser
      // song entry preserves the parent folder name through the dropped collection.
      directoryLabel: song.directoryLabel,
      // Chart filename — the gameplay view derives `laneModeExtension` from this for the engine,
      // so PMS / BME / BMS lane-mode resolution doesn't depend on the BMS content heuristic
      // (`#PLAYER 3` + channel 17). Without it a `#PLAYER 1` PMS chart routes to the IIDX 7-key
      // bindings instead of POPN-9, which silently drops lane 6+ keys.
      chartPath: song.chartPath,
      onExit: () => {
        void this.finishBeatorajaGameplayThen(() => this.showSelect());
      },
      onComplete: (summary, maxCombo, history) => {
        // Result skin (`type = 7`) when the bundle ships one — otherwise jump back to select.
        // `finishBeatorajaGameplayThen` drops the gameplay scene first so the result scene gets a
        // clean stage; the result scene mounts in the `then` branch. `history` carries the
        // per-judge score / gauge polyline samples for the result skin's graph elements.
        // The play-log is captured HERE (while the gameplay view is guaranteed alive) — the finish
        // transition below disposes the scene before the result mounts.
        const playlog = this.beatorajaGameplayView?.getPlaylog();
        void this.finishBeatorajaGameplayThen(async () => {
          const mounted = await this.showBeatorajaResult(song, summary, maxCombo, history);
          if (!mounted) await this.showSelect();
          // Auto-save fires even when the theme ships no result skin — falling back to select
          // shouldn't cost the user their replay file.
          this.maybeAutoSavePlaylog(playlog);
        });
      },
      onError: (error) => {
        // `PlayerInterruptedError` lands here for the ESC path — it's the expected exit for "user
        // pressed ESC mid-chart". Treat it as a clean exit.
        gameplayLog.info('beatoraja engine ended', { error: (error as Error).message });
        void this.finishBeatorajaGameplayThen(() => this.showSelect());
      },
    });
    this.beatorajaGameplayView.root.zIndex = 0;
    // Track the live variant so the Debug Menu's "Play *K" dropdowns know whether their
    // type-code matches the active scene before triggering a live re-mount.
    this.currentBeatorajaPlayVariant = variant;
    await this.sceneHost.setScene(this.beatorajaGameplayView);
    this.setStatus(`Playing (beatoraja): ${song.title}`);

    // Consume the "user pressed Record on the select screen" flag. Same flow as the LR2
    // gameplay path — `autoRecordArmed` is set when the user clicks the Record button
    // before picking a song; the next gameplay mount kicks the recorder off automatically.
    if (this.autoRecordArmed) {
      this.autoRecordArmed = false;
      const controller = this.recordController;
      controller?.domElement.classList.remove('arming');
      try {
        this.beatorajaGameplayView.startRecording();
        controller?.domElement.classList.add('recording');
        controller?.name('■ Stop');
        this.setStatus('Recording…');
      } catch (error) {
        controller?.name('● Record');
        recordLog.warn('auto-start failed', error);
      }
    }

    // Skin-options panel for the play skin's `property[]` / `filepath[]`. Live edits flow through
    // `applyBeatorajaPlaySkinConfig` → `replaceSkin` so the chrome rebuilds without tearing down
    // the engine driver. The audio session, chart playback, and scoring all keep running.
    this.refreshBeatorajaSkinOptionsGui({
      title: `Skin Config (Play ${variant}K)`,
      entryPath: selectedEntry.entryPath,
      header: headerLoad.header,
      onApply: (nextConfig) => {
        void this.applyBeatorajaPlaySkinConfig(selectedEntry.entryPath, variant, nextConfig);
      },
    });
  }

  /**
   * Apply a fresh skin-config to the active beatoraja gameplay scene WITHOUT restarting the chart.
   * Re-loads the skin with the new options, rebuilds the per-entry texture cache, then calls
   * `replaceSkin` on the live gameplay view. The runtime adapter's `setBaseOps` handles the option
   * delta so per-side judge state / timer stamps / current frame all carry through unchanged.
   */
  private async applyBeatorajaPlaySkinConfig(
    entryPath: string,
    variant: BeatorajaPlayableVariant,
    config: BeatorajaSkinConfig,
  ): Promise<void> {
    const bundle = this.beatorajaTheme;
    if (!bundle || !this.beatorajaGameplayView) return;
    // Load the SPECIFIC entry — different from the discovery's "best" pick when the user picked an
    // alternate skin from the Debug Menu's skin-picker dropdown.
    const result = loadBeatorajaSkin({ entryPath, files: bundle.files, skinConfig: config });
    if (!result.ok || !result.skin) return;
    this.beatorajaTextureCachesByEntry.delete(entryPath);
    const sourceBundle = bundleBeatorajaSources({
      files: bundle.files,
      entryPath,
      sources: (result.skin.source ?? []) as unknown as ReadonlyArray<Readonly<Record<string, unknown>>>,
      filepathSchema: result.skin.filepath,
      filepathOverrides: config.file,
    });
    const textures = await loadBeatorajaTexturesFromBundle(sourceBundle);
    this.beatorajaTextureCachesByEntry.set(entryPath, textures);
    let fonts = this.beatorajaFontCachesByEntry.get(entryPath);
    if (fonts === undefined) {
      fonts = await loadBeatorajaFonts({
        files: bundle.files,
        entryPath,
        fonts: normalizeBeatorajaFonts(result.skin.font),
      });
      this.beatorajaFontCachesByEntry.set(entryPath, fonts);
    }
    this.beatorajaGameplayView.replaceSkin({ skin: result.skin, skinConfig: config, textures, fonts });

    this.refreshBeatorajaSkinOptionsGui({
      title: `Skin Config (Play ${variant}K)`,
      entryPath,
      header: result.header,
      onApply: (nextConfig) => {
        void this.applyBeatorajaPlaySkinConfig(entryPath, variant, nextConfig);
      },
    });
  }

  /**
   * Mount the beatoraja-skinned song select scene. Loads the theme's select skin (with a default
   * `skin_config.option` fill from `buildDefaultSkinConfigOptions`), reuses cached textures / fonts
   * when available, and hands the scene a callback that routes the chosen song through the existing
   * `showDecide` / `playSong` flow.
   */
  private async showBeatorajaSelect(): Promise<void> {
    const bundle = this.beatorajaTheme;
    if (bundle === undefined) return;

    // Pick the actual entry to mount — honor a user override from the Debug Menu's skin-picker dropdown
    // when one was set, otherwise fall back to the discovery's "best" pick (`theme.selectSkin`).
    const selectCandidates = bundle.theme.entries.filter(
      (entry) => entry.header.type === BEATORAJA_SKIN_TYPE.MUSIC_SELECT,
    );
    const selectedEntry = this.pickBeatorajaSkinEntryWithOverride(
      BEATORAJA_SKIN_TYPE.MUSIC_SELECT,
      selectCandidates,
      bundle.theme.selectSkin,
    );
    if (selectedEntry === undefined) {
      gameplayLog.warn('beatoraja select: no select skin in theme');
      this.setStatus('Beatoraja select unavailable: no select skin');
      return;
    }

    // Two-pass evaluation — header pass picks up the skin's `property[]` schema, the second pass
    // re-runs `main()` with default option picks so dynamic `source[]` / `destination[]` populate.
    const headerLoad = loadBeatorajaSkin({ entryPath: selectedEntry.entryPath, files: bundle.files });
    if (!headerLoad.ok) {
      gameplayLog.warn(`beatoraja select: ${headerLoad.error.message}`);
      this.setStatus(`Beatoraja select unavailable: ${headerLoad.error.message}`);
      return;
    }
    // Resolve cached skin config (or seed defaults from the header's property[] schema). The
    // skin-options panel mutates this object as the user picks options.
    const config = this.resolveBeatorajaSkinConfig(selectedEntry.entryPath, headerLoad.header);
    const result = loadBeatorajaSkin({ entryPath: selectedEntry.entryPath, files: bundle.files, skinConfig: config });
    if (!result.ok || !result.skin) {
      const reason = result.ok ? 'skin payload missing' : result.error.message;
      gameplayLog.warn(`beatoraja select: ${reason}`);
      this.setStatus(`Beatoraja select unavailable: ${reason}`);
      return;
    }
    // Narrow the union by extracting the (now-known-defined) `skin` reference; subsequent uses
    // type-check without `!` operators.
    const skin = result.skin;
    const skinLoad = { entry: selectedEntry, skin };

    // Texture + font cache — same per-entry memoization as the gameplay path. The select skin lives
    // at a different `entryPath` than `play_*.luaskin` so the caches are naturally segregated.
    let textures = this.beatorajaTextureCachesByEntry.get(skinLoad.entry.entryPath);
    if (textures === undefined) {
      const sourceBundle = bundleBeatorajaSources({
        files: bundle.files,
        entryPath: skinLoad.entry.entryPath,
        sources: (skinLoad.skin.source ?? []) as unknown as ReadonlyArray<Readonly<Record<string, unknown>>>,
        filepathSchema: skinLoad.skin.filepath,
      });
      gameplayLog.info(
        `beatoraja select source bundle: resolved=${sourceBundle.assets.length} unresolved=${sourceBundle.unresolved.length} (entry=${skinLoad.entry.entryPath})`,
      );
      for (const u of sourceBundle.unresolved) {
        gameplayLog.warn(`beatoraja select unresolved source[${u.id}] '${u.path}': ${u.reason}`);
      }
      textures = await loadBeatorajaTexturesFromBundle(sourceBundle);
      this.beatorajaTextureCachesByEntry.set(skinLoad.entry.entryPath, textures);
    }
    let fonts = this.beatorajaFontCachesByEntry.get(skinLoad.entry.entryPath);
    if (fonts === undefined) {
      const fontDeclarations = normalizeBeatorajaFonts(skinLoad.skin.font);
      fonts = await loadBeatorajaFonts({
        files: bundle.files,
        entryPath: skinLoad.entry.entryPath,
        fonts: fontDeclarations,
      });
      this.beatorajaFontCachesByEntry.set(skinLoad.entry.entryPath, fonts);
    }

    // Capture the OUTGOING scene's state before disposing so the snapshot is fresh — covers
    // the rare hot-swap case where `showBeatorajaSelect` runs while a scene is already up
    // (e.g. theme reload). Normal PLAY → SELECT flow already captures via `playSongBeatoraja`
    // / `showDecide`, but doing it here defensively ensures the snapshot is never stale.
    if (this.beatorajaSelectScene !== undefined) {
      this.beatorajaSelectSnapshot = this.beatorajaSelectScene.captureSnapshot();
    }
    this.beatorajaSelectScene?.dispose();
    this.beatorajaSelectScene = new PixiBeatorajaSelectScene({
      skin: skinLoad.skin,
      textures,
      fonts,
      skinConfig: config,
      skinAudio: this.beatorajaSkinAudio,
      songs: this.collection.songs,
      // Pass the collection so the scene's `ChartPreviewEngine` can resolve each focused
      // song's `BrowserSongAssetSource` and play `#PREVIEW` audio (or fall back to in-place
      // chart playback) on cursor settle. Without this, the beatoraja select runs silent on
      // cursor moves — same as the LR2 select did before the preview engine was added.
      collection: this.collection,
      // Theme-bundled navigation cues (cursor / decide / cancel / folder open-close /
      // option-change). Routed through the same `BeatorajaSkinAudioPlayer` the Lua audio_play
      // calls use — that way browsers cap a single AudioContext per scene rather than two.
      systemSoundPaths: this.beatorajaSystemSoundPaths,
      // Looping select-screen background music. Same audio backend as the navigation cues so
      // a single AudioContext mixes them down. The scene starts the loop on enter and stops
      // it on exit; transitioning into decide / play tears it down cleanly.
      selectBgmPath: this.beatorajaSelectBgmPath,
      // In-session lamp lookup — completed runs in this session light the focused song bar's
      // lamp icon. Without this every bar reported as `CLEAR_LAMP_NOPLAY` regardless of how
      // many times the user cleared the chart in the same session (audit 2.18).
      resolveSongLampOp: (song) => this.beatorajaSessionLampOps.get(song.id),
      // Decoder for the focused song's chart-bitmap synthetic ids (`-100 STAGEFILE` /
      // `-101 BACKBMP` / `-102 BANNER`). The scene calls this on every focus change and
      // caches by song-id; default beatoraja's select.json paints `-102 BANNER` as the
      // per-song banner inside the chart-info panel.
      decodeChartImages: (song) => this.loadBeatorajaChartImages(song),
      // Restore the last cursor so coming back from gameplay lands on the same song.
      initialIndex: this.beatorajaSelectIndex,
      // Restore richer scene state captured before the previous tear-down — folder /
      // sort / filter / favorites / cursor stack. Takes precedence over `initialIndex` when
      // both are set (snapshot encodes the full position; bare index can't disambiguate
      // root vs. inside-folder). Cleared by `onExit` so a future fresh entry from the empty
      // drop screen starts at root.
      restoreSnapshot: this.beatorajaSelectSnapshot,
      onSongPicked: (song, opts) => {
        // Cache the index using the picked song's identity — survives the scene tear-down.
        this.beatorajaSelectIndex = this.collection.songs.indexOf(song);
        // Same flow as the LR2 select view: route to decide → gameplay. The decide branch in
        // `showDecide` already detects the beatoraja gameplay case and skips its splash.
        // Forward the `autoPlay` override (set by the skin's AUTO PLAY button click → act=16);
        // omitted otherwise so the user's global default applies.
        void this.showDecide(song, { autoPlay: opts?.autoPlay });
      },
      onExit: () => {
        // ESC from the beatoraja select returns to the empty drop screen. Clear the snapshot
        // because the user explicitly left — coming back via a fresh drop or theme reload
        // should start at root, not pick up wherever they were.
        this.elements.shell.classList.add('empty');
        void this.sceneHost.setScene(undefined);
        this.beatorajaSelectScene?.dispose();
        this.beatorajaSelectScene = undefined;
        this.beatorajaSelectSnapshot = undefined;
        this.beatorajaSkinOptionsGui?.clear();
      },
      onReadtextRequest: (song) => {
        // Skin's READTEXT button (act=17 — "readme" / "btn-text" etc.). Find the chart's
        // accompanying `.txt` next to its BMS file and show it in a transient browser dialog.
        // No persistence / styling — just enough to surface chart-author notes.
        void this.showBeatorajaReadtext(song);
      },
      onSkinConfigChange: (next) => {
        // Skin mutated its own config (currently only the `JUDGE_TIMING` button — note offset
        // ±1 ms per click). Persist back into the per-entry cache so the next mount /
        // `replaceSkin` keeps the adjustment, and re-apply through `applyBeatorajaSelectSkinConfig`
        // so the bottom-centre options panel re-renders with the new value.
        this.beatorajaSkinConfigByEntry.set(skinLoad.entry.entryPath, next);
        void this.applyBeatorajaSelectSkinConfig(skinLoad.entry.entryPath, next);
      },
    });
    await this.sceneHost.setScene(this.beatorajaSelectScene);
    this.setStatus(`Select (beatoraja): ${this.collection.songs.length} song(s)`);

    // Build the bottom-centre skin-options panel for this select skin's `property[]` / `filepath[]`.
    // User picks flow back through `onApply` → live `replaceSkin` on the active scene so chrome
    // changes (Play Side, Score Graph On/Off, etc.) take effect on the very next Pixi frame
    // without disposing / re-mounting the scene.
    this.refreshBeatorajaSkinOptionsGui({
      title: 'Skin Config (Select)',
      entryPath: selectedEntry.entryPath,
      header: headerLoad.header,
      onApply: (nextConfig) => {
        void this.applyBeatorajaSelectSkinConfig(selectedEntry.entryPath, nextConfig);
      },
    });
  }

  /**
   * Find the focused song's accompanying README / notes text and surface it in a transient
   * overlay. Searches the song's source for a `.txt` file in the same directory as the chart
   * (BMS convention: `myhardchart.bms` ↔ `myhardchart.txt` / `readme.txt` / etc.). When more
   * than one matches, picks alphabetically — chart-authors typically only ship one.
   *
   * The overlay is a lightweight `<dialog>` injected at runtime — no persistent UI, click
   * outside or hit Escape to dismiss. Falls back to a `console.log` notice when no `.txt` is
   * found so the user has a hint that the chart didn't ship readtext content.
   */
  private async showBeatorajaReadtext(song: BrowserSongEntry): Promise<void> {
    const source = resolveSongSource(this.collection, song);
    if (source === undefined) {
      gameplayLog.info('beatoraja readtext: source not found', { songId: song.id });
      return;
    }
    const chartDir = song.chartPath.includes('/') ? song.chartPath.slice(0, song.chartPath.lastIndexOf('/')) : '';
    // Match `.txt` files inside the chart's folder (or root when the chart is at the top).
    const textPaths: string[] = [];
    for (const path of source.files.keys()) {
      const lower = path.toLowerCase();
      if (!lower.endsWith('.txt')) continue;
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      if (dir.toLowerCase() !== chartDir.toLowerCase()) continue;
      textPaths.push(path);
    }
    textPaths.sort();
    const textPath = textPaths[0];
    if (textPath === undefined) {
      gameplayLog.info('beatoraja readtext: no .txt found', { dir: chartDir });
      return;
    }
    const entry = source.files.get(textPath);
    if (entry === undefined) return;
    const bytes = await loadAssetBytes(entry);
    if (bytes === undefined) return;
    // BMS-era authors typically ship Shift_JIS-encoded text. Try the BOM-aware UTF-8 first;
    // fall back to a Shift_JIS decode when the result contains replacement characters.
    let text = decodeText(bytes, 'utf-8');
    if (text.includes('�')) {
      try {
        text = decodeText(bytes, 'shift_jis');
      } catch {
        // some browsers don't expose 'shift_jis' decoder; keep the UTF-8 best-effort.
      }
    }
    showReadtextOverlay({
      title: `${song.title}${song.artist ? ` — ${song.artist}` : ''}`,
      filename: textPath.split('/').pop() ?? textPath,
      body: text,
    });
  }

  /**
   * Decode the focused chart's `#STAGEFILE` / `#BACKBMP` / `#BANNER` bitmaps to Pixi textures
   * for the beatoraja decide scene's synthetic-id destinations (`-100` / `-101` / `-102`).
   * Each entry is best-effort — missing or malformed bitmaps resolve to `undefined` and the
   * matching destinations stay hidden. Uses the same `loadTextureFromBytes` decoder the LR2
   * scenes use, so TGA / PNG / BMP / JPG all work transparently.
   */
  private async loadBeatorajaChartImages(song: BrowserSongEntry): Promise<{
    stageFile?: ChartImageTexture;
    backBmp?: ChartImageTexture;
    banner?: ChartImageTexture;
  }> {
    const source = resolveSongSource(this.collection, song);
    if (source === undefined) return {};
    const meta = song.chart.metadata;
    const out: { stageFile?: ChartImageTexture; backBmp?: ChartImageTexture; banner?: ChartImageTexture } = {};
    const decode = async (relPath: string | undefined): Promise<ChartImageTexture | undefined> => {
      if (relPath === undefined || relPath.length === 0) return undefined;
      // Resolve relative to the chart's directory — `#STAGEFILE foo.png` lives next to the BMS
      // unless the path starts with `/`. We strip any leading slash and join under the chart's
      // dirname for the lookup.
      const chartDir = song.chartPath.includes('/') ? song.chartPath.slice(0, song.chartPath.lastIndexOf('/')) : '';
      const normalized = relPath.replace(/^\/+/, '');
      const candidates = [chartDir.length > 0 ? `${chartDir}/${normalized}` : normalized, normalized];
      for (const candidate of candidates) {
        const entry = source.files.get(candidate);
        if (entry === undefined) continue;
        const bytes = await loadAssetBytes(entry);
        if (bytes === undefined) continue;
        try {
          return await loadTextureFromBytes(candidate, bytes);
        } catch (error) {
          gameplayLog.info('beatoraja decide chart-image decode failed', { path: candidate, error });
          return undefined;
        }
      }
      return undefined;
    };
    const [stageFile, backBmp, banner] = await Promise.all([
      decode(meta.stageFile),
      decode(meta.backBmp),
      decode(meta.banner),
    ]);
    if (stageFile !== undefined) out.stageFile = stageFile;
    if (backBmp !== undefined) out.backBmp = backBmp;
    if (banner !== undefined) out.banner = banner;
    return out;
  }

  /**
   * Apply a fresh skin-config to the active beatoraja select scene WITHOUT disposing / re-mounting.
   * Re-runs the skin's Lua `main()` (or re-parses the JSON) with the new options, refreshes the
   * texture cache (Lua skins emit different `source[]` lists per option set), then calls
   * `replaceSkin` on the live scene.
   */
  private async applyBeatorajaSelectSkinConfig(entryPath: string, config: BeatorajaSkinConfig): Promise<void> {
    const bundle = this.beatorajaTheme;
    if (!bundle || !this.beatorajaSelectScene) return;
    // Load the SPECIFIC entry — different from the discovery's "best" pick when the user picked an
    // alternate skin from the Debug Menu's skin-picker dropdown.
    const result = loadBeatorajaSkin({ entryPath, files: bundle.files, skinConfig: config });
    if (!result.ok || !result.skin) return;
    // Drop and re-decode the texture cache for this entry — option changes can alter `source[]`.
    this.beatorajaTextureCachesByEntry.delete(entryPath);
    const sourceBundle = bundleBeatorajaSources({
      files: bundle.files,
      entryPath,
      sources: (result.skin.source ?? []) as unknown as ReadonlyArray<Readonly<Record<string, unknown>>>,
      filepathSchema: result.skin.filepath,
      filepathOverrides: config.file,
    });
    const textures = await loadBeatorajaTexturesFromBundle(sourceBundle);
    this.beatorajaTextureCachesByEntry.set(entryPath, textures);
    let fonts = this.beatorajaFontCachesByEntry.get(entryPath);
    if (fonts === undefined) {
      // Per-entry font cache miss — fonts may differ between skins, so load fresh for this entry.
      fonts = await loadBeatorajaFonts({
        files: bundle.files,
        entryPath,
        fonts: normalizeBeatorajaFonts(result.skin.font),
      });
      this.beatorajaFontCachesByEntry.set(entryPath, fonts);
    }
    this.beatorajaSelectScene.replaceSkin({ skin: result.skin, skinConfig: config, textures, fonts });

    // Refresh the skin-options panel against the new entry's header so the property dropdowns
    // reflect the new skin's `property[]` schema.
    this.refreshBeatorajaSkinOptionsGui({
      title: 'Skin Config (Select)',
      entryPath,
      header: result.header,
      onApply: (nextConfig) => {
        void this.applyBeatorajaSelectSkinConfig(entryPath, nextConfig);
      },
    });
  }

  /**
   * Mount the beatoraja decide splash for `song`. Returns `true` when the splash actually mounted —
   * `false` falls through to the no-decide fast-path (the loaded theme didn't ship a decide skin,
   * the entry's header / payload failed to load, etc.). Both branches eventually call
   * `playSongBeatoraja`; the difference is whether the user sees an animated chrome between
   * select and gameplay.
   */
  private async showBeatorajaDecide(song: BrowserSongEntry, overrides: { autoPlay?: boolean }): Promise<boolean> {
    const bundle = this.beatorajaTheme;
    if (bundle === undefined) return false;

    // Decide skin discovery — same shape as select / play. Picks the user's override when set,
    // otherwise the discovery's "best" pick (`theme.decideSkin`). Falling back to
    // `decideCandidates[0]` here was the previous behaviour and a bug: that's whatever
    // happens to come first in the file-walk iteration order, NOT the preferred entry. So
    // when the user picked the discovery default in the Debug Menu (which CLEARS the
    // override per `rebuildBeatorajaSkinPickers`), the next decide mount fell back to
    // `decideCandidates[0]` and silently mounted whichever theme the file map iterated
    // first (typically GdbG_Skin instead of the requested default). The Debug Menu's
    // dropdown showed the right name but the wrong skin actually loaded.
    const decideCandidates = bundle.theme.entries.filter((entry) => entry.header.type === BEATORAJA_SKIN_TYPE.DECIDE);
    const selectedEntry = this.pickBeatorajaSkinEntryWithOverride(
      BEATORAJA_SKIN_TYPE.DECIDE,
      decideCandidates,
      bundle.theme.decideSkin,
    );
    if (selectedEntry === undefined) return false;

    // Two-pass evaluation — same `loadBeatorajaSkin` contract as select / play. The first pass
    // gives us the header (used for `property[]` dropdown); the second runs the skin's `main()`
    // with the resolved option set so dynamic destinations populate. The phase-2 eval also
    // gets a `runtimeContext` populated with the chart's difficulty ops so themes that
    // pre-compute per-difficulty values at load time (e.g. ModernChic's
    // `CUSTOM.NUM.diffRGB()`) see a non-`nil` answer instead of crashing on `RGB[1]`.
    const headerLoad = loadBeatorajaSkin({ entryPath: selectedEntry.entryPath, files: bundle.files });
    if (!headerLoad.ok) {
      gameplayLog.warn(`beatoraja decide: ${headerLoad.error.message}`);
      return false;
    }
    const config = this.resolveBeatorajaSkinConfig(selectedEntry.entryPath, headerLoad.header);
    const result = loadBeatorajaSkin({
      entryPath: selectedEntry.entryPath,
      files: bundle.files,
      skinConfig: config,
      runtimeContext: this.buildBeatorajaSkinLoadContext(song, config),
    });
    if (!result.ok || !result.skin) {
      const reason = result.ok ? 'skin payload missing' : result.error.message;
      gameplayLog.warn(`beatoraja decide: ${reason}`);
      return false;
    }

    // Texture + font cache lookup — reuse existing entries, decode + register fresh ones.
    let textures = this.beatorajaTextureCachesByEntry.get(selectedEntry.entryPath);
    if (textures === undefined) {
      const sourceBundle = bundleBeatorajaSources({
        files: bundle.files,
        entryPath: selectedEntry.entryPath,
        sources: (result.skin.source ?? []) as unknown as ReadonlyArray<Readonly<Record<string, unknown>>>,
        filepathSchema: result.skin.filepath,
        filepathOverrides: config.file,
      });
      textures = await loadBeatorajaTexturesFromBundle(sourceBundle);
      this.beatorajaTextureCachesByEntry.set(selectedEntry.entryPath, textures);
    }
    let fonts = this.beatorajaFontCachesByEntry.get(selectedEntry.entryPath);
    if (fonts === undefined) {
      fonts = await loadBeatorajaFonts({
        files: bundle.files,
        entryPath: selectedEntry.entryPath,
        fonts: normalizeBeatorajaFonts(result.skin.font),
      });
      this.beatorajaFontCachesByEntry.set(selectedEntry.entryPath, fonts);
    }

    await this.ensureHostMounted();
    this.lastSelectNavigation = this.selectView?.getNavigation();
    this.selectView?.setVisible(false);
    // Capture the select scene's state before disposing — the user picked a song and is
    // heading into decide → play. When they come back via the result scene's "back to
    // select" path we re-mount with this snapshot so they land in the same folder / cursor /
    // sort / filter / favorites state, not at the root with default sort.
    if (this.beatorajaSelectScene !== undefined) {
      this.beatorajaSelectSnapshot = this.beatorajaSelectScene.captureSnapshot();
    }
    this.beatorajaSelectScene?.dispose();
    this.beatorajaSelectScene = undefined;
    this.beatorajaDecideScene?.dispose();

    // Resolve `#IF` / `#RANDOM` once at decide entry so the decide skin's bpmgraph plots the
    // SAME branches the gameplay scene will play. `resolveBmsControlFlow` rolls each `#RANDOM`
    // fresh per call; resolving twice (here + inside `prepareBeatorajaGameplayChart`) would yield
    // different branches between decide and gameplay. The resolved chart is cached on the demo
    // and reused by `playSongBeatoraja` via `preResolvedChart`.
    const resolvedChart = resolveBmsControlFlow(song.chart, { random: Math.random });
    this.lastBeatorajaChart = { chart: resolvedChart, chartPath: song.chartPath };

    // Idempotency gate — `onContinue` and the auto-advance timer can race in theory; whichever
    // lands first wins. Same pattern as the LR2 decide path.
    let advanced = false;
    const advance = (then: () => void): void => {
      if (advanced) return;
      advanced = true;
      then();
    };

    // Resolve the chart's #STAGEFILE / #BACKBMP / #BANNER bitmaps to Pixi textures so the
    // decide skin's synthetic-id destinations (-100 / -101 / -102) can paint them. Loading is
    // best-effort — missing bitmaps just leave the matching destinations hidden.
    const chartImages = await this.loadBeatorajaChartImages(song);

    this.beatorajaDecideScene = new PixiBeatorajaDecideScene({
      skin: result.skin,
      textures,
      fonts,
      // Pass the resolved chart so the decide skin's bpmgraph element (when authored) plots the
      // BPM curve of the about-to-play chart.
      chart: resolvedChart,
      skinConfig: config,
      song,
      chartImages,
      bgmBytes: this.beatorajaThemeBgm.decide,
      skinAudio: this.beatorajaSkinAudio,
      onContinue: () =>
        advance(() => {
          // Drop the decide scene first so the gameplay scene gets a clean stage. `playSongBeatoraja`
          // handles the rest — host mount, audio prep, skin selection, etc.
          void this.sceneHost.setScene(undefined).then(() => {
            this.beatorajaDecideScene?.dispose();
            this.beatorajaDecideScene = undefined;
            void this.playSongBeatoraja(song, overrides);
          });
        }),
      onCancel: () =>
        advance(() => {
          // ESC from the splash returns to select — same fallback as LR2.
          void this.sceneHost.setScene(undefined).then(() => {
            this.beatorajaDecideScene?.dispose();
            this.beatorajaDecideScene = undefined;
            void this.showSelect();
          });
        }),
    });
    await this.sceneHost.setScene(this.beatorajaDecideScene);
    this.setStatus(`Decide (beatoraja): ${song.title}`);
    return true;
  }

  /**
   * Mount the beatoraja result scene for `song` against the chart's final `summary`. Returns
   * `true` when the scene actually mounted — `false` falls through to the no-result fast-path
   * (no result skin in the bundle, or skin load failed). Same shape as `showBeatorajaDecide`.
   */
  private async showBeatorajaResult(
    song: BrowserSongEntry,
    summary: PlayerSummary,
    maxCombo: number,
    history: {
      scoreHistory: ReadonlyArray<{ progress: number; exScore: number }>;
      gaugeHistory: ReadonlyArray<{ progress: number; value: number }>;
      timingHistory: ReadonlyArray<{ deltaMs: number; kind: string }>;
    },
  ): Promise<boolean> {
    const bundle = this.beatorajaTheme;
    if (bundle === undefined) return false;

    // Stash the run's clear-lamp into the in-session map (audit 2.18) so the next time the
    // user lands on this song in the select scene the bar's lamp icon lights up. Cleared
    // runs replace any previous lamp; a failed retry of a previously-cleared chart should
    // not downgrade the lamp.
    const newLamp = computeClearLampOp({
      cleared: summary.gauge?.cleared ?? false,
      perfect: summary.perfect,
      great: summary.great,
      good: summary.good,
      bad: summary.bad,
      poor: summary.poor,
      total: summary.total,
      gaugeType: summary.gauge?.type,
    });
    const previousLamp = this.beatorajaSessionLampOps.get(song.id);
    if (newLamp !== BEATORAJA_OP.CLEAR_LAMP_FAILED || previousLamp === undefined) {
      this.beatorajaSessionLampOps.set(song.id, newLamp);
    }

    // Same fix as decide — fall back to the discovery's `theme.resultSkin` rather than
    // `resultCandidates[0]` (= file-walk iteration order), so picking the discovery default
    // in the Debug Menu (which clears the override) actually mounts the discovery default
    // instead of silently picking whatever theme happens to iterate first.
    const resultCandidates = bundle.theme.entries.filter((entry) => entry.header.type === BEATORAJA_SKIN_TYPE.RESULT);
    const selectedEntry = this.pickBeatorajaSkinEntryWithOverride(
      BEATORAJA_SKIN_TYPE.RESULT,
      resultCandidates,
      bundle.theme.resultSkin,
    );
    if (selectedEntry === undefined) return false;

    const headerLoad = loadBeatorajaSkin({ entryPath: selectedEntry.entryPath, files: bundle.files });
    if (!headerLoad.ok) {
      gameplayLog.warn(`beatoraja result: ${headerLoad.error.message}`);
      return false;
    }
    const config = this.resolveBeatorajaSkinConfig(selectedEntry.entryPath, headerLoad.header);
    // Phase-2 eval gets the chart's difficulty ops via `runtimeContext` so result themes that
    // pre-compute per-difficulty values at load time (mirroring the decide path's
    // ModernChic-style `diffRGB()` pattern) don't crash on `nil` indexing.
    const result = loadBeatorajaSkin({
      entryPath: selectedEntry.entryPath,
      files: bundle.files,
      skinConfig: config,
      runtimeContext: this.buildBeatorajaSkinLoadContext(song, config),
    });
    if (!result.ok || !result.skin) {
      const reason = result.ok ? 'skin payload missing' : result.error.message;
      gameplayLog.warn(`beatoraja result: ${reason}`);
      return false;
    }

    let textures = this.beatorajaTextureCachesByEntry.get(selectedEntry.entryPath);
    if (textures === undefined) {
      const sourceBundle = bundleBeatorajaSources({
        files: bundle.files,
        entryPath: selectedEntry.entryPath,
        sources: (result.skin.source ?? []) as unknown as ReadonlyArray<Readonly<Record<string, unknown>>>,
        filepathSchema: result.skin.filepath,
        filepathOverrides: config.file,
      });
      textures = await loadBeatorajaTexturesFromBundle(sourceBundle);
      this.beatorajaTextureCachesByEntry.set(selectedEntry.entryPath, textures);
    }
    let fonts = this.beatorajaFontCachesByEntry.get(selectedEntry.entryPath);
    if (fonts === undefined) {
      fonts = await loadBeatorajaFonts({
        files: bundle.files,
        entryPath: selectedEntry.entryPath,
        fonts: normalizeBeatorajaFonts(result.skin.font),
      });
      this.beatorajaFontCachesByEntry.set(selectedEntry.entryPath, fonts);
    }

    await this.ensureHostMounted();
    this.beatorajaResultScene?.dispose();

    // Decode the chart's #STAGEFILE / #BACKBMP / #BANNER bitmaps so the result skin's
    // synthetic-id destinations (-100 / -101 / -102) can paint them. Reuses the same loader
    // as decide / play so all three scenes share one decoder path.
    const chartImages = await this.loadBeatorajaChartImages(song);

    let dismissed = false;
    this.beatorajaResultScene = new PixiBeatorajaResultScene({
      skin: result.skin,
      textures,
      fonts,
      skinConfig: config,
      song,
      // Pass the just-played chart so any `bpmgraph[]` element in the result skin can plot the
      // chart's BPM curve. The prep bundle is disposed at gameplay teardown, so the chart
      // reference is snapshot into `lastBeatorajaChart` for use here. We only forward when the
      // cached chart matches the song the result scene is rendering — otherwise the bpmgraph
      // would plot the wrong chart's BPM curve.
      chart: this.lastBeatorajaChart?.chartPath === song.chartPath ? this.lastBeatorajaChart.chart : undefined,
      summary,
      maxCombo,
      scoreHistory: history.scoreHistory,
      gaugeHistory: history.gaugeHistory,
      timingHistory: history.timingHistory,
      chartImages,
      // Pick the outcome-specific jingle when one was discovered, falling back to the generic
      // `result` slot. Beatoraja themes that ship a single result BGM authoredit as `result.*`,
      // while themes that distinguish clear / fail (most reference themes) ship dedicated tracks.
      bgmBytes:
        ((summary.gauge?.cleared ?? false) ? this.beatorajaThemeBgm.clear : this.beatorajaThemeBgm.fail) ??
        this.beatorajaThemeBgm.result,
      skinAudio: this.beatorajaSkinAudio,
      onContinue: () => {
        if (dismissed) return;
        dismissed = true;
        void this.sceneHost.setScene(undefined).then(() => {
          this.beatorajaResultScene?.dispose();
          this.beatorajaResultScene = undefined;
          void this.showSelect();
        });
      },
    });
    await this.sceneHost.setScene(this.beatorajaResultScene);
    this.setStatus(
      `Result (beatoraja): ${song.title} · score=${summary.score} ex=${summary.exScore} maxCombo=${maxCombo}`,
    );
    return true;
  }

  /**
   * Record an in-scene skin override and sync the Debug Menu dropdown's displayed value so the
   * two surfaces stay consistent. Called from the in-scene `BeatorajaSkinOptionsGui` callbacks
   * (the popup the user opens with the skin's authored "options" button); the Debug Menu's own
   * dropdown writes the override directly because its `onChange` is the source.
   *
   * Pass `entryPath = undefined` to clear the override (= fall back to the theme's discovery
   * default). The picker dropdown also resets to the default option in that case.
   */
  private setBeatorajaSkinOverride(typeCode: number, entryPath: string | undefined): void {
    if (entryPath === undefined) {
      this.beatorajaSkinOverridesByType.delete(typeCode);
    } else {
      this.beatorajaSkinOverridesByType.set(typeCode, entryPath);
    }
    // Mirror the change onto the Debug Menu dropdown when one exists for this type. lil-gui's
    // `setValue` writes to the underlying proxy AND repaints the option list to highlight the
    // matching entry; without this the dropdown would still show the previous selection until
    // the next `rebuildBeatorajaSkinPickers` call (= next theme drop).
    const controller = this.beatorajaSkinPickerControllers.get(typeCode);
    if (controller !== undefined) {
      const fallbackPath = this.beatorajaTheme?.theme.entries.find((e) => e.header.type === typeCode)?.entryPath;
      controller.setValue(entryPath ?? fallbackPath ?? '');
    }
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
   * Repopulate the "Beatoraja skins" debug-menu folder with one dropdown per scene type that the
   * loaded theme actually ships an entry for. Called from `loadBeatorajaTheme` after each drop,
   * so the dropdowns always reflect the live `beatorajaTheme.entries` list.
   *
   * Each dropdown:
   *   - shows the scene's "best" entry (from theme discovery) as the default — selecting a
   *     different option sets `beatorajaSkinOverridesByType` and the next scene mount uses it
   *     via {@link pickBeatorajaSkinEntryWithOverride}.
   *   - labels options by `${header.name} (${entryPath})` so the user can disambiguate same-
   *     named skins from different folders.
   *   - is omitted entirely for scene types the loaded theme doesn't ship at all (so the panel
   *     stays compact). Single-entry types still get a dropdown so the user can see at a glance
   *     which file is mounted.
   */
  private rebuildBeatorajaSkinPickers(): void {
    const folder = this.beatorajaSkinPickerFolder;
    if (folder === undefined) return;
    // Tear down previous controllers so dropdown options match the current theme bundle. lil-gui
    // doesn't support live-updating an `add(target, prop, options)` controller's option list, so
    // recreating each time is the safe path.
    for (const controller of this.beatorajaSkinPickerControllers.values()) {
      controller.destroy();
    }
    this.beatorajaSkinPickerControllers.clear();
    const theme = this.beatorajaTheme?.theme;
    if (theme === undefined) return;
    // Order matters here — the folder lays controllers out in insertion order, so we keep the
    // play-variant types together (clustered by key count), then chrome scenes (select / decide
    // / result / etc.) below them.
    const sceneTypes: ReadonlyArray<{ typeCode: number; label: string; best?: BeatorajaSkinEntry }> = [
      { typeCode: BEATORAJA_SKIN_TYPE.PLAY_5KEYS, label: 'Play 5K', best: theme.playSkins['5'] },
      { typeCode: BEATORAJA_SKIN_TYPE.PLAY_7KEYS, label: 'Play 7K', best: theme.playSkins['7'] },
      { typeCode: BEATORAJA_SKIN_TYPE.PLAY_9KEYS, label: 'Play 9K', best: theme.playSkins['9'] },
      { typeCode: BEATORAJA_SKIN_TYPE.PLAY_10KEYS, label: 'Play 10K', best: theme.playSkins['10'] },
      { typeCode: BEATORAJA_SKIN_TYPE.PLAY_14KEYS, label: 'Play 14K', best: theme.playSkins['14'] },
      { typeCode: BEATORAJA_SKIN_TYPE.PLAY_24KEYS, label: 'Play 24K', best: theme.playSkins['24'] },
      { typeCode: BEATORAJA_SKIN_TYPE.PLAY_24KEYS_DOUBLE, label: 'Play 24K DP', best: theme.playSkins['24d'] },
      { typeCode: BEATORAJA_SKIN_TYPE.MUSIC_SELECT, label: 'Music Select', best: theme.selectSkin },
      { typeCode: BEATORAJA_SKIN_TYPE.DECIDE, label: 'Decide', best: theme.decideSkin },
      { typeCode: BEATORAJA_SKIN_TYPE.RESULT, label: 'Result', best: theme.resultSkin },
      { typeCode: BEATORAJA_SKIN_TYPE.COURSE_RESULT, label: 'Course Result', best: theme.courseResultSkin },
    ];
    for (const scene of sceneTypes) {
      const candidates = theme.entries.filter((entry) => entry.header.type === scene.typeCode);
      if (candidates.length === 0) continue;
      // Build a label → entryPath map. lil-gui shows the keys in the dropdown and writes the
      // matching value to the proxy. Using entryPath as the value lets us look up the entry on
      // change without keeping a separate index.
      const options: Record<string, string> = {};
      for (const entry of candidates) {
        const name = entry.header.name?.length ? entry.header.name : '(unnamed)';
        const label = `${name} (${entry.entryPath})`;
        options[label] = entry.entryPath;
      }
      // The proxy holds the currently-selected entryPath. Default to the discovery's best pick
      // so the dropdown reflects what would actually mount if no override is set.
      const proxy = { entryPath: scene.best?.entryPath ?? candidates[0]!.entryPath };
      const controller = folder
        .add(proxy, 'entryPath', options)
        .name(`${scene.label} (${candidates.length})`)
        .onChange((nextEntryPath: string) => {
          if (scene.best !== undefined && nextEntryPath === scene.best.entryPath) {
            // Picking the discovery default = "no override" — drop any prior override so future
            // theme rotations pick up the new "best" automatically.
            this.beatorajaSkinOverridesByType.delete(scene.typeCode);
          } else {
            this.beatorajaSkinOverridesByType.set(scene.typeCode, nextEntryPath);
          }
          // Live-apply: if the user's pick matches the currently-mounted scene type, re-mount it
          // immediately against the new entry. Without this the Debug Menu only takes effect on
          // the NEXT scene transition, which felt broken to the user (drop a theme, pick a skin,
          // nothing visible until you ESC and re-enter the scene).
          this.applyBeatorajaSkinSwitchIfActive(scene.typeCode, nextEntryPath, candidates);
        });
      this.beatorajaSkinPickerControllers.set(scene.typeCode, controller);
    }
  }

  /**
   * If the active scene's type-code matches `typeCode`, re-mount it against `entryPath`. Invoked
   * by the Debug Menu's skin-picker dropdown (the canonical surface for switching skins —
   * the bottom-centre `BeatorajaSkinOptionsGui` only exposes the picked skin's authored
   * `property[]` / `filepath[]` schema, not the picker itself). No-op when no matching scene is
   * active (e.g., user picks a Decide skin while the Select scene is on screen — the override
   * still gets recorded by the caller for the next mount, but nothing visible changes now).
   *
   * `candidates` carries the dropdown's source list so we can recover the entry's `header` for
   * config-defaults seeding without re-loading the skin to read it back. The header is also
   * needed by `applyBeatoraja*SkinConfig` indirectly via the cached config map.
   */
  private applyBeatorajaSkinSwitchIfActive(
    typeCode: number,
    entryPath: string,
    candidates: ReadonlyArray<BeatorajaSkinEntry>,
  ): void {
    const matched = candidates.find((entry) => entry.entryPath === entryPath);
    if (matched === undefined) return;
    const config = this.resolveBeatorajaSkinConfig(entryPath, matched.header);
    if (typeCode === BEATORAJA_SKIN_TYPE.MUSIC_SELECT && this.beatorajaSelectScene !== undefined) {
      void this.applyBeatorajaSelectSkinConfig(entryPath, config);
      return;
    }
    if (
      this.beatorajaGameplayView !== undefined &&
      this.currentBeatorajaPlayVariant !== undefined &&
      playSkinTypeForVariant(this.currentBeatorajaPlayVariant) === typeCode
    ) {
      void this.applyBeatorajaPlaySkinConfig(entryPath, this.currentBeatorajaPlayVariant, config);
    }
  }

  /**
   * Pick the cached skin config for an entry — falling back to a fresh defaults-fill from the
   * header's `property[]` schema. Mutating the returned object directly mutates the cache, but the
   * skin-options panel emits fresh copies on change so the cached state never becomes accidentally
   * shared with downstream consumers.
   */
  /**
   * Build a `BeatorajaLuaRuntimeContext` for skin-load time so themes that compute values via
   * `main_state.option(...)` inside `main()` see chart-aware ops. Without this:
   *
   *   ModernChic decide.lua's `lockonAnimation` calls `CUSTOM.NUM.diffRGB()` which does
   *   `main_state.option(MAIN.OP.DIFFICULTY1..)` → returns false → falls through to `nil` →
   *   `RGB[1]` index crashes the entire `main()` evaluation → the load fails silently and
   *   `showBeatorajaDecide` returns false (= the user's reported "no decide animation,
   *   the scene jumps straight to PLAY" symptom).
   *
   * The context's `option` reflects the same op set the scene would compute on mount, so any
   * pre-computed RGB / position / asset choice the skin makes at load time matches what would
   * render anyway. Surfacing the chart's difficulty + skin_config option picks is enough to
   * unblock the surveyed cases (ModernChic decide / result); other accessors stay
   * \`undefined\` and fall through to the stub defaults.
   */
  private buildBeatorajaSkinLoadContext(
    song: BrowserSongEntry | undefined,
    skinConfig: BeatorajaSkinConfig,
  ): BeatorajaLuaRuntimeContext {
    const ops = new Set(buildBaseOpSet(skinConfig.option));
    const difficulty = song?.chart.metadata.difficulty;
    switch (difficulty) {
      case 1:
        ops.add(BEATORAJA_OP.LEVEL_BEGINNER);
        ops.add(BEATORAJA_OP.DIFFICULTY_BEGINNER);
        break;
      case 2:
        ops.add(BEATORAJA_OP.LEVEL_NORMAL);
        ops.add(BEATORAJA_OP.DIFFICULTY_NORMAL);
        break;
      case 3:
        ops.add(BEATORAJA_OP.LEVEL_HYPER);
        ops.add(BEATORAJA_OP.DIFFICULTY_HYPER);
        break;
      case 4:
        ops.add(BEATORAJA_OP.LEVEL_ANOTHER);
        ops.add(BEATORAJA_OP.DIFFICULTY_ANOTHER);
        break;
      case 5:
        ops.add(BEATORAJA_OP.LEVEL_INSANE);
        ops.add(BEATORAJA_OP.DIFFICULTY_INSANE);
        break;
      default:
        ops.add(BEATORAJA_OP.DIFFICULTY_UNDEFINED);
        break;
    }
    const audio = this.beatorajaSkinAudio;
    return {
      option: (id) => ops.has(id),
      // Wire `main_state.audio_play / audio_loop / audio_stop` to the theme-bundle audio
      // player. ModernChic's `Root/customsound.lua` calls these from every panel-toggle /
      // song-change / confirm — without them the menu UI feels dead even though the eval
      // doesn't crash. Each callback returns false when the player isn't constructed (no
      // theme bundle yet) so the Lua side gracefully no-ops.
      audioPlay: audio === undefined ? undefined : (path, vol) => audio.play(path, vol),
      audioLoop: audio === undefined ? undefined : (path, vol) => audio.loop(path, vol),
      audioStop: audio === undefined ? undefined : (path) => audio.stop(path),
    };
  }

  private resolveBeatorajaSkinConfig(entryPath: string, header: BeatorajaSkinHeader): BeatorajaSkinConfig {
    let cached = this.beatorajaSkinConfigByEntry.get(entryPath);
    if (cached === undefined) {
      // Seed both `option` (from `property[].def`) AND `file` (from `filepath[].def`). Earlier
      // `file` started empty, which made the wildcard fallback inside `resolveSourcePath` pick
      // whichever filename happened to sort first instead of the author's authored default —
      // ModernChic's `key` filepath got `#default.png` instead of the intended `harf.png`,
      // its `bomb` filepath got `Kakabomb.png` instead of `diamond SCUROed..png`, etc.
      // `buildDefaultSkinConfigFiles` resolves each `filepath[].def` against the wildcard's
      // match set so first-time mounts pick the author-intended file rather than a sort-order
      // accident. The bundle's `files` map is the same one `loadBeatorajaSkin` consumed, so
      // the wildcard expansion sees identical candidates either way.
      const file =
        this.beatorajaTheme !== undefined
          ? buildDefaultSkinConfigFiles(header, this.beatorajaTheme.files, entryPath)
          : {};
      // `customOffset` starts empty — the GUI's per-slot zero-fill happens at panel build
      // time. Storing the empty object explicitly here means the config shape stays
      // consistent across the cache vs. the GUI emit path (both have a `customOffset` key,
      // even if empty), which keeps spread / deep-clone snapshots free of surprises.
      cached = { offset: 0, option: buildDefaultSkinConfigOptions(header), file, customOffset: {} };
      this.beatorajaSkinConfigByEntry.set(entryPath, cached);
    }
    return cached;
  }

  /**
   * Pre-resolve `filepath[]` candidate lists for the skin-options panel. Each entry's `path` field
   * is a wildcard relative to the skin directory; `expandBeatorajaWildcard` walks the dropped file
   * map and returns every match. The panel hands these to lil-gui as dropdown options so the user
   * can pick a specific file by name rather than guessing.
   */
  private collectBeatorajaFileCandidates(
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
   * Lazily instantiate the skin-options panel. Deferred from the constructor because the demo shell
   * (the parent the panel attaches to) doesn't exist until `app.innerHTML` materializes.
   */
  private ensureBeatorajaSkinOptionsGui(): BeatorajaSkinOptionsGui {
    if (this.beatorajaSkinOptionsGui === undefined) {
      this.beatorajaSkinOptionsGui = new BeatorajaSkinOptionsGui({ container: this.elements.shell });
    }
    return this.beatorajaSkinOptionsGui;
  }

  /**
   * Update the bottom-centre skin-options panel for a freshly-mounted beatoraja scene. Subsequent
   * user changes flow back through `onChange` → cache update → scene re-mount.
   *
   * Skin selection itself is handled by the Debug Menu, not this panel — the demo's
   * `setBeatorajaSkinOverride` + `applyBeatorajaPlaySkinConfig` cascade is invoked from there.
   */
  private refreshBeatorajaSkinOptionsGui(args: {
    title: string;
    entryPath: string;
    header: BeatorajaSkinHeader;
    onApply: (updatedConfig: BeatorajaSkinConfig) => void;
  }): void {
    const config = this.resolveBeatorajaSkinConfig(args.entryPath, args.header);
    const candidates = this.collectBeatorajaFileCandidates(args.entryPath, args.header);
    const gui = this.ensureBeatorajaSkinOptionsGui();
    gui.setSkin({
      title: args.title,
      // Forward the entry's stable path so `setSkin` can short-circuit when the same skin entry
      // is being reapplied (the round-trip after every controller tweak). Without this the GUI
      // tears down and rebuilds on every value change, snapping the panel back to its
      // initial collapsed state mid-edit.
      entryPath: args.entryPath,
      header: args.header,
      config,
      fileCandidates: candidates,
      onChange: (next) => {
        // Persist and notify the caller so it can re-mount the active scene with the new config.
        this.beatorajaSkinConfigByEntry.set(args.entryPath, next);
        args.onApply(next);
      },
    });
  }

  /** Tear down the active beatoraja gameplay view + its prep bundle. Idempotent. */
  private disposeBeatorajaGameplay(): void {
    this.beatorajaGameplayView?.dispose();
    this.beatorajaGameplayView = undefined;
    this.currentBeatorajaPlayVariant = undefined;
    if (this.beatorajaGameplayPrep) {
      // Refresh the cached chart with whatever the prep ended up using — this preserves the
      // `chartPath ⇒ chart` association even on the rare path where the prep had to fall back to
      // a fresh resolve (e.g. gameplay reached without going through decide). The audio / BGA
      // resources owned by `prep` still get released by `dispose()`.
      const chartPath = this.lastBeatorajaChart?.chartPath;
      if (chartPath !== undefined) {
        this.lastBeatorajaChart = { chart: this.beatorajaGameplayPrep.chart, chartPath };
      }
      void this.beatorajaGameplayPrep.dispose();
      this.beatorajaGameplayPrep = undefined;
    }
  }

  /** Sequence beatoraja-gameplay teardown → caller-supplied transition (mirrors `finishGameplayThen`). */
  private async finishBeatorajaGameplayThen(then: () => void | Promise<void>): Promise<void> {
    await this.sceneHost.setScene(undefined);
    this.disposeBeatorajaGameplay();
    await then();
  }

  private async showSelect(): Promise<void> {
    this.elements.shell.classList.remove('playing');
    // The `.empty` class drives the centered "Drop BMS folder…" hint. Toggle it off the moment we have charts to show,
    // and back on after a wipe / failed drop so the hint comes back instead of leaving the user staring at a blank
    // canvas.
    this.elements.shell.classList.toggle('empty', this.collection.songs.length === 0);
    await this.ensureHostMounted();
    this.gameplayView?.dispose();
    this.gameplayView = undefined;
    this.disposeBeatorajaGameplay();
    this.resultView?.dispose();
    this.resultView = undefined;
    // Decide splash is cleared too — Escape from the splash should land back on the select scene rather than leave the
    // splash drawing over it.
    this.decideView?.dispose();
    this.decideView = undefined;
    // Family dispatch. The Debug Menu's "Skin family" pick overrides the auto chain (beatoraja → LR2 → default);
    // when the user hasn't overridden, the auto branch matches the legacy behaviour. The select scene also
    // gates on `songs.length > 0` for the beatoraja path because the beatoraja select scene's chrome assumes a
    // non-empty library (it paints empty-state hints separately from the LR2 path).
    const activeFamily = pickActiveFamilyForScene(this.familyDispatchState(), 'select');
    if (activeFamily === 'beatoraja' && this.collection.songs.length > 0) {
      // Hide / dispose the LR2 select view if it was up — only one select can own the scene host.
      this.selectView?.setVisible(false);
      await this.showBeatorajaSelect();
      return;
    }
    // Same teardown for the beatoraja select scene if we're falling back to LR2 (theme dropped, etc.).
    // Capture before disposing so a future beatoraja-theme reload (e.g. user re-drops the same
    // theme) restores the cursor / folder state. The snapshot is opaque data — harmless to retain
    // even when the user has switched away.
    if (this.beatorajaSelectScene !== undefined) {
      this.beatorajaSelectSnapshot = this.beatorajaSelectScene.captureSnapshot();
    }
    this.beatorajaSelectScene?.dispose();
    this.beatorajaSelectScene = undefined;
    // Decide / result splashes don't outlive a return to select either — the gameplay-skinned
    // chrome they paint would otherwise overlay the select scene.
    this.beatorajaDecideScene?.dispose();
    this.beatorajaDecideScene = undefined;
    this.beatorajaResultScene?.dispose();
    this.beatorajaResultScene = undefined;
    // The active family for this select mount. `'lr2'` flows the loaded LR2 select skin through, `'default'` strips
    // it so the underlying scene paints built-in chrome regardless of what's loaded. The beatoraja branch returned
    // earlier, so we only have these two cases here.
    const lr2SelectSkin = activeFamily === 'lr2' ? this.selectSkin : undefined;
    if (this.selectView) {
      // Push the latest theme assets onto the view BEFORE flipping it visible. Order matters — `setSelectBgm` no-ops
      // when the bytes haven't changed, so back-from-play is silent; on a fresh theme drop it stops the old loop, swaps
      // the bytes, and (because we're still hidden) defers the actual `start()` until `setVisible(true)` lands a moment
      // later. Doing it the other way round would briefly start the prior theme's BGM during the visibility flip.
      this.selectView.setSkin(lr2SelectSkin);
      this.selectView.setSelectBgm(this.selectBgmBytes);
      this.selectView.setDecideBgm(this.decideBgmBytes);
      this.selectView.setSystemSounds(this.systemSoundBundle);
      this.selectView.setCollection(this.collection);
      this.selectView.setVisible(true);
      if (this.lastSelectNavigation) {
        this.selectView.setNavigation(this.lastSelectNavigation);
      }
      return;
    }
    // Pick the right family's select scene: when an LR2 select skin is loaded, use the LR2 scene; otherwise the
    // default family takes over (visually the built-in 640×480 chrome). The previous code constructed
    // `PixiSongSelectView` with `skin: this.selectSkin` and relied on the LR2 scene's internal `if (skin)` fallback —
    // now that "no skin" is its own family at the type level, the dispatch happens here and the LR2 scene type
    // signals to readers that a real LR2 skin is required to take this path.
    const selectSceneOptions = {
      selectBgm: this.selectBgmBytes,
      decideBgm: this.decideBgmBytes,
      systemSounds: this.systemSoundBundle,
      initialNavigation: this.lastSelectNavigation,
      // Seed the in-scene panel's autoPlay value from the cached demo state (carries the last value the user picked
      // across re-mounts of the select view).
      initialPlayOptions: { autoPlay: this.guiState.autoPlay },
      onPlayOptionsChange: (options: { autoPlay: boolean }) => {
        // Cache the last value so it survives a select-view re-mount even though the lil-gui toggle is gone.
        this.guiState.autoPlay = options.autoPlay;
      },
      onSongSelected: (song: BrowserSongEntry) => {
        // Fire the decide cue first — it plays through the select view's AudioContext which keeps running even after
        // the view is hidden, so the cue isn't cut by the gameplay mount.
        void this.selectView?.playDecideSound();
        void this.showDecide(song);
      },
      onSongAutoPlay: (song: BrowserSongEntry) => {
        // The skin's AUTOPLAY button forces the auto flag on for this session regardless of the toolbar checkbox state.
        // We DON'T mutate the checkbox here — the user might want to keep it off for the next manual play.
        void this.selectView?.playDecideSound();
        void this.showDecide(song, { autoPlay: true });
      },
      onSearchActivate: () => {
        this.elements.searchInput.focus();
        this.elements.searchInput.select();
      },
    };
    this.selectView = lr2SelectSkin
      ? new PixiSongSelectView({ skin: lr2SelectSkin, ...selectSceneOptions })
      : new DefaultPixiSongSelectView(selectSceneOptions);
    await this.selectView.mount(this.sceneHost);
    this.selectView.setCollection(this.collection);
  }

  /**
   * Mounts the decide-screen splash and routes the user into gameplay when it dismisses (auto-advance OR Enter / Space
   * / Escape input). Without a decide skin, falls straight through to `playSong` so themes that don't ship a Decide
   * directory still play the chart immediately.
   *
   * The decide view runs alongside the select view's AudioContext — `playDecideSound` was already fired at song-pick
   * time, and the splash visually masks the chart-load + gameplay-mount window that comes next.
   */
  private async showDecide(song: BrowserSongEntry, overrides: { autoPlay?: boolean } = {}): Promise<void> {
    // Family dispatch for the decide splash. Note this is decoupled from the gameplay family pick: a user can be
    // playing in LR2 mode and have a beatoraja-only decide skin, or vice versa. The decide splash is a one-shot
    // overlay so each scene transition consults the family helper afresh.
    const decideFamily = pickActiveFamilyForScene(this.familyDispatchState(), 'decide', song);
    if (decideFamily === 'beatoraja') {
      const mounted = await this.showBeatorajaDecide(song, overrides);
      if (!mounted) await this.playSong(song, overrides);
      return;
    }
    if (decideFamily === 'default' || !this.decideSkin) {
      // Default family has no decide splash by design — same for an LR2-only setup that didn't ship a decide skin.
      // The select view's `playDecideSound` already fired so the audio cue still plays.
      await this.playSong(song, overrides);
      return;
    }
    await this.ensureHostMounted();
    this.lastSelectNavigation = this.selectView?.getNavigation();
    this.selectView?.setVisible(false);
    this.decideView?.dispose();
    this.gameplayView?.dispose();
    this.gameplayView = undefined;
    // Build the gameplay view eagerly and kick off its heavy load (chart parse, audio decode, BGA preload) IN PARALLEL
    // with the Decide animation. The Decide splash typically runs ~3 s; chart asset decoding is mostly done by the time
    // the splash auto-advances, so the hand-off to gameplay becomes instant instead of dropping a frozen frame.
    const preloaded = this.preloadGameplay(song, overrides);
    let advanced = false;
    const advance = (then: () => void): void => {
      // Idempotent — the auto-advance timer, key input, and pointer click can all race; whichever lands first wins and
      // re-entries no-op.
      if (advanced) return;
      advanced = true;
      then();
    };
    this.decideView = new PixiDecideView({
      skin: this.decideSkin,
      onContinue: () =>
        advance(() => {
          void this.startGameplayAfterDecide(song, preloaded);
        }),
      onCancel: () =>
        advance(() => {
          // User backed out of the splash — abandon the prepared gameplay scene before falling back to the select view.
          this.gameplayView?.dispose();
          this.gameplayView = undefined;
          void this.showSelect();
        }),
    });
    await this.decideView.mount(this.sceneHost, { song, collection: this.collection });
  }

  /**
   * Constructs a fresh `PixiGameplayView` with the current play-options snapshot and starts its `prepare()` against the
   * shared host. The returned promise resolves once chart audio is decoded — the host awaits it inside the Decide
   * `onContinue` handler before flipping the scene visible.
   *
   * Wired up here (rather than inline in `showDecide`) because the same option-marshalling + callback wiring is needed
   * whether we're going through Decide or the no-decide fast-path. `playSong` shares this construction shape.
   */
  private preloadGameplay(song: BrowserSongEntry, overrides: { autoPlay?: boolean }): Promise<void> {
    this.recordingFilenameBase = sanitizeFilenameStem(song.title) || `gameplay-${Date.now()}`;
    // Same family check as `playSong` — picking `'default'` from the Debug Menu strips the LR2 skin even when one
    // is loaded for this chart. Computing `gameplayFamily` here keeps the decide → gameplay preload path consistent
    // with the no-decide fast-path.
    const gameplayFamily = pickActiveFamilyForScene(this.familyDispatchState(), 'gameplay', song);
    const playSkin = gameplayFamily === 'lr2' ? pickLr2PlaySkin(this.playSkins, song) : undefined;
    this.gameplayView = this.buildLr2GameplayView(song, playSkin, overrides);
    return this.gameplayView.prepare(this.sceneHost, song, resolveSongSource(this.collection, song));
  }

  /**
   * Constructs the LR2-family (or default-family fallback) gameplay scene for `song` with the current option snapshot.
   * Branches on `playSkin`:
   *
   * - **`Lr2Skin`** present → constructs {@link PixiGameplayView} with that skin. LR2 chrome paints from the skin.
   * - **`undefined`** (no LR2 theme dropped, or the dropped theme has no skin for this chart's key mode) →
   *   constructs {@link DefaultPixiGameplayView}. The default family's injected chrome renderer takes over.
   *
   * The two branches share every other option — pulling the option-marshalling into one helper avoids the previous
   * two-place duplication between `preloadGameplay` and `playSong` (LR2 fallback path).
   */
  private buildLr2GameplayView(
    song: BrowserSongEntry,
    playSkin: Lr2Skin | undefined,
    overrides: { autoPlay?: boolean },
  ): PixiGameplayView {
    const playOptions = this.selectView?.getPlayOptions();
    const sharedOptions = {
      autoPlay: overrides.autoPlay ?? playOptions?.autoPlay ?? this.guiState.autoPlay,
      autoPauseOnBlur: this.guiState.autoPauseOnBlur,
      initialHiSpeed: playOptions?.hiSpeed,
      bga: playOptions?.bga,
      bgaSize: playOptions?.bgaSize,
      scoreGraph: playOptions?.scoreGraph,
      hsFix: playOptions?.hsFix,
      hiddenSudden1P: playOptions?.hiddenSudden1P,
      hiddenSudden2P: playOptions?.hiddenSudden2P,
      shutter: playOptions?.shutter,
      laneCover: playOptions?.laneCover,
      autoScratch1P: playOptions?.autoScratch1P,
      autoScratch2P: playOptions?.autoScratch2P,
      dpFlip: playOptions?.dpFlip,
      random1P: playOptions?.random1P,
      random2P: playOptions?.random2P,
      gauge: playOptions?.gauge1P,
      audioCompressor: this.guiState.compressor,
      audioCompressorMode: this.compressorMode,
      audioCompressorStages: {
        key: this.guiState.compressorKey,
        bgm: this.guiState.compressorBgm,
        master: this.guiState.compressorMaster,
      },
      bgaTranscodeMaxLongEdgePx: this.guiState.bgaResizeMaxEdgePx > 0 ? this.guiState.bgaResizeMaxEdgePx : undefined,
      bgaTranscodeUseWebCodecs: this.guiState.bgaUseWebCodecs,
      showInvisibleNotes: this.guiState.showInvisibleNotes,
      judgedNoteDisplay: this.guiState.judgedNoteDisplay,
      onExit: () => {
        void this.finishGameplayThen(() => this.showSelect());
      },
      onChartFinished: (result: PixiGameplayResultData) => {
        void this.finishGameplayThen(() => this.showResult(result));
      },
      onRestart: () => {
        void this.finishGameplayThen(() => this.playSong(song));
      },
    };
    if (playSkin === undefined) {
      // Default-family path: no LR2 skin loaded for this chart. `DefaultPixiGameplayView` strips the skin / invisible-
      // note-skin slots from its option shape, so neither value flows in here.
      return new DefaultPixiGameplayView(sharedOptions);
    }
    return new PixiGameplayView({
      ...sharedOptions,
      skin: playSkin,
      // Pass the loaded 9-keys play variant as the invisible-note sprite source — Pop'n's green wide note at index 3
      // is the sprite the gameplay view paints over each invisible note when
      // {@link DemoGuiState.showInvisibleNotes} is on. Falls back to a flat green rectangle when the dropped theme
      // didn't ship `play_9.lr2skin`. Only meaningful with an LR2 theme loaded — the default family wouldn't have
      // anywhere to source the sprite from.
      invisibleNoteSkin: this.playSkins['9'],
    });
  }

  /**
   * Tears the Decide splash down and hands the stage over to the (already-prepared) gameplay scene. Awaits the preload
   * promise: when the user dismisses Decide before chart audio has finished decoding, the splash's last frame stays on
   * screen until prepare resolves — visually a brief hold rather than the previous frozen-frame freeze.
   */
  private async startGameplayAfterDecide(song: BrowserSongEntry, preloaded: Promise<void>): Promise<void> {
    try {
      await preloaded;
    } catch (error) {
      gameplayLog.warn('preload failed; falling back to no-decide path', error);
      this.gameplayView?.dispose();
      this.gameplayView = undefined;
      this.decideView?.dispose();
      this.decideView = undefined;
      await this.playSong(song);
      return;
    }
    if (!this.gameplayView) return;
    this.elements.shell.classList.add('playing');
    this.lastSelectNavigation = this.selectView?.getNavigation();
    this.selectView?.setVisible(false);
    this.decideView?.dispose();
    this.decideView = undefined;
    this.setStatus(`Playing: ${song.title}`);
    this.gameplayView.start();
    if (this.autoRecordArmed) {
      this.autoRecordArmed = false;
      const controller = this.recordController;
      controller?.domElement.classList.remove('arming');
      try {
        this.gameplayView.startRecording();
        controller?.domElement.classList.add('recording');
        controller?.name('■ Stop');
        this.setStatus('Recording…');
      } catch (error) {
        controller?.name('● Record');
        recordLog.warn('auto-start failed', error);
      }
    }
  }

  private async playSong(song: BrowserSongEntry, overrides: { autoPlay?: boolean } = {}): Promise<void> {
    // Family dispatch for the gameplay scene. The Debug Menu's "Skin family" pick funnels through here so a user
    // override of `'lr2'` / `'default'` forces that family even when beatoraja is technically available, while
    // `'auto'` keeps the legacy preference (beatoraja → LR2 → default).
    const gameplayFamily = pickActiveFamilyForScene(this.familyDispatchState(), 'gameplay', song);
    if (gameplayFamily === 'beatoraja') {
      await this.playSongBeatoraja(song, overrides);
      return;
    }
    this.elements.shell.classList.add('playing');
    await this.ensureHostMounted();
    this.lastSelectNavigation = this.selectView?.getNavigation();
    this.selectView?.setVisible(false);
    // Tear down the decide splash before mounting gameplay — both share the host stage, so leaving the decide layer
    // alive would draw the splash on top of the gameplay scene.
    this.decideView?.dispose();
    this.decideView = undefined;
    this.gameplayView?.dispose();
    this.disposeBeatorajaGameplay();
    // Refresh the recording filename base for the upcoming play — each session writes to a unique file in the user's
    // downloads folder rather than overwriting the previous one.
    this.recordingFilenameBase = sanitizeFilenameStem(song.title) || `gameplay-${Date.now()}`;
    // Resolve the LR2 play skin only when the family pick actually says LR2 — overriding to `'default'` skips the
    // skin even if one is loaded. `buildLr2GameplayView` then constructs `DefaultPixiGameplayView` when the skin
    // is undefined and `PixiGameplayView` otherwise; see `preloadGameplay` for the matching call shape (both feed
    // the same helper so option marshalling stays in one place).
    const playSkin = gameplayFamily === 'lr2' ? pickLr2PlaySkin(this.playSkins, song) : undefined;
    this.gameplayView = this.buildLr2GameplayView(song, playSkin, overrides);
    this.setStatus(`Playing: ${song.title}`);
    await this.gameplayView.mount(this.sceneHost, song, resolveSongSource(this.collection, song));
    // Consume the "user pressed Record on the select screen" flag now that gameplay is mounted — `startRecording`
    // requires the gameplay AudioContext to exist, which only happens after `mount`. Failing here is non-fatal: the
    // select-screen click already nudged the user that capture would start; if it doesn't (codec missing / no
    // MediaRecorder), the surfaced error replaces the armed status without breaking gameplay.
    if (this.autoRecordArmed) {
      this.autoRecordArmed = false;
      const controller = this.recordController;
      controller?.domElement.classList.remove('arming');
      try {
        this.gameplayView.startRecording();
        controller?.domElement.classList.add('recording');
        controller?.name('■ Stop');
        this.setStatus('Recording…');
      } catch (error) {
        controller?.name('● Record');
        recordLog.warn('auto-start failed', error);
        this.setStatus(`Recording unavailable: ${(error as Error).message}`);
      }
    }
  }

  /**
   * Closes out an in-flight recording (if any) and then runs the caller-supplied transition (`showSelect` /
   * `showResult` / `playSong`). Sequencing here is non-negotiable: every one of those transitions disposes the gameplay
   * view, which in turn closes the AudioContext the `MediaRecorder` is tapping. Doing the dispose first leaves
   * `MediaRecorder.stop()` waiting on a `'stop'` event that never fires because its source stream died — the user would
   * see the result screen pop up but never get the saved WebM. Awaiting `finalizeRecordingIfActive` first lets the
   * recorder flush + download cleanly before the graph it depends on goes away.
   */
  private async finishGameplayThen(transition: () => Promise<void>): Promise<void> {
    await finalizeRecordingIfActive(this.recordingDeps());
    await transition();
  }

  private async showResult(data: PixiGameplayResultData): Promise<void> {
    await this.ensureHostMounted();
    this.resultView?.dispose();
    // Family dispatch for result. We currently only model the LR2 / default split here — the beatoraja result
    // scene is constructed inside `playSongBeatoraja`'s onComplete handler, not via `showResult`, so this method
    // never sees the `'beatoraja'` family. Pick the LR2 result skin only when the family pick says so; defaulting
    // strips the slot even if the loaded theme has a result skin.
    const resultFamily = pickActiveFamilyForScene(this.familyDispatchState(), 'result');
    const lr2ResultSkin = resultFamily === 'lr2' ? this.resultSkin : undefined;
    const sharedResultOptions = {
      collection: this.collection,
      clearBgm: this.clearBgmBytes,
      failBgm: this.failBgmBytes,
      resultBgm: this.resultBgmBytes,
      onContinue: () => {
        void this.showSelect();
      },
    };
    this.resultView = lr2ResultSkin
      ? new PixiResultView({ skin: lr2ResultSkin, ...sharedResultOptions })
      : new DefaultPixiResultView(sharedResultOptions);
    await this.resultView.mount(this.sceneHost, data);
    this.gameplayView?.dispose({ preserveAudioTail: true });
    this.gameplayView = undefined;
    this.setStatus(`Result: ${data.song.title}`);
    this.maybeAutoSavePlaylog(data.playlog);
  }

  /**
   * Downloads the play-log (`*.bmplay.json` input replay) when the "Auto-save play history" toggle is on. Called
   * from both result paths (LR2/default `showResult`, beatoraja `onComplete`) the moment the result presentation is
   * up. Failures are non-fatal — the result screen must never be blocked by a download hiccup.
   */
  private maybeAutoSavePlaylog(playlog: BeMusicPlaylog | undefined): void {
    if (!this.guiState.autoSavePlaylog || playlog === undefined) {
      return;
    }
    try {
      const blob = new Blob([serializePlaylog(playlog)], { type: 'application/json' });
      downloadBlob(blob, resolvePlaylogFilename(playlog));
    } catch (error) {
      gameplayLog.warn('play-log auto-save failed', error);
    }
  }
}

// Browser compatibility probe runs first so the drop card paints the readiness verdict immediately on first render. We
// do this BEFORE constructing the demo app so that even a hard-fail (Pixi `Application.init()` throwing on a no-WebGL2
// browser) still leaves the user looking at the unsupported-browser message rather than a blank canvas.
renderBrowserCompatPanel(checkBrowserCompat());

// Wire up the bottom-right Help button + unified Help / OSS modal. The acknowledgement list is rendered lazily on first
// open of the OSS tab, so the initial paint isn't blocked on rendering ~30 dependency cards.
wireHelpModal();

void waitForDefaultUiFonts().finally(() => {
  void new PlayerWebDemoApp({
    stage: document.querySelector<HTMLDivElement>('#stage')!,
    shell: document.querySelector<HTMLDivElement>('.shell')!,
    songInput: document.querySelector<HTMLInputElement>('#songs')!,
    searchInput: document.querySelector<HTMLInputElement>('#search')!,
    loadingOverlay: document.querySelector<HTMLDivElement>('#loading-overlay')!,
    loadingLabel: document.querySelector<HTMLDivElement>('#loading-label')!,
    loadingBarFill: document.querySelector<HTMLDivElement>('#loading-bar-fill')!,
    loadingCounter: document.querySelector<HTMLDivElement>('#loading-counter')!,
  }).start();
});
