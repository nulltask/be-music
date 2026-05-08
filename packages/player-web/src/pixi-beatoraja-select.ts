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
//   - **Selection highlight** — the row at the cursor renders in a warm yellow tint to stand
//     out against arbitrarily-coloured skin chrome. No solid backdrop / row panel: the skin's
//     authored chrome stays fully visible behind the list.
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

import { Container, FederatedPointerEvent, Graphics, Sprite, Text, Texture, type Ticker } from 'pixi.js';
import type { BeatorajaSkin, BeatorajaSkinConfig, BeatorajaSongListLayout } from '@be-music/beatoraja-skin';
import {
  BEATORAJA_NUM,
  BEATORAJA_OP,
  BEATORAJA_TEXT,
  buildBaseOpSet,
  parseBeatorajaSongList,
} from '@be-music/beatoraja-skin';
import { BeatorajaPlaySkinView } from './pixi-beatoraja-skin-view.ts';
import type { BeatorajaTextureCache } from './beatoraja-textures.ts';
import type { BeatorajaFontCache } from './beatoraja-fonts.ts';
import type { PixiScene, PixiSceneHost } from './pixi-scene-host.ts';
import { computeBeatorajaChartDensity, type ChartDensity } from './beatoraja-chart-density.ts';
import { computeBeatorajaChartTotalSeconds } from './beatoraja-chart-duration.ts';
import { computeBeatorajaNoteBreakdown, type NoteBreakdown } from './beatoraja-chart-note-counts.ts';
import { groupSongsByFolder, resolveChartPlayVariant } from './library.ts';
import { detectChartFeatures } from './select-ops.ts';
import type { BrowserBrowseEntry, BrowserFolderNode, BrowserSongEntry } from './types.ts';

export interface PixiBeatorajaSelectSceneOptions {
  skin: BeatorajaSkin;
  textures: BeatorajaTextureCache;
  /** Optional skin TTF cache (`loadBeatorajaFonts`). Absent → platform sans-serif fallback. */
  fonts?: BeatorajaFontCache;
  /** Confirmed user picks for the skin's `property[]`. */
  skinConfig?: BeatorajaSkinConfig;
  /** Songs to choose from. Empty array → "no songs" placeholder. */
  songs: ReadonlyArray<BrowserSongEntry>;
  /** Initial highlighted index (within the song list at root). Defaults to 0. */
  initialIndex?: number;
  /**
   * Called when the user confirms a song (`Enter` on a song row, or click an already-selected
   * song). The optional `options.autoPlay` is `true` when the source was the skin's authored
   * `button_autoplay` (act=16) — the host should route to gameplay in auto mode rather than
   * the user's default. When omitted / false, the host follows whatever the user has selected
   * in their global play settings.
   */
  onSongPicked: (song: BrowserSongEntry, options?: { autoPlay?: boolean }) => void;
  /** Called when the user backs out of the root list (`Escape` at root). */
  onExit?: () => void;
  /**
   * Called when the user clicks the skin's READTEXT button (act=17) — typically `readme` /
   * `player-info` / `help` / `btn-text` etc. depending on the skin. The host is expected to
   * find and display the chart's accompanying text file (`.txt` next to the chart, or
   * `#TEXT`-resolved content). Omit to have the action fall through to a console log.
   */
  onReadtextRequest?: (song: BrowserSongEntry) => void;
  /**
   * Called when the scene mutates `skinConfig` in place — currently fires for `JUDGE_TIMING`
   * (act=74) note-offset adjustments. The host should persist the new config (e.g. write it
   * into its per-entry config cache) and refresh any external readouts (e.g. the bottom-right
   * lil-gui's "Note offset" slider). Receives a fresh shallow clone so the callback never
   * aliases the scene's mutator state.
   */
  onSkinConfigChange?: (config: BeatorajaSkinConfig) => void;
}

/**
 * Fallback visible-row count when the skin doesn't author a `songlist` block. Odd so the
 * cursor sits on the centre. Real skins override this with the count of `songlist.liston`
 * entries (default beatoraja theme has 21, ModernChic 17, GdbG 11, …).
 */
const FALLBACK_VISIBLE_ROW_COUNT = 13;

/**
 * Beatoraja's `select.json` `value[]` block declares `{"id":"songs_count", … "ref":300}` for
 * the "X songs" footer that shows on a folder bar. The `300` doesn't appear in beatoraja's
 * standard `prop.lua` number table (the publicly-documented enum stops at the 100s); it's a
 * select-scene-specific extension code the renderer answers from the focused folder's child
 * count. We hardcode it here rather than promoting it to {@link BEATORAJA_NUM} because the
 * value source is scene-specific (the select scene's entries[] state, not the runtime adapter).
 */
const SELECT_NUM_SONGS_IN_FOLDER = 300;

/**
 * Ref 368 = BMS `#TOTAL` header value. ModernChic surfaces it as a chart-stats readout
 * (`info.lua` → "TOTAL値"). No symbolic name in our `BEATORAJA_NUM` enum — beatoraja's
 * documented prop.lua stops short of this code. Sourced from `chart.metadata.total`, which
 * holds the parsed `#TOTAL` value (gauge total per BMS spec; defaults vary).
 */
const SELECT_NUM_BMS_TOTAL = 368;

/**
 * Imageset ref 11 — the focused chart's keymode index. Skin authors order their `images[]`
 * array to match beatoraja's MainState enum; default's `modeset` declaration in `select.json`
 * is `["allkeys","5keys","7keys","10keys","14keys","9keys","24keys","24keysDP"]`, indexes 0-7.
 */
const SELECT_REF_KEYMODE_INDEX = 11;

/**
 * Imageset ref 308 — the focused chart's `#LNMODE` (long-note variant: 0=LN, 1=CN, 2=HCN).
 * Default skin's `lnmodeset` imageset shows the matching label. Charts without an explicit
 * `#LNMODE` directive default to 0 (LN), matching beatoraja's pre-LNMODE fallback.
 */
const SELECT_REF_LNMODE_INDEX = 308;

/**
 * Imageset ref 370 — best clear lamp for the focused chart. Default skin's `state_clear`
 * imageset declares 11 sub-images for NOPLAY through MAX. We have no score DB so we always
 * return 0 (NOPLAY), matching the `CLEAR_LAMP_NOPLAY` op we fire on every song.
 */
const SELECT_REF_BEST_CLEAR_LAMP_INDEX = 370;

/**
 * Per-kind note-count refs (ModernChic's `bmsanalysis.lua` block):
 *
 *   - `350` TOTALNOTE_NORMAL — playable taps minus scratch / LN / BSS.
 *   - `351` TOTALNOTE_LN — long notes (excluding scratch LN).
 *   - `352` TOTALNOTE_SCRATCH — single-tap scratches.
 *   - `353` TOTALNOTE_BSS — back-spin scratches (long scratch).
 */
const SELECT_NUM_TOTALNOTE_NORMAL = 350;
const SELECT_NUM_TOTALNOTE_LN = 351;
const SELECT_NUM_TOTALNOTE_SCRATCH = 352;
const SELECT_NUM_TOTALNOTE_BSS = 353;

