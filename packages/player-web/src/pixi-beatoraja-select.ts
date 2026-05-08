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
import { groupSongsByFolder, resolveChartPlayVariant } from './library.ts';
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
  /** Called when the user confirms a song (`Enter` on a song row, or click an already-selected song). */
  onSongPicked: (song: BrowserSongEntry) => void;
  /** Called when the user backs out of the root list (`Escape` at root). */
  onExit?: () => void;
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
    switch (refOp) {
      case BEATORAJA_NUM.TOTALNOTES:
      case BEATORAJA_NUM.TOTALNOTES_LIVE:
        return song.totalNotes;
      case BEATORAJA_NUM.MAINBPM:
      case BEATORAJA_NUM.NOWBPM:
        return song.bpm !== undefined ? Math.round(song.bpm) : undefined;
      // Without a parsed BPM-curve per song we report the same value for min/max — close
      // enough for the value display until the loader exposes the per-chart range.
      case BEATORAJA_NUM.MAXBPM:
      case BEATORAJA_NUM.MINBPM:
        return song.bpm !== undefined ? Math.round(song.bpm) : undefined;
      case BEATORAJA_NUM.PLAYLEVEL:
        return resolvePlayLevel(song.playLevel);
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
