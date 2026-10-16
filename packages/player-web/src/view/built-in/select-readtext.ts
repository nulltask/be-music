/**
 * The select screen's README overlay: a modal card over the song list showing the text file shipped next to a chart,
 * scrolled by the wheel, a swipe or the keys. The session decides when it shows and with what text (`SelectFrame`'s
 * `readText`); the overlay only draws it and keeps its scroll, clamped to the text.
 */

import { Color, Container, Graphics, Text, TextStyle } from 'pixi.js';
import { CORE_TEXT_FONT } from '../../scene/core/fonts.ts';

const TEXT = new Color('#f6f2e8');
const MUTED = new Color('#a9a39a');

/** The README overlay. See the module comment. */
export class SelectReadTextOverlay {
  /** The overlay's layer: the view puts it on top of its frame. */
  readonly layer: Container = new Container();
  private readonly backdrop = new Graphics();
  private readonly card = new Graphics();
  private readonly title = new Text({
    text: 'Readme',
    style: new TextStyle({ fill: TEXT, fontSize: 22, fontWeight: '700', fontFamily: CORE_TEXT_FONT }),
  });
  /** The body's scroll viewport: masked to the card, so a scrolled body never draws over the skin around it. */
  private readonly viewport = new Container();
  private readonly viewportMask = new Graphics();
  private readonly body = new Text({
    text: '',
    style: new TextStyle({
      fill: TEXT,
      fontSize: 14,
      // Author notes are often pre-formatted ASCII art, tables or column-aligned changelogs: a monospace face keeps
      // their layout. CJK glyphs fall back to the browser's monospace Japanese face.
      fontFamily: 'ui-monospace, monospace',
      wordWrap: true,
      wordWrapWidth: 600,
      lineHeight: 18,
    }),
  });
  /** The scrollbar's track and thumb, shown only when the text overflows. */
  private readonly scrollbar = new Graphics();
  /** The close keys, as the card has no close button. */
  private readonly footer = new Text({
    text: '↑↓ / Wheel to scroll · Enter or click to close',
    style: new TextStyle({ fill: MUTED, fontSize: 12, fontFamily: CORE_TEXT_FONT }),
  });
  /** What is shown (a `SelectFrame`'s `readText`), or `undefined` while the overlay is closed. */
  private shown: { readonly text: string } | undefined;
  /** How far the body is scrolled, in pixels; clamped to the body as it is laid out on each draw. */
  private scroll = 0;

  public constructor() {
    this.layer.label = 'select/read-text';
    this.layer.visible = false;
    this.viewport.addChild(this.body);
    // The mask has to be in the scene graph for its transform to stay current; it only clips.
    this.viewport.mask = this.viewportMask;
    this.layer.addChild(
      this.backdrop,
      this.card,
      this.title,
      this.viewport,
      this.viewportMask,
      this.scrollbar,
      this.footer,
    );
  }

  /** Whether the overlay is showing a text. */
  get open(): boolean {
    return this.shown !== undefined;
  }

  /** Shows a text file, from its top each time it is opened; `undefined` closes the overlay. */
  show(readText: { readonly text: string } | undefined): void {
    if (readText === this.shown) return;
    this.shown = readText;
    this.scroll = 0;
    if (readText !== undefined) this.body.text = readText.text;
  }

  /** Scrolls the body by `delta` pixels (positive: down); the draw clamps it to the text. */
  scrollBy(delta: number): void {
    if (this.shown === undefined) return;
    this.scroll = Math.max(0, this.scroll + delta);
  }

  /** Draws the overlay over a `designWidth` × `designHeight` frame, or hides it while closed. */
  render(designWidth: number, designHeight: number): void {
    if (this.shown === undefined) {
      this.layer.visible = false;
      return;
    }
    this.layer.visible = true;
    this.backdrop.clear().rect(0, 0, designWidth, designHeight).fill({ color: 0x000000, alpha: 0.85 });
    const cardWidth = Math.min(800, designWidth - 80);
    const cardHeight = Math.min(560, designHeight - 80);
    const cardX = Math.round((designWidth - cardWidth) / 2);
    const cardY = Math.round((designHeight - cardHeight) / 2);
    this.card
      .clear()
      .roundRect(cardX, cardY, cardWidth, cardHeight, 12)
      .fill({ color: 0x111318, alpha: 0.96 })
      .stroke({ color: 0x2a2f3a, width: 2 });
    this.title.position.set(cardX + 24, cardY + 16);
    // A 12 px gutter on the right for the scrollbar, so the body never reflows when it overflows; room at the bottom for
    // the footer.
    const gutter = 12;
    const padX = 24;
    const headerH = 56;
    const footerH = 32;
    const viewportX = cardX + padX;
    const viewportY = cardY + headerH;
    const viewportW = cardWidth - padX * 2 - gutter;
    const viewportH = cardHeight - headerH - footerH;
    this.footer.position.set(cardX + padX, cardY + cardHeight - footerH + 8);
    this.body.style.wordWrapWidth = viewportW;
    // Clamped against the body laid out at this width, so it never scrolls past its last line.
    const bodyH = this.body.height;
    const maxScroll = Math.max(0, bodyH - viewportH);
    if (this.scroll > maxScroll) this.scroll = maxScroll;
    this.viewport.position.set(viewportX, viewportY);
    this.body.position.set(0, -this.scroll);
    this.viewportMask.clear().rect(viewportX, viewportY, viewportW, viewportH).fill({ color: 0xffffff });
    this.scrollbar.clear();
    if (maxScroll > 0) {
      const trackX = cardX + cardWidth - padX;
      const trackW = 4;
      this.scrollbar.rect(trackX, viewportY, trackW, viewportH).fill({ color: 0xffffff, alpha: 0.06 });
      const thumbH = Math.max(24, (viewportH / bodyH) * viewportH);
      const thumbY = viewportY + (this.scroll / maxScroll) * (viewportH - thumbH);
      this.scrollbar.rect(trackX, thumbY, trackW, thumbH).fill({ color: 0xffffff, alpha: 0.45 });
    }
  }
}