/**
 * Note-density refs (ModernChic `info.lua`):
 *
 *   - `360` / `361` peak NPS — integer + first-decimal digits.
 *   - `362` / `363` end NPS (the chart's last 1-sec window).
 *   - `364` / `365` average NPS (`totalNotes / totalSeconds`).
 *
 * Skin authors render the readout as `{integer}.{decimal} NPS` by placing the integer cell
 * next to a literal "." next to the decimal cell.
 */
const SELECT_NUM_DENSITY_PEAK = 360;
const SELECT_NUM_DENSITY_PEAK_AFTERDOT = 361;
const SELECT_NUM_DENSITY_END = 362;
const SELECT_NUM_DENSITY_END_AFTERDOT = 363;
const SELECT_NUM_DENSITY_AVERAGE = 364;
const SELECT_NUM_DENSITY_AVERAGE_AFTERDOT = 365;

/**
 * Per-frame tween rate for `scrollPosition` chasing `currentIndex`. Fraction of the remaining
 * delta closed each frame at 60 Hz — `0.25` lands inside ~150 ms which feels responsive without
 * looking jumpy. We snap to the integer once the gap drops below `SCROLL_SNAP_THRESHOLD` so the
 * position doesn't asymptotically wander.
 */
const SCROLL_TWEEN_RATE = 0.25;
const SCROLL_SNAP_THRESHOLD = 0.005;

export class PixiBeatorajaSelectScene implements PixiScene {
  readonly root = new Container();
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
  /** Per-row label texts. */
  private readonly rowLabels: Text[] = [];
  /** Per-row "kind icon" texts (folder ▸ vs song ♪). Length matches {@link rowLabels}. */
  private readonly rowKindIcons: Text[] = [];
  /** Per-row sub-label (artist / song count). Length matches {@link rowLabels}. */
  private readonly rowSublabels: Text[] = [];
  /** Per-row click hit area. Sized to the row's authored rect on layout. */
  private readonly rowHitAreas: Sprite[] = [];
  /**
   * Skin-authored `songlist` layout (rect-per-row + focused row index). Parsed from
   * `skin.songlist` at construction. `undefined` when the skin omits the block — the layout
   * code falls back to a screen-space hard-coded grid so unsupported themes still get
   * something usable.
   */
  private songList: BeatorajaSongListLayout | undefined;
  /** Cached visible row count — `songList?.rows.length` or the fallback constant. */
  private visibleRowCount = FALLBACK_VISIBLE_ROW_COUNT;
  /** Cached focused row index within `0..visibleRowCount-1`. */
  private centreRowIndex = Math.floor(FALLBACK_VISIBLE_ROW_COUNT / 2);

  private readonly options: PixiBeatorajaSelectSceneOptions;
  private host?: PixiSceneHost;
  private tickerHandle?: (ticker: Ticker) => void;
  private startMs = 0;
  /**
   * Folder navigation stack. Empty = at root (showing folder bars). Length-1 = inside one
   * folder (showing songs). Mirrors `pixi-select.ts`'s nav model — beatoraja's reference skin
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
  private disposed = false;

  constructor(options: PixiBeatorajaSelectSceneOptions) {
    this.options = options;

    this.view = new BeatorajaPlaySkinView({
      skin: options.skin,
      textures: options.textures,
      // Text content tracks the highlighted song. The skin's title / artist / genre text destinations
      // therefore reflect the live cursor, matching beatoraja's own select-screen behavior.
      resolveTextContent: (refOp) => this.resolveSelectionText(refOp),
      // Numeric values from the focused song — total notes, BPM, level. Skins render
      // these via `value[]` elements with `ref = 74 (TOTALNOTES)`, `92 (MAINBPM)`,
      // `96 (PLAYLEVEL)`, etc. Without this, the chart-info panel sits on its idle
      // zeros even after the cursor moves to a different song.
      resolveNumberValue: (refOp) => this.resolveSelectionNumber(refOp),
      // Imageset / generic ref values. Drives `imageset[]` sub-image picks (e.g. `modeset`
      // ref 11 picks "5keys" / "7keys" / etc. from the skin's array based on the focused
      // chart's keymode) plus any other `ref`-driven selectors the skin authored.
      resolveRefValue: (refOp) => this.resolveSelectionRefValue(refOp),
      // Slider values — volume / lanecover / lift translate sliders. Without a value the
      // renderer hides the slider entirely; we report `1.0` (max position) for volume types
      // so ModernChic's volume sliders sit at full instead of vanishing.
      resolveSliderValue: (type) => resolveSelectionSliderValue(type),
      // Skin-authored button clicks — `image[].act` codes (15=play, 16=autoplay, etc.). Routed
      // through `handleButtonAction` so the user can hit "AUTO PLAY" on the skin's chrome and
      // the scene starts the focused song in auto mode without round-tripping through a separate
      // toggle.
      onButtonAction: (act, mods) => this.handleButtonAction(act, mods),
      resolveFontFamily: options.fonts ? (id) => options.fonts!.family(id) : undefined,
      resolveFontKind: options.fonts ? (id) => options.fonts!.kind(id) : undefined,
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
    this.listLayer.eventMode = 'static';
    this.view.container.addChildAt(this.listLayer, this.view.songListLayerInsertIndex);

    this.songList = parseBeatorajaSongList(options.skin);
    this.applySongListGeometry();
    this.buildRowVisuals(options.fonts);
    this.refreshEntries(options.initialIndex ?? 0);

    // eslint-disable-next-line no-console
    console.log(
      '[beatoraja-select] mounted',
      JSON.stringify({
        canvas: { w: this.view.width, h: this.view.height },
        songs: options.songs.length,
        folders: groupSongsByFolder(options.songs).length,
        initialIndex: this.currentIndex,
        skinName: options.skin.name,
      }),
    );
  }

  enter(host: PixiSceneHost): void {
    if (this.disposed) return;
    this.host = host;
    this.startMs = performance.now();
    this.fitToStage();
    this.tickerHandle = (ticker) => this.tick(ticker);
    host.app.ticker.add(this.tickerHandle);
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.handleKeyDown);
    }
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
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.exit();
    this.view.dispose();
    if (!this.root.destroyed) {
      this.root.destroy({ children: false });
    }
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
    this.view.dispose();
    this.cachedBaseOps = undefined;

    (this.options as { skinConfig?: BeatorajaSkinConfig }).skinConfig = opts.skinConfig;

    this.view = new BeatorajaPlaySkinView({
      skin: opts.skin,
      textures: opts.textures,
      resolveTextContent: (refOp) => this.resolveSelectionText(refOp),
      resolveNumberValue: (refOp) => this.resolveSelectionNumber(refOp),
      resolveRefValue: (refOp) => this.resolveSelectionRefValue(refOp),
      resolveSliderValue: (type) => resolveSelectionSliderValue(type),
      onButtonAction: (act, mods) => this.handleButtonAction(act, mods),
      resolveFontFamily: opts.fonts ? (id) => opts.fonts!.family(id) : undefined,
      resolveFontKind: opts.fonts ? (id) => opts.fonts!.kind(id) : undefined,
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
    this.songList = parseBeatorajaSongList(opts.skin);
    this.applySongListGeometry();
    this.buildRowVisuals(opts.fonts);
    this.refreshRowVisuals();

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
    this.refreshRowVisuals();

    const elapsed = performance.now() - this.startMs;
    // Pass through unfired timers as `undefined` so destinations gated on them stay hidden.
    // Returning `0` for everything would render `timer=2` (TIMER_FADEOUT) gated chrome — most
    // notably a fullscreen black fade-IN that the default skin authors — from the moment the
    // scene mounts, blacking out the entire view. The destination renderer hardcodes the
    // `timer=0` (scene-start) path to use 0 elapsed already, so passing `undefined` for
    // anything else is the correct behaviour.
    this.view.update({
      activeOps: this.computeActiveOps(),
      getTimerStart: () => undefined,
      nowMs: elapsed,
    });
  }

  /**
   * Stable per-skin op set — `skin_config.option` picks plus any always-on flags. Cached because
   * `buildBaseOpSet` walks the option map; recompute only when `replaceSkin` invalidates the
   * cache. Live per-frame ops (focused-bar kind, chart keymode) are added on top in
   * {@link computeActiveOps}.
   */
  private baseOps(): ReadonlySet<number> {
    if (this.cachedBaseOps !== undefined) return this.cachedBaseOps;
    this.cachedBaseOps = buildBaseOpSet(this.options.skinConfig?.option);
    return this.cachedBaseOps;
  }
  private cachedBaseOps: ReadonlySet<number> | undefined;

