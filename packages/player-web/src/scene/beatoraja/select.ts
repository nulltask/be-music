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
// rows (`select/rows.ts`), the search input (`select/search.ts`) and the focused chart's images and graphs
// (`select/chart-images.ts`).

import { Container, FederatedPointerEvent, Graphics, Sprite, Text, Texture, type Ticker } from 'pixi.js';
import type { ChartPlayVariant } from '@be-music/chart';
import type { BeatorajaSkin, BeatorajaSkinConfig } from '@be-music/beatoraja-skin';
import {
  buildBaseOpSet,
  parseBeatorajaSongList,
  TIMER_SCENE_START,
  TIMER_SONGBAR_CHANGE,
} from '@be-music/beatoraja-skin';
import {
  BEATORAJA_KEYS_FILTERS,
  BEATORAJA_SORTS,
  beatorajaKeyModeIndex,
  beatorajaLnModeIndex,
  beatorajaWallClockOf,
  resolveBeatorajaSelectBarOps,
  resolveBeatorajaSelectNumber,
  resolveBeatorajaSelectRefValue,
  resolveBeatorajaSelectSliderValue,
  resolveBeatorajaSelectText,
  type BeatorajaChartTraits,
  type BeatorajaSelectChartFacts,
  type BeatorajaSelectInput,
  type BeatorajaSystemSoundPaths,
} from '@be-music/beatoraja-skin/scene';
import { BeatorajaPlaySkinView } from './skin-view.ts';
import { BeatorajaSelectChartImages, type BeatorajaSelectChartImagesContext } from './select/chart-images.ts';
import { BeatorajaSelectRows, type BeatorajaSelectRowsContext } from './select/rows.ts';
import { BeatorajaSelectSearch, songMatchesQuery, type BeatorajaSelectSearchContext } from './select/search.ts';
import type { BeatorajaTextureCache } from '../../skin/beatoraja/textures.ts';
import type { BeatorajaFontCache } from '../../skin/beatoraja/fonts.ts';
import type { BeatorajaSkinAudio } from '../../skin/beatoraja/audio.ts';
import type { PixiScene, PixiSceneHost } from '../host.ts';
import { computeBeatorajaChartDensity, type ChartDensity } from '../../chart/beatoraja/density.ts';
import { computeBeatorajaChartTotalSeconds } from '../../chart/beatoraja/duration.ts';
import { extractChartSubartist } from '../../chart/beatoraja/meta.ts';
import { computeBeatorajaNoteBreakdown, type NoteBreakdown } from '../../chart/beatoraja/note-counts.ts';
import { groupSongsByFolder, resolveChartPlayVariant, resolveSongSource } from '../../collection/collection.ts';
import { resolveLr2ChartFeatures } from '@be-music/lr2-skin/state';
import { ChartPreviewEngine } from '../../chart/preview.ts';
import type {
  BrowserBrowseEntry,
  BrowserCourseEntry,
  BrowserFolderNode,
  BrowserSongEntry,
} from '../../collection/types.ts';
import { masterOutput } from '../../runtime/master-volume.ts';

