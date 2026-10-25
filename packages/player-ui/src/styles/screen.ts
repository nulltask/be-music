import { css, type CSSResultGroup } from 'lit';
import { previewHost, previewTheme } from './preview-theme.ts';

/** Full-screen composition; list, detail and option styling belongs to their own elements. */
export const screenStyles: CSSResultGroup = [
  previewTheme,
  previewHost,
  css`
    :host {
      height: 100%;
      min-height: 0;
      container-name: be-music-screen;
    }
    .screen {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      overflow: auto;
      pointer-events: auto;
      background: var(--background, #171717);
      padding: clamp(16px, 3cqi, 36px);
    }
    header {
      display: flex;
      flex: none;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 20px;
    }
    h1 {
      font-size: clamp(22px, 3cqi, 36px);
      letter-spacing: -0.035em;
    }
    h2 {
      font-size: 18px;
    }
    .eyebrow {
      color: var(--muted-foreground, #8da7c7);
      letter-spacing: 0.14em;
      font-size: 11px;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    .columns {
      display: grid;
      flex: 1 1 auto;
      grid-template-columns: minmax(0, 1.5fr) minmax(220px, 1fr);
      grid-template-rows: minmax(0, 1fr);
      gap: 24px;
      min-height: 0;
    }
    .columns > * {
      min-width: 0;
      min-height: 0;
    }
    .browse {
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    be-music-chart-list {
      flex: 1 1 auto;
      min-height: 0;
      --be-music-list-height: 100%;
    }
    be-music-chart-details {
      overflow: auto;
    }
    .panel {
      background: var(--card, #18212f);
      color: var(--card-foreground, inherit);
      border: 1px solid var(--border, #2c394c);
      border-radius: var(--radius, 14px);
      padding: 20px;
    }
    .panel dl {
      gap: 10px 18px;
    }
    /* A two-player result shows the players side by side. */
    .players {
      display: grid;
      gap: 16px;
    }
    .players[data-count='2'] {
      grid-template-columns: repeat(2, minmax(0, 320px));
    }
    .stat {
      font-size: clamp(24px, 4cqi, 44px);
      font-variant-numeric: tabular-nums;
      font-weight: 700;
    }
    input[type='search'] {
      width: min(380px, 100%);
    }
    progress {
      height: 18px;
    }
    .center {
      display: grid;
      flex: 1 1 auto;
      place-content: center;
      gap: 20px;
      width: 100%;
      max-width: 720px;
      margin: auto;
    }
    /* 40rem matches the previous 650px window breakpoint, measured on the screen itself. */
    @container be-music-screen (max-width: 40rem) {
      .columns {
        flex: none;
        grid-template-columns: 1fr;
        grid-template-rows: none;
      }
      header {
        flex-wrap: wrap;
      }
      be-music-chart-list {
        flex: none;
        --be-music-list-height: 18rem;
      }
      be-music-chart-details {
        overflow: visible;
      }
    }
  `,
];
