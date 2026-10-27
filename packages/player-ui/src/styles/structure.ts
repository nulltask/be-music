import { css, type CSSResult } from 'lit';

/**
 * Structure every element shares: layout, sizing and scrolling, and nothing a theme decides. No colour, border,
 * background or font family is set here; spacing reads the `--be-music-*` lengths documented in the package README, with
 * small defaults so an unthemed element still reads. A theme (`setBeMusicTheme`) adds the look.
 */
export const structureStyles: CSSResult = css`
  :host {
    display: block;
    min-width: 0;
    container-type: inline-size;
    container-name: be-music;
    font: inherit;
  }
  * {
    box-sizing: border-box;
  }
  h1,
  h2,
  h3,
  p {
    margin: 0;
  }
  [hidden] {
    display: none !important;
  }
  .muted {
    font-size: 0.85em;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
  dl {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 4px var(--be-music-gap, 8px);
    margin: 0;
    font-size: 0.85em;
  }
  dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--be-music-gap, 8px);
  }
  /* A titled box of related figures. */
  .panel {
    display: grid;
    align-content: start;
    gap: var(--be-music-gap, 8px);
    min-width: 0;
    padding: var(--be-music-panel-padding, 12px);
  }
  .panel h3 {
    font-size: 0.85em;
    line-height: 1.2;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85em;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    padding: 2px 0 2px var(--be-music-gap, 8px);
    text-align: right;
  }
  th:first-child,
  td:first-child {
    padding-left: 0;
    text-align: left;
  }
  /* Graphs stretch to the panel's width at a fixed height; their strokes keep their width. */
  svg {
    display: block;
    width: 100%;
    height: var(--be-music-graph-height, 44px);
    overflow: visible;
  }
  svg * {
    vector-effect: non-scaling-stroke;
  }
  progress,
  meter {
    display: block;
    width: 100%;
    min-width: 0;
  }
`;
