import { css, html, type CSSResultGroup, type PropertyDeclarations, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import type { LibraryChart } from '@be-music/player-skin-sdk';
import { BeMusicElement } from '../base.ts';
import { baseStyles } from '../styles/base.ts';

/** The charts of a previewed track; picking one requests it (`activate-request`, by index). */
export class BeMusicPreviewSelectElement extends BeMusicElement {
  static override properties: PropertyDeclarations = {
    charts: { attribute: false },
    heading: {},
  };
  static override styles: CSSResultGroup = [
    baseStyles,
    css`
      :host {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        gap: 10px;
        height: 100%;
        padding: 16px;
        background: var(--be-music-color-background, #10151f);
      }
      ul {
        display: grid;
        align-content: start;
        gap: 6px;
        margin: 0;
        padding: 0;
        overflow: auto;
        list-style: none;
        overscroll-behavior: contain;
      }
      button {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: 10px;
        width: 100%;
        text-align: left;
      }
      .play {
        color: var(--be-music-color-accent, #abcaff);
      }
      .title,
      .artist {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .artist,
      .facts {
        color: var(--be-music-color-muted, #b8c7da);
        font-size: 0.85em;
      }
    `,
  ];
  declare charts: readonly LibraryChart[] | undefined;
  declare heading: string | undefined;

  protected override render(): TemplateResult {
    const charts = this.charts ?? [];
    return html`<h2 part="heading">${this.heading ?? 'Choose a chart'}</h2>
      <ul part="list" aria-label="Charts">
        ${repeat(
          charts,
          (chart) => chart.id,
          (chart, index) =>
            html`<li>
              <button part="row" @click=${() => this.emit('activate-request', { index })}>
                <span class="play" aria-hidden="true">▶</span>
                <span
                  ><span class="title">${[chart.title, chart.subtitle].filter(Boolean).join(' ')}</span
                  ><span class="artist">${chart.artist ?? ''}</span></span
                >
                <span class="facts"
                  >${[chart.genre, chart.playLevel !== undefined ? `Lv. ${chart.playLevel}` : undefined]
                    .filter(Boolean)
                    .join(' · ')}</span
                >
              </button>
            </li>`,
        )}
      </ul>`;
  }
}
