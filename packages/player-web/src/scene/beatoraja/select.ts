// Beatoraja-skinned song select scene.
//
// Mounts a `BeatorajaPlaySkinView` against a select-format skin (`type = 5`, parsed from
// `select.json` / `selectmain.lua`) and adds a usable browse UI on top:
//
//   - **Folder browsing** — songs are bucketed by `directoryLabel` via `groupSongsByFolder`.
//     At root, the list shows folder bars (label + song count); entering a folder shows its
//     songs. Backspace / Escape pops the stack. Mirrors the LR2 select view's nav model.
//   - **Mouse interaction** — clicking a row moves the cursor to it; clicking an already-
//     selected row "enters" (pick song / open folder). Pointer events go through Pixi's
//     `eventMode='static'` and are scoped to the row hit areas so the rest of the skin chrome
//     stays interaction-pass-through.
//   - **Smooth scroll** — `currentIndex` is the discrete cursor; `scrollPosition` is the
//     animated value the renderer reads. `scrollPosition` tweens toward `currentIndex` on every
//     tick so a long jump (PageDown / End) glides instead of teleporting.
//   - **Selection highlight** — preferred path is the skin's own per-row bar-image swap:
//     skins that author the focused `liston[i]` entry with a different `id` than its
//     peers (e.g. `list_on` vs `list`) get a per-row bar texture swap automatically —
//     `parseBeatorajaSongList` captures the per-row id and we crop `image[id]` into a
//     Sprite per row. When the skin DOESN'T author a focused-row variant, we fall back to
//     a warm-yellow label tint so the selection still stands out; when the skin DOES, we
//     suppress the tint to avoid over-painting the authored cue.
//   - **Text resolver** — surfaces the *currently-highlighted* song's title / artist / genre /
//     etc. via `text[].ref` so the skin's authored info panels reflect the live cursor.
//   - **Keyboard navigation** — ArrowUp/Down (one row), PageUp/Down (10 rows), Home/End
//     (extremes), Enter (pick / enter folder), Backspace/Escape (leave folder / exit).
//
// What's still deferred:
//   - Per-song clear-lamp / score state via `value[].ref` codes (DB layer)
//   - Preview audio (no beatoraja parallel to LR2's `playSelectBgm` yet)
//   - Search / sort / random song picks
//   - Chart-difficulty submenus inside a folder (currently flat song list)
//
// The scene is made of parts that read and drive it through one context it builds (`createContext`): the song list's
// rows (`select/rows.ts`), the search input (`select/search.ts`), the focused chart's images and graphs
// (`select/chart-images.ts`) and what the skin reads of the screen (`select/skin-state.ts`). What the skin reads of a
// chart bar is in `select/chart-facts.ts`, and the scene's options and snapshot types in `select/options.ts`.

import { Container, FederatedPointerEvent, Graphics, Sprite, Text, type Ticker } from 'pixi.js';
import type { BeatorajaSkin, BeatorajaSkinConfig } from '@be-music/beatoraja-skin';
import { parseBeatorajaSongList, TIMER_SCENE_START, TIMER_SONGBAR_CHANGE } from '@be-music/beatoraja-skin';
import {
  beatorajaKeyModeIndex,
  beatorajaLnModeIndex,
  resolveBeatorajaSelectSliderValue,
  type BeatorajaSystemSoundPaths,
} from '@be-music/beatoraja-skin/scene';
import { BeatorajaPlaySkinView } from './skin-view.ts';
import { safeResolveChartVariant } from './select/chart-facts.ts';
import { BeatorajaSelectChartImages, type BeatorajaSelectChartImagesContext } from './select/chart-images.ts';
import type { PixiBeatorajaSelectSceneOptions, PixiBeatorajaSelectSceneSnapshot } from './select/options.ts';
import { BeatorajaSelectRows, type BeatorajaSelectRowsContext } from './select/rows.ts';
import { BeatorajaSelectSearch, songMatchesQuery, type BeatorajaSelectSearchContext } from './select/search.ts';
import { BeatorajaSelectSkinState, type BeatorajaSelectSkinStateContext } from './select/skin-state.ts';
import type { BeatorajaTextureCache } from '../../skin/beatoraja/textures.ts';
import type { BeatorajaFontCache } from '../../skin/beatoraja/fonts.ts';
import type { PixiScene, PixiSceneHost } from '../host.ts';
import { groupSongsByFolder, resolveSongSource } from '../../collection/collection.ts';
import { ChartPreviewEngine } from '../../chart/preview.ts';
import type {
  BrowserBrowseEntry,
  BrowserCourseEntry,
  BrowserFolderNode,
  BrowserSongEntry,
} from '../../collection/types.ts';
import { masterOutput } from '../../runtime/master-volume.ts';

export type { PixiBeatorajaSelectSceneOptions, PixiBeatorajaSelectSceneSnapshot } from './select/options.ts';

/**
 * Per-frame tween rate for `scrollPosition` chasing `currentIndex`. Fraction of the remaining
 * delta closed each frame at 60 Hz — `0.25` lands inside ~150 ms which feels responsive without
 * looking jumpy. We snap to the integer once the gap drops below `SCROLL_SNAP_THRESHOLD` so the
 * position doesn't asymptotically wander.
 */
const SCROLL_TWEEN_RATE = 0.25;
const SCROLL_SNAP_THRESHOLD = 0.005;

/** What the scene's parts read and drive on it. */
type BeatorajaSelectSceneContext = BeatorajaSelectRowsContext &
  BeatorajaSelectSearchContext &
  BeatorajaSelectChartImagesContext &
  BeatorajaSelectSkinStateContext;

export class PixiBeatorajaSelectScene implements PixiScene {
  readonly root: Container = new Container();
  readonly identity = { kind: 'select', family: 'beatoraja' } as const;
  /** Full-canvas backdrop behind the skin container — see `PixiBeatorajaGameplayView` for rationale. */
  private readonly backdrop = new Graphics();
  private view: BeatorajaPlaySkinView;
  /**
   * Song-bar overlay. Painted on top of the skin in screen-space (NOT inside the skin's scaled
   * container) so the row layout doesn't compress with the letterbox. The reference skin renders
   * song bars via its own `bar[]` declarations, which we don't parse yet — this overlay lets the
   * scene be usable in the meantime.
   */
  /**
   * Song-bar overlay. Mounted INSIDE `view.container` so it inherits the skin's scale +
   * positional transform — the labels live in skin-space and follow whatever bar-list layout
   * the skin authored (default reference theme: a column at x=800; ModernChic: an arched
   * column on the right; GdbG: a strip on the lower-right; etc.). Without this the labels
   * sat at hard-coded screen-space coordinates that ignored the skin's chrome.
   */
  private readonly listLayer = new Container();
  /** This scene as the parts it is made of read and drive it (see {@link createContext}). */
  private readonly context: BeatorajaSelectSceneContext = PixiBeatorajaSelectScene.createContext(this);
  /** The song list: each row's bar, title, level digits, feature labels and hit sprite, drawn into `listLayer`. */
  private readonly rows: BeatorajaSelectRows = new BeatorajaSelectRows(this.context);
  /** The rows' titles, as the scene's tests reach them. */
  private get rowLabels(): (Text | undefined)[] {
    return this.rows.rowLabels;
  }
  /** The rows' hit sprites, as the scene's tests reach them. */
  private get rowHitAreas(): (Sprite | undefined)[] {
    return this.rows.rowHitAreas;
  }
  /** The search input mode and its prompt. */
  private readonly search: BeatorajaSelectSearch = new BeatorajaSelectSearch(this.context);
  /** The search prompt, as the scene's tests reach it. */
  private get searchPromptText(): Text | undefined {
    return this.search.searchPromptText;
  }
  /** The focused chart's images and graphs. */
  private readonly chartImages: BeatorajaSelectChartImages = new BeatorajaSelectChartImages(this.context);
  /** What the skin reads of the screen: the frame's select input, its texts and values, and the active ops. */
  private readonly skinState: BeatorajaSelectSkinState = new BeatorajaSelectSkinState(this.context);

  private readonly options: PixiBeatorajaSelectSceneOptions;
  private host?: PixiSceneHost;
  private tickerHandle?: (ticker: Ticker) => void;
  private startMs = 0;
  /**
   * Folder navigation stack. Empty = at root (showing folder bars). Length-1 = inside one
   * folder (showing songs). Mirrors `scene/lr2/select.ts`'s nav model — beatoraja's reference skin
   * also flattens to "folders / songs" without deeper nesting.
   */
  private folderStack: BrowserFolderNode[] = [];
  /**
   * Per-stack-depth cursor stack. Index 0 holds the cursor index for the root list; deeper
   * entries hold the cursor for each opened folder. Restored on `leaveFolder` so the user
   * returns to the folder bar they entered through, not the top of the parent list.
   */
  private cursorStack: number[] = [0];
  /** Snapshot of the entries the current scene depth is rendering. Re-derived on every nav change. */
  private entries: ReadonlyArray<BrowserBrowseEntry> = [];
  /** Discrete cursor — what `entries[currentIndex]` refers to. The keyboard / pointer mutate this. */
  private currentIndex = 0;
  /**
   * Animated cursor — a fractional approximation of {@link currentIndex} that chases it via
   * an exponential tween. The renderer maps this onto row positions so a 10-row jump glides
   * instead of teleporting. Snaps to the integer once the gap is small.
   */
  private scrollPosition = 0;

