/**
 * The select screen's README overlay: the modal the LR2 READTEXT button (and a be-music skin's `toggleReadme`) opens
 * over the song list to show the text file shipped next to the focused chart, scrolled by the wheel, a swipe or the
 * keys. The scene draws it on top of its frame and routes its input here while it is open.
 *
 * The overlay reads the library and plays its cues through {@link SelectReadTextContext}; the select scene passes it.
 */

import { dirname } from '@be-music/utils/core';
import { Color, Container, Graphics, Text, TextStyle } from 'pixi.js';
import { loadAssetBytes, resolveSongSource } from '../../../collection/collection.ts';
import type { BrowserSongCollection, BrowserSongEntry } from '../../../collection/types.ts';
import { CORE_TEXT_FONT } from '../fonts.ts';

const TEXT = new Color('#f6f2e8');
const MUTED = new Color('#a9a39a');

/** What the README overlay reads and drives on the select scene: its fields and methods of these names. */
export interface SelectReadTextContext {
  readonly collection: BrowserSongCollection;
  readonly disposed: boolean;
  playOneShotSound(name: string): Promise<void>;
  render(): void;
}

/** The README overlay. See the module comment. */
export class SelectReadTextOverlay {
  private readonly ctx: SelectReadTextContext;

  /**
   * Top-most overlay used by the LR2 READTEXT button (#SRC_BUTTON type 17). Hidden until the user clicks the button on
   * a song whose folder ships a `.txt` file. The skin's own readtext UI lives on its own panel timer (15 / 16) and we
   * don't have the chrome for that yet — render a no-frills modal so the feature is at least usable.
   */
  readonly readTextLayer: Container = new Container();
  private readonly readTextBackdrop = new Graphics();
  private readonly readTextCard = new Graphics();
  private readonly readTextTitle = new Text({
    text: 'Readme',
    style: new TextStyle({
      fill: TEXT,
      // Match the rest of the select-scene UI chrome — same weight / family used by `title` (the empty-state header)
      // and the result-screen panel labels. No `letterSpacing` tracking — that was a leftover from the all-caps draft
      // and looks sparse with mixed-case.
      fontSize: 22,
      fontWeight: '700',
      fontFamily: CORE_TEXT_FONT,
    }),
  });
  /**
   * Scroll viewport for the readtext body. The body lives inside this container with a mask matching
   * `readTextViewportMask`, so negative-Y offsets clip to the visible card area instead of overflowing onto the
   * surrounding skin / decide layer.
   */
  private readonly readTextViewport = new Container();
  private readonly readTextViewportMask = new Graphics();
  private readonly readTextBody = new Text({
    text: '',
    style: new TextStyle({
      fill: TEXT,
      fontSize: 14,
      // Author notes are typically pre-formatted ASCII art / tables / column-aligned changelogs; a monospace font
      // preserves that layout. CJK glyphs fall back to the browser's monospace JP face automatically.
      fontFamily: 'ui-monospace, monospace',
      wordWrap: true,
      wordWrapWidth: 600,
      lineHeight: 18,
    }),
  });
  /** Scrollbar gutter + thumb (only visible when content overflows). */
  private readonly readTextScrollbar = new Graphics();
  /**
   * Footer hint inside the modal — the close shortcut would otherwise be invisible (no native `[x]` close button on the
   * Pixi card). Mirrors the LR2 default skin's right-hand README panel which always shows the dismiss key in-frame.
   */
  private readonly readTextFooter = new Text({
    text: '↑↓ / Wheel to scroll · Enter or click to close',
    style: new TextStyle({
      fill: MUTED,
      fontSize: 12,
      fontFamily: CORE_TEXT_FONT,
    }),
  });
  /** True while the readtext modal is open. */
  readTextOpen = false;
  /**
   * Pixel offset of the readtext body inside its viewport. Always a non-negative integer; clamped to `[0, max(0, bodyH
   * - viewH)]` by `renderReadTextOverlay` whenever the modal re-renders.
   */
  private readTextScroll = 0;

