import { css, type CSSResult } from 'lit';
export const gameplayStyles: CSSResult = css`
  :host {
    display: block;
    position: absolute;
    inset: 0;
    container-type: size;
    pointer-events: none;
  }
  .gameplay {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(100cqw, calc(100cqh * var(--stage-ratio, 1)));
    height: min(100cqh, calc(100cqw / var(--stage-ratio, 1)));
    container-type: size;
    pointer-events: none;
  }
  .hud {
    position: absolute;
    left: var(--hud-left, 65%);
    right: 2.8%;
    top: 1.5%;
    bottom: 1.5%;
    display: grid;
    grid-template-rows: auto auto auto minmax(0, 1fr);
    gap: 6px;
    pointer-events: auto;
    font-size: clamp(10px, 1.35cqw, 14px);
    font-variant-numeric: tabular-nums;
  }
  .hud-heading {
    min-width: 0;
    min-height: 23cqh;
    padding-right: 14cqw;
  }
  .gameplay[data-bga='off'] .hud-heading {
    min-height: 0;
    padding-right: 0;
  }
  .hud .eyebrow {
    margin: 0;
    font-size: 0.8em;
    white-space: nowrap;
  }
  .hud h2 {
    font-size: 1.1em;
    margin: 4px 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hud .muted {
    font-size: 0.85em;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .hud-primary {
    background: var(--be-music-panel-background, #18212f);
    border-radius: 6px;
    padding: 6px;
  }
  .hud dl {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 3px 6px;
    margin: 4px 0;
    font-size: 0.85em;
  }
  .hud dd {
    text-align: right;
    overflow-wrap: anywhere;
    max-width: 16em;
  }
  .hud dl.hud-live {
    display: flex;
    flex-wrap: wrap;
    gap: 3px 6px;
  }
  .hud-live dd {
    margin-right: 6px;
  }
  .hud progress {
    display: block;
    height: 4px;
    margin-top: 4px;
  }
  .hud button {
    padding: 4px 8px;
    font-size: 0.85em;
  }
  .hud .actions {
    gap: 4px;
  }
  .hud-details {
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
  }
  .hud-details > summary {
    padding: 3px 0 6px;
    cursor: pointer;
    color: #b8c7da;
    font-size: 0.85em;
  }
  .hud-extra {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(160px, 100%), 1fr));
    align-content: start;
    align-items: start;
    gap: 6px;
  }
  .hud-card {
    min-width: 0;
    padding: 6px;
    background: var(--be-music-panel-background, #18212fee);
    border: 1px solid #2c394c;
    border-radius: 6px;
  }
  .hud-card h3 {
    font-size: 0.85em;
    margin: 0 0 6px;
    color: var(--be-music-color-accent, #abcaff);
  }
  .gameplay[data-orientation='portrait'] .hud {
    --be-music-score-size: 1.3em;
    display: block;
    top: 0.9%;
    left: 2.5%;
    right: auto;
    bottom: auto;
    width: 75%;
    height: 11.5%;
    padding: 2px 4px;
    font-size: clamp(9px, 2.5cqw, 14px);
  }
  .gameplay[data-orientation='portrait'] .hud-heading {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-height: 0;
    padding: 0;
  }
  .gameplay[data-orientation='portrait'] .hud-heading h2 {
    flex: 1;
    min-width: 0;
    margin: 0;
  }
  .gameplay[data-orientation='portrait'] .hud-heading p {
    display: none;
  }
  .gameplay[data-orientation='portrait'] .hud-primary {
    padding: 2px 0;
    background: transparent;
  }
  .gameplay[data-orientation='portrait'] .hud dl.hud-live {
    margin: 2px 0;
  }
  .gameplay[data-orientation='portrait'] .hud button {
    padding: 2px 6px;
  }
  .gameplay[data-orientation='portrait'] .hud .actions {
    margin-top: 2px;
    padding-right: 40%;
  }
  .gameplay[data-orientation='portrait'] .hud-details {
    overflow: visible;
  }
  .gameplay[data-orientation='portrait'] .hud-details > summary {
    position: absolute;
    right: 4px;
    bottom: 0;
    max-width: 40%;
    padding: 2px 4px;
    border-radius: 4px;
    background: #293950;
  }
  .gameplay[data-orientation='portrait'] .hud-extra {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    width: 126%;
    max-height: 78cqh;
    padding: 6px;
    background: #10151ff5;
    border: 1px solid #38465c;
    border-radius: 8px;
    overflow: auto;
    overscroll-behavior: contain;
    grid-template-columns: repeat(auto-fit, minmax(min(145px, 100%), 1fr));
    font-size: clamp(11px, 2.8cqw, 14px);
  }

  .hud-extra > * {
    min-width: 0;
  }
  .hud-extra > [wide] {
    grid-column: 1 / -1;
  }
`;
