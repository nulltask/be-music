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
import type { BeatorajaSkin, BeatorajaSkinConfig } from '@be-music/beatoraja-skin';
import { BEATORAJA_NUM, BEATORAJA_TEXT, buildBaseOpSet } from '@be-music/beatoraja-skin';
import { BeatorajaPlaySkinView } from './pixi-beatoraja-skin-view.ts';
import type { BeatorajaTextureCache } from './beatoraja-textures.ts';
import type { BeatorajaFontCache } from './beatoraja-fonts.ts';
import type { PixiScene, PixiSceneHost } from './pixi-scene-host.ts';
import { groupSongsByFolder } from './library.ts';
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

/** Number of rows visible in the overlay list at once (odd so the cursor sits on the centre). */
const VISIBLE_ROW_COUNT = 13;
const CENTRE_ROW_INDEX = Math.floor(VISIBLE_ROW_COUNT / 2);

/**
 * Per-frame tween rate for `scrollPosition` chasing `currentIndex`. Fraction of the remaining
 * delta closed each frame at 60 Hz — `0.25` lands inside ~150 ms which feels responsive without
 * looking jumpy. We snap to the integer once the gap drops below `SCROLL_SNAP_THRESHOLD` so the
 * position doesn't asymptotically wander.
 */
const SCROLL_TWEEN_RATE = 0.25;
const SCROLL_SNAP_THRESHOLD = 0.005;

/** Padding inside the list overlay area. Drives the row layout math. */
const PANEL_PADDING_X = 14;

/**
 * Per-row vertical span in screen pixels. Beatoraja's reference + GdbG `bar-select`
 * destinations sit around 75px tall in a 1080-tall skin canvas, giving roughly 56px on a 1×
 * letterboxed render at 1080p. We pin this to a fixed screen-pixel value rather than deriving
 * from canvas height — the labels are screen-space `Text` nodes whose font size doesn't scale
 * with canvas resolution, so an auto-derived `panelHeight / VISIBLE_ROW_COUNT` ballooned to
 * ~146px on 4K displays and made the list dominate the chrome.
 */