export interface PixiBeatorajaSelectSceneOptions {
  skin: BeatorajaSkin;
  /**
   * The host edits the search query in its own text field (with IME) and passes it in through
   * {@link PixiBeatorajaSelectScene.setSearchQuery}: the scene then leaves `/` and typed keys to that field instead of
   * running its own key-by-key search mode.
   */
  externalSearch?: boolean;
  textures: BeatorajaTextureCache;
  /** Optional skin TTF cache (`loadBeatorajaFonts`). Absent → platform sans-serif fallback. */
  fonts?: BeatorajaFontCache;
  /** Confirmed user picks for the skin's `property[]`. */
  skinConfig?: BeatorajaSkinConfig;
  /** Songs to choose from. Empty array → "no songs" placeholder. */
  songs: ReadonlyArray<BrowserSongEntry>;
  /** Course folders, listed after the song folders at the root (see `resolveCourseFolders`). */
  courseFolders?: ReadonlyArray<BrowserFolderNode>;
  /**
   * The player started a course bar. A course with a stage missing from the collection (`playable: false`) is handed
   * over too, so the host can say why it does not start. `autoPlay` is set when AUTO PLAY (act 16) started it: every
   * stage plays itself.
   */
  onCoursePicked?: (course: BrowserCourseEntry, options?: { autoPlay?: boolean }) => void;
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
  /** Optional audio backend for `main_state.audio_play / loop / stop` Lua calls. */
  skinAudio?: BeatorajaSkinAudio;
  /**
   * Optional lookup that returns the focused song's clear-lamp op (one of
   * `BEATORAJA_OP.CLEAR_LAMP_*`). When omitted, every song reports as `CLEAR_LAMP_NOPLAY`
   * (= 100), which makes the song-list lamp icon always render the "no record" frame —
   * audit 2.18.
   *
   * Hosts that track in-session play history (the demo does, keyed by `BrowserSongEntry.id`)
   * supply the callback to light the lamp icon based on actual completed runs. The lookup is
   * called on every frame for the focused entry only — caching at the host's discretion.
   * Folder rows pass through unchanged (the lamp op is a song-bar concept).
   */
  resolveSongLampOp?: (song: BrowserSongEntry) => number | undefined;
  /**
   * The focused course bar's clear-lamp op (`BEATORAJA_OP.CLEAR_LAMP_*`), from the player's best record on the course, as
   * beatoraja lights a `GradeBar`'s lamp from its course score. Omitted (or `undefined`) reads as `CLEAR_LAMP_NOPLAY`;
   * a random course bar has no record.
   */
  resolveCourseLampOp?: (course: BrowserCourseEntry) => number | undefined;
  /**
   * Optional song collection — the same `BrowserSongCollection` the demo built `songs` from.
   * Required only for the chart-preview engine: `ChartPreviewEngine.focus()` needs to resolve
   * each song's `BrowserSongAssetSource` to load the `#PREVIEW` file (or fall back to in-place
   * chart playback). When omitted, the preview engine stays inactive — the select scene runs
   * silent on cursor moves, same as before this option existed.
   */
  collection?: import('../../collection/types.ts').BrowserSongCollection;
  /**
   * Optional system-sound paths for navigation cues. Each value is a bundle-relative path
   * (e.g. `'sound/cursor.wav'`) that {@link skinAudio} resolves through its file map and
   * decodes lazily. The scene fires the matching path on these events:
   *
   *   - `cursor` — every cursor advance (ArrowUp / ArrowDown / PageUp / PageDown / Home / End
   *     / wheel / mouse-click on a non-focused row).
   *   - `folderOpen` — drilling into a folder bar via Enter / click.
   *   - `folderClose` — backing out via Escape / Backspace.
   *   - `decide` — confirming a song bar (Enter / click on focused / autoplay button).
   *   - `optionChange` — sort cycle (act=12) / keymode filter cycle (act=11).
   *   - `cancel` — back-navigation when not in a folder (root-level ESC).
   *
   * Missing entries are silently skipped — themes that don't ship a particular cue just don't
   * play it. Requires {@link skinAudio} to also be supplied; without an audio backend the
   * paths are unreferenced and the scene runs silent on navigation.
   *
   * Hosts should discover the paths from the theme bundle (e.g. probe `sound/cursor.wav`,
   * `sound/decide.wav` etc. against the bundle's file map) and pass whatever they found.
   * Beatoraja itself reads these paths from its `config.json` keys (`sound_cursor`,
   * `sound_select`, `sound_cancel`, `sound_folder`) — the same convention the demo follows.
   */
  systemSoundPaths?: BeatorajaSystemSoundPaths;
  /**
   * Optional bundle-relative path to a looping select-scene BGM (typically `Bgm/select.wav`).
   * When supplied, the scene starts the loop in {@link enter} and stops it in {@link exit} via
   * the {@link skinAudio} backend. Routed through the same `BeatorajaSkinAudioPlayer` the Lua
   * audio_loop / audio_play calls use so a single AudioContext serves both.
   *
   * Discovered by hosts via {@link discoverBeatorajaSelectBgmPath}; pass the result verbatim
   * (or `undefined` for a silent select). Beatoraja's reference engine stores the path in
   * `config.json` `bgm_select`; the web port uses convention-based probing instead.
   *
   * Volume is fixed at `0.7` — quieter than authored to leave headroom for chart preview
   * playback (the preview engine doesn't currently duck the BGM, so a too-loud loop drowns
   * out short preview clips). Future ducking would multiply this by an in-flight factor.
   */
  selectBgmPath?: string;
  /**
   * Optional snapshot from a previous mount — restores the user's prior cursor / folder /
   * filter / sort / favorite state when re-entering the select scene (e.g. after returning
   * from a play). Captured via {@link PixiBeatorajaSelectScene.captureSnapshot} on the
   * outgoing scene before disposal; passed verbatim into the next mount's options. Takes
   * precedence over {@link initialIndex} when both are set — snapshot already encodes the
   * cursor's full position (including which folder the user was in), and `initialIndex`
   * alone can't disambiguate between "song N of root" vs "song N of folder X".
   *
   * Folder identity is preserved by `label` (folder names are stable across mounts as long
   * as the underlying `BrowserSongCollection` hasn't been reshuffled). When the new
   * collection no longer contains a folder by that label (the user dropped a different
   * library), the restore falls back to the root list with cursor 0 — a safe default that
   * doesn't crash when stale state outlives its source.
   */
  restoreSnapshot?: PixiBeatorajaSelectSceneSnapshot;
  /**
   * Optional decoder for the focused song's chart-bitmap synthetic ids. The scene calls
   * this on every focus change; the host returns a Promise resolving to whichever bitmaps
   * the chart shipped (`#STAGEFILE` / `#BACKBMP` / `#BANNER`). Decoded textures cache
   * inside the scene by `song.id` so subsequent re-focuses skip the IO.
   *
   * Without this, destinations referencing the synthetic ids `-100` / `-101` / `-102`
   * stay hidden — default beatoraja's select.json paints `-102 BANNER` as the focused
   * song's banner inside the chart-info panel, ModernChic uses `-100 STAGEFILE` as a
   * frosted backdrop, etc.
   */
  decodeChartImages?: (song: BrowserSongEntry) => Promise<{ stageFile?: Texture; backBmp?: Texture; banner?: Texture }>;
}