  /**
   * Per-scene timer ladder. Mirrors the play scene's runtime adapter `timerStartedAt` map —
   * destinations gated on `timer = N` consult `getTimerStart(N)` to compute their elapsed
   * time, returning `undefined` keeps the destination hidden. Stamped at scene mount
   * (`TIMER_SCENE_START`) and on every cursor move (`TIMER_SONGBAR_CHANGE`).
   *
   * Mirrors upstream `MusicSelector.timer.setTimerOn(MAIN.TIMER.SONGBAR_CHANGE)` which the
   * select-scene emits on `BarManager.update` (= focus moved). ModernChic's
   * `musicdisplay.lua` keys title / genre / artist text destinations on this timer; without
   * it the left-side song-info panel never appears.
   */
  private timerStartedAt: Map<number, number> = new Map();

  private lastFitWidth = 0;
  private lastFitHeight = 0;
  /**
   * Favorited songs / charts — keyed by `BrowserSongEntry.id`. Toggled via the skin's
   * `FAVORITE_SONG` (act=89) / `FAVORITE_CHART` (act=90) buttons. Memory-only for now (no DB
   * persistence); state is lost when the user reloads the page or drops a different theme.
   * The two sets are tracked separately because beatoraja distinguishes "song-level" favorites
   * (apply to all charts of a folder) from "chart-level" (apply to one specific .bms / .bmson).
   */
  private readonly favoriteSongs = new Set<string>();
  private readonly favoriteCharts = new Set<string>();
  /**
   * Global LN-mode override. When `undefined`, the focused chart's authored `#LNMODE` (or 0 =
   * LN by default) drives the `lnmodeset` imageset. When set via the skin's LNMODE click
   * (act=308), takes precedence — beatoraja's reference behaviour: the player picks "I want
   * to play this chart as LN / CN / HCN" and the engine reinterprets long-note pairs at the
   * new mode at gameplay time.
   */
  private lnModeOverride: 0 | 1 | 2 | undefined;
  /**
   * Active keymode filter — index into beatoraja's MainState `["allkeys","5keys","7keys",
   * "10keys","14keys","9keys","24keys","24keysDP"]` enum. `0` (ALL) shows every chart;
   * non-zero filters the song list to charts matching the variant. Cycled via the skin's
   * MODE button (act=11). The `modeset` imageset's `ref=11` resolver returns this value so
   * the visible label updates in step.
   */
  private keymodeFilter = 0;
  /**
   * Active sort mode — index into the song-sort enum the `sortset` imageset's `images[]`
   * matches. `divy:8 / len:8` in default's declaration → 8 slots. We map them as:
   *
   *   0 DEFAULT         — original collection order (folder-grouped)
   *   1 TITLE           — alphabetical by title
   *   2 ARTIST          — alphabetical by artist
   *   3 GENRE           — alphabetical by genre
   *   4 PLAYLEVEL       — by `#PLAYLEVEL` ascending
   *   5 BPM             — by main BPM ascending
   *   6 TOTALNOTES      — by playable-note count ascending
   *   7 LASTPLAY        — by most-recent play (DB-required; falls back to DEFAULT today)
   *
   * Cycled via the SORT button (act=12). Affects only flat song lists (inside a folder); at
   * the root, songs are still grouped by `directoryLabel` so a sort would jumble folders.
   */
  private sortMode = 0;
  /**
   * Live search query (case-insensitive substring match on title + artist + genre + sub
   * title). Empty string = no filter. Updated by the search input flow (see
   * {@link BeatorajaSelectSearch.searchActive} / handleKeyDown's `/` branch). Surfaced to the skin via
   * `BEATORAJA_TEXT.SEARCHWORD` so themes that author the search-display text node show
   * the live query while the user types.
   */
  private searchQuery = '';
  private disposed = false;
  /**
   * Lazily-constructed chart-preview engine. Mirrors the LR2 `scene/lr2/select.ts` integration —
   * focuses on the song under the cursor, decodes its `#PREVIEW` audio (or falls back to
   * in-place chart playback when none is declared), and tears playback down on cursor move /
   * scene exit. Built on first cursor settle so the AudioContext isn't touched until the user
   * actually browses songs. Stays `undefined` when the host didn't pass an `audioContext` /
   * `collection`.
   */
  private chartPreviewEngine: ChartPreviewEngine | undefined;

  constructor(options: PixiBeatorajaSelectSceneOptions) {
    this.options = options;

    this.view = new BeatorajaPlaySkinView({
      skin: options.skin,
      textures: options.textures,
      // Skin-config-level op set drives inner if-gated keyframe alternative resolution inside
      // `normalizeBeatorajaDestinations`. Select-format skins (e.g. ModernChic Select) author
      // layout-variant rects per skin option — without threading this set the resolver picks
      // the catch-all fallback regardless of the user's chosen layout. Routed through
      // `baseOps()` so a `replaceSkin` mid-session reuses the same cached set the per-frame
      // op-resolution path uses.
      skinConfigOps: this.skinState.baseOps(),
      // Text content tracks the highlighted song. The skin's title / artist / genre text destinations
      // therefore reflect the live cursor, matching beatoraja's own select-screen behavior.
      resolveTextContent: (refOp) => this.skinState.resolveSelectionText(refOp),
      // Numeric values from the focused song — total notes, BPM, level. Skins render
      // these via `value[]` elements with `ref = 74 (TOTALNOTES)`, `92 (MAINBPM)`,
      // `96 (PLAYLEVEL)`, etc. Without this, the chart-info panel sits on its idle
      // zeros even after the cursor moves to a different song.
      resolveNumberValue: (refOp) => this.skinState.resolveSelectionNumber(refOp),
      // Imageset / generic ref values. Drives `imageset[]` sub-image picks (e.g. `modeset`
      // ref 11 picks "5keys" / "7keys" / etc. from the skin's array based on the focused
      // chart's keymode) plus any other `ref`-driven selectors the skin authored.
      resolveRefValue: (refOp) => this.skinState.resolveSelectionRefValue(refOp),
      // Slider values — volume / lanecover / lift translate sliders. Without a value the
      // renderer hides the slider entirely; we report `1.0` (max position) for volume types
      // so ModernChic's volume sliders sit at full instead of vanishing.
      resolveSliderValue: (type) => resolveBeatorajaSelectSliderValue(type),
      // Skin-authored button clicks — `image[].act` codes (15=play, 16=autoplay, etc.). Routed
      // through `handleButtonAction` so the user can hit "AUTO PLAY" on the skin's chrome and
      // the scene starts the focused song in auto mode without round-tripping through a separate
      // toggle.
      onButtonAction: (act, mods) => this.handleButtonAction(act, mods),
      resolveFontFamily: options.fonts ? (id) => options.fonts!.family(id) : undefined,
      resolveFontKind: options.fonts ? (id) => options.fonts!.kind(id) : undefined,
      // Chart-image synthetic ids (-100 STAGEFILE / -101 BACKBMP / -102 BANNER). Returns
      // the FOCUSED song's bitmap when the chart shipped one. Default beatoraja's
      // select.json paints `-102` as the per-song banner; ModernChic uses `-100` as a
      // frosted backdrop on the chart-info panel.
      chartImageProvider: (id) => this.chartImages.resolveChartImageForFocus(id),
      // BPM segments + mainbpm reference for the focused chart's `bpmgraph` element.
      // The spec-faithful renderer path uses these to apply log-scaled, mainbpm-relative
      // y projection AND color-code segments by BPM identity (mainbpm = green, minbpm =
      // blue, maxbpm = red, others = yellow, stop = magenta).
      resolveBpmGraphData: () => this.chartImages.resolveBpmGraphDataForFocus(),
      // Per-second × per-category note distribution histogram for `judgegraph` type=0
      // (= the `notes-graph` element on the default skin). Mirrors upstream
      // `SkinNoteDistributionGraph.updateData()` with TYPE_NORMAL.
      resolveNoteDistribution: () => this.chartImages.resolveNoteDistributionForFocus(),
    });

    this.root.addChild(this.backdrop);
    this.root.addChild(this.view.container);
    // Mount the song-list overlay INSIDE the skin's view container so it inherits the same
    // scale / position transform as the rest of the chrome. The labels live in skin-space
    // (skin.w × skin.h) and follow the skin's authored bar-list layout.
    //
    // Splice it at `view.songListLayerInsertIndex` — the z-anchor the skin authored as
    // `{id = "songlist"}` inside `destination[]`. Chrome declared earlier in the destination
    // list (background, frame) paints behind the labels; chrome declared after (cursor highlight,
    // info panels, decorative overlays) paints on top. Skins that omit the anchor get the
    // top-of-stack fallback (legacy behavior).
    //
    // `passive`, not `static`: Pixi hit-tests the children of an interactive container as interactive too, so the row
    // label above a row's hit sprite would take a click on the title text and hand it to this (listener-less) layer.
    // Passive leaves each child to its own mode: only the row hit sprites are hit.
    this.listLayer.eventMode = 'passive';
    this.view.container.addChildAt(this.listLayer, this.view.songListLayerInsertIndex);

    this.rows.songList = parseBeatorajaSongList(options.skin);
    this.rows.applySongListGeometry();
    this.rows.buildRowVisuals(options.fonts);

    // Apply the snapshot BEFORE the first refreshEntries so its `keymodeFilter` / `sortMode`
    // shape the entry list immediately — applying after would briefly render the unfiltered
    // root before re-running. Folder navigation is replayed by walking `folderPath` and
    // pushing matching folders onto `folderStack`; missing labels short-circuit the walk
    // (snapshot was captured against a now-stale collection).
    const snapshot = options.restoreSnapshot;
    if (snapshot !== undefined) {
      this.keymodeFilter = snapshot.keymodeFilter;
      this.sortMode = snapshot.sortMode;
      this.lnModeOverride = snapshot.lnModeOverride;
      // Search query persists across the round-trip; the active-input flag does NOT —
      // coming back from gameplay should land in navigation mode so arrow keys work
      // immediately. Defensive `?? ''` covers older snapshots taken before the field
      // existed (forward-compat with sessionStorage / localStorage payloads).
      this.searchQuery = (snapshot as { searchQuery?: string }).searchQuery ?? '';
      for (const id of snapshot.favoriteSongs) this.favoriteSongs.add(id);
      for (const id of snapshot.favoriteCharts) this.favoriteCharts.add(id);
      this.cursorStack = snapshot.cursorStack.slice();
      // Walk `folderPath` resolving each label to a folder node from the live collection.
      // Re-runs `groupSongsByFolder` on the keymode-filtered set so the folders match what
      // refreshEntries() will produce below.
      const filtered =
        this.keymodeFilter === 0
          ? options.songs
          : options.songs.filter((song) => beatorajaKeyModeIndex(safeResolveChartVariant(song)) === this.keymodeFilter);
      // The root lists the course folders after the song folders, as `refreshEntries` does, so a cursor left in a
      // course folder (the select scene is mounted again after every course) comes back to its course bar.
      const rootFolders = [...groupSongsByFolder(filtered), ...(options.courseFolders ?? [])];
      let currentFolders: ReadonlyArray<BrowserFolderNode> = rootFolders;
      for (const label of snapshot.folderPath) {
        const match = currentFolders.find((f) => f.label === label);
        if (match === undefined) {
          // Snapshot referenced a folder no longer in the collection — abort the walk and
          // pop the cursor stack back to where we successfully landed. Avoids a crash AND
          // gives the user a sensible "near where I was" rather than a hard reset to root.
          this.cursorStack = this.cursorStack.slice(0, this.folderStack.length + 1);
          break;
        }
        this.folderStack.push(match);
        // Inside one folder, the entries are songs (no nested folders). Subsequent labels
        // in `folderPath` should never match if any exist (collection is flat) — the walk
        // self-terminates on the first miss.
        currentFolders = [];
      }
      // Honour the cursor for the deepest depth we successfully restored. `refreshEntries`
      // will clamp it again on a length mismatch.
      const initialIndex =
        this.cursorStack[this.cursorStack.length - 1] ?? snapshot.cursorStack[snapshot.cursorStack.length - 1] ?? 0;
      this.refreshEntries(initialIndex);
    } else {
      this.refreshEntries(options.initialIndex ?? 0);
    }

    // eslint-disable-next-line no-console
    console.log(
      '[beatoraja-select] mounted',
      JSON.stringify({
        canvas: { w: this.view.width, h: this.view.height },
        songs: options.songs.length,
        folders: groupSongsByFolder(options.songs).length,
        initialIndex: this.currentIndex,
        folderDepth: this.folderStack.length,
        sortMode: this.sortMode,
        keymodeFilter: this.keymodeFilter,
        skinName: options.skin.name,
        restored: snapshot !== undefined,
      }),
    );
  }