  /**
   * Per-frame active op set. Combines the stable base ops with bar-state ops derived from the
   * cursor's focused entry:
   *
   *   - `FOLDERBAR (1)` — focused entry is a folder bar. Default skin gates its `songs_font` /
   *     `songs_count` and the bar-history `lamp` / `rank` graphs on this op.
   *   - `SONGBAR (2)` — focused entry is a song bar. Gates the BPM / playlevel / score / miss /
   *     combo / clear / play readouts that make up most of the left-pane info panel.
   *   - `PLAYABLEBAR (5)` — folder OR song. (Reserved; we don't have grade bars.)
   *   - `KEYSONG_*` (160-164 / 1160-1161) — variant of the focused song's chart, lights up the
   *     "7KEYS" / "5KEYS" / etc. label image.
   *
   * Without these the entire info pane stays hidden because its destinations are gated on
   * `op:[2]` in the authored skin.
   */
  private computeActiveOps(): ReadonlySet<number> {
    const base = this.baseOps();
    // Fast path: no active entry → just the base set (includes `skin_config.option` picks).
    const entry = this.entries[this.currentIndex];
    if (entry === undefined) return base;

    const ops = new Set(base);

    // Scene-wide defaults — system state we've made available consistently from the moment the
    // scene mounts. These are independent of the focused entry so they live outside the song /
    // folder branches.
    //
    //   - `LOADED` (81): assets / library finished loading (we never enter this scene before
    //     the chart bundle is decoded, so it's always true).
    //   - `OFFLINE` (50): IR (online ranking) is unavailable. We have no IR integration today
    //     so the OFFLINE branch always wins; chrome gated on ONLINE stays hidden.
    //   - `REPLAY_OFF` (82): replay system is disabled. No replay capture / playback yet.
    //   - `DISABLE_SAVE_SCORE` (60) / `NO_SAVE_CLEAR` (62): score DB is unavailable. Chrome
    //     gated on the ENABLE_* / *_SAVE_CLEAR variants stays hidden until DB layer ships.
    //   - `BGAON` (41): play-scene BGA enabled. The select scene's "BGA: ON / OFF" indicator
    //     gates on this; we have no BGA-disable toggle, so it's permanently on.
    //
    // Without this batch the skin's chrome at the bottom of the screen (replay / IR badges,
    // save-status indicators) sits on its idle / unknown state.
    ops.add(BEATORAJA_OP.LOADED);
    ops.add(BEATORAJA_OP.OFFLINE);
    ops.add(BEATORAJA_OP.REPLAY_OFF);
    ops.add(BEATORAJA_OP.DISABLE_SAVE_SCORE);
    ops.add(BEATORAJA_OP.NO_SAVE_CLEAR);
    ops.add(BEATORAJA_OP.BGA_ON);

    if (entry.kind === 'folder') {
      ops.add(BEATORAJA_OP.FOLDERBAR);
    } else {
      ops.add(BEATORAJA_OP.SONGBAR);
      ops.add(BEATORAJA_OP.PLAYABLEBAR);
      // Map chart variant → keysong op. `resolveChartPlayVariant` returns one of the 5/7/9/10/14
      // strings the LR2 / beatoraja paths share; 24K / 24K-DP variants aren't surfaced today
      // but the destination gates still resolve correctly when those values land.
      const variant = safeResolveChartVariant(entry.song);
      const keysongOp = keysongOpForVariant(variant);
      if (keysongOp !== undefined) ops.add(keysongOp);

      // Chart traits — gates per-feature chrome. Beatoraja's trait op codes match the LR2
      // `dst_option` block 1:1 (HAS_LN=173, HAS_BGA=171, HAS_BPMCHANGE=177, HAS_RANDOMSEQUENCE=179),
      // so reusing `detectChartFeatures` (originally written for the LR2 select scene) gives us
      // matching semantics for free.
      const features = detectChartFeatures(entry.song);
      ops.add(features.longNote ? BEATORAJA_OP.HAS_LN : BEATORAJA_OP.NO_LN);
      ops.add(features.bga ? BEATORAJA_OP.HAS_BGA : BEATORAJA_OP.NO_BGA);
      ops.add(features.bpmChange ? BEATORAJA_OP.HAS_BPMCHANGE : BEATORAJA_OP.NO_BPMCHANGE);
      ops.add(features.random ? BEATORAJA_OP.HAS_RANDOMSEQUENCE : BEATORAJA_OP.NO_RANDOMSEQUENCE);
      // HAS_BPMSTOP (1177) — chart stops are channel `09`. Default skin's `bpmgraph` swaps a
      // "with stop" variant on this op (see `op:[1177]` in `select.json`). No companion `NO_*`
      // op is defined in beatoraja's prop.lua for stops — `1177` alone toggles the right chrome.
      const hasStop = chartHasStop(entry.song);
      if (hasStop) ops.add(BEATORAJA_OP.HAS_BPMSTOP);

      // Asset presence — chrome that fades / hides depending on whether the chart shipped a
      // banner / loading-screen / select-screen image. Sourced directly from `metadata.*`.
      const meta = entry.song.chart.metadata;
      ops.add(meta.stageFile ? BEATORAJA_OP.HAS_STAGEFILE : BEATORAJA_OP.NO_STAGEFILE);
      ops.add(meta.banner ? BEATORAJA_OP.HAS_BANNER : BEATORAJA_OP.NO_BANNER);
      ops.add(meta.backBmp ? BEATORAJA_OP.HAS_BACKBMP : BEATORAJA_OP.NO_BACKBMP);

      // Difficulty op — `#DIFFICULTY 1..5` lights up the matching LEVEL_* op (70..74). Skins
      // gate per-difficulty chrome (e.g. the BEGINNER / NORMAL / HYPER / ANOTHER / INSANE label
      // images in ModernChic) on these. Charts without a difficulty header → no op fires (skin
      // shows fallback chrome).
      const difficultyOp = difficultyLevelOp(meta.difficulty);
      if (difficultyOp !== undefined) ops.add(difficultyOp);

      // Judge rank op — `#RANK 0..4` lights up JUDGE_VERYHARD / HARD / NORMAL / EASY /
      // VERYEASY. ModernChic / GdbG both gate the per-rank judgment-window labels on these.
      // Charts without `#RANK` default to NORMAL — matches beatoraja's behavior of treating
      // "missing rank" as the standard window.
      ops.add(judgeRankOp(meta.rank));

      // Clear-lamp default — without a score DB we have no record of past plays, so every
      // song reports as `CLEAR_LAMP_NOPLAY` (100). Skins gate the small "lamp" graphic on the
      // bar list on this op; in the meantime the user sees the "no play" indicator instead of
      // a blank bar.
      ops.add(BEATORAJA_OP.CLEAR_LAMP_NOPLAY);
    }
    return ops;
  }