const ROW_HEIGHT_PX = 56;

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
  private readonly listLayer = new Container();
  /** Per-row label texts. */
  private readonly rowLabels: Text[] = [];
  /** Per-row "kind icon" texts (folder ▸ vs song ♪). Length matches {@link rowLabels}. */
  private readonly rowKindIcons: Text[] = [];
  /** Per-row sub-label (artist / song count). Length matches {@link rowLabels}. */
  private readonly rowSublabels: Text[] = [];
  /** Per-row click hit area. Sized to the row's text band on layout. */
  private readonly rowHitAreas: Sprite[] = [];

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
    this.listLayer.eventMode = 'static';
    this.root.addChild(this.listLayer);

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
    // The root currently holds [backdrop, oldView (destroyed), listLayer]. Re-add the new view
    // BETWEEN backdrop and listLayer so the layering stays correct (skin chrome behind the list).
    this.root.removeChild(this.listLayer);
    this.root.addChild(this.view.container);
    this.root.addChild(this.listLayer);

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
      activeOps: this.baseOps(),
      getTimerStart: () => undefined,
      nowMs: elapsed,
    });
  }

  private baseOps(): ReadonlySet<number> {
    if (this.cachedBaseOps !== undefined) return this.cachedBaseOps;
    this.cachedBaseOps = buildBaseOpSet(this.options.skinConfig?.option);
    return this.cachedBaseOps;
  }
  private cachedBaseOps: ReadonlySet<number> | undefined;

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

  // ─── Visuals ──────────────────────────────────────────────────────────────────────────────────

  private buildRowVisuals(fonts: BeatorajaFontCache | undefined): void {
    const skinFamily = fonts?.values()[0]?.family;
    const fontFamily = skinFamily !== undefined ? `'${skinFamily}', sans-serif` : 'sans-serif';
    for (let i = 0; i < VISIBLE_ROW_COUNT; i += 1) {
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
        style: { fontFamily, fontSize: 18, fill: 0xffffff, fontWeight: '600' },
      });
      icon.anchor.set(0, 0.5);
      this.listLayer.addChild(icon);
      this.rowKindIcons.push(icon);

      // Primary label — title (song) / folder name (folder).
      const label = new Text({
        text: '',
        style: { fontFamily, fontSize: 18, fill: 0xffffff, fontWeight: '600' },
      });
      label.anchor.set(0, 0.5);
      this.listLayer.addChild(label);
      this.rowLabels.push(label);

      // Sub-label — artist (song) / song count (folder). Smaller, fainter.
      const sub = new Text({
        text: '',
        style: { fontFamily, fontSize: 13, fill: 0xc0d0ff, fontStyle: 'italic' },
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
    // entry shows the LAST entry and vice versa. (After a wrap-jump in `moveCursor`,
    // `scrollPosition` may sit transiently outside the range; the modulo here keeps the
    // displayed entries consistent across the boundary.)
    const centreEntry = this.scrollPosition;
    for (let i = 0; i < VISIBLE_ROW_COUNT; i += 1) {
      const rawEntryIndex = Math.round(centreEntry) + (i - CENTRE_ROW_INDEX);
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
      // Highlight the centred visible row (matches `layoutRows`'s tint logic). Like a music
      // picker wheel — the highlight stays put while songs scroll past it. Using "row matches
      // currentIndex" instead would make the highlight LEAD the tween, which looks like the
      // selected song teleports across rows mid-scroll.
      const isSelected = i === CENTRE_ROW_INDEX;
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
      label.style.fontSize = isSelected ? 22 : 17;
      sub.alpha = isSelected ? 0.95 : 0.55;
    }
    this.layoutRows();
  }

  /**
   * Position + size the row visuals against the current canvas. Recomputes on every `fitToStage`
   * call AND every visual refresh so a smooth-scroll mid-frame keeps the rows in sync (the
   * `scrollPosition` fractional drift is folded into the row Y offsets here).
   */
  private layoutRows(): void {
    const host = this.host;
    if (!host) return;
    const { width, height } = host.app.screen;
    if (width <= 0 || height <= 0) return;

    // Right-half overlay for the song bar list. No panel rectangle is painted any more — the
    // skin's authored chrome (banner / song-bar artwork / chart info) is what the user wants
    // to see; an opaque overlay panel was hiding that. The list area's bounds still drive
    // row positioning so the labels stay grouped on the right side of the canvas.
    //
    // Vertical anchor: GdbG_Skin authors `bar-select` at `y = 670, h = 75` in a 1080-tall skin
    // canvas (Pixi y ≈ 373 — slightly above geometric centre, which feels right for a song
    // bar list). We want the focused row to land near that visual zone. Centring at
    // `height * 0.42` is close enough to a 1080-canvas's authored 373 / 1080 ≈ 0.345 ratio
    // while staying readable on shorter / taller viewports.
    const panelLeft = Math.floor(width * 0.5);
    const panelRight = Math.floor(width * 0.97);
    const panelWidth = Math.max(120, panelRight - panelLeft);
    const focusedRowCentreY = Math.floor(height * 0.42);
    const rowHeight = ROW_HEIGHT_PX;

    const rowLeft = panelLeft + PANEL_PADDING_X;
    const rowWidth = panelWidth - PANEL_PADDING_X * 2;
    // Fractional cursor offset (the scroll tween's residual). Pixels to slide every row by so
    // an in-flight tween shows a sub-row scroll instead of jumping a whole row at the snap.
    // `baseY` is the focused-row centre Y (where row `CENTRE_ROW_INDEX` lands). Other rows
    // fan out via `(i - CENTRE_ROW_INDEX) * rowHeight`.
    const fractional = this.scrollPosition - Math.round(this.scrollPosition);
    const baseY = focusedRowCentreY - fractional * rowHeight;

    for (let i = 0; i < VISIBLE_ROW_COUNT; i += 1) {
      const hit = this.rowHitAreas[i]!;
      const icon = this.rowKindIcons[i]!;
      const label = this.rowLabels[i]!;
      const sub = this.rowSublabels[i]!;
      if (!label.visible) continue;
      const rowCentreY = baseY + (i - CENTRE_ROW_INDEX) * rowHeight;
      const rowTop = rowCentreY - rowHeight / 2 + 2;
      const rowH = rowHeight - 4;

      const isSelected = i === CENTRE_ROW_INDEX;

      hit.x = rowLeft;
      hit.y = rowTop;
      hit.width = rowWidth;
      hit.height = rowH;
      hit.hitArea = null; // sprite bounds are the hit area when null

      const iconX = rowLeft + 12;
      icon.x = iconX;
      icon.y = rowCentreY;
      // No backdrop now — selected row uses a warm yellow tint to stand out against
      // arbitrarily-coloured skin chrome; non-selected stays plain white.
      icon.tint = isSelected ? 0xffe066 : 0xffffff;

      const labelX = iconX + 24;
      label.x = labelX;
      label.y = rowCentreY - 2;
      label.tint = isSelected ? 0xffe066 : 0xffffff;

      sub.x = labelX;
      sub.y = rowCentreY + (label.style.fontSize as number) * 0.55;
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
    const rawIndex = Math.round(this.scrollPosition) + (rowOffset - CENTRE_ROW_INDEX);
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
