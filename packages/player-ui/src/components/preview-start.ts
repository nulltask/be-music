import { css, html, svg, type CSSResultGroup, type PropertyDeclarations, type TemplateResult } from 'lit';
import { BeMusicElement } from '../base.ts';
import { structureStyles } from '../styles/structure.ts';
import { renderAutoPlayCheck } from './auto-play-check.ts';

/**
 * The large play button over a preview before it plays (`mode="play"`) or after it ended (`mode="replay"`). With
 * `autoPlay` set, an AUTO checkbox sits under it, whose change requests `auto-play-change`.
 */
export class BeMusicPreviewStartElement extends BeMusicElement {
  static override properties: PropertyDeclarations = {
    mode: {},
    disabled: { type: Boolean },
    /** AUTO plays the chart by itself; off, the viewer plays it. No checkbox while unset. */
    autoPlay: { attribute: false },
  };
  static override styles: CSSResultGroup = [
    structureStyles,
    css`
      :host {
        display: grid;
        place-content: center;
        justify-items: center;
        gap: 14px;
        position: absolute;
        inset: 0;
        background: #05070b80;
      }
      button {
        display: grid;
        justify-items: center;
        gap: 6px;
        min-width: 8rem;
        height: auto;
        padding: 18px 26px;
        font-size: 15px;
      }
      .auto-play {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 0.9em;
        white-space: nowrap;
        cursor: pointer;
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
  declare autoPlay: boolean | undefined;

  constructor() {
    super();
    this.mode = 'play';
    this.disabled = false;
  }

  protected override render(): TemplateResult {
    const replay = this.mode === 'replay';
    return html`<button
        class="btn"
        data-size="lg"
        part="button"
        ?disabled=${this.disabled}
        @click=${() => this.emit('play-request', { autoPlay: true })}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          ${replay ? svg`<path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z" />` : svg`<path d="M8 5v14l11-7z" />`}
        </svg>
        <span>${replay ? 'Replay' : 'Play'}</span>
      </button>
      ${renderAutoPlayCheck(this.autoPlay, (autoPlay) => this.emit('auto-play-change', { autoPlay }), this.disabled)}`;
  }
}