  /**
   * Recompute the entries the renderer should show given the current `folderStack`, then sync
   * `currentIndex` and the scroll baseline. Called on mount, on folder enter / leave, and on
   * external `setSelectionIndex`.
   */
  private refreshEntries(initialIndex: number): void {
    if (this.folderStack.length === 0) {
      const folders = groupSongsByFolder(this.options.songs);
      this.entries = folders.map((folder): BrowserBrowseEntry => ({ kind: 'folder', folder }));
    } else {
      const top = this.folderStack[this.folderStack.length - 1]!;
      this.entries = top.songs.map((song): BrowserBrowseEntry => ({ kind: 'song', song }));
    }
    this.currentIndex = clampIndex(initialIndex, this.entries.length);
    this.scrollPosition = this.currentIndex;
    this.refreshRowVisuals();
  }

  private resolveSelectionText(refOp: number): string | undefined {
    const song = this.focusedSong();
    const skin = this.options.skin;
    switch (refOp) {
      case BEATORAJA_TEXT.TITLE:
        return song?.title ?? '';
      case BEATORAJA_TEXT.SUBTITLE:
        return song?.subtitle ?? '';
      case BEATORAJA_TEXT.FULLTITLE:
        return joinNonEmpty(song?.title, song?.subtitle);
      case BEATORAJA_TEXT.GENRE:
        return song?.genre ?? '';
      case BEATORAJA_TEXT.ARTIST:
        return song?.artist ?? '';
      case BEATORAJA_TEXT.SUBARTIST:
        return '';
      case BEATORAJA_TEXT.FULLARTIST:
        return song?.artist ?? '';
      case BEATORAJA_TEXT.SKIN_NAME:
        return skin.name ?? '';
      case BEATORAJA_TEXT.SKIN_AUTHOR:
        return skin.author ?? '';
      case BEATORAJA_TEXT.DIRECTORY:
        return song?.directoryLabel ?? this.currentFolderLabel();
      case BEATORAJA_TEXT.SEARCHWORD:
        return '';
      default:
        return undefined;
    }
  }

  /**
   * Numeric values for the focused song. Beatoraja's reference + GdbG_Skin select scenes both
   * author `value[]` displays for the highlighted chart's note count, BPM, and difficulty
   * level — without this resolver those `value[]` elements stay on their idle digits even as
   * the cursor moves between songs.
   *
   * Best-record / play-count / IR refs (refs 71..89, 77..79) return `undefined` because we
   * don't have a score DB yet; the matching number panels will render as blanks until that
   * layer ships.
   */
  private resolveSelectionNumber(refOp: number): number | undefined {
    // ref 300 = `songs_count` (number of songs in the focused folder). Resolved BEFORE the
    // `focusedSong()` early-return below — it makes sense on a folder bar where focusedSong()
    // returns the first child, but the more useful number is the folder's child count itself.
    if (refOp === SELECT_NUM_SONGS_IN_FOLDER) {
      const entry = this.entries[this.currentIndex];
      if (entry?.kind === 'folder') return entry.folder.songs.length;
      // On a song bar, the parent folder's count if known; otherwise undefined.
      const parent = this.folderStack[this.folderStack.length - 1];
      return parent?.songs.length;
    }

    // Wall-clock readouts (`time_year/month/day/hour/minute/second`, refs 21-26). The default
    // skin authors these as `value[]` with `ref:21..` for the corner clock display; ModernChic
    // / GdbG also surface them somewhere in the chrome. They're independent of the focused
    // song so they resolve BEFORE the `focusedSong()` early-return — without that, the clock
    // freezes whenever the cursor is on a non-song row (folder, empty list, etc.).
    switch (refOp) {
      case BEATORAJA_NUM.TIME_YEAR:
      case BEATORAJA_NUM.TIME_MONTH:
      case BEATORAJA_NUM.TIME_DAY:
      case BEATORAJA_NUM.TIME_HOUR:
      case BEATORAJA_NUM.TIME_MINUTE:
      case BEATORAJA_NUM.TIME_SECOND:
        return resolveWallClockField(refOp);
    }

    const song = this.focusedSong();
    if (song === undefined) return undefined;

    // BMS `#TOTAL` value (gauge total per BMS spec). Returned as the integer floor — beatoraja's
    // value digits don't carry a fraction part for this readout. `undefined` when the chart
    // didn't author a TOTAL header (rare; older BMS files may omit it).
    if (refOp === SELECT_NUM_BMS_TOTAL) {
      const total = song.chart.metadata.total;
      return typeof total === 'number' && Number.isFinite(total) ? Math.floor(total) : undefined;
    }

    // Per-kind note breakdown (ModernChic `bmsanalysis.lua`). Each ref returns one bucket of
    // `computeBeatorajaNoteBreakdown`; the cache below ensures the events scan happens once
    // per song.
    switch (refOp) {
      case SELECT_NUM_TOTALNOTE_NORMAL:
        return resolveNoteBreakdown(song).normal;
      case SELECT_NUM_TOTALNOTE_LN:
        return resolveNoteBreakdown(song).ln;
      case SELECT_NUM_TOTALNOTE_SCRATCH:
        return resolveNoteBreakdown(song).scratch;
      case SELECT_NUM_TOTALNOTE_BSS:
        return resolveNoteBreakdown(song).bss;
    }

    // Note density readouts (ModernChic `info.lua`). Each readout splits a float NPS value
    // into integer + first-decimal cells. Skin authors render "12.4 NPS" via three cells:
    // integer + literal "." + first-decimal.
    switch (refOp) {
      case SELECT_NUM_DENSITY_PEAK:
        return resolveDensity(song).peak.whole;
      case SELECT_NUM_DENSITY_PEAK_AFTERDOT:
        return resolveDensity(song).peak.afterDot;
      case SELECT_NUM_DENSITY_END:
        return resolveDensity(song).end.whole;
      case SELECT_NUM_DENSITY_END_AFTERDOT:
        return resolveDensity(song).end.afterDot;
      case SELECT_NUM_DENSITY_AVERAGE:
        return resolveDensity(song).average.whole;
      case SELECT_NUM_DENSITY_AVERAGE_AFTERDOT:
        return resolveDensity(song).average.afterDot;
    }

    switch (refOp) {
      case BEATORAJA_NUM.TOTALNOTES:
      case BEATORAJA_NUM.TOTALNOTES_LIVE:
        return song.totalNotes;
      case BEATORAJA_NUM.MAINBPM:
      case BEATORAJA_NUM.NOWBPM:
        return song.bpm !== undefined ? Math.round(song.bpm) : undefined;
      // MAX / MIN BPM — walk the chart's BPM-change events and pick the extremes. Falls back to
      // the chart's main BPM when the chart is constant-tempo (no `03`/`08` events). Cached per
      // song to avoid re-scanning events every frame.
      case BEATORAJA_NUM.MAXBPM:
        return resolveBpmRange(song)?.max;
      case BEATORAJA_NUM.MINBPM:
        return resolveBpmRange(song)?.min;
      case BEATORAJA_NUM.PLAYLEVEL:
        return resolvePlayLevel(song.playLevel);
      // JUDGETIMING (note offset in ms) — sourced from `skin_config.offset`. The default skin
      // surfaces it as a small readout next to the option panel; user adjustments via the
      // bottom-right "Note offset (ms)" slider should reflect live. Returns 0 when the config
      // wasn't supplied or when offset is not a number (legacy `BeatorajaLuaSkinConfig` widened
      // `offset` to a number-or-table union — only the number case is the offset readout).
      case BEATORAJA_NUM.JUDGETIMING: {
        const offset = this.options.skinConfig?.offset;
        return typeof offset === 'number' && Number.isFinite(offset) ? offset : 0;
      }
      // Song length minutes / seconds (refs 1163 / 1164). Computed once per song from BPM
      // segments + STOP events. Authors typically place these next to each other so the panel
      // reads "M:SS" — the seconds value is `floor(totalSeconds) % 60`, NOT the fractional
      // remainder, matching beatoraja's reference behavior.
      case BEATORAJA_NUM.SONGLENGTH_MINUTE:
        return Math.floor(resolveSongLengthSeconds(song) / 60);
      case BEATORAJA_NUM.SONGLENGTH_SECOND:
        return Math.floor(resolveSongLengthSeconds(song)) % 60;
      // Live-play counters all report 0 in the select scene — no engine running. Skins that
      // share a `value[]` element across select / play (rare) get sensible idle digits.
      case BEATORAJA_NUM.POINT:
      case BEATORAJA_NUM.SCORE2:
      case BEATORAJA_NUM.SCORE_RATE:
      case BEATORAJA_NUM.SCORE_RATE_AFTERDOT:
      case BEATORAJA_NUM.COMBO:
      case BEATORAJA_NUM.MAXCOMBO_LIVE:
      case BEATORAJA_NUM.GROOVEGAUGE:
      case BEATORAJA_NUM.PERFECT:
      case BEATORAJA_NUM.GREAT:
      case BEATORAJA_NUM.GOOD:
      case BEATORAJA_NUM.BAD:
      case BEATORAJA_NUM.POOR:
        return 0;
      default:
        return undefined;
    }
  }