  public constructor(ctx: SelectReadTextContext) {
    this.ctx = ctx;
    this.readTextLayer.label = 'select/read-text';
    this.readTextLayer.visible = false;
    this.readTextViewport.addChild(this.readTextBody);
    // Pixi v8 mask: the mask graphic must live in the scene graph (so its world transform is current) but stays
    // invisible visually — it's only used for clipping. Adding it as a sibling of the viewport keeps both transforms in
    // sync with any future readtext-layer translation.
    this.readTextViewport.mask = this.readTextViewportMask;
    this.readTextLayer.addChild(
      this.readTextBackdrop,
      this.readTextCard,
      this.readTextTitle,
      this.readTextViewport,
      this.readTextViewportMask,
      this.readTextScrollbar,
      this.readTextFooter,
    );
  }

  /**
   * Toggles the READTEXT modal for the focused song. Looks for a `.txt` file in the song's directory and shows its
   * contents in a centered Pixi card. Closes on second click / Escape / cursor move to a different song.
   */
  toggleReadText(song: BrowserSongEntry): void {
    if (this.readTextOpen) {
      this.closeReadText();
      return;
    }
    void (async () => {
      // Readtext lookup is async because the song bundle defers every file's bytes (lazy `File` reference) until
      // something actually needs them. Wrap in a self-invoked async IIFE because the click handler stays sync.
      const text = await findReadtextForSong(this.ctx.collection, song);
      if (this.ctx.disposed) return;
      if (!text) {
        // No `.txt` companion — give brief audible feedback so the user knows the click registered, then bail out.
        void this.ctx.playOneShotSound('option-change');
        return;
      }
      this.readTextBody.text = text;
      // Reset scroll on every open so the user always lands at the top of a freshly-loaded README, even if they had
      // scrolled through a previous one in the same session.
      this.readTextScroll = 0;
      this.readTextOpen = true;
      this.readTextLayer.visible = true;
      void this.ctx.playOneShotSound('option-open');
      this.ctx.render();
    })();
  }

  /**
   * Adjusts the readtext body's scroll offset by `delta` pixels (positive = scroll down). Clamps to the body / viewport
   * extents — overflow checks happen in {@link renderReadTextOverlay}, but we also clamp here so repeated wheel events
   * at the bottom don't keep growing the stored offset (which would cause a "rubber band" effect when the viewport size
   * later changes).
   */
  scrollReadText(delta: number): void {
    if (!this.readTextOpen) return;
    const next = Math.max(0, this.readTextScroll + delta);
    if (next === this.readTextScroll) return;
    this.readTextScroll = next;
    this.ctx.render();
  }

  /**
   * Hides the READTEXT modal, fires the LR2 panel-close cue, and re-renders. Safe to call when already closed (no-op +
   * no cue), which lets `noteCursorChange` blindly invoke it on every bar move without churning sound effects.
   */
  closeReadText(): void {
    if (!this.readTextOpen) return;
    this.readTextOpen = false;
    this.readTextLayer.visible = false;
    void this.ctx.playOneShotSound('option-close');
    this.ctx.render();
  }