/**
 * Serializable scene state captured at scene-exit for restoration on the next mount. The host
 * persists this opaquely (no field-by-field interpretation needed); the scene re-applies it on
 * the next constructor call. All references are by VALUE — ids and labels rather than object
 * pointers — so the snapshot survives `BrowserSongCollection` rebuilds (drop a new library and
 * the snapshot still applies as long as the same folder labels / song ids exist).
 */
export interface PixiBeatorajaSelectSceneSnapshot {
  /** Folder labels in nesting order. Empty = at root. */
  folderPath: ReadonlyArray<string>;
  /** Cursor index per stack depth. `[rootIdx]` at root, `[rootIdx, songIdxInFolder]` one deep. */
  cursorStack: ReadonlyArray<number>;
  /** Active keymode filter (act=11 MODE button cycle). 0 = ALL. */
  keymodeFilter: number;
  /** Active sort mode (act=12 SORT button cycle). 0 = DEFAULT. */
  sortMode: number;
  /**
   * Global LN-mode override (act=308 LNMODE button cycle). `undefined` = use the chart's
   * authored `#LNMODE`; `0..2` = user override (LN / CN / HCN).
   */
  lnModeOverride: 0 | 1 | 2 | undefined;
  /** `BrowserSongEntry.id`s the user marked as song-level favorites. */
  favoriteSongs: ReadonlyArray<string>;
  /** `BrowserSongEntry.id`s the user marked as chart-level favorites. */
  favoriteCharts: ReadonlyArray<string>;
  /**
   * Live search query. Survives PLAY → SELECT round-trips so the user lands back on the
   * same filtered list. Empty string = no filter (the typical case when the user hasn't
   * touched search). The active-input flag isn't persisted — coming back from gameplay
   * always starts in non-input mode so the user can navigate immediately.
   */
  searchQuery: string;
}

