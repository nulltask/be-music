import { css, type CSSResult } from 'lit';
export const gameplayStyles: CSSResult = css`
  /* Resolved on .hud against the stage, then inherited as lengths. The HUD column is its own container. */
  @property --be-music-hud-heading-block {
    syntax: '<length>';
    inherits: true;
    initial-value: 0px;
  }
  @property --be-music-hud-heading-inline {
    syntax: '<length>';
    inherits: true;
    initial-value: 0px;
  }
  @property --be-music-hud-extra-block {
    syntax: '<length>';
    inherits: true;
    initial-value: 0px;
  }
  @property --be-music-hud-extra-font {
    syntax: '<length>';
    inherits: true;
    initial-value: 11px;
  }
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
    container-type: inline-size;
    container-name: hud;
    --be-music-hud-heading-block: 23cqh;
    --be-music-hud-heading-inline: 14cqw;
    --be-music-hud-extra-block: 78cqh;
    --be-music-hud-extra-font: clamp(11px, 2.8cqw, 14px);
    --be-music-gap: 6px;
    --be-music-panel-padding: 8px;
    pointer-events: auto;
    font-size: clamp(10px, 1.35cqw, 14px);
    font-variant-numeric: tabular-nums;
  }
  /* Over the lanes, where the eye is, not over the HUD's figures. */
  .paused {
    position: absolute;
    left: var(--playfield-center, 50%);
    top: 50%;
    transform: translate(-50%, -50%);
    margin: 0;
    padding: 6px 14px;
    font-size: clamp(16px, 4cqh, 28px);
    font-weight: 700;
  }
  .hud-heading {
    min-width: 0;
    min-height: var(--be-music-hud-heading-block);
    padding-right: var(--be-music-hud-heading-inline);
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
    padding: var(--be-music-panel-padding, 8px);
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
    font-size: 0.85em;
  }
  .hud-extra {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(160px, 100%), 1fr));
    align-content: start;
    align-items: start;
    gap: 6px;
  }
  @container hud (max-width: 22rem) {
    .hud:not([data-orientation='portrait']) .actions {
      gap: 2px;
    }
    .hud:not([data-orientation='portrait']) .hud-extra {
      grid-template-columns: repeat(auto-fit, minmax(min(120px, 100%), 1fr));
    }
  }
  .gameplay[data-orientation='portrait'] .hud {
    --be-music-score-size: 1.3em;
    display: block;
    top: 0.9%;
    left: 2.5%;
    right: auto;
    bottom: auto;
    width: 75%;
    height: auto;
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
    padding: 0;
  }
  .gameplay[data-orientation='portrait'] .hud dl.hud-live {
    margin: 0;
  }
  /* The band above the lanes holds five lines; the time left is in the live figures already. */
  .gameplay[data-orientation='portrait'] .hud-primary > progress {
    display: none;
  }
  /* Basecoat's buttons are a fixed height; the portrait band above the lanes is not tall enough for it. */
  .gameplay[data-orientation='portrait'] .hud button {
    height: auto;
    min-height: 0;
    padding: 2px 6px;
  }
  .gameplay[data-orientation='portrait'] .hud .actions {
    margin-top: 4px;
    padding-right: 40%;
  }
  .gameplay[data-orientation='portrait'] .hud-details {
    overflow: visible;
  }
  /* Level with the action buttons: the same bottom edge, line height, padding and border, so the rows share a centre. */
  .gameplay[data-orientation='portrait'] .hud-details > summary {
    position: absolute;
    right: 4px;
    bottom: 2px;
    max-width: 40%;
    padding: 2px 6px;
    border: 1px solid transparent;
    line-height: var(--text-sm--line-height, calc(1.25 / 0.875));
  }
  .gameplay[data-orientation='portrait'] .hud-extra {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    width: 126%;
    padding: 6px;
    overflow: auto;
    overscroll-behavior: contain;
    grid-template-columns: repeat(auto-fit, minmax(min(145px, 100%), 1fr));
    max-height: var(--be-music-hud-extra-block);
    font-size: var(--be-music-hud-extra-font);
  }

  .hud-extra > * {
    min-width: 0;
  }
  .hud-extra > [wide] {
    grid-column: 1 / -1;
  }
`;
