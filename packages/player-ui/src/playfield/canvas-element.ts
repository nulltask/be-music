import { css, html, type CSSResultGroup, type PropertyDeclarations, type TemplateResult } from 'lit';
import type { BeMusicRect } from '@be-music/player-skin-sdk';
import { DataElement } from '../base.ts';
import type { BeMusicPlayfieldPaintContext } from './paint.ts';

/**
 * A playfield component drawing on its own canvas. `rect` is the part of the stage it covers, in design pixels: the
 * element is sized by its layout, and its canvas matches the device pixels of that box, so painters keep drawing in
 * stage coordinates whatever the element's size on screen.
 */
export abstract class BeMusicPlayfieldCanvasElement<Data> extends DataElement<Data> {
  static override styles: CSSResultGroup = css`
    :host {
      display: block;
      position: relative;
      pointer-events: none;
    }
    canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }
  `;
  static override properties: PropertyDeclarations = { rect: { attribute: false } };
  declare rect: BeMusicRect | undefined;
  private canvas: HTMLCanvasElement | undefined;
  private context: CanvasRenderingContext2D | null | undefined;
  private observer: ResizeObserver | undefined;
  private pixelWidth = 0;
  private pixelHeight = 0;

  protected abstract paint(context: BeMusicPlayfieldPaintContext, data: Data): void;

  override connectedCallback(): void {
    super.connectedCallback();
    const Observer = this.ownerDocument.defaultView?.ResizeObserver;
    if (!Observer) return;
    this.observer = new Observer(([entry]) => {
      const device = entry?.devicePixelContentBoxSize?.[0];
      const ratio = this.ownerDocument.defaultView?.devicePixelRatio ?? 1;
      const box = entry?.contentRect;
      this.pixelWidth = Math.round(device?.inlineSize ?? (box?.width ?? 0) * ratio);
      this.pixelHeight = Math.round(device?.blockSize ?? (box?.height ?? 0) * ratio);
      this.draw();
    });
    try {
      this.observer.observe(this, { box: 'device-pixel-content-box' });
    } catch {
      this.observer.observe(this);
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.observer?.disconnect();
    this.observer = undefined;
  }

  protected override render(): TemplateResult {
    return html`<canvas part="canvas" aria-hidden="true"></canvas>`;
  }

  protected override firstUpdated(): void {
    this.canvas = this.renderRoot.querySelector('canvas') ?? undefined;
  }

  protected override updated(): void {
    this.draw();
  }

  private draw(): void {
    const canvas = this.canvas;
    if (!canvas || this.pixelWidth <= 0 || this.pixelHeight <= 0) return;
    if (canvas.width !== this.pixelWidth || canvas.height !== this.pixelHeight) {
      canvas.width = this.pixelWidth;
      canvas.height = this.pixelHeight;
    }
    this.context ??= canvas.getContext('2d');
    const ctx = this.context;
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const rect = this.rect;
    if (!rect || rect.w <= 0 || rect.h <= 0 || this.data === undefined) return;
    const scaleX = canvas.width / rect.w;
    const scaleY = canvas.height / rect.h;
    ctx.setTransform(scaleX, 0, 0, scaleY, -rect.x * scaleX, -rect.y * scaleY);
    this.paint(ctx, this.data);
  }
}
