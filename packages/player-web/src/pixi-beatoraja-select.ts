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
//   - **List background** — a semi-transparent rounded panel sits behind the row labels with a
//     brighter highlight on the selected row, so the list reads against arbitrarily-busy skin
//     chrome backgrounds.
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
import { BEATORAJA_TEXT, buildBaseOpSet } from '@be-music/beatoraja-skin';
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

/** Visual constants for the row backdrops + labels. */
const PANEL_PADDING_X = 14;
const PANEL_PADDING_Y = 12;
const PANEL_RADIUS = 10;
const ROW_RADIUS = 6;
const ROW_BG_ALPHA = 0.32;
const ROW_BG_HIGHLIGHT_ALPHA = 0.78;
const ROW_BG_FOLDER_TINT = 0x1d2c46;
const ROW_BG_SONG_TINT = 0x14202f;
const ROW_BG_HIGHLIGHT_TINT = 0xffe066;
const PANEL_BG_TINT = 0x000000;
const PANEL_BG_ALPHA = 0.55;

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
  /** Semi-transparent rounded panel behind every row, painted before the per-row backgrounds. */
  private readonly listPanel = new Graphics();
  /** Per-row backgrounds (highlight when selected). `rowBackgrounds.length === VISIBLE_ROW_COUNT`. */
  private readonly rowBackgrounds: Graphics[] = [];
  /** Per-row label texts. Same length as {@link rowBackgrounds}. */
  private readonly rowLabels: Text[] = [];
  /** Per-row "kind icon" texts (folder ▸ vs song ♪). Length matches {@link rowLabels}. */
  private readonly rowKindIcons: Text[] = [];
  /** Per-row sub-label (artist / song count). Length matches {@link rowLabels}. */
  private readonly rowSublabels: Text[] = [];
  /** Per-row click hit area. Sized to the row backdrop on layout. */
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
      resolveFontFamily: options.fonts ? (id) => options.fonts!.family(id) : undefined,
      resolveFontKind: options.fonts ? (id) => options.fonts!.kind(id) : undefined,
    });

    this.root.addChild(this.backdrop);
    this.root.addChild(this.view.container);
    this.listLayer.eventMode = 'static';
    this.root.addChild(this.listLayer);
    this.listLayer.addChild(this.listPanel);

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
    // Treat every timer as fired at scene start so the skin's load-fade-in / animations play out.
    // No engine is running here so the only "clock" the skin can react to is this static scene
    // tick — `getTimerStart() => 0` makes every authored timer fire from t=0.
    this.view.update({
      activeOps: this.baseOps(),
      getTimerStart: () => 0,
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
      // Background — drawn first so the labels paint on top.
      const bg = new Graphics();
      this.listLayer.addChild(bg);
      this.rowBackgrounds.push(bg);

      // Hit area sprite — invisible but interactive. Sized to match the row backdrop.
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
    // toward `currentIndex`, every row's index slides by the same amount.
    const centreEntry = this.scrollPosition;
    for (let i = 0; i < VISIBLE_ROW_COUNT; i += 1) {
      const entryIndex = Math.round(centreEntry) + (i - CENTRE_ROW_INDEX);
      const entry = entryIndex >= 0 && entryIndex < total ? this.entries[entryIndex] : undefined;
      const bg = this.rowBackgrounds[i]!;
      const icon = this.rowKindIcons[i]!;
      const label = this.rowLabels[i]!;
      const sub = this.rowSublabels[i]!;
      const hit = this.rowHitAreas[i]!;
      if (entry === undefined) {
        bg.visible = false;
        icon.visible = false;
        label.visible = false;
        sub.visible = false;
        hit.visible = false;
        continue;
      }
      const isSelected = entryIndex === this.currentIndex;
      bg.visible = true;
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

    // Right-half panel for the song bar list. The reference theme typically authors the song
    // strip across the right ~40 % of the canvas; we mirror that.
    const panelLeft = Math.floor(width * 0.5);
    const panelRight = Math.floor(width * 0.97);
    const panelWidth = Math.max(120, panelRight - panelLeft);
    const panelTop = Math.floor(height * 0.06);
    const panelBottom = Math.floor(height * 0.94);
    const panelHeight = Math.max(120, panelBottom - panelTop);
    const rowHeight = Math.max(28, Math.floor((panelHeight - PANEL_PADDING_Y * 2) / VISIBLE_ROW_COUNT));

    this.listPanel
      .clear()
      .roundRect(panelLeft, panelTop, panelWidth, panelHeight, PANEL_RADIUS)
      .fill({ color: PANEL_BG_TINT, alpha: PANEL_BG_ALPHA });

    const rowLeft = panelLeft + PANEL_PADDING_X;
    const rowWidth = panelWidth - PANEL_PADDING_X * 2;
    // Fractional cursor offset (the scroll tween's residual). Pixels to slide every row by so
    // an in-flight tween shows a sub-row scroll instead of jumping a whole row at the snap.
    const fractional = this.scrollPosition - Math.round(this.scrollPosition);
    const baseY = panelTop + PANEL_PADDING_Y + rowHeight / 2 - fractional * rowHeight;

    for (let i = 0; i < VISIBLE_ROW_COUNT; i += 1) {
      const bg = this.rowBackgrounds[i]!;
      const hit = this.rowHitAreas[i]!;
      const icon = this.rowKindIcons[i]!;
      const label = this.rowLabels[i]!;
      const sub = this.rowSublabels[i]!;
      if (!bg.visible) continue;
      const rowCentreY = baseY + (i - CENTRE_ROW_INDEX) * rowHeight;
      const rowTop = rowCentreY - rowHeight / 2 + 2;
      const rowH = rowHeight - 4;

      const isSelected = i === CENTRE_ROW_INDEX;
      const entryIndex = Math.round(this.scrollPosition) + (i - CENTRE_ROW_INDEX);
      const entry = this.entries[entryIndex];
      const baseTint = entry?.kind === 'folder' ? ROW_BG_FOLDER_TINT : ROW_BG_SONG_TINT;
      const tint = isSelected ? ROW_BG_HIGHLIGHT_TINT : baseTint;
      const alpha = isSelected ? ROW_BG_HIGHLIGHT_ALPHA : ROW_BG_ALPHA;
      bg.clear().roundRect(rowLeft, rowTop, rowWidth, rowH, ROW_RADIUS).fill({ color: tint, alpha });

      hit.x = rowLeft;
      hit.y = rowTop;
      hit.width = rowWidth;
      hit.height = rowH;
      hit.hitArea = null; // sprite bounds are the hit area when null

      const iconX = rowLeft + 12;
      icon.x = iconX;
      icon.y = rowCentreY;
      icon.tint = isSelected ? 0x000000 : 0xffffff;

      const labelX = iconX + 24;
      label.x = labelX;
      label.y = rowCentreY - 2;
      label.tint = isSelected ? 0x000000 : 0xffffff;

      sub.x = labelX;
      sub.y = rowCentreY + (label.style.fontSize as number) * 0.55;
      sub.tint = isSelected ? 0x222222 : 0xc0d0ff;
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
    // Translate visible-row index into an entry index against the current scroll state. Use
    // `Math.round(this.scrollPosition)` so a click during a scroll-tween still lands on the
    // entry currently displayed in that row.
    const entryIndex = Math.round(this.scrollPosition) + (rowOffset - CENTRE_ROW_INDEX);
    if (entryIndex < 0 || entryIndex >= this.entries.length) return;
    if (entryIndex !== this.currentIndex) {
      // First click: move cursor. Second click on the same row will enter / pick.
      this.currentIndex = entryIndex;
      this.refreshRowVisuals();
      return;
    }
    this.activateCurrentEntry();
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

  private moveCursor(delta: number): void {
    if (this.entries.length === 0) return;
    const next = clampIndex(this.currentIndex + delta, this.entries.length);
    if (next === this.currentIndex) return;
    this.currentIndex = next;
    // Don't reset scrollPosition — let the tween pick it up.
    this.refreshRowVisuals();
  }

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
