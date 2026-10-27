import { css, unsafeCSS, type CSSResult } from 'lit';
import { PREVIEW_THEME_CSS } from './preview-theme.generated.ts';

/** Basecoat, adopted inside the preview components' shadow roots. The page's `.dark` tokens inherit in. */
export const previewTheme: CSSResult = unsafeCSS(PREVIEW_THEME_CSS);

/**
 * Structure every Basecoat-based element shares, with neutral defaults. Colours come from the Basecoat tokens on the
 * page; spacing and type read the `--be-music-*` lengths documented in the package README, so a skin or an
 * application sets its own scale on an ancestor without overriding component rules. Class names stay clear of
 * Basecoat's components (`.card`, `.badge`, `.table`), whose spacing assumes Basecoat's own markup.
 */
export const previewHost: CSSResult = css`
  :host {
    display: block;
    min-width: 0;
    container-type: inline-size;
    container-name: be-music;
    color: var(--foreground, #edf2fa);
    font: inherit;
    font-family: var(--font-sans, system-ui, sans-serif);
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
  .muted,
  dt {
    color: var(--muted-foreground, #9baac0);
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
    background: var(--card, #18181b);
    color: var(--card-foreground, inherit);
    border: 1px solid var(--border, #ffffff1a);
    border-radius: var(--radius, 0.625rem);
  }
  .panel h3 {
    font-size: 0.85em;
    font-weight: 600;
    line-height: 1.2;
    color: var(--muted-foreground, #9baac0);
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
  th {
    font-weight: 500;
    color: var(--muted-foreground, #9baac0);
  }
  tbody th {
    color: inherit;
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
  progress {
    appearance: none;
    height: 6px;
    border: 0;
    border-radius: 999px;
    overflow: hidden;
    background: var(--muted, #27272a);
    color: var(--primary, #edf2fa);
  }
  progress::-webkit-progress-bar {
    background: var(--muted, #27272a);
  }
  progress::-webkit-progress-value {
    background: var(--primary, #edf2fa);
  }
  progress::-moz-progress-bar {
    background: var(--primary, #edf2fa);
  }
`;
