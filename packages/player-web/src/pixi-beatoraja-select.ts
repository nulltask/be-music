// Beatoraja-skinned song select scene.
//
// Mounts a `BeatorajaPlaySkinView` against a select-format skin (`type = 5`, parsed from
// `select.json` / `selectmain.lua`) and adds:
//
//   - A song-bar overlay listing the dropped collection's songs as Pixi `Text` nodes. The current
//     selection is centered; surrounding songs scroll past as the user navigates. This is a
//     deliberately-simple list — beatoraja's reference skin uses a per-state `songbar` declaration
//     with clear-lamp icons and folder bars; mirroring that requires resolving `bar[]` / `value[]` /
//     image-ref state we haven't wired yet, so we paint plain text on top of the skin chrome.
//   - A `text[].ref` resolver that surfaces the *currently-highlighted* song's title / artist /
//     genre / etc. (not "the chart being played" as in the gameplay path). The skin's chrome panels
//     therefore reflect the selection live.
//   - Keyboard navigation: `ArrowUp` / `ArrowDown` move the selection, `Enter` picks, `Escape` exits.
//
// What's deferred for a later patch:
//   - Folder browsing (`groupSongsByFolder` + folder-bar rendering)
//   - Per-song clear-lamp / score state via `value[].ref` codes
//   - Preview audio (LR2 path's `playSelectBgm` doesn't yet have a beatoraja parallel)
//   - Search / sort / random song picks

import { Container, Graphics, Text, type Ticker } from 'pixi.js';
import type { BeatorajaSkin, BeatorajaSkinConfig } from '@be-music/beatoraja-skin';
import { BEATORAJA_TEXT, buildBaseOpSet } from '@be-music/beatoraja-skin';
import { BeatorajaPlaySkinView } from './pixi-beatoraja-skin-view.ts';
import type { BeatorajaTextureCache } from './beatoraja-textures.ts';
import type { BeatorajaFontCache } from './beatoraja-fonts.ts';
import type { PixiScene, PixiSceneHost } from './pixi-scene-host.ts';
import type { BrowserSongEntry } from './types.ts';

export interface PixiBeatorajaSelectSceneOptions {
  skin: BeatorajaSkin;
  textures: BeatorajaTextureCache;
  /** Optional skin TTF cache (`loadBeatorajaFonts`). Absent → platform sans-serif fallback. */
  fonts?: BeatorajaFontCache;
  /** Confirmed user picks for the skin's `property[]`. */
  skinConfig?: BeatorajaSkinConfig;
  /** Songs to choose from. Empty array → "no songs" placeholder. */
  songs: ReadonlyArray<BrowserSongEntry>;
  /** Initial highlighted index. Defaults to 0; clamped to `[0, songs.length - 1]`. */
  initialIndex?: number;
  /** Called when the user confirms a song (`Enter`). */
  onSongPicked: (song: BrowserSongEntry) => void;
  /** Called when the user backs out (`Escape`). */
  onExit?: () => void;
}

/** Number of songs visible in the overlay list at once. The current selection is centered. */
const VISIBLE_ROW_COUNT = 11;

export class PixiBeatorajaSelectScene implements PixiScene {
  readonly root = new Container();
  /** Full-canvas backdrop behind the skin container — see `PixiBeatorajaGameplayView` for rationale. */
  private readonly backdrop = new Graphics();
  private view: BeatorajaPlaySkinView;
  /**
   * Song-bar overlay. Painted on top of the skin in screen-space (NOT inside the skin's scaled
   * container) so the row layout doesn't compress with the letterbox. This is a placeholder UI: the
   * reference skin renders song bars via its own `bar[]` declarations, which we don't parse yet.
   */
  private readonly songListLayer = new Container();
  private readonly songLabels: Text[] = [];
  private readonly options: PixiBeatorajaSelectSceneOptions;
  private host?: PixiSceneHost;
  private tickerHandle?: (ticker: Ticker) => void;
  private startMs = 0;
  private currentIndex: number;
  private lastFitWidth = 0;
  private lastFitHeight = 0;
  private disposed = false;

