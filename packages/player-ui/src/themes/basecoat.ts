import { css, unsafeCSS } from 'lit';
import type { BeMusicTheme } from '../theme.ts';
import { BASECOAT_THEME_CSS } from './basecoat.generated.ts';

/**
 * The Basecoat look: Basecoat's components (the elements' buttons, fields and selects carry its class names) and the
 * colours, borders and backgrounds of the elements' own parts, all from the page's Basecoat tokens (`--background`,
 * `--card`, `--border`, `--primary`, `--muted-foreground`, `--radius` and the rest), which inherit into the shadow
 * roots. Pass it to `defineBeMusicElements(registry, { theme: basecoatTheme })`.
 */
export const basecoatTheme: BeMusicTheme = [
  unsafeCSS(BASECOAT_THEME_CSS),
  css`
    :host {
      color: var(--foreground, #edf2fa);
      font-family: var(--font-sans, system-ui, sans-serif);
    }
    .muted,
    .artist,
    .facts,
    dt,
    th,
    .eyebrow,
    .panel h3,
    label:not([part~='meter']),
    summary {
      color: var(--muted-foreground, #9baac0);
    }
    tbody th {
      color: inherit;
    }
    .panel,
    .hud-primary {
      background: var(--card, #18181b);
      color: var(--card-foreground, inherit);
      border: 1px solid var(--border, #ffffff1a);
      border-radius: var(--radius, 0.625rem);
    }
    .panel h3 {
      font-weight: 600;
    }
    progress {
      appearance: none;
      height: 6px;
      border: 0;
      border-radius: 999px;
      overflow: hidden;
      background: var(--muted, #27272a);
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
    .screen,
    :host(be-music-preview-select) {
      background: var(--background, #171717);
    }
    .search-error {
      color: var(--destructive, #f87171);
    }
    /* The chart list: the current row filled, the level in the primary colour. */
    [part~='row'] {
      border-color: transparent;
    }
    [part~='row'][aria-current='true'] {
      background: var(--accent, #293d59);
      color: var(--accent-foreground, inherit);
      border-color: var(--border, transparent);
    }
    [part~='row-kind'] {
      color: var(--primary, #abcaff);
    }
    /* A gauge inside a result's panel: a rule above it instead of a box of its own. */
    .player > be-music-gauge-panel::part(panel) {
      background: none;
      border: 0;
      border-top: 1px solid var(--border, #ffffff1a);
      border-radius: 0;
    }
    [part~='paused'] {
      background: color-mix(in oklch, var(--background, #09090b) 80%, transparent);
      border-radius: var(--radius, 0.625rem);
    }
    .gameplay[data-orientation='portrait'] .hud-primary {
      background: transparent;
      border: 0;
    }
    .gameplay[data-orientation='portrait'] .hud-details > summary {
      border-radius: calc(var(--radius, 0.625rem) - 4px);
      background: var(--accent, #3f3f46);
      color: var(--accent-foreground, inherit);
    }
    .gameplay[data-orientation='portrait'] .hud-extra {
      background: color-mix(in oklch, var(--background, #09090b) 96%, transparent);
      border: 1px solid var(--border, #ffffff1a);
      border-radius: var(--radius, 0.625rem);
    }
    .thumb {
      background: var(--muted, #0c1018);
      border-radius: calc(var(--radius, 0.625rem) - 4px);
    }
  `,
];
