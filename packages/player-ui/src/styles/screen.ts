import { css, type CSSResultGroup } from 'lit';
import { structureStyles } from './structure.ts';

/**
 * Full-screen composition; list, detail and option styling belongs to their own elements. Lengths and type read the
 * `--be-music-*` custom properties with neutral defaults; a skin's own scale and typography go on the host element.
 */
export const screenStyles: CSSResultGroup = [
  structureStyles,
  css`
    :host {
      height: 100%;
      min-height: 0;
      container-name: be-music-screen;
    }
    .screen {
      display: flex;
      flex-direction: column;
      gap: var(--be-music-section-gap, 24px);
      height: 100%;
      min-height: 0;
      overflow: auto;
      pointer-events: auto;
      padding: var(--be-music-screen-padding, 24px);
    }
    header {
      display: flex;
      flex: none;
      flex-wrap: wrap;
      align-items: flex-end;
      justify-content: space-between;
      gap: var(--be-music-gap, 8px) var(--be-music-section-gap, 24px);
    }
    .heading {
      display: grid;
      gap: 4px;
      min-width: 0;
    }
    .search {
      display: flex;
      flex: 0 1 24rem;
      flex-direction: column;
      gap: 4px;
      min-width: min(16rem, 100%);
    }
    .search input {
      width: 100%;
    }
    .search-error {
      font-size: 12px;
    }
    .search-error:empty {
      display: none;
    }
    h1 {
      font-size: var(--be-music-title-size, 1.75rem);
      font-weight: var(--be-music-title-weight, 600);
      letter-spacing: var(--be-music-title-tracking, normal);
      line-height: 1.15;
      overflow-wrap: anywhere;
    }
    h2 {
      font-size: 18px;
    }
    .eyebrow {
      font-size: 0.75rem;
      line-height: 1.3;
    }
    .columns {
      display: grid;
      flex: 1 1 auto;
      grid-template-columns: minmax(0, 1.5fr) minmax(16rem, 1fr);
      grid-template-rows: minmax(0, 1fr);
      gap: var(--be-music-section-gap, 24px);
      min-height: 0;
    }
    .columns > * {
      min-width: 0;
      min-height: 0;
    }
    .browse {
      display: flex;
      flex-direction: column;
      gap: var(--be-music-gap, 8px);
      min-height: 0;
    }
    .folder {
      flex-wrap: nowrap;
    }
    .folder .muted {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .select-filters > summary {
      display: none;
    }
    .select-filters > be-music-play-options {
      display: grid;
    }
    be-music-play-options {
      margin-bottom: var(--be-music-gap, 8px);
    }
    be-music-chart-list {
      flex: 1 1 auto;
      min-height: 0;
      --be-music-list-height: 100%;
    }
    be-music-chart-details {
      overflow: auto;
    }
    /* Decide and result: one column, as wide as its content allows and centred on the screen. */
    .center {
      display: grid;
      flex: 1 0 auto;
      align-content: center;
      gap: var(--be-music-section-gap, 24px);
      width: 100%;
      max-width: var(--be-music-center-width, 56rem);
      margin: 0 auto;
    }
    .center > .heading {
      gap: var(--be-music-gap, 8px);
    }
    /* A two-player result shows the players side by side. */
    .players {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(18rem, 100%), 1fr));
      gap: var(--be-music-section-gap, 24px);
    }
    .player {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      column-gap: var(--be-music-section-gap, 24px);
    }
    .player > .verdict {
      display: grid;
      align-content: start;
      gap: 4px;
    }
    .player > be-music-gauge-panel {
      grid-column: 1 / -1;
      --be-music-graph-height: 72px;
    }
    /* The gauge sits inside the player's panel. */
    .player > be-music-gauge-panel::part(panel) {
      padding: var(--be-music-gap, 8px) 0 0;
    }
    .result-verdict {
      font-size: clamp(20px, 2.5cqi, 26px);
      font-weight: 700;
      line-height: 1.2;
    }
    .result-play-tag {
      justify-self: start;
      border: 2px solid currentColor;
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 0.75rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      line-height: 1.3;
    }
    .player .verdict {
      gap: 8px;
    }
    .stat {
      font-size: var(--be-music-stat-size, 2.25rem);
      font-variant-numeric: tabular-nums;
      font-weight: 700;
      line-height: 1.1;
    }
    .center progress {
      height: 8px;
    }
    /* 40rem matches the previous 650px window breakpoint, measured on the screen itself. */
    @container be-music-screen (max-width: 40rem) {
      .columns {
        grid-template-columns: 1fr;
        grid-template-rows: minmax(12rem, 1fr) auto;
        gap: 12px;
      }
      .search {
        flex-basis: 100%;
      }
      .select-filters > summary {
        display: block;
        cursor: pointer;
        padding: 8px 0;
        font-size: 13px;
        font-weight: 600;
      }
      .select-filters:not([open]) > be-music-play-options {
        display: none;
      }
      be-music-chart-list {
        flex: 1 1 auto;
        --be-music-list-height: 100%;
      }
      be-music-chart-details {
        overflow: auto;
        max-height: 15rem;
        --be-music-panel-padding: 12px;
        --be-music-section-gap: 8px;
      }
    }
    /* A narrow player panel stacks its verdict over its figures. */
    @container be-music-screen (max-width: 30rem) {
      .player {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `,
];