  /**
   * The scene as its parts read and drive it: getters over its state and arrow methods over its own, so the parts reach
   * the members they need while those stay private to the scene.
   */
  private static createContext(scene: PixiBeatorajaSelectScene): BeatorajaSelectSceneContext {
    return {
      get view(): BeatorajaPlaySkinView {
        return scene.view;
      },
      get options(): PixiBeatorajaSelectSceneOptions {
        return scene.options;
      },
      get listLayer(): Container {
        return scene.listLayer;
      },
      get entries(): ReadonlyArray<BrowserBrowseEntry> {
        return scene.entries;
      },
      get scrollPosition(): number {
        return scene.scrollPosition;
      },
      handleRowPointerTap: (rowOffset, event) => scene.handleRowPointerTap(rowOffset, event),
      get searchQuery(): string {
        return scene.searchQuery;
      },
      setSearchQuery: (query) => scene.setSearchQuery(query),
      moveCursor: (delta) => scene.moveCursor(delta),
      setCursor: (index) => scene.setCursor(index),
      get disposed(): boolean {
        return scene.disposed;
      },
      get currentIndex(): number {
        return scene.currentIndex;
      },
      get keymodeFilter(): number {
        return scene.keymodeFilter;
      },
      get sortMode(): number {
        return scene.sortMode;
      },
      get lnModeOverride(): 0 | 1 | 2 | undefined {
        return scene.lnModeOverride;
      },
      currentFolderLabel: () => scene.currentFolderLabel(),
    };
  }

  /**
   * Snapshot the live scene state for restoration on the next mount. Hosts call this BEFORE
   * disposing the scene (e.g. on PLAY transition) and pass the result back as
   * `options.restoreSnapshot` when re-mounting on return. The snapshot is plain data — safe
   * to JSON-stringify for session persistence if the host wants it to survive a page reload.
   *
   * Folder identity is preserved by `label` rather than object reference so the snapshot
   * survives a `BrowserSongCollection` rebuild. See {@link PixiBeatorajaSelectSceneSnapshot}
   * for the full shape and stale-snapshot fallback rules.
   */
  captureSnapshot(): PixiBeatorajaSelectSceneSnapshot {
    return {
      folderPath: this.folderStack.map((folder) => folder.label),
      // The deepest entry is the live cursor: `cursorStack` keeps the parents' cursors only (its last slot is the `0`
      // pushed on entering the folder and is not updated as the cursor moves).
      cursorStack: [...this.cursorStack.slice(0, this.folderStack.length), this.currentIndex],
      keymodeFilter: this.keymodeFilter,
      sortMode: this.sortMode,
      lnModeOverride: this.lnModeOverride,
      favoriteSongs: Array.from(this.favoriteSongs),
      favoriteCharts: Array.from(this.favoriteCharts),
      searchQuery: this.searchQuery,
    };
  }

  /** The bar under the cursor (a folder, song or course), or `undefined` when the list is empty. */
  getFocusedEntry(): BrowserBrowseEntry | undefined {
    return this.entries[this.currentIndex];
  }

