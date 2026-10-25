import { css, unsafeCSS, type CSSResult } from 'lit';
import { PREVIEW_THEME_CSS } from './preview-theme.generated.ts';

/** Basecoat, adopted inside the preview components' shadow roots. The page's `.dark` tokens inherit in. */
export const previewTheme: CSSResult = unsafeCSS(PREVIEW_THEME_CSS);

/** Resets that must not paint over Basecoat's buttons. */
export const previewHost: CSSResult = css`
  :host {
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
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
`;