  renderReadTextOverlay(designWidth: number, designHeight: number): void {
    if (!this.readTextOpen) {
      this.readTextLayer.visible = false;
      return;
    }
    this.readTextLayer.visible = true;
    this.readTextBackdrop.clear().rect(0, 0, designWidth, designHeight).fill({ color: 0x000000, alpha: 0.85 });
    const cardWidth = Math.min(800, designWidth - 80);
    const cardHeight = Math.min(560, designHeight - 80);
    const cardX = Math.round((designWidth - cardWidth) / 2);
    const cardY = Math.round((designHeight - cardHeight) / 2);
    this.readTextCard
      .clear()
      .roundRect(cardX, cardY, cardWidth, cardHeight, 12)
      .fill({ color: 0x111318, alpha: 0.96 })
      .stroke({ color: 0x2a2f3a, width: 2 });
    this.readTextTitle.position.set(cardX + 24, cardY + 16);
    // Reserve a 12px gutter on the right for the scrollbar so the body never reflows on overflow. Wrap width drives
    // Pixi's word-wrap layout — drop the gutter from the card padding (24px each side).
    const gutter = 12;
    const padX = 24;
    const headerH = 56;
    // Reserve enough vertical room at the bottom for the footer hint so the body never overlaps the close-instructions
    // row.
    const footerH = 32;
    const viewportX = cardX + padX;
    const viewportY = cardY + headerH;
    const viewportW = cardWidth - padX * 2 - gutter;
    const viewportH = cardHeight - headerH - footerH;
    this.readTextFooter.position.set(cardX + padX, cardY + cardHeight - footerH + 8);
    this.readTextBody.style.wordWrapWidth = viewportW;
    // Clamp the stored scroll against the freshly-measured body height so the body can never scroll past its last line.
    // We do this AFTER setting the wrap width so `body.height` reflects the current layout.
    const bodyH = this.readTextBody.height;
    const maxScroll = Math.max(0, bodyH - viewportH);
    if (this.readTextScroll > maxScroll) this.readTextScroll = maxScroll;
    // Position the viewport at the body's top-left and offset the body itself by `-scroll` so it slides up as the user
    // scrolls down. Using the viewport as the positioning anchor (rather than nudging the body absolute) keeps the
    // mask-relative hit-testing simple if we ever wire pointer-driven scrolling.
    this.readTextViewport.position.set(viewportX, viewportY);
    this.readTextBody.position.set(0, -this.readTextScroll);
    // Mask geometry must be redrawn each frame — the card's size depends on the screen, and Pixi's mask uses the
    // graphic's current geometry verbatim.
    this.readTextViewportMask.clear().rect(viewportX, viewportY, viewportW, viewportH).fill({ color: 0xffffff });
    // Scrollbar — render only when the body overflows. The track is a faint gutter and the thumb is sized
    // proportionally to the visible fraction of the body.
    this.readTextScrollbar.clear();
    if (maxScroll > 0) {
      const trackX = cardX + cardWidth - padX;
      const trackY = viewportY;
      const trackW = 4;
      const trackH = viewportH;
      this.readTextScrollbar.rect(trackX, trackY, trackW, trackH).fill({ color: 0xffffff, alpha: 0.06 });
      const thumbH = Math.max(24, (viewportH / bodyH) * trackH);
      const thumbY = trackY + (this.readTextScroll / maxScroll) * (trackH - thumbH);
      this.readTextScrollbar.rect(trackX, thumbY, trackW, thumbH).fill({ color: 0xffffff, alpha: 0.45 });
    }
  }
}

/**
 * Looks up a `.txt` companion file in the same directory as the focused song's chart and returns its decoded contents.
 * Used by the LR2 READTEXT button (`#SRC_BUTTON,...,17,...`) to surface per-song notes / changelogs that BMS authors
 * traditionally ship alongside the chart files.
 *
 * Resolution rules — kept deliberately tolerant so we don't need the source to follow any specific naming convention:
 *
 * - Only files **directly inside** the chart's directory are considered (no recursing into sub-folders, no walking up
 *   to the source root).
 * - The first matching file wins. The map iteration order is the source's insertion order (which mirrors the directory
 *   listing on the directory loader / the central directory order on the ZIP loader), so this is stable per source.
 * - Returns `undefined` when the song has no resolvable source or no sibling `.txt` exists, letting the caller play the
 *   "no readtext" feedback cue instead of opening an empty modal.
 */
async function findReadtextForSong(
  collection: BrowserSongCollection,
  song: BrowserSongEntry,
): Promise<string | undefined> {
  const source = resolveSongSource(collection, song);
  if (!source) return undefined;
  const dir = dirname(song.chartPath).toLowerCase();
  for (const [path, entry] of source.files) {
    if (!path.toLowerCase().endsWith('.txt')) continue;
    if (dirname(path).toLowerCase() !== dir) continue;
    // Song-bundle files are lazy `File` references — pull the bytes on demand. The .txt is small so the read is cheap;
    // the bytes go out of scope once decoded into the modal text, so they don't pin any extra memory.
    const bytes = await loadAssetBytes(entry);
    if (!bytes) continue;
    return decodeReadtextBytes(bytes);
  }
  return undefined;
}

/**
 * Decodes raw `.txt` bytes to a string. BMS author notes are historically Shift-JIS (the LR2 era's default codepage on
 * Japanese Windows installs), but modern releases sometimes ship as UTF-8 with or without a BOM. Try UTF-8 first when a
 * BOM is present (unambiguous), then probe Shift-JIS, and finally fall back to lossy UTF-8 so we always return *some*
 * string rather than failing the modal open.
 */
function decodeReadtextBytes(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(3));
  }
  try {
    const sjis = new TextDecoder('shift-jis', { fatal: false }).decode(bytes);
    if (sjis.length > 0 && !sjis.includes('�')) return sjis;
  } catch {
    // `shift-jis` not available in this runtime — fall through.
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}