  enter(host: PixiSceneHost): void {
    if (this.disposed) return;
    this.host = host;
    this.startMs = performance.now();
    // Stamp the always-on scene-start timer (= 0) and the initial songbar-change pulse so
    // skin destinations keyed on either start their `dst[]` keyframe walk from t=0 the
    // moment the scene mounts. The songbar pulse is re-stamped inside `moveCursor` /
    // `setCursor` / folder transitions on every cursor change, mirroring upstream's
    // `MusicSelector.timer.setTimerOn(MAIN.TIMER.SONGBAR_CHANGE)`.
    this.timerStartedAt.set(TIMER_SCENE_START, 0);
    this.timerStartedAt.set(TIMER_SONGBAR_CHANGE, 0);
    this.fitToStage();
    this.tickerHandle = (ticker) => this.tick(ticker);
    host.app.ticker.add(this.tickerHandle);
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.handleKeyDown);
    }
    // Kick off preview audio for the initial cursor position. The engine's internal
    // `focusDelayMs` (= LR2_PREVIEW_FOCUS_DELAY_MS, 1s) means a quick scene-flip won't
    // actually start playback if the user moves on immediately.
    this.refreshChartPreview();
    this.startSelectBgm();
  }

  exit(): void {
    if (this.tickerHandle && this.host) {
      this.host.app.ticker.remove(this.tickerHandle);
    }
    this.tickerHandle = undefined;
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleKeyDown);
    }
    this.host = undefined;
    // Stop preview audio when the scene is hidden — the engine retains its state for the
    // next `enter()` re-arm. Distinct from `dispose()` which permanently tears it down.
    this.chartPreviewEngine?.focus(undefined);
    this.stopSelectBgm();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.exit();
    this.chartPreviewEngine?.dispose();
    this.chartPreviewEngine = undefined;
    // Close the dedicated preview AudioContext we created lazily — `AudioContext.close()` is
    // async but we don't await it; the browser cleans up the underlying audio thread on its
    // own. Wrapped in a Promise.resolve guard to avoid warnings when called twice (e.g. on a
    // hot-reload tear-down where the context was already closing).
    if (this.previewAudioContext !== undefined) {
      void this.previewAudioContext.close().catch(() => {});
      this.previewAudioContext = undefined;
    }
    this.search.destroySearchPrompt();
    this.rows.destroyRowVisuals();
    if (this.listLayer.parent) {
      this.listLayer.parent.removeChild(this.listLayer);
    }
    if (!this.listLayer.destroyed) {
      this.listLayer.destroy({ children: true });
    }
    this.view.dispose();
    if (!this.backdrop.destroyed) {
      this.backdrop.destroy({ children: false, context: true });
    }
    if (!this.root.destroyed) {
      this.root.destroy({ children: false });
    }
  }

  /**
   * Screenshot capture descriptor — see `PixiScene.getStageInfo`. Returns the play-skin
   * view's container at native skin dimensions; the row-overlay listLayer is inside that
   * container so the captured frame includes both the skin chrome and the song bars.
   */
  getStageInfo(): { container: Container; width: number; height: number } {
    return { container: this.view.container, width: this.view.width, height: this.view.height };
  }

  /**
   * Hot-swap the underlying skin / textures / fonts / config without losing the cursor position.
   * Used by the skin-options panel for live `property[]` / `filepath[]` edits — rebuilds the chrome
   * against the new skin while preserving navigation state.
   */
  replaceSkin(opts: {
    skin: BeatorajaSkin;
    skinConfig?: BeatorajaSkinConfig;
    textures: BeatorajaTextureCache;
    fonts?: BeatorajaFontCache;
  }): void {
    if (this.disposed) return;
    this.search.destroySearchPrompt();
    this.view.dispose();
    this.skinState.cachedBaseOps = undefined;

    // Mirror upstream `MainState.setSkin` (`MainState.java:113-132`): swap in the new skin AND
    // its companion resource set so subsequent calls to `buildRowVisuals` /
    // `resolveLevelValueElement` / `buildFeatureLabelSprite` / etc. resolve image[]/value[]/
    // texture lookups against the new skin instead of the previous one.
    //
    // Previously only `skinConfig` was updated here; `options.skin` / `options.textures` /
    // `options.fonts` stayed pointing at the prior mount's instances. The new `view` was built
    // against the new skin, but the songlist row chrome (PLAYLEVEL digits, panel backgrounds)
    // is rendered by THIS scene class through `this.options.*` and continued to read the OLD
    // skin's `value[]` declarations and the OLD textures cache. User-visible symptom: switching
    // skins mid-session left the previous skin's PLAYLEVEL font / panel background tints
    // bleeding into the new skin's row layout.
    const mut = this.options as {
      skin: BeatorajaSkin;
      textures: BeatorajaTextureCache;
      fonts?: BeatorajaFontCache;
      skinConfig?: BeatorajaSkinConfig;
    };
    mut.skin = opts.skin;
    mut.textures = opts.textures;
    mut.fonts = opts.fonts;
    mut.skinConfig = opts.skinConfig;

    this.view = new BeatorajaPlaySkinView({
      skin: opts.skin,
      textures: opts.textures,
      // `cachedBaseOps` was nulled above — `getCachedBaseOps` rebuilds against the NEW
      // `skinConfig.option` map so layout-variant dst alts re-resolve to the user's
      // (possibly changed) option picks for the swapped skin.
      skinConfigOps: this.skinState.baseOps(),
      resolveTextContent: (refOp) => this.skinState.resolveSelectionText(refOp),
      resolveNumberValue: (refOp) => this.skinState.resolveSelectionNumber(refOp),
      resolveRefValue: (refOp) => this.skinState.resolveSelectionRefValue(refOp),
      resolveSliderValue: (type) => resolveBeatorajaSelectSliderValue(type),
      onButtonAction: (act, mods) => this.handleButtonAction(act, mods),
      resolveFontFamily: opts.fonts ? (id) => opts.fonts!.family(id) : undefined,
      resolveFontKind: opts.fonts ? (id) => opts.fonts!.kind(id) : undefined,
      chartImageProvider: (id) => this.chartImages.resolveChartImageForFocus(id),
      resolveBpmGraphData: () => this.chartImages.resolveBpmGraphDataForFocus(),
      resolveNoteDistribution: () => this.chartImages.resolveNoteDistributionForFocus(),
    });
    // The old view's `container.destroy({children: false})` (inside `view.dispose()`) detaches
    // its children — listLayer was one of them, so it's now orphaned. Re-parent into the new
    // view container at the new view's authored songlist anchor (different skins place it at
    // different z-indices).
    if (this.listLayer.parent) this.listLayer.parent.removeChild(this.listLayer);
    this.root.addChild(this.view.container);
    this.view.container.addChildAt(this.listLayer, this.view.songListLayerInsertIndex);

    // New skin → re-parse the songlist (different skin may declare a different layout) and
    // REBUILD the row visuals against the new visible-row count. Different skins author
    // different `liston[]` lengths (default reference theme = 21, ModernChic = 17, GdbG_Skin
    // = 11), so the row arrays must be rebuilt — without this, `refreshRowVisuals` walks the
    // new `visibleRowCount` and indexes past the still-old `rowLabels[]`, throwing "Cannot set
    // properties of undefined". `buildRowVisuals` tears down stale entries first so this is
    // safe to call repeatedly.
    this.rows.songList = parseBeatorajaSongList(opts.skin);
    this.rows.applySongListGeometry();
    // Invalidate per-skin caches keyed on the OLD skin's declarations. `buildRowVisuals`
    // re-resolves the level value entry / strip texture against the new skin via
    // `resolveLevelValueElement`.
    this.rows.featureLabelImages = undefined;
    this.rows.valueElementsById = undefined;
    this.rows.buildRowVisuals(opts.fonts);
    this.rows.refreshRowVisuals();
    this.search.refreshSearchPrompt();

    this.lastFitWidth = 0;
    this.lastFitHeight = 0;

    // eslint-disable-next-line no-console
    console.log(
      '[beatoraja-select] skin replaced',
      JSON.stringify({ canvas: { w: this.view.width, h: this.view.height }, name: opts.skin.name }),
    );
  }

  /** Programmatically jump to a song index inside the ROOT list. Used by the host to restore prior cursor. */
  setSelectionIndex(index: number): void {
    // Force-pop any folder stack so the index applies to the root entries.
    this.folderStack = [];
    this.cursorStack = [clampIndex(index, groupSongsByFolder(this.options.songs).length)];
    this.refreshEntries(this.cursorStack[0]!);
  }

  // ─── Internals ────────────────────────────────────────────────────────────────────────────────

  private tick(ticker: Ticker): void {
    if (this.disposed) return;
    this.fitToStage();
    // Tween `scrollPosition` toward `currentIndex`. Frame-rate-aware so a 30 Hz tick glides at the
    // same speed as a 60 Hz one (the visible duration matches). `ticker.deltaTime` is a 60 Hz-
    // normalized step — `1` at 60 fps, `2` at 30 fps, `0.5` at 120 fps.
    const target = this.currentIndex;
    const delta = target - this.scrollPosition;
    if (Math.abs(delta) < SCROLL_SNAP_THRESHOLD) {
      this.scrollPosition = target;
    } else {
      const factor = 1 - Math.pow(1 - SCROLL_TWEEN_RATE, ticker.deltaTime);
      this.scrollPosition += delta * factor;
    }
    this.rows.refreshRowVisuals();

    const elapsed = performance.now() - this.startMs;
    // Pass through unfired timers as `undefined` so destinations gated on them stay hidden.
    // Returning `0` for everything would render `timer=2` (TIMER_FADEOUT) gated chrome — most
    // notably a fullscreen black fade-IN that the default skin authors — from the moment the
    // scene mounts, blacking out the entire view. The destination renderer hardcodes the
    // `timer=0` (scene-start) path to use 0 elapsed already, so passing `undefined` for
    // anything else is the correct behaviour.
    const skinAudio = this.options.skinAudio;
    this.skinState.frameInput = undefined;
    this.skinState.frameInput = this.skinState.selectInput();
    this.view.update({
      activeOps: this.skinState.computeActiveOps(),
      // Consult the per-scene timer ladder. Returning `undefined` for unstamped timers keeps
      // those destinations hidden (matches the play-scene runtime adapter's behaviour and
      // upstream `getTimerStart` semantics — only fired timers produce a non-null start
      // time). The previous always-`undefined` return blocked every `timer = N`-gated
      // destination, including ModernChic's title / genre / artist text panel which keys
      // off `TIMER_SONGBAR_CHANGE = 11`.
      getTimerStart: (timerId) => this.timerStartedAt.get(timerId),
      nowMs: elapsed,
      audioPlay: skinAudio === undefined ? undefined : (path, vol) => skinAudio.play(path, vol),
      audioLoop: skinAudio === undefined ? undefined : (path, vol) => skinAudio.loop(path, vol),
      audioStop: skinAudio === undefined ? undefined : (path) => skinAudio.stop(path),
    });
    this.skinState.frameInput = undefined;
  }

  /**
   * Recompute the entries the renderer should show given the current `folderStack`, then sync
   * `currentIndex` and the scroll baseline. Called on mount, on folder enter / leave, and on
   * external `setSelectionIndex`.
   */
  private refreshEntries(initialIndex: number): void {
    // Apply the current keymode filter (act=11 MODE button cycles it). `0` = ALL → no filter.
    // Higher values restrict to charts whose `resolveChartPlayVariant` returns the matching
    // variant; charts without a variant resolution are dropped from the filtered set.
    const filter = this.keymodeFilter;
    const keymodeFiltered =
      filter === 0
        ? this.options.songs
        : this.options.songs.filter((song) => beatorajaKeyModeIndex(safeResolveChartVariant(song)) === filter);
    // Search query — case-insensitive substring match on title / artist / genre / subtitle.
    // Empty string short-circuits (no filter). Applied AFTER the keymode filter so a search
    // narrows whatever the user already filtered to via the MODE button.
    const query = this.searchQuery.toLowerCase();
    const searchFiltered =
      query.length === 0 ? keymodeFiltered : keymodeFiltered.filter((song) => songMatchesQuery(song, query));
    if (this.folderStack.length === 0) {
      // When a search is active at the root, beatoraja flattens the result into a song list
      // (no folder grouping) — matches the user's mental model of "show me every chart whose
      // title contains X" rather than "show me folders that contain such charts". The
      // keymode-only path keeps the folder grouping for browse-mode.
      if (query.length > 0) {
        const sorted = this.sortMode !== 0 ? sortSongsByMode(searchFiltered, this.sortMode) : searchFiltered;
        this.entries = sorted.map((song): BrowserBrowseEntry => ({ kind: 'song', song }));
      } else {
        const folders = [...groupSongsByFolder(searchFiltered), ...(this.options.courseFolders ?? [])];
        this.entries = folders.map((folder): BrowserBrowseEntry => ({ kind: 'folder', folder }));
      }
    } else if (this.folderStack[this.folderStack.length - 1]!.courses !== undefined) {
      const courses = this.folderStack[this.folderStack.length - 1]!.courses!;
      this.entries = courses.map((course): BrowserBrowseEntry => ({ kind: 'course', course }));
    } else {
      const top = this.folderStack[this.folderStack.length - 1]!;
      // When a filter is active, the folder's pre-stored `songs` may include charts the
      // current filter excludes — re-filter on read so what the user sees matches the badge.
      let folderSongs = filter === 0 ? top.songs : top.songs.filter((s) => keymodeFiltered.includes(s));
      if (query.length > 0) folderSongs = folderSongs.filter((s) => songMatchesQuery(s, query));
      if (this.sortMode !== 0) folderSongs = sortSongsByMode(folderSongs, this.sortMode);
      this.entries = folderSongs.map((song): BrowserBrowseEntry => ({ kind: 'song', song }));
    }
    this.currentIndex = clampIndex(initialIndex, this.entries.length);
    this.scrollPosition = this.currentIndex;
    this.markSongbarChangeTimer();
    this.rows.refreshRowVisuals();
    // Folder enter / leave / filter change reshuffles the entry list; re-arm preview against
    // the new focused song (or stop if the new focus is a folder bar).
    this.refreshChartPreview();
    // Search-prompt suffix carries a live "N matches" count — refresh whenever the entry
    // list changes so the user sees the new result count after folder enter / sort cycle /
    // keymode filter change while a search query is active.
    this.search.refreshSearchPrompt();
  }

  /**
   * Adjust the active skin's `note offset` (ref 12 — JUDGETIMING) by `delta` milliseconds.
   * Mutates the in-memory `skinConfig.offset` so the next-frame `JUDGETIMING` resolver returns
   * the new value; also fires the host's `onSkinConfigChange` callback (when supplied) so the
   * demo can persist the adjustment back into its skin-config cache.
   *
   * Clamped to the same `±200 ms` range the bottom-right options panel uses (beatoraja's own
   * judge-offset slider has the same bounds).
   */
  private adjustJudgeTiming(delta: number): void {
    const config = this.options.skinConfig;
    if (config === undefined) return;
    const current = typeof config.offset === 'number' && Number.isFinite(config.offset) ? config.offset : 0;
    const next = Math.max(-200, Math.min(200, current + delta));
    if (next === current) return;
    (config as { offset: number }).offset = next;
    // eslint-disable-next-line no-console
    console.log('[beatoraja-select] act=74 JUDGE_TIMING adjusted', JSON.stringify({ from: current, to: next }));
    this.options.onSkinConfigChange?.(this.cloneSkinConfig(config));
  }

  /** Shallow-clone the skin config so the host's callback never aliases our mutator state. */
  private cloneSkinConfig(config: BeatorajaSkinConfig): BeatorajaSkinConfig {
    return {
      offset: typeof config.offset === 'number' ? config.offset : 0,
      option: { ...config.option },
      file: { ...config.file },
    };
  }

  /**
   * Cycle the sort mode and rebuild the song list against the new ordering. Wraps at 0..7.
   * Stays within the current folder — sorting doesn't change which folder you're in, just the
   * row order inside it.
   *
   * Cursor preservation: capture the focused entry's IDENTITY (song reference for song bars,
   * folder reference for folder bars) before the rebuild, then re-find it in the new entries
   * array and re-anchor the cursor to that index. Without this the cursor stays on the
   * `currentIndex` slot and a different song appears focused — the user has to manually
   * scroll to find the song they were on.
   */
  private cycleSortMode(step: number): void {
    const next = (((this.sortMode + step) % 8) + 8) % 8;
    if (next === this.sortMode) return;
    this.sortMode = next;
    // eslint-disable-next-line no-console
    console.log('[beatoraja-select] act=12 SORT cycled', JSON.stringify({ to: next }));
    this.playSystemSound('optionChange');
    const previouslyFocused = this.entries[this.currentIndex];
    this.refreshEntries(this.currentIndex);
    if (previouslyFocused !== undefined) {
      // Re-locate the focused entry in the new (sorted) list. Identity comparison works
      // because BrowserSongEntry / BrowserFolderNode objects are stable references — sorting
      // produces a new array but reuses the same item references.
      const newIndex = this.entries.findIndex((entry) => isSameEntry(entry, previouslyFocused));
      if (newIndex >= 0) {
        this.currentIndex = newIndex;
        this.scrollPosition = newIndex;
        this.rows.refreshRowVisuals();
      }
    }
  }

  /**
   * Cycle the keymode filter and rebuild the song list against the new filter. Wraps at 0..7.
   *
   * Preserves the active folder stack — the filter narrows the songs visible WITHIN whatever
   * folder the user is currently browsing instead of yanking them back to root. User-reported
   * symptom: cycling the KEY filter in SONG SELECT bounced the cursor back to the folder list
   * instead of filtering within the open folder. The previous "pop back to root on filter
   * change" behavior was a defensive measure against folders becoming empty after filtering,
   * but folders going empty is a fine state — the user can back out with Escape.
   *
   * Cursor restoration: when the previously-focused song still exists in the post-filter
   * entries, snap the cursor to its new index. Otherwise clamp to whatever the filter left
   * (mostly index 0 — the next available row).
   */
  private cycleKeymodeFilter(step: number): void {
    const next = (((this.keymodeFilter + step) % 8) + 8) % 8;
    if (next === this.keymodeFilter) return;
    this.keymodeFilter = next;
    // eslint-disable-next-line no-console
    console.log('[beatoraja-select] act=11 MODE filter cycled', JSON.stringify({ to: next }));
    this.playSystemSound('optionChange');
    // Capture the focused song BEFORE the entries list mutates so we can re-find its row in
    // the post-filter list (when the song still passes the filter).
    const focused = this.focusedSong();
    this.refreshEntries(this.currentIndex);
    if (focused !== undefined) {
      const restored = this.entries.findIndex((entry) => entry.kind === 'song' && entry.song === focused);
      if (restored >= 0 && restored !== this.currentIndex) {
        this.currentIndex = restored;
        this.scrollPosition = restored;
        this.markSongbarChangeTimer();
        this.rows.refreshRowVisuals();
      }
    }
  }

  /**
   * Cycle the global LN-mode override forward (`step = +1`) or backward (`-1`). Starts from
   * the focused chart's authored `#LNMODE` when no override is set yet so the first click
   * advances from "LN" → "CN" rather than reverting an unset state. Wraps at 0..2.
   */
  private cycleLnModeOverride(step: number): void {
    const current = this.lnModeOverride ?? beatorajaLnModeIndex(this.focusedSong()?.chart.bms?.lnMode);
    const next = (((current + step) % 3) + 3) % 3;
    this.lnModeOverride = next as 0 | 1 | 2;
    // eslint-disable-next-line no-console
    console.log('[beatoraja-select] act=308 LNMODE cycled', JSON.stringify({ from: current, to: next }));
  }

  /**
   * Skin-authored button click handler. The view forwards `image[].act` codes from sprites
   * the user clicks; this method maps each to a select-scene action.
   *
   * Supported beatoraja `button_type` codes (= the `act` field on default skin's `image[]`):
   *
   *   - `15` PLAY — start the focused song in the user's default mode (manual unless they've
   *     toggled auto in the global settings).
   *   - `16` AUTO PLAY — start the focused song in auto mode regardless of the user's global
   *     setting. The host's `onSongPicked({autoPlay: true})` propagates the override into the
   *     `playSongBeatoraja` mode argument.
   *   - `315` PRACTICE — practice mode (no scoring). Currently routed as a normal play; the
   *     practice runtime isn't implemented yet, but at least the click takes the user into
   *     gameplay rather than no-op'ing.
   *   - `19` / `316` / `317` / `318` REPLAY 1-4 — replay slots. Logged + ignored; no replay
   *     system yet.
   *
   * Other action codes log and return — community skins extend the table for sort cycling /
   * volume controls / etc., which the demo doesn't surface as clickable chrome yet.
   */
  private handleButtonAction(act: number, modifiers?: { shift: boolean; ctrl: boolean; alt: boolean }): void {
    if (this.disposed) return;
    // Stamp the press-state op (audit 2.1) BEFORE branching the action. `computeActiveOps`
    // gates each entry on `BUTTON_PRESS_WINDOW_MS` so press-feedback chrome lights up for
    // the duration regardless of which action arm we end up taking (or whether we early-out
    // because the song / folder isn't pickable).
    this.skinState.buttonPressedAt.set(act, performance.now());
    const entry = this.entries[this.currentIndex];
    const song = entry?.kind === 'song' ? entry.song : entry?.kind === 'folder' ? entry.folder.songs[0] : undefined;
    // PLAY / AUTO PLAY on a course bar start the course (`MusicSelector` reads the course bar the same way).
    if ((act === 15 || act === 16) && entry?.kind === 'course') {
      this.pickCourse(entry.course, act === 16);
      return;
    }
    switch (act) {
      case 15: // PLAY (user's default mode)
        if (song !== undefined) {
          // eslint-disable-next-line no-console
          console.log('[beatoraja-select] act=15 PLAY', JSON.stringify({ title: song.title }));
          this.playSystemSound('decide');
          this.options.onSongPicked(song);
        }
        return;
      case 16: // AUTO PLAY
        if (song !== undefined) {
          // eslint-disable-next-line no-console
          console.log('[beatoraja-select] act=16 AUTO PLAY', JSON.stringify({ title: song.title }));
          this.playSystemSound('decide');
          this.options.onSongPicked(song, { autoPlay: true });
        }
        return;
      case 315: // PRACTICE — practice runtime not implemented yet; fall through to plain play
        if (song !== undefined) {
          // eslint-disable-next-line no-console
          console.log(
            '[beatoraja-select] act=315 PRACTICE (routed as normal play)',
            JSON.stringify({ title: song.title }),
          );
          this.playSystemSound('decide');
          this.options.onSongPicked(song);
        }
        return;
      case 19:
      case 316:
      case 317:
      case 318:
        // eslint-disable-next-line no-console
        console.log('[beatoraja-select] replay slot click ignored', JSON.stringify({ act }));
        return;
      case 210: // OPEN_IR_WEBSITE — IR ranking site for the focused chart
        openIrWebsite(song);
        return;
      case 17: // READTEXT — show the chart's accompanying `.txt` content
        if (song !== undefined && this.options.onReadtextRequest !== undefined) {
          // eslint-disable-next-line no-console
          console.log('[beatoraja-select] act=17 READTEXT', JSON.stringify({ title: song.title }));
          this.options.onReadtextRequest(song);
        } else {
          // eslint-disable-next-line no-console
          console.log('[beatoraja-select] act=17 READTEXT (no host hook)', JSON.stringify({ title: song?.title }));
        }
        return;
      case 89: // FAVORITE_SONG — toggle the focused song's "favorite song" flag
        if (song !== undefined) {
          const next = !this.favoriteSongs.has(song.id);
          if (next) this.favoriteSongs.add(song.id);
          else this.favoriteSongs.delete(song.id);
          // eslint-disable-next-line no-console
          console.log(
            '[beatoraja-select] act=89 FAVORITE_SONG toggled',
            JSON.stringify({ title: song.title, favorite: next }),
          );
        }
        return;
      case 90: // FAVORITE_CHART — toggle the focused chart's "favorite chart" flag
        if (song !== undefined) {
          const next = !this.favoriteCharts.has(song.id);
          if (next) this.favoriteCharts.add(song.id);
          else this.favoriteCharts.delete(song.id);
          // eslint-disable-next-line no-console
          console.log(
            '[beatoraja-select] act=90 FAVORITE_CHART toggled',
            JSON.stringify({ title: song.title, favorite: next }),
          );
        }
        return;
      case 74: // JUDGE_TIMING — adjust note offset by ±1 ms (Shift = decrement). Wraps at ±200.
        this.adjustJudgeTiming(modifiers?.shift === true ? -1 : 1);
        return;
      case 308: // LNMODE — cycle 0 → 1 → 2 → 0 (LN / CN / HCN). Shift cycles in reverse.
        this.cycleLnModeOverride(modifiers?.shift === true ? -1 : 1);
        return;
      case 11: // MODE — cycle keymode filter (ALL / 5K / 7K / 10K / 14K / 9K / 24K / 24K-DP)
        this.cycleKeymodeFilter(modifiers?.shift === true ? -1 : 1);
        return;
      case 12: // SORT — cycle sort order (default / title / artist / genre / level / bpm / notes / lastplay)
        this.cycleSortMode(modifiers?.shift === true ? -1 : 1);
        return;
      case 900: // GdbG_Skin's `volume` button — community extension, not in stock prop.lua.
        // Player-web has no volume picker UI yet; we surface a console log so the click is
        // visibly acknowledged. Future iteration: open a small volume-slider modal
        // (master / key / BGM) reusing the same `<dialog>` pattern as READTEXT.
        // eslint-disable-next-line no-console
        console.log('[beatoraja-select] act=900 GdbG volume button (no volume UI yet)');
        return;
      default:
        // eslint-disable-next-line no-console
        console.log('[beatoraja-select] unhandled button act', JSON.stringify({ act }));
        return;
    }
  }

  /**
   * The song the cursor is focused on. Returns `undefined` when the cursor is on a folder
   * row — mirrors upstream `MusicSelector.java:214`'s
   *
   *     resource.setSongdata(current instanceof SongBar ? ((SongBar) current).getSongData() : null);
   *
   * which sets the "current song" to `null` for any non-`SongBar` focus. Downstream
   * `StringPropertyFactory` / `IntegerPropertyFactory` resolvers then return `""` /
   * `MIN_VALUE` for refs that need a song, hiding the corresponding chrome — including the
   * left-side title / artist / genre / chart-density / song-length panels.
   *
   * Pre-fix this returned `entry.folder.songs[0]` (= the first song INSIDE the focused
   * folder), so the panels showed that song's metadata even while the user was hovering
   * the folder row — visible to the user as "the title still shows on the left while I'm
   * on a folder bar". Aligning to upstream's null-on-folder behaviour fixes the leak.
   */
  private focusedSong(): BrowserSongEntry | undefined {
    const entry = this.entries[this.currentIndex];
    if (entry === undefined) return undefined;
    return entry.kind === 'song' ? entry.song : undefined;
  }

  private currentFolderLabel(): string {
    if (this.folderStack.length === 0) return '';
    return this.folderStack[this.folderStack.length - 1]!.label;
  }

  // ─── Layout / visuals ─────────────────────────────────────────────────────────────────────────

  /** Map a chart's `playLevel` to a tint colour band — visual hint at glance. */

  private fitToStage(): void {
    const host = this.host;
    if (!host) return;
    const { width, height } = host.app.screen;
    if (width === this.lastFitWidth && height === this.lastFitHeight) return;
    if (width <= 0 || height <= 0) return;
    this.lastFitWidth = width;
    this.lastFitHeight = height;
    const scaleX = width / this.view.width;
    const scaleY = height / this.view.height;
    const scale = Math.min(scaleX, scaleY);
    if (!Number.isFinite(scale) || scale <= 0) return;

    const container = this.view.container;
    container.scale.set(scale, scale);
    container.x = (width - this.view.width * scale) / 2;
    container.y = (height - this.view.height * scale) / 2;

    this.backdrop.clear().rect(0, 0, width, height).fill(0x000000);
    this.rows.layoutRows();
  }

  // ─── Pointer + keyboard input ────────────────────────────────────────────────────────────────

  private handleRowPointerTap(rowOffset: number, _event: FederatedPointerEvent): void {
    if (this.disposed) return;
    const total = this.entries.length;
    if (total === 0) return;
    // Translate visible-row index into an entry index against the current scroll state. Use
    // `Math.round(this.scrollPosition)` so a click during a scroll-tween still lands on the
    // entry currently displayed in that row. Wrap into `[0, total)` so a click on a row
    // showing a wrapped entry resolves to the right song. The cursor's smooth-scroll path is
    // chosen by direction-of-travel: if the visible row offset is forward (downward) we pull
    // `scrollPosition` to take the short forward path, and vice versa.
    const rawIndex = Math.round(this.scrollPosition) + (rowOffset - this.rows.centreRowIndex);
    const next = ((rawIndex % total) + total) % total;
    if (next === this.currentIndex) {
      this.activateCurrentEntry();
      return;
    }
    // If the click landed on a wrapped row (rawIndex outside `[0, total)`), shift
    // `scrollPosition` so the tween takes the visible direction the user clicked toward.
    if (rawIndex >= total) this.scrollPosition -= total;
    else if (rawIndex < 0) this.scrollPosition += total;
    this.currentIndex = next;
    this.markSongbarChangeTimer();
    this.rows.refreshRowVisuals();
  }

  /**
   * Hands a course bar to the host. `MusicSelector` does not start a course with a missing stage ("Some of songs not
   * found"): it plays the cancel cue, and the host is still told so it can say which stages are missing.
   */
  private pickCourse(course: BrowserCourseEntry, autoPlay = false): void {
    const picked = this.options.onCoursePicked;
    this.playSystemSound(picked !== undefined && course.playable ? 'decide' : 'cancel');
    if (autoPlay) picked?.(course, { autoPlay: true });
    else picked?.(course);
  }

  private activateCurrentEntry(): void {
    const entry = this.entries[this.currentIndex];
    if (entry === undefined) return;
    if (entry.kind === 'folder') {
      // Push the folder's cursor onto the stack and refresh entries. Cursor stack records the
      // CURRENT index BEFORE descending so leaving the folder lands the cursor back on the
      // folder bar the user picked.
      this.cursorStack[this.folderStack.length] = this.currentIndex;
      this.folderStack.push(entry.folder);
      this.cursorStack.push(0);
      this.refreshEntries(0);
      this.playSystemSound('folderOpen');
      return;
    }
    if (entry.kind === 'course') {
      this.pickCourse(entry.course);
      return;
    }
    // eslint-disable-next-line no-console
    console.log(
      '[beatoraja-select] song picked',
      JSON.stringify({ index: this.currentIndex, title: entry.song.title, artist: entry.song.artist }),
    );
    this.playSystemSound('decide');
    this.options.onSongPicked(entry.song);
  }

  private leaveFolder(): void {
    if (this.folderStack.length === 0) {
      this.playSystemSound('cancel');
      this.options.onExit?.();
      return;
    }
    this.folderStack.pop();
    this.cursorStack.pop();
    const restoredIndex = this.cursorStack[this.cursorStack.length - 1] ?? 0;
    this.refreshEntries(restoredIndex);
    this.playSystemSound('folderClose');
  }

  /**
   * Fire a system-sound cue by name. Resolves the path from {@link PixiBeatorajaSelectSceneOptions.systemSoundPaths}
   * and routes through {@link skinAudio} (the host's `BeatorajaSkinAudioPlayer`). Silently
   * no-ops when either the path or audio backend is absent — themes that don't ship a
   * particular cue (or hosts that didn't discover it in the bundle) just stay quiet for that
   * event. Volume is fixed at 1.0; tracking authored sound levels per-event would need
   * beatoraja's `config.json` `volume_*` knobs which we don't currently parse.
   */
  private playSystemSound(name: keyof BeatorajaSystemSoundPaths): void {
    const paths = this.options.systemSoundPaths;
    if (paths === undefined) return;
    const path = paths[name];
    if (path === undefined || path.length === 0) return;
    this.options.skinAudio?.play(path, 1);
  }

  /**
   * Start the looping select BGM if the scene has both a path and an audio backend. Routed
   * through `BeatorajaSkinAudio.loop` so the audio decode + AudioContext are shared with
   * Lua-driven sounds. Volume defaults to `0.7` — quieter than the chart preview's `1.0` so
   * preview clips remain audible (no per-source ducking yet; volume blend handles the
   * common case).
   *
   * Idempotent — calling twice in a row stacks two loops on the same path, which would
   * audibly double the BGM. We track {@link selectBgmPlaying} to short-circuit redundant
   * starts. The `enter()` lifecycle method is the only caller, but a future scene-host that
   * called `enter` twice without `exit` would otherwise produce a stuck overlap.
   */
  private startSelectBgm(): void {
    if (this.selectBgmPlaying) return;
    const path = this.options.selectBgmPath;
    if (path === undefined || path.length === 0) return;
    const skinAudio = this.options.skinAudio;
    if (skinAudio === undefined) return;
    if (skinAudio.loop(path, 0.7)) {
      this.selectBgmPlaying = true;
    }
  }

  /**
   * Stop the looping select BGM. Safe to call when nothing was playing — the underlying
   * `audio_stop` is a no-op for paths with no active loop.
   */
  private stopSelectBgm(): void {
    if (!this.selectBgmPlaying) return;
    const path = this.options.selectBgmPath;
    if (path === undefined || path.length === 0) {
      this.selectBgmPlaying = false;
      return;
    }
    this.options.skinAudio?.stop(path);
    this.selectBgmPlaying = false;
  }
  private selectBgmPlaying = false;

  /**
   * Move the cursor by `delta` rows, wrapping around list bounds (last row → first row on
   * forward overflow, first row → last row on backward overflow). Beatoraja's reference song
   * select wheel is circular and this matches that behavior — the user reported the song-select
   * list should wrap around at the ends.
   *
   * Wrap detection adjusts `scrollPosition` so the smooth-scroll tween takes the SHORT path
   * around the boundary instead of sliding visually through every row in between. Without
   * this, going from the last song to the first via a single ArrowDown would look like a
   * snap-back through the entire list.
   */
  private moveCursor(delta: number): void {
    const total = this.entries.length;
    if (total === 0) return;
    const raw = this.currentIndex + delta;
    const next = ((raw % total) + total) % total;
    if (next === this.currentIndex) return;
    if (delta > 0 && raw >= total) {
      // Forward wrap (e.g. last → first). Pull the animated scroll position down by `total`
      // so the next tween glides forward by `delta` rows instead of slamming all the way back.
      this.scrollPosition -= total;
    } else if (delta < 0 && raw < 0) {
      // Backward wrap (first → last). Push the scroll position up by `total` for the same
      // reason — symmetric direction.
      this.scrollPosition += total;
    }
    this.currentIndex = next;
    this.markSongbarChangeTimer();
    this.rows.refreshRowVisuals();
    this.refreshChartPreview();
    this.playSystemSound('cursor');
  }

  /**
   * Re-stamp the `TIMER_SONGBAR_CHANGE` (= 11) timer to the current scene-relative time.
   * Mirrors upstream's `MusicSelector.timer.setTimerOn(MAIN.TIMER.SONGBAR_CHANGE)` which
   * fires whenever `BarManager` advances the focused row. Stamped via
   * `performance.now() - this.startMs` so the value is in the same scene-relative time
   * base the renderer reads via `nowMs`.
   */
  private markSongbarChangeTimer(): void {
    if (this.startMs === 0) return;
    this.timerStartedAt.set(TIMER_SONGBAR_CHANGE, performance.now() - this.startMs);
  }

  /**
   * Absolute cursor jump (Home / End). Doesn't wrap — Home and End are explicit "go to the
   * extremes" actions, not relative motion, so the user expectation matches a clamp.
   */
  private setCursor(index: number): void {
    if (this.entries.length === 0) return;
    const next = clampIndex(index, this.entries.length);
    if (next === this.currentIndex) return;
    this.currentIndex = next;
    this.markSongbarChangeTimer();
    this.rows.refreshRowVisuals();
    this.refreshChartPreview();
    this.playSystemSound('cursor');
  }

  /**
   * Lazily build the chart-preview engine on first cursor settle. Returns `undefined` when the
   * host didn't supply a `collection` (without it `resolveSongSource` has no map to walk) or
   * when AudioContext isn't available (Node tests). Otherwise constructs a fresh AudioContext
   * for preview playback — beatoraja themes don't use a select BGM, so there's nothing to
   * duck against and a dedicated context is fine. The context is closed by {@link dispose}.
   */
  private ensureChartPreviewEngine(): ChartPreviewEngine | undefined {
    if (this.chartPreviewEngine !== undefined) return this.chartPreviewEngine;
    if (this.disposed) return undefined;
    if (this.options.collection === undefined) return undefined;
    if (typeof globalThis.AudioContext !== 'function') return undefined;
    // Construct the AudioContext on first preview request rather than at scene-mount — browsers
    // gate `AudioContext.resume()` behind a user gesture, so creating it before the user has
    // interacted with the page burns a context that'll print "AudioContext was not allowed to
    // start" to the console. By the time `ensureChartPreviewEngine` is called the user has
    // already triggered the scene mount through a click / keypress.
    this.previewAudioContext = new AudioContext({ latencyHint: 'interactive' });
    this.chartPreviewEngine = new ChartPreviewEngine(this.previewAudioContext, masterOutput(this.previewAudioContext));
    return this.chartPreviewEngine;
  }
  private previewAudioContext: AudioContext | undefined;

  /**
   * Hand the preview engine the current focused song (or `undefined` when the cursor sits on a
   * folder bar). The engine internally swallows redundant focuses, so calling this on every
   * cursor move is cheap. Skipped while the scene isn't visible (`host` unset) to avoid
   * preview audio firing through a backgrounded scene.
   */
  private refreshChartPreview(): void {
    if (this.disposed || this.host === undefined) return;
    const engine = this.ensureChartPreviewEngine();
    const entry = this.entries[this.currentIndex];
    const song = entry?.kind === 'song' ? entry.song : undefined;
    // Always trigger the chart-image fetch (banner / backbmp / stagefile) on focus change,
    // independent of preview-engine availability — destinations gated on the synthetic
    // image ids paint regardless of whether audio is wired.
    this.chartImages.refreshChartImagesForFocus(song);
    if (engine === undefined) return;
    if (song === undefined || this.options.collection === undefined) {
      engine.focus(undefined);
      return;
    }
    const source = resolveSongSource(this.options.collection, song);
    if (source === undefined) {
      engine.focus(undefined);
      return;
    }
    engine.focus({ song, source });
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (this.disposed) return;
    // Typing in the host's search field (or any text field) is not navigation.
    if (isEditableKeyTarget(event.target)) return;
    // Search-input mode swallows most keys — ArrowUp/Down still navigate within the
    // filtered list (so the user can type, then arrow-pick), but printable characters /
    // Backspace mutate the query and Enter / Escape exit the mode.
    if (this.search.searchActive) {
      this.search.handleSearchKey(event);
      return;
    }
    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        this.moveCursor(-1);
        break;
      case 'ArrowDown':
        event.preventDefault();
        this.moveCursor(1);
        break;
      case 'PageUp':
        event.preventDefault();
        this.moveCursor(-10);
        break;
      case 'PageDown':
        event.preventDefault();
        this.moveCursor(10);
        break;
      case 'Home':
        event.preventDefault();
        this.setCursor(0);
        break;
      case 'End':
        event.preventDefault();
        this.setCursor(this.entries.length - 1);
        break;
      case 'Enter':
        event.preventDefault();
        this.activateCurrentEntry();
        break;
      case 'Backspace':
        event.preventDefault();
        if (this.folderStack.length > 0) this.leaveFolder();
        break;
      case 'Escape':
        event.preventDefault();
        // ESC at root with an active search clears the filter rather than exiting the
        // scene. The two-step behaviour matches what users expect from search-equipped
        // file browsers — "narrow it, look, clear, leave".
        if (this.searchQuery.length > 0 && this.folderStack.length === 0) {
          this.setSearchQuery('');
          break;
        }
        this.leaveFolder();
        break;
      case '/':
        // With the host's field doing the typing, `/` is its shortcut, not ours.
        if (this.options.externalSearch === true) break;
        // `/` enters search-input mode. Subsequent keystrokes type into the query (see
        // `handleSearchKey`) until Enter (commit) or Escape (clear + exit) lands.
        event.preventDefault();
        this.setSearchActive(true);
        break;
      case 'r':
      case 'R':
        // Random song / folder pick. Mirrors beatoraja's "random select" feature (the engine
        // calls it RANDOM_SELECT in its key-config) — picks a random ENTRY from the current
        // list (folder bars at root, song bars inside a folder). The user typically uses this
        // to discover charts in a large library; pressing it repeatedly walks distinct random
        // picks. Skip when only one entry exists (random-of-one is a no-op the user would
        // perceive as nothing happening).
        event.preventDefault();
        this.pickRandomEntry();
        break;
    }
  };

  /**
   * Mutate the search query / search-mode state. Called from the `/`-search input flow.
   * Re-runs `refreshEntries` so the visible row list narrows in real time as the user
   * types. The cursor resets to the top of the new filtered list (otherwise an old
   * `currentIndex` would point at a now-out-of-bounds slot).
   */
  public setSearchQuery(query: string): void {
    if (this.searchQuery === query) return;
    this.searchQuery = query;
    this.refreshEntries(0);
    this.search.refreshSearchPrompt();
  }

  private setSearchActive(active: boolean): void {
    this.search.setSearchActive(active);
  }

  /**
   * Jump the cursor to a uniformly-random entry within the current list. Used by the `R`
   * keybinding (mirrors beatoraja's RANDOM_SELECT). Stays within the current folder — random
   * doesn't traverse into subfolders.
   */
  private pickRandomEntry(): void {
    const total = this.entries.length;
    if (total <= 1) return;
    // Pick a different index than the current one — guarantees the user perceives motion.
    let next = Math.floor(Math.random() * total);
    if (next === this.currentIndex) {
      next = (next + 1) % total;
    }
    // eslint-disable-next-line no-console
    console.log('[beatoraja-select] random-pick', JSON.stringify({ from: this.currentIndex, to: next, of: total }));
    this.setCursor(next);
  }
}