  /**
   * Generic `ref`-driven resolution for the imageset pipe (`{id="modeset", ref:11, images:[…]}`
   * etc.). Returns the integer index that the imageset's `images[]` array should pick. Called by
   * the view's `resolveRefValue` hook on every imageset paint.
   *
   * Skin authors order their `images[]` arrays to match beatoraja's MainState integer enums; the
   * mapping below mirrors those enums:
   *
   *   - `ref:11` (`modeset`) — keymode index. 0 = ALL, 1 = 5K, 2 = 7K, 3 = 10K, 4 = 14K,
   *     5 = 9K, 6 = 24K, 7 = 24K-DP. Matches default skin's `["allkeys","5keys","7keys",
   *     "10keys","14keys","9keys","24keys","24keysDP"]` ordering.
   *
   * Unrecognised refs return 0 — the imageset renderer treats that as "first slot", which is the
   * skin's authored "default / unknown" image and degrades gracefully for refs we haven't wired
   * yet (option-* selectors, lnmodeset, sortset, etc.).
   */
  private resolveSelectionRefValue(refOp: number): number {
    if (refOp === SELECT_REF_KEYMODE_INDEX) {
      const song = this.focusedSong();
      if (song === undefined) return 0;
      return keymodeImagesetIndex(safeResolveChartVariant(song));
    }
    if (refOp === SELECT_REF_LNMODE_INDEX) {
      // 0 = LN, 1 = CN (charge note), 2 = HCN (hell charge note). User's LNMODE-button click
      // override (act=308) wins; otherwise fall back to the focused chart's authored `#LNMODE`
      // (or 0 for legacy BMS that didn't author the directive).
      if (this.lnModeOverride !== undefined) return this.lnModeOverride;
      const song = this.focusedSong();
      const lnMode = song?.chart.bms?.lnMode;
      if (typeof lnMode === 'number' && lnMode >= 0 && lnMode <= 2) return lnMode;
      return 0;
    }
    if (refOp === SELECT_REF_BEST_CLEAR_LAMP_INDEX) {
      // Best clear lamp index — `state_clear` imageset's 11 slots map onto beatoraja's lamp
      // ladder: 0=NOPLAY, 1=FAILED, 2=ASSIST_EASY, 3=LIGHT_ASSIST_EASY, 4=EASY, 5=NORMAL,
      // 6=HARD, 7=EXHARD, 8=FULLCOMBO, 9=PERFECT, 10=MAX. We have no score DB so every chart
      // reports as 0 (NOPLAY) — matches the `CLEAR_LAMP_NOPLAY` op we already fire.
      return 0;
    }
    return 0;
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
   * Cycle the global LN-mode override forward (`step = +1`) or backward (`-1`). Starts from
   * the focused chart's authored `#LNMODE` when no override is set yet so the first click
   * advances from "LN" → "CN" rather than reverting an unset state. Wraps at 0..2.
   */
  private cycleLnModeOverride(step: number): void {
    const song = this.focusedSong();
    const authored = song?.chart.bms?.lnMode;
    const current =
      this.lnModeOverride ?? (typeof authored === 'number' && authored >= 0 && authored <= 2 ? authored : 0);
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
    const entry = this.entries[this.currentIndex];
    const song = entry?.kind === 'song' ? entry.song : entry?.folder.songs[0];
    switch (act) {
      case 15: // PLAY (user's default mode)
        if (song !== undefined) {
          // eslint-disable-next-line no-console
          console.log('[beatoraja-select] act=15 PLAY', JSON.stringify({ title: song.title }));
          this.options.onSongPicked(song);
        }
        return;
      case 16: // AUTO PLAY
        if (song !== undefined) {
          // eslint-disable-next-line no-console
          console.log('[beatoraja-select] act=16 AUTO PLAY', JSON.stringify({ title: song.title }));
          this.options.onSongPicked(song, { autoPlay: true });
        }
        return;
      case 315: // PRACTICE — practice runtime not implemented yet; fall through to plain play
        if (song !== undefined) {
          // eslint-disable-next-line no-console
          console.log('[beatoraja-select] act=315 PRACTICE (routed as normal play)', JSON.stringify({ title: song.title }));
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
      default:
        // eslint-disable-next-line no-console
        console.log('[beatoraja-select] unhandled button act', JSON.stringify({ act }));
        return;
    }
  }

  /** Whichever song the current cursor points at — at root, picks the first song of the focused folder. */
  private focusedSong(): BrowserSongEntry | undefined {
    const entry = this.entries[this.currentIndex];
    if (entry === undefined) return undefined;
    if (entry.kind === 'song') return entry.song;
    return entry.folder.songs[0];
  }

  private currentFolderLabel(): string {
    if (this.folderStack.length === 0) return '';
    return this.folderStack[this.folderStack.length - 1]!.label;
  }

  // ─── Layout / visuals ─────────────────────────────────────────────────────────────────────────

  /**
   * Recompute `visibleRowCount` + `centreRowIndex` from the parsed `songlist`. When the skin
   * doesn't author one we fall back to the legacy 13-row hardcoded grid.
   *
   * Called on construction and `replaceSkin` — the songlist parse depends on the skin
   * payload, so it has to re-run when the skin payload changes.
   */
  private applySongListGeometry(): void {
    if (this.songList !== undefined) {
      this.visibleRowCount = this.songList.rows.length;
      this.centreRowIndex = this.songList.focusedRowIndex;
    } else {
      this.visibleRowCount = FALLBACK_VISIBLE_ROW_COUNT;
      this.centreRowIndex = Math.floor(FALLBACK_VISIBLE_ROW_COUNT / 2);
    }
  }

  /**
   * Get the per-row rect for visible-row index `i` in skin-space (top-left origin Y-DOWN).
   * Reads directly from `songList.rows[i]` (Y-flipped from libGDX Y-UP) when available;
   * otherwise synthesises a fallback grid on the right half of the canvas.
   */
  private rowRectAt(i: number): { x: number; y: number; w: number; h: number } {
    const skinH = this.view.height;
    if (this.songList !== undefined) {
      const r = this.songList.rows[i];
      if (r !== undefined) {
        return { x: r.x, y: skinH - r.y - r.h, w: r.w, h: r.h };
      }
    }
    // Fallback: right half, evenly spaced. Keeps unsupported skins (no songlist block)
    // usable.
    const skinW = this.view.width;
    const fallbackRowH = 56 * (skinH / 720);
    const focusedRowCentreY = skinH * 0.42;
    const cx = skinW * 0.74;
    const w = skinW * 0.4;
    const yCentre = focusedRowCentreY + (i - this.centreRowIndex) * fallbackRowH;
    return { x: cx - w / 2, y: yCentre - fallbackRowH / 2, w, h: fallbackRowH };
  }

  private buildRowVisuals(fonts: BeatorajaFontCache | undefined): void {
    const skinFamily = fonts?.values()[0]?.family;
    const fontFamily = skinFamily !== undefined ? `'${skinFamily}', sans-serif` : 'sans-serif';
    // Tear down old visuals when rebuilding (e.g. on `replaceSkin` against a skin whose
    // songlist length differs from the previous one). Pixi children stay attached to
    // listLayer; clearing the arrays lets the new loop allocate the right count.
    for (const t of this.rowLabels) t.destroy();
    for (const t of this.rowKindIcons) t.destroy();
    for (const t of this.rowSublabels) t.destroy();
    for (const s of this.rowHitAreas) s.destroy();
    this.rowLabels.length = 0;
    this.rowKindIcons.length = 0;
    this.rowSublabels.length = 0;
    this.rowHitAreas.length = 0;
    // Pick a font size proportional to the row height. Skins with tall bars (ModernChic
    // 70px) get bigger text; skins with thin bars (default 36px) get smaller text. The 0.45
    // multiplier leaves room for a sub-label below the primary one.
    const sampleRect = this.rowRectAt(this.centreRowIndex);
    const labelSize = Math.max(12, Math.floor(sampleRect.h * 0.45));
    const subSize = Math.max(10, Math.floor(sampleRect.h * 0.25));
    for (let i = 0; i < this.visibleRowCount; i += 1) {
      // Hit area sprite — invisible but interactive. Sized to the row's text band on layout.
      const hit = new Sprite({ texture: Texture.WHITE });
      hit.alpha = 0;
      hit.eventMode = 'static';
      hit.cursor = 'pointer';
      hit.on('pointertap', (event: FederatedPointerEvent) => this.handleRowPointerTap(i, event));
      this.listLayer.addChild(hit);
      this.rowHitAreas.push(hit);

      // Kind icon (▶ / ▸ / ♪) — narrow column at the row's left edge.
      const icon = new Text({
        text: '',
        style: { fontFamily, fontSize: labelSize, fill: 0xffffff, fontWeight: '600' },
      });
      icon.anchor.set(0, 0.5);
      this.listLayer.addChild(icon);
      this.rowKindIcons.push(icon);

      // Primary label — title (song) / folder name (folder).
      const label = new Text({
        text: '',
        style: { fontFamily, fontSize: labelSize, fill: 0xffffff, fontWeight: '600' },
      });
      label.anchor.set(0, 0.5);
      this.listLayer.addChild(label);
      this.rowLabels.push(label);

      // Sub-label — artist (song) / song count (folder). Smaller, fainter.
      const sub = new Text({
        text: '',
        style: { fontFamily, fontSize: subSize, fill: 0xc0d0ff, fontStyle: 'italic' },
      });
      sub.anchor.set(0, 0.5);
      this.listLayer.addChild(sub);
      this.rowSublabels.push(sub);
    }
  }

  /**
   * Repaint the row backdrops + labels for the current cursor / scroll state. Called on every
   * tick (cheap — just text mutations + Graphics rect rebuild).
   */
  private refreshRowVisuals(): void {
    const total = this.entries.length;
    // The "centre" of the visible window in entry-coordinates. As `scrollPosition` tweens
    // toward `currentIndex`, every row's index slides by the same amount. Indices that fall
    // outside `[0, total)` are wrapped — the list is circular, so the row above the first
    // entry shows the LAST entry and vice versa.
    const centreEntry = this.scrollPosition;
    for (let i = 0; i < this.visibleRowCount; i += 1) {
      const rawEntryIndex = Math.round(centreEntry) + (i - this.centreRowIndex);
      const wrappedIndex = total > 0 ? ((rawEntryIndex % total) + total) % total : -1;
      const entry = total > 0 ? this.entries[wrappedIndex] : undefined;
      const icon = this.rowKindIcons[i]!;
      const label = this.rowLabels[i]!;
      const sub = this.rowSublabels[i]!;
      const hit = this.rowHitAreas[i]!;
      if (entry === undefined) {
        icon.visible = false;
        label.visible = false;
        sub.visible = false;
        hit.visible = false;
        continue;
      }
      const isSelected = i === this.centreRowIndex;
      icon.visible = true;
      label.visible = true;
      sub.visible = true;
      hit.visible = true;
      if (entry.kind === 'folder') {
        const folder = entry.folder;
        icon.text = isSelected ? '▼' : '▸';
        label.text = folder.label;
        sub.text = `${folder.songs.length} song${folder.songs.length === 1 ? '' : 's'}`;
      } else {
        const song = entry.song;
        icon.text = isSelected ? '▶' : '♪';
        label.text = song.title;
        sub.text = song.artist ?? '';
      }
      icon.alpha = isSelected ? 1 : 0.7;
      label.alpha = isSelected ? 1 : 0.75;
      sub.alpha = isSelected ? 0.95 : 0.55;
    }
    this.layoutRows();
  }

  /**
   * Position + size the row visuals using the skin's authored `songlist.liston` rects (or
   * the synthesised fallback grid). Coordinates are skin-space — the listLayer is mounted
   * inside `view.container` so the parent transform handles scaling / letterboxing.
   *
   * The fractional `scrollPosition` residual feeds into a per-row Y nudge so an in-flight
   * tween shows a sub-row glide instead of jumping a whole row at the snap. The offset
   * is applied along the AVERAGE row-height direction, which works for straight column
   * layouts and degrades gracefully for arched / diagonal layouts (the rows still glide,
   * just along a non-vertical axis).
   */
  private layoutRows(): void {
    if (this.visibleRowCount === 0) return;

    // Average row height (skin-space) to scale the fractional scroll. For straight layouts
    // this is the per-row vertical step; for arched layouts it's a reasonable approximation
    // of the typical step magnitude.
    const aboveCentre = this.rowRectAt(Math.max(0, this.centreRowIndex - 1));
    const atCentre = this.rowRectAt(this.centreRowIndex);
    const avgRowStep = Math.abs(aboveCentre.y - atCentre.y) || atCentre.h;
    const fractional = this.scrollPosition - Math.round(this.scrollPosition);
    const fractionalNudge = -fractional * avgRowStep;

    for (let i = 0; i < this.visibleRowCount; i += 1) {
      const hit = this.rowHitAreas[i]!;
      const icon = this.rowKindIcons[i]!;
      const label = this.rowLabels[i]!;
      const sub = this.rowSublabels[i]!;
      if (!label.visible) continue;
      const rect = this.rowRectAt(i);
      const rowCentreY = rect.y + rect.h / 2 + fractionalNudge;

      const isSelected = i === this.centreRowIndex;

      hit.x = rect.x;
      hit.y = rect.y + fractionalNudge;
      hit.width = rect.w;
      hit.height = rect.h;
      hit.hitArea = null;

      const iconX = rect.x + Math.max(8, Math.floor(rect.h * 0.2));
      icon.x = iconX;
      icon.y = rowCentreY;
      icon.tint = isSelected ? 0xffe066 : 0xffffff;

      const labelX = iconX + Math.max(20, Math.floor(rect.h * 0.5));
      label.x = labelX;
      label.y = rowCentreY - Math.floor(rect.h * 0.05);
      label.tint = isSelected ? 0xffe066 : 0xffffff;

      sub.x = labelX;
      sub.y = rowCentreY + Math.floor(rect.h * 0.25);
      sub.tint = isSelected ? 0xffe066 : 0xc0d0ff;
    }
  }

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
    this.layoutRows();
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
    const rawIndex = Math.round(this.scrollPosition) + (rowOffset - this.centreRowIndex);
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
    this.refreshRowVisuals();
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
      return;
    }
    // eslint-disable-next-line no-console
    console.log(
      '[beatoraja-select] song picked',
      JSON.stringify({ index: this.currentIndex, title: entry.song.title, artist: entry.song.artist }),
    );
    this.options.onSongPicked(entry.song);
  }