/**
 * How long a `BUTTON_*` op stays active after a click fires (audit 2.1). 200ms is long
 * enough for the player to perceive the press-state highlight in skins that author short
 * "press feedback" tweens, short enough that subsequent clicks don't pile up if the user
 * mashes a button. Beatoraja itself gates press feedback on Java's input-frame state which
 * lasts a single frame; our 200ms window gives smooth animation under a 60fps tick.
 */
const BUTTON_PRESS_WINDOW_MS = 200;

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
  BeatorajaSelectChartImagesContext;

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
      skinConfigOps: this.baseOps(),
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
    this.cachedBaseOps = undefined;

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
      skinConfigOps: this.baseOps(),
      resolveTextContent: (refOp) => this.resolveSelectionText(refOp),
      resolveNumberValue: (refOp) => this.resolveSelectionNumber(refOp),
      resolveRefValue: (refOp) => this.resolveSelectionRefValue(refOp),
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
    this.frameInput = undefined;
    this.frameInput = this.selectInput();
    this.view.update({
      activeOps: this.computeActiveOps(),
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
    this.frameInput = undefined;
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
   * Transient BUTTON-press tracker (audit 2.1). Maps each clicked `act` code to the
   * `performance.now()` timestamp at which the press happened. `computeActiveOps` adds the
   * code to the active op set while it's still within {@link BUTTON_PRESS_WINDOW_MS}, so
   * skins gating press-state chrome on the matching op see the highlight in flight. Older
   * entries get garbage-collected lazily during op resolution; the map stays bounded since
   * the user can only click so many buttons per second.
   */
  private readonly buttonPressedAt = new Map<number, number>();

  /**
   * Per-frame active op set: the stable base ops, the focused bar's ops and the buttons pressed a moment ago. Without
   * the bar's ops the info pane stays hidden: its destinations are gated on `op:[2]` (`SONGBAR`).
   */
  private computeActiveOps(): ReadonlySet<number> {
    const base = this.baseOps();
    // Fast path: no active entry → just the base set (includes `skin_config.option` picks).
    const entry = this.entries[this.currentIndex];
    if (entry === undefined) return base;

    const ops = new Set(base);
    // The bar's ops: the screen's fixed state, and the folder, course or chart bar with its key mode, traits,
    // difficulty, judge rank and clear lamp (`resolveBeatorajaSelectBarOps`).
    for (const op of resolveBeatorajaSelectBarOps(this.selectInput())) ops.add(op);

    // Transient BUTTON-press feedback (audit 2.1). Each `act` code clicked within the last
    // `BUTTON_PRESS_WINDOW_MS` lights its matching op so destinations gating press-state
    // chrome on `op = {act}` show their pressed visual. GC stale entries lazily — the map's
    // size is bounded by user-click rate, which can never exceed ~10/sec.
    if (this.buttonPressedAt.size > 0) {
      const now = performance.now();
      for (const [act, pressedAtMs] of this.buttonPressedAt) {
        if (now - pressedAtMs >= BUTTON_PRESS_WINDOW_MS) {
          this.buttonPressedAt.delete(act);
          continue;
        }
        ops.add(act);
      }
    }
    return ops;
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
   * What the skin reads of the screen (`@be-music/beatoraja-skin/scene`): the focused bar and its chart's facts, the
   * folder, the search, the MODE / SORT / LNMODE choices, the skin, the judge timing, the bar's best lamp and the clock.
   * Built once per frame in {@link tick}; read through it for every value, text and image of the frame.
   */
  private selectInput(): BeatorajaSelectInput {
    if (this.frameInput !== undefined) return this.frameInput;
    const entry = this.entries[this.currentIndex];
    const offset = this.options.skinConfig?.offset;
    const lampOp =
      entry?.kind === 'song'
        ? this.options.resolveSongLampOp?.(entry.song)
        : entry?.kind === 'course' && entry.course.random === undefined
          ? this.options.resolveCourseLampOp?.(entry.course)
          : undefined;
    return {
      focused: entry,
      ...(entry?.kind === 'song' ? { chart: selectChartFacts(entry.song) } : {}),
      folderLabel: this.currentFolderLabel(),
      searchText: this.searchQuery,
      list: {
        keysFilter: BEATORAJA_KEYS_FILTERS[this.keymodeFilter] ?? 'ALL',
        sort: BEATORAJA_SORTS[this.sortMode] ?? 'OFF',
      },
      ...(this.lnModeOverride !== undefined ? { lnMode: this.lnModeOverride } : {}),
      skin: { name: this.options.skin.name, author: this.options.skin.author },
      judgeTiming: typeof offset === 'number' && Number.isFinite(offset) ? offset : 0,
      ...(lampOp !== undefined ? { lampOp } : {}),
      wallClock: beatorajaWallClockOf(new Date()),
    };
  }

  /** The frame's {@link selectInput}, while `tick` draws it. */
  private frameInput: BeatorajaSelectInput | undefined;

  private resolveSelectionText(refOp: number): string | undefined {
    return resolveBeatorajaSelectText(refOp, this.selectInput());
  }

  private resolveSelectionNumber(refOp: number): number | undefined {
    return resolveBeatorajaSelectNumber(refOp, this.selectInput());
  }

  private resolveSelectionRefValue(refOp: number): number {
    return resolveBeatorajaSelectRefValue(refOp, this.selectInput());
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
    this.buttonPressedAt.set(act, performance.now());
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
 * `resolveChartPlayVariant` walks the chart's events / metadata to classify keys mode. On a
 * malformed entry it can throw; a per-frame op-set computation must never throw, so we wrap
 * with a try/catch and fall back to `undefined` (= no `KEYSONG_*` op set, "modeless" bar).
 */
function safeResolveChartVariant(song: BrowserSongEntry): ChartPlayVariant | undefined {
  try {
    return resolveChartPlayVariant(song);
  } catch {
    return undefined;
  }
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
 * What the skin reads of a chart bar beyond its library entry (`BeatorajaSelectChartFacts`), kept per chart. The facts
 * that walk the chart (traits, note kinds, densities, length, BPM range) are read the first time a skin asks for them.
 */
function selectChartFacts(song: BrowserSongEntry): BeatorajaSelectChartFacts {
  let facts = SELECT_CHART_FACTS.get(song);
  if (facts === undefined) {
    const meta = song.chart.metadata;
    let traits: BeatorajaChartTraits | undefined;
    const playVariant = safeResolveChartVariant(song);
    facts = {
      ...(playVariant !== undefined ? { playVariant } : {}),
      get traits(): BeatorajaChartTraits {
        if (traits === undefined) {
          const features = resolveLr2ChartFeatures(song.chart);
          traits = {
            longNote: features.longNote,
            bga: features.bga,
            bpmChange: features.bpmChange,
            random: features.random,
            stop: chartHasStop(song),
            stageFile: Boolean(meta.stageFile),
            banner: Boolean(meta.banner),
            backBmp: Boolean(meta.backBmp),
          };
        }
        return traits;
      },
      ...(meta.difficulty !== undefined ? { difficulty: meta.difficulty } : {}),
      ...(meta.rank !== undefined ? { judgeRank: meta.rank } : {}),
      ...(typeof meta.total === 'number' ? { total: meta.total } : {}),
      ...(song.chart.bms?.lnMode !== undefined ? { lnMode: song.chart.bms.lnMode } : {}),
      get subartist(): string {
        return extractChartSubartist(song.chart);
      },
      get noteBreakdown(): NoteBreakdown {
        return resolveNoteBreakdown(song);
      },
      get density(): ChartDensity {
        return resolveDensity(song);
      },
      get lengthSeconds(): number {
        return resolveSongLengthSeconds(song);
      },
      get bpmRange(): { min: number; max: number } | undefined {
        return resolveBpmRange(song);
      },
    };
    SELECT_CHART_FACTS.set(song, facts);
  }
  return facts;
}
const SELECT_CHART_FACTS = new WeakMap<BrowserSongEntry, BeatorajaSelectChartFacts>();

/**
 * `true` when the chart authored at least one stop event (channel `09` in BMS, scaled stop in
 * bmson). Used to fire `HAS_BPMSTOP` (1177). Iterates events linearly — at typical chart sizes
 * (a few thousand events) this is microseconds; the WeakMap-cached `resolveLr2ChartFeatures` next to
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

/** Whether a key event comes from a text field, where keys type rather than steer the list. */
function isEditableKeyTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'range'].includes(target.type);
}
