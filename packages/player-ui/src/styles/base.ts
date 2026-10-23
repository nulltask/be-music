import { css, type CSSResult } from 'lit';

/**
 * Shared tokens cross shadow roots; each component owns its structural styles.
 * Each element is an inline-size container named `be-music`, so its layout follows its own width.
 * Screens rename that container to `be-music-screen`.
 */
export const baseStyles: CSSResult = css`
  :host {
    display: block;
    min-width: 0;
    container-type: inline-size;
    container-name: be-music;
    color-scheme: dark;
    color: var(--be-music-color-text, #edf2fa);
    font: inherit;
    font-family: var(--be-music-font, system-ui, sans-serif);
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
  h3 {
    font-size: 0.85em;
    margin-bottom: 6px;
    color: var(--be-music-color-accent, #abcaff);
  }
  button,
  input,
  select {
    font: inherit;
    color: inherit;
    border: 1px solid #38465c;
    border-radius: 8px;
    background: var(--be-music-control-background, #1a2433);
    padding: 8px 12px;
  }
  button {
    cursor: pointer;
  }
  button:hover {
    background: #293950;
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  :focus-visible {
    outline: 3px solid var(--be-music-focus-color, #91bfff);
    outline-offset: 2px;
  }
  [hidden] {
    display: none !important;
  }
  .card {
    background: var(--be-music-panel-background, #18212fee);
    border: 1px solid #2c394c;
    border-radius: var(--be-music-radius, 6px);
    padding: 8px;
  }
  .muted,
  dt {
    color: var(--be-music-color-muted, #9baac0);
  }
  .muted {
    font-size: 0.85em;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
  dl {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 3px 8px;
    margin: 4px 0;
    font-size: 0.85em;
  }
  dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8em;
    font-variant-numeric: tabular-nums;
  }
  th {
    font-weight: 500;
    color: var(--be-music-color-muted, #9baac0);
    text-align: left;
  }
  td,
  thead th:not(:first-child) {
    text-align: right;
  }
  th,
  td {
    padding: 2px 3px;
  }
  meter,
  progress {
    width: 100%;
    accent-color: var(--be-music-color-accent, #abcaff);
  }
  svg {
    display: block;
    width: 100%;
    height: 44px;
    background: var(--be-music-color-background, #10151f);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .primary {
    background: var(--be-music-color-accent, #abcaff);
    color: #10151f;
    font-weight: 700;
  }
`;