function clampIndex(value: number, length: number): number {
  if (length <= 0) return 0;
  if (!Number.isFinite(value)) return 0;
  const truncated = Math.trunc(value);
  if (truncated < 0) return 0;
  if (truncated >= length) return length - 1;
  return truncated;
}

/**
 * Identity-equality on browse entries. Songs compare by reference (BrowserSongEntry objects
 * are stable across sort / filter rebuilds — array operations re-arrange but never re-allocate
 * them). Folders compare by reference too, but `groupSongsByFolder` constructs a fresh
 * BrowserFolderNode list on every call, so we fall back to the human label as a stable id.
 */
function isSameEntry(a: BrowserBrowseEntry, b: BrowserBrowseEntry): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'song' && b.kind === 'song') return a.song === b.song;
  if (a.kind === 'folder' && b.kind === 'folder') return a.folder.label === b.folder.label;
  if (a.kind === 'course' && b.kind === 'course') return a.course.id === b.course.id;
  return false;
}

/**
 * Sort a song list by the given mode index. Mode `0` (DEFAULT) is the caller's responsibility
 * — they pass the original collection in unchanged. The other modes are documented next to the
 * `sortMode` field on the scene class.
 *
 * Returns a NEW array; never mutates the input. Sort is `localeCompare`-based for strings (so
 * Japanese alphabetisation works) and numeric for level / BPM / notes.
 */
