import { css, html, svg, type CSSResultGroup, type PropertyDeclarations, type TemplateResult } from 'lit';
import { BeMusicElement } from '../base.ts';
import { baseStyles } from '../styles/base.ts';

/** The large play button over a preview before it plays (`mode="play"`) or after it ended (`mode="replay"`). */
export class BeMusicPreviewStartElement extends BeMusicElement {
  static override properties: PropertyDeclarations = { mode: {}, disabled: { type: Boolean } };
  static override styles: CSSResultGroup = [
    baseStyles,
    css`
      :host {
        display: grid;
        place-items: center;
        position: absolute;
        inset: 0;
        background: #05070b80;
      }
      button {
        display: grid;
        justify-items: center;
        gap: 6px;
        padding: 18px 26px;
        border-radius: 16px;
        background: #05070bcc;
        font-size: 15px;
      }
      svg {
        width: 56px;
        height: 56px;
        fill: currentColor;
      }
    `,
  ];
  declare mode: 'play' | 'replay';
  declare disabled: boolean;

  constructor() {
    super();
    this.mode = 'play';
    this.disabled = false;
  }

  protected override render(): TemplateResult {
    const replay = this.mode === 'replay';
    return html`<button
      part="button"
      ?disabled=${this.disabled}
      @click=${() => this.emit('play-request', { autoPlay: true })}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        ${replay ? svg`<path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z" />` : svg`<path d="M8 5v14l11-7z" />`}
      </svg>
      <span>${replay ? 'Replay' : 'Play'}</span>
    </button>`;
  }
}