  private leaveFolder(): void {
    if (this.folderStack.length === 0) {
      this.options.onExit?.();
      return;
    }
    this.folderStack.pop();
    this.cursorStack.pop();
    const restoredIndex = this.cursorStack[this.cursorStack.length - 1] ?? 0;
    this.refreshEntries(restoredIndex);
  }

  /**
   * Move the cursor by `delta` rows, wrapping around list bounds (last row → first row on
   * forward overflow, first row → last row on backward overflow). Beatoraja's reference song
   * select wheel is circular and this matches that behavior — the user reported "選曲リストは循環します".
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
    this.refreshRowVisuals();
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
    this.refreshRowVisuals();
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (this.disposed) return;
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
        this.leaveFolder();
        break;
    }
  };
}

function clampIndex(value: number, length: number): number {
  if (length <= 0) return 0;
  if (!Number.isFinite(value)) return 0;
  const truncated = Math.trunc(value);
  if (truncated < 0) return 0;
  if (truncated >= length) return length - 1;
  return truncated;
}

function joinNonEmpty(...parts: ReadonlyArray<string | undefined>): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ');
}

/**
 * `BrowserSongEntry.playLevel` arrives as either a number (BMS `#PLAYLEVEL 12`) or a string
 * (some BMSON files / BMS variants store it as text). The skin's `value[]` resolver expects
 * a number, so we coerce — strings parse via `parseInt`; non-finite results return
 * `undefined` so the digit panel shows blanks rather than NaN garbage.
 */
function resolvePlayLevel(level: number | string | undefined): number | undefined {
  if (typeof level === 'number') return Number.isFinite(level) ? level : undefined;
  if (typeof level === 'string' && level.length > 0) {
    const parsed = Number.parseInt(level, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * `resolveChartPlayVariant` walks the chart's events / metadata to classify keys mode. On a
 * malformed entry it can throw; a per-frame op-set computation must never throw, so we wrap
 * with a try/catch and fall back to `undefined` (= no `KEYSONG_*` op set, "modeless" bar).
 */
function safeResolveChartVariant(song: BrowserSongEntry): '5' | '7' | '9' | '10' | '14' | undefined {
  try {
    return resolveChartPlayVariant(song);
  } catch {
    return undefined;
  }
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

/**
 * Resolve one wall-clock field — picks the right `Date` accessor for the given `BEATORAJA_NUM`
 * `TIME_*` ref. Reads `Date.now()` per call so the seconds tick live as the renderer re-samples
 * each frame. Months are 1-indexed (skin authors expect "1..12", not the JS `0..11`).
 */
function resolveWallClockField(refOp: number): number | undefined {
  const now = new Date();
  switch (refOp) {
    case BEATORAJA_NUM.TIME_YEAR:
      return now.getFullYear();
    case BEATORAJA_NUM.TIME_MONTH:
      return now.getMonth() + 1;
    case BEATORAJA_NUM.TIME_DAY:
      return now.getDate();
    case BEATORAJA_NUM.TIME_HOUR:
      return now.getHours();
    case BEATORAJA_NUM.TIME_MINUTE:
      return now.getMinutes();
    case BEATORAJA_NUM.TIME_SECOND:
      return now.getSeconds();
    default:
      return undefined;
  }
}

/**
 * Cached chart duration in seconds for the focused song. The underlying computation walks the
 * full event list + bpm/stop tables; caching keyed by the `BrowserSongEntry` reference (= the
 * chart never changes once loaded) keeps per-frame resolves O(1).
 */
function resolveSongLengthSeconds(song: BrowserSongEntry): number {
  const cached = SONG_LENGTH_CACHE.get(song);
  if (cached !== undefined) return cached;
  const seconds = computeBeatorajaChartTotalSeconds(song.chart);
  SONG_LENGTH_CACHE.set(song, seconds);
  return seconds;
}
const SONG_LENGTH_CACHE = new WeakMap<BrowserSongEntry, number>();

/**
 * Cached note breakdown for the focused song. Same caching pattern as the duration helper —
 * the events scan happens once per song, then per-frame resolves are O(1) lookups.
 */
function resolveNoteBreakdown(song: BrowserSongEntry): NoteBreakdown {
  const cached = NOTE_BREAKDOWN_CACHE.get(song);
  if (cached !== undefined) return cached;
  const breakdown = computeBeatorajaNoteBreakdown(song.chart);
  NOTE_BREAKDOWN_CACHE.set(song, breakdown);
  return breakdown;
}
const NOTE_BREAKDOWN_CACHE = new WeakMap<BrowserSongEntry, NoteBreakdown>();

/** Cached note density (peak / end / avg NPS) for the focused song. */
function resolveDensity(song: BrowserSongEntry): ChartDensity {
  const cached = NOTE_DENSITY_CACHE.get(song);
  if (cached !== undefined) return cached;
  const density = computeBeatorajaChartDensity(song.chart);
  NOTE_DENSITY_CACHE.set(song, density);
  return density;
}
const NOTE_DENSITY_CACHE = new WeakMap<BrowserSongEntry, ChartDensity>();

/**
 * Walk the chart's BPM-change events (channels `03` / `08`) and return the integer min / max
 * BPM. Includes the chart's `metadata.bpm` so a chart that doesn't change BPM still gets a
 * sensible (min === max === main) result. Returns `undefined` when neither metadata BPM nor
 * any change event yields a finite positive number (corrupt / empty chart).
 *
 * Cached per song via WeakMap — the events array is iterated once and reused across frames.
 */
function resolveBpmRange(song: BrowserSongEntry): { min: number; max: number } | undefined {
  const cached = BPM_RANGE_CACHE.get(song);
  if (cached !== undefined) return cached === null ? undefined : cached;
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  const considerBpm = (bpm: number): void => {
    if (!Number.isFinite(bpm) || bpm <= 0) return;
    if (bpm < min) min = bpm;
    if (bpm > max) max = bpm;
  };
  considerBpm(song.chart.metadata.bpm);
  const bpmTable = song.chart.resources?.bpm ?? {};
  for (const event of song.chart.events ?? []) {
    if (event.value === '00' || event.value === '') continue;
    if (event.channel === '03') {
      considerBpm(parseInt(event.value, 16));
    } else if (event.channel === '08') {
      const looked =
        bpmTable[event.value] ?? bpmTable[event.value.toLowerCase()] ?? bpmTable[event.value.toUpperCase()];
      if (typeof looked === 'number') considerBpm(looked);
      else if (typeof looked === 'string') considerBpm(Number.parseFloat(looked));
    }
  }
  if (!Number.isFinite(min) || max <= 0) {
    BPM_RANGE_CACHE.set(song, null);
    return undefined;
  }
  const result = { min: Math.round(min), max: Math.round(max) };
  BPM_RANGE_CACHE.set(song, result);
  return result;
}
const BPM_RANGE_CACHE = new WeakMap<BrowserSongEntry, { min: number; max: number } | null>();

/**
 * `true` when the chart authored at least one stop event (channel `09` in BMS, scaled stop in
 * bmson). Used to fire `HAS_BPMSTOP` (1177). Iterates events linearly — at typical chart sizes
 * (a few thousand events) this is microseconds; the WeakMap-cached `detectChartFeatures` next to
 * it amortises any worst-case cost across the same select-scene tick.
 */
function chartHasStop(song: BrowserSongEntry): boolean {
  const cached = STOP_PRESENCE_CACHE.get(song);
  if (cached !== undefined) return cached;
  const has = (song.chart.events ?? []).some((event) => event.channel === '09');
  STOP_PRESENCE_CACHE.set(song, has);
  return has;
}
const STOP_PRESENCE_CACHE = new WeakMap<BrowserSongEntry, boolean>();

/**
 * Keys-variant string → imageset index for `modeset` (ref 11). Mirrors beatoraja's MainState
 * keymode enum used by the default skin: 0 = ALL_KEYS, 1 = 5K, 2 = 7K, 3 = 10K, 4 = 14K, 5 = 9K,
 * 6 = 24K (not surfaced today), 7 = 24K-DP (not surfaced today). Unknown variants fall back to 0
 * (skins author this slot as "allkeys" / "any").
 */
function keymodeImagesetIndex(variant: '5' | '7' | '9' | '10' | '14' | undefined): number {
  switch (variant) {
    case '5':
      return 1;
    case '7':
      return 2;
    case '10':
      return 3;
    case '14':
      return 4;
    case '9':
      return 5;
    default:
      return 0;
  }
}

/**
 * SkinProperty `MAIN.SLIDER` types relevant to the select scene. Beatoraja's master / key /
 * BGM volume sliders are 17 / 18 / 19. We return a max-position value (1.0 = far end of the
 * slider's authored range) so ModernChic's volume strip shows at "full" — there's no live
 * volume state in the player today, but rendering a slider at 0 (= sprite at home position)
 * looks broken.
 *
 * Lanecover / lift / hispeed sliders (types 4/5/6) aren't relevant on the select scene, but
 * skins occasionally author them anyway; returning `undefined` for those keeps the sprite
 * at its dst-rect home (effectively "off"), matching beatoraja's behavior.
 */
function resolveSelectionSliderValue(type: number): number | undefined {
  switch (type) {
    case 17: // MASTER_VOLUME
    case 18: // KEY_VOLUME
    case 19: // BGM_VOLUME
      return 1;
    default:
      return undefined;
  }
}

/**
 * BMS `#RANK` value (0..4) → matching `BEATORAJA_OP.JUDGE_*` code. Falls back to JUDGE_NORMAL
 * (the standard 7K window) for unknown / missing values, matching beatoraja's own treatment of
 * legacy charts that don't author the header.
 */
function judgeRankOp(rank: number | undefined): number {
  switch (rank) {
    case 0:
      return BEATORAJA_OP.JUDGE_VERYHARD;
    case 1:
      return BEATORAJA_OP.JUDGE_HARD;
    case 3:
      return BEATORAJA_OP.JUDGE_EASY;
    case 4:
      return BEATORAJA_OP.JUDGE_VERYEASY;
    case 2:
    default:
      return BEATORAJA_OP.JUDGE_NORMAL;
  }
}

/**
 * BMS `#DIFFICULTY` value (1..5) → matching `BEATORAJA_OP.LEVEL_*` code. Returns `undefined`
 * when the chart didn't author a difficulty header (a lot of older BMS files omit it) so the
 * caller fires no op and the skin's fallback chrome (or no chrome) shows.
 */
function difficultyLevelOp(difficulty: number | undefined): number | undefined {
  switch (difficulty) {
    case 1:
      return BEATORAJA_OP.LEVEL_BEGINNER;
    case 2:
      return BEATORAJA_OP.LEVEL_NORMAL;
    case 3:
      return BEATORAJA_OP.LEVEL_HYPER;
    case 4:
      return BEATORAJA_OP.LEVEL_ANOTHER;
    case 5:
      return BEATORAJA_OP.LEVEL_INSANE;
    default:
      return undefined;
  }
}

/** Keys-variant string → matching `BEATORAJA_OP.KEYSONG_*` code, or `undefined` for unknown. */
function keysongOpForVariant(variant: '5' | '7' | '9' | '10' | '14' | undefined): number | undefined {
  switch (variant) {
    case '5':
      return BEATORAJA_OP.KEYSONG_5K;
    case '7':
      return BEATORAJA_OP.KEYSONG_7K;
    case '9':
      return BEATORAJA_OP.KEYSONG_9K;
    case '10':
      return BEATORAJA_OP.KEYSONG_10K;
    case '14':
      return BEATORAJA_OP.KEYSONG_14K;
    default:
      return undefined;
  }
}
