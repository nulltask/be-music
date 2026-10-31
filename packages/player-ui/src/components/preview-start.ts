import { css, html, nothing, svg, type CSSResultGroup, type PropertyDeclarations, type TemplateResult } from 'lit';
import { BeMusicElement } from '../base.ts';
import { structureStyles } from '../styles/structure.ts';
import { renderAutoPlayCheck } from './auto-play-check.ts';

/**
 * The large play button over a preview before it plays (`mode="play"`) or after it ended (`mode="replay"`), or the
 * button that starts downloading the track (`mode="load"`), with its file name as the `caption`. With
 * `autoPlay` set, an AUTO checkbox sits under it, whose change requests `auto-play-change`.
 */
export class BeMusicPreviewStartElement extends BeMusicElement {
  static override properties: PropertyDeclarations = {
    mode: {},
    disabled: { type: Boolean },
    /** A line of small type under the label, such as the file the button loads. */
    caption: {},
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
      .caption {
        max-width: 16rem;
        overflow: hidden;
        font-size: 12px;
        text-overflow: ellipsis;
        white-space: nowrap;
        opacity: 0.7;
      }
      svg {
        width: 56px;
        height: 56px;
        fill: currentColor;
      }
    `,
  ];
  declare mode: 'play' | 'replay' | 'load';
  declare caption: string | undefined;
  declare disabled: boolean;
  declare autoPlay: boolean | undefined;

  constructor() {
    super();
    this.mode = 'play';
    this.disabled = false;
  }

  protected override render(): TemplateResult {
    const replay = this.mode === 'replay';
    const load = this.mode === 'load';
    return html`<button
        class="btn"
        data-size="lg"
        part="button"
        ?disabled=${this.disabled}
        @click=${() => this.emit('play-request', { autoPlay: true })}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          ${
            replay
              ? svg`<path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z" />`
              : load
                ? svg`<path d="M11 4h2v8.2l3.3-3.3 1.4 1.4L12 16l-5.7-5.7 1.4-1.4 3.3 3.3zM5 18h14v2H5z" />`
                : svg`<path d="M8 5v14l11-7z" />`
          }
        </svg>
        <span>${replay ? 'Replay' : load ? 'Load' : 'Play'}</span>
        ${this.caption ? html`<span class="caption" part="caption">${this.caption}</span>` : nothing}
      </button>
      ${renderAutoPlayCheck(this.autoPlay, (autoPlay) => this.emit('auto-play-change', { autoPlay }), this.disabled)}`;
  }
}