function sortSongsByMode(songs: ReadonlyArray<BrowserSongEntry>, mode: number): ReadonlyArray<BrowserSongEntry> {
  const out = [...songs];
  switch (mode) {
    case 1: // TITLE
      out.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? '', 'ja'));
      break;
    case 2: // ARTIST
      out.sort((a, b) => (a.artist ?? '').localeCompare(b.artist ?? '', 'ja'));
      break;
    case 3: // GENRE
      out.sort((a, b) => (a.genre ?? '').localeCompare(b.genre ?? '', 'ja'));
      break;
    case 4: // PLAYLEVEL
      out.sort((a, b) => sortableNumber(a.playLevel) - sortableNumber(b.playLevel));
      break;
    case 5: // BPM (main)
      out.sort((a, b) => (a.bpm ?? 0) - (b.bpm ?? 0));
      break;
    case 6: // TOTALNOTES
      out.sort((a, b) => (a.totalNotes ?? 0) - (b.totalNotes ?? 0));
      break;
    case 7: // LASTPLAY (DB-required) — currently no-op (returns original order)
      break;
    default:
      break;
  }
  return out;
}

/**
 * Coerce a `playLevel` (number | string | undefined) to a comparable number. Strings parse via
 * `parseInt`; undefined / non-finite values get `+Infinity` so they sort to the end of the list.
 */
function sortableNumber(value: number | string | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * Open the IR (Internet Ranking) website for the given chart in a new browser tab. Beatoraja
 * users typically run an LR2IR-compatible service (`http://www.dream-pro.info/~lavalse/LR2IR/`)
 * — the URL takes a chart MD5 as its query. We don't compute MD5 today, so this resolves to
 * the IR site's index page so the user can search manually.
 *
 * Falls back to the LR2IR home page when no song is focused (clicked from a folder bar). The
 * `_blank` target + `noopener,noreferrer` ensures the demo can't be navigated by the IR site.
 */
function openIrWebsite(_song: BrowserSongEntry | undefined): void {
  if (typeof window === 'undefined') return;
  // The standard LR2 / beatoraja IR. Future iteration: compute the chart's MD5 and append it
  // as a query parameter so the IR landing page deep-links to the chart's leaderboard.
  const url = 'http://www.dream-pro.info/~lavalse/LR2IR/search.cgi?mode=ranking';
  // eslint-disable-next-line no-console
  console.log('[beatoraja-select] opening IR website', JSON.stringify({ url }));
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Whether a key event comes from a text field, where keys type rather than steer the list. */
function isEditableKeyTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'range'].includes(target.type);
}
