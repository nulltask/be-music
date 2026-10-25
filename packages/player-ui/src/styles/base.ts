import { css, type CSSResult } from 'lit';

/**
 * Shared structure for elements that do not adopt the Basecoat sheet themselves.
 * Color comes from the Basecoat tokens on the page (`--background`, `--foreground`, and the rest); they inherit into
 * the shadow root. Each element is an inline-size container named `be-music`. Screens rename it `be-music-screen`.
 */
export const baseStyles: CSSResult = css`
  :host {
    display: block;
    min-width: 0;
    container-type: inline-size;
    container-name: be-music;
    color-scheme: dark;
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
  h3 {
    font-size: 0.85em;
    margin-bottom: 6px;
    color: var(--primary, #edf2fa);
  }
  button,
  input,
  select {
    font: inherit;
    color: var(--secondary-foreground, inherit);
    border: 1px solid var(--border, #ffffff1a);
    border-radius: calc(var(--radius, 0.625rem) - 2px);
    background: var(--secondary, #27272a);
    padding: 8px 12px;
  }
  button {
    cursor: pointer;
  }
  button:hover {
    background: var(--accent, #3f3f46);
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  :focus-visible {
    outline: 3px solid var(--ring, #a1a1aa);
    outline-offset: 2px;
  }
  [hidden] {
    display: none !important;
  }
  .card {
    background: var(--card, #18181b);
    color: var(--card-foreground, inherit);
    border: 1px solid var(--border, #ffffff1a);
    border-radius: var(--radius, 0.625rem);
    padding: 8px;
  }
  .muted,
  dt {
    color: var(--muted-foreground, #a1a1aa);
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
    color: var(--muted-foreground, #a1a1aa);
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
    accent-color: var(--primary, #edf2fa);
  }
  svg {
    display: block;
    width: 100%;
    height: 44px;
    background: var(--background, #09090b);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .primary {
    background: var(--primary, #edf2fa);
    color: var(--primary-foreground, #18181b);
    font-weight: 700;
  }
`;