  constructor(options: PixiBeatorajaSelectSceneOptions) {
    this.options = options;
    this.currentIndex = clampIndex(options.initialIndex ?? 0, options.songs.length);

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
    this.root.addChild(this.songListLayer);

    this.buildSongLabels(options.fonts);
    this.refreshSongLabels();

    // eslint-disable-next-line no-console
    console.log(
      '[beatoraja-select] mounted',
      JSON.stringify({
        canvas: { w: this.view.width, h: this.view.height },
        songs: options.songs.length,
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
    this.tickerHandle = () => this.tick();
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
   * against the new skin while preserving `currentIndex`, the song list, and the navigation state.
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

    // Mutate the options' skin-config so subsequent `baseOps()` calls pick up the new value (it
    // memoizes from `options.skinConfig?.option`). The other options' identity is preserved so the
    // panel state, song list, callbacks all keep pointing at the same objects.
    (this.options as { skinConfig?: BeatorajaSkinConfig }).skinConfig = opts.skinConfig;

    this.view = new BeatorajaPlaySkinView({
      skin: opts.skin,
      textures: opts.textures,
      resolveTextContent: (refOp) => this.resolveSelectionText(refOp),
      resolveFontFamily: opts.fonts ? (id) => opts.fonts!.family(id) : undefined,
      resolveFontKind: opts.fonts ? (id) => opts.fonts!.kind(id) : undefined,
    });
    // The root currently holds [backdrop, oldView (destroyed), songList]. Re-add the new view
    // BETWEEN backdrop and songList so the layering stays correct (skin chrome behind the list).
    this.root.removeChild(this.songListLayer);
    this.root.addChild(this.view.container);
    this.root.addChild(this.songListLayer);

    // Force a re-fit so the new skin's `w` / `h` apply on the next tick.
    this.lastFitWidth = 0;
    this.lastFitHeight = 0;

    // eslint-disable-next-line no-console
    console.log(
      '[beatoraja-select] skin replaced',
      JSON.stringify({
        canvas: { w: this.view.width, h: this.view.height },
        name: opts.skin.name,
      }),
    );
  }

  /** Programmatically jump to a song index. Out-of-range values are clamped. */
  setSelectionIndex(index: number): void {
    const next = clampIndex(index, this.options.songs.length);
    if (next === this.currentIndex) return;
    this.currentIndex = next;
    this.refreshSongLabels();
  }

  // ─── Internals ────────────────────────────────────────────────────────────────────────────────

  private tick(): void {
    if (this.disposed) return;
    this.fitToStage();
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

  private resolveSelectionText(refOp: number): string | undefined {
    const song = this.options.songs[this.currentIndex];
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
        // BrowserSongEntry doesn't carry sub-artist, so we surface the empty string rather than
        // letting the resolver fall through to `undefined` (which would make the text destination
        // disappear — confusing in a select context where "no sub-artist" is a normal case).
        return '';
      case BEATORAJA_TEXT.FULLARTIST:
        return song?.artist ?? '';
      // Skin name / author from the mounted skin's header. Useful for select skins that label
      // themselves on the chrome panel ("[GdbG Skin] Music Select").
      case BEATORAJA_TEXT.SKIN_NAME:
        return skin.name ?? '';
      case BEATORAJA_TEXT.SKIN_AUTHOR:
        return skin.author ?? '';
      // Highlighted song's parent directory — surfaced through the existing `directoryLabel`
      // field on BrowserSongEntry. Empty string when the host didn't preserve folder info.
      case BEATORAJA_TEXT.DIRECTORY:
        return song?.directoryLabel ?? '';
      // Search query — we don't expose a search UI yet, so the slot stays empty. Skins that
      // author a search box still get a non-undefined result so the text node doesn't disappear.
      case BEATORAJA_TEXT.SEARCHWORD:
        return '';
      default:
        return undefined;
    }
  }

  private buildSongLabels(fonts: BeatorajaFontCache | undefined): void {
    // Pick the first registered skin font, if any — keeps the song list visually consistent with
    // the rest of the chrome on Japanese / wide-glyph themes. `BeatorajaFontCache.values()` returns
    // the loaded fonts in declaration order; element 0 is conventionally the "main" body font.
    const skinFamily = fonts?.values()[0]?.family;
    const fontFamily = skinFamily !== undefined ? `'${skinFamily}', sans-serif` : 'sans-serif';
    for (let i = 0; i < VISIBLE_ROW_COUNT; i += 1) {
      const text = new Text({
        text: '',
        style: {
          fontFamily,
          fontSize: 18,
          fill: 0xffffff,
          align: 'left',
        },
      });
      text.anchor.set(0, 0.5);
      this.songListLayer.addChild(text);
      this.songLabels.push(text);
    }
  }

  private refreshSongLabels(): void {
    const songs = this.options.songs;
    const center = Math.floor(VISIBLE_ROW_COUNT / 2);
    for (let i = 0; i < VISIBLE_ROW_COUNT; i += 1) {
      const idx = this.currentIndex + (i - center);
      const song = idx >= 0 && idx < songs.length ? songs[idx] : undefined;
      const label = this.songLabels[i]!;
      if (song === undefined) {
        label.text = '';
        label.visible = false;
        continue;
      }
      label.visible = true;
      const isCurrent = i === center;
      label.text = `${isCurrent ? '▶ ' : '  '}${song.title}${song.artist ? ` — ${song.artist}` : ''}`;
      label.alpha = isCurrent ? 1 : 0.55;
      label.tint = isCurrent ? 0xffe066 : 0xffffff;
      label.style.fontSize = isCurrent ? 22 : 16;
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

    // Place the song list overlay on the right half of the canvas. Beatoraja's reference skin
    // typically authors the song bar between roughly x = 60 % … 100 % of the canvas; we mirror that
    // proportion so the list overlaps the area the skin "expects" to be a song bar without us having
    // to parse the skin's `bar[]` declaration.
    const rowHeight = Math.max(20, Math.floor(height / (VISIBLE_ROW_COUNT + 4)));
    const overlayLeft = Math.floor(width * 0.55);
    const overlayCenterY = Math.floor(height / 2);
    for (let i = 0; i < VISIBLE_ROW_COUNT; i += 1) {
      const label = this.songLabels[i]!;
      label.x = overlayLeft;
      label.y = overlayCenterY + (i - Math.floor(VISIBLE_ROW_COUNT / 2)) * rowHeight;
    }
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (this.disposed) return;
    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        this.setSelectionIndex(this.currentIndex - 1);
        break;
      case 'ArrowDown':
        event.preventDefault();
        this.setSelectionIndex(this.currentIndex + 1);
        break;
      case 'PageUp':
        event.preventDefault();
        this.setSelectionIndex(this.currentIndex - 10);
        break;
      case 'PageDown':
        event.preventDefault();
        this.setSelectionIndex(this.currentIndex + 10);
        break;
      case 'Home':
        event.preventDefault();
        this.setSelectionIndex(0);
        break;
      case 'End':
        event.preventDefault();
        this.setSelectionIndex(this.options.songs.length - 1);
        break;
      case 'Enter': {
        event.preventDefault();
        const song = this.options.songs[this.currentIndex];
        if (song !== undefined) {
          // eslint-disable-next-line no-console
          console.log(
            '[beatoraja-select] song picked',
            JSON.stringify({ index: this.currentIndex, title: song.title, artist: song.artist }),
          );
          this.options.onSongPicked(song);
        }
        break;
      }
      case 'Escape':
        event.preventDefault();
        this.options.onExit?.();
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
