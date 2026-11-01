import { css, type CSSResult } from 'lit';

/**
 * The cabinet arrangement of the gameplay HUD: every panel absolutely placed on the letterboxed stage, and type sized in
 * stage pixels (`--px`, one design pixel), so the HUD scales with the stage like the playfield under it. Colour comes
 * from the theme; the bars and keys fall back to the text colour so an unthemed HUD still reads.
 */
export const cabinetStyles: CSSResult = css`
  .cabinet {
    --px: calc(100cqh / var(--stage-height, 480));
    font-size: calc(var(--px) * 10);
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
  }
  .cab {
    position: absolute;
    min-width: 0;
    margin: 0;
    pointer-events: auto;
  }
  .cabinet .panel {
    display: block;
    padding: calc(var(--px) * 5) calc(var(--px) * 8);
    border-radius: calc(var(--px) * 4);
    overflow: hidden;
  }
  .cabinet .eyebrow {
    display: block;
    margin: 0;
    font-size: 0.8em;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cabinet dl {
    gap: calc(var(--px) * 1) calc(var(--px) * 6);
    font-size: 1em;
  }
  .play-frame {
    pointer-events: none;
  }
  .chart-progress {
    pointer-events: none;
    overflow: hidden;
  }
  .progress-fill {
    width: 100%;
    background: currentColor;
    opacity: 0.6;
  }
  .keys {
    pointer-events: none;
  }
  .key {
    position: absolute;
    top: 20%;
    bottom: 0;
    padding: 0 calc(var(--px) * 1);
    background-clip: content-box;
    background-color: currentColor;
    opacity: 0.75;
  }
  .key[data-kind='black'] {
    top: 0;
    bottom: 20%;
    opacity: 0.35;
  }
  .key[data-kind='scratch'],
  .key[data-kind='wheel-up'],
  .key[data-kind='wheel-down'] {
    top: 0;
    border-radius: 50%;
    aspect-ratio: 1;
    width: auto !important;
    opacity: 0.35;
  }
  .figure strong {
    position: absolute;
    right: calc(var(--px) * 8);
    bottom: calc(var(--px) * 4);
    font-size: 2em;
    font-weight: 700;
  }
  .center {
    display: grid !important;
    place-items: center;
    padding: 0 !important;
  }
  .center strong {
    font-size: 1.6em;
  }
  /* The double-play row under the keys is short, and the chart panel a narrow stack. */
  .cabinet[data-double-play] .figure strong {
    font-size: 1.5em;
  }
  .cabinet[data-double-play] .players {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto;
    align-content: center;
    gap: calc(var(--px) * 3);
  }
  .cabinet[data-double-play] .players .chart-title {
    grid-row: 1;
    text-align: left;
  }
  .cabinet[data-double-play] .players .chart-title h2 {
    font-size: 1.3em;
  }
  .cabinet[data-double-play] .players .plate {
    grid-row: 2;
    grid-auto-flow: column;
    justify-content: start;
    align-items: center;
    gap: calc(var(--px) * 6);
  }
  .cabinet[data-double-play] .players .plate[part~='second-player'] {
    display: none;
  }
  /* The double-play band beside the menu corner holds only the buttons, set smaller to fit. */
  .controls {
    justify-content: center;
    padding-inline: calc(var(--px) * 3) !important;
  }
  .controls .actions {
    flex-wrap: nowrap;
    gap: calc(var(--px) * 2);
    min-width: 0;
  }
  .controls button {
    flex: 0 1 auto;
    min-width: 0;
    padding: 0 calc(var(--px) * 3) !important;
    font-size: 0.75em;
    overflow: hidden;
  }
  .cabinet[data-double-play] .stage-band .eyebrow {
    width: auto;
  }
  /* The double-play BPM row is short: MIN, the BPM and MAX side by side. */
  .cabinet[data-double-play] .bpm {
    grid-template: 'min number max' auto 'min label max' auto / 1fr auto 1fr;
    align-items: center;
    padding-block: 0 !important;
  }
  .cabinet[data-double-play] .bpm strong {
    grid-area: number;
    font-size: 1.8em;
    line-height: 1;
  }
  .cabinet[data-double-play] .bpm-range {
    display: contents;
  }
  .cabinet[data-double-play] .bpm-range > :first-child {
    grid-area: min;
    justify-self: start;
  }
  .cabinet[data-double-play] .bpm-range > .eyebrow {
    grid-area: label;
    text-align: center;
  }
  .cabinet[data-double-play] .bpm-range > :last-child {
    grid-area: max;
    justify-self: end;
  }
  .graph-header dl {
    margin-top: calc(var(--px) * 3);
  }
  .graph-header dd {
    font-size: 1.5em;
    font-weight: 700;
  }
  .graph {
    display: grid !important;
    grid-template-rows: auto minmax(0, 1fr) auto;
  }
  .plot {
    position: relative;
    margin: calc(var(--px) * 4) 0;
  }
  .rank-line {
    position: absolute;
    left: 0;
    right: 0;
    border-bottom: 1px solid;
    font-size: 0.85em;
    opacity: 0.6;
  }
  .bars {
    position: absolute;
    inset: 0 0 0 calc(var(--px) * 26);
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: calc(var(--px) * 6);
  }
  .bar {
    position: relative;
  }
  .bar-full,
  .bar-now {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    background: currentColor;
  }
  .bar-full {
    opacity: 0.2;
  }
  .diffs dd {
    font-weight: 700;
  }
  /* The lane option on top, the pacemaker box on the foot. */
  .graph-footer {
    display: grid !important;
    grid-template-rows: auto 1fr;
    align-items: end;
    gap: calc(var(--px) * 6);
  }
  .option-row {
    display: flex;
    align-self: start;
    justify-content: space-between;
    align-items: baseline;
    gap: calc(var(--px) * 6);
    min-width: 0;
  }
  .graph-footer strong {
    font-size: 1.1em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pacemaker {
    width: 100%;
    padding: calc(var(--px) * 6) 0;
    border: 1px solid;
    border-radius: calc(var(--px) * 4);
    text-align: center;
    font-weight: 700;
  }
  .stage-band {
    display: flex !important;
    align-items: center;
    gap: calc(var(--px) * 8);
    padding-block: 0 !important;
  }
  .stage-band strong {
    flex: 1;
    min-width: 0;
    text-align: center;
    font-size: 1.3em;
    letter-spacing: 0.1em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .stage-band .eyebrow {
    flex: none;
    width: calc(var(--px) * 70);
  }
  .stage-band .actions {
    flex: none;
    gap: calc(var(--px) * 3);
  }
  .stage-band button {
    height: auto;
    min-height: 0;
    padding: calc(var(--px) * 1) calc(var(--px) * 6);
    font-size: 0.9em;
  }
  .players {
    display: grid !important;
    grid-template-columns: calc(var(--px) * 84) minmax(0, 1fr) auto;
    align-items: center;
    gap: calc(var(--px) * 8);
  }
  .plate {
    display: grid;
    justify-items: center;
    gap: calc(var(--px) * 2);
    min-width: 0;
  }
  .plate strong {
    font-size: 1.2em;
  }
  .difficulty {
    padding: 0 calc(var(--px) * 8);
    border-radius: calc(var(--px) * 3);
    font-size: 0.85em;
    font-weight: 700;
  }
  .chart-title {
    min-width: 0;
    text-align: center;
  }
  .chart-title h2 {
    font-size: 1.5em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* The counts run down the panel's full height, as the timing meter does. */
  .judge {
    display: grid !important;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) calc(var(--px) * 24);
    grid-template-rows: minmax(0, 1fr);
    align-content: stretch !important;
    gap: calc(var(--px) * 8);
  }
  .judge .counts {
    align-content: space-between;
  }
  /* The gauge's label and meter sit in the middle of their box. */
  be-music-gauge-panel.cab {
    display: grid;
    align-content: center;
  }
  .sound-only {
    display: grid !important;
    grid-template-rows: minmax(0, 1fr);
    place-items: end center;
    padding-bottom: calc(var(--px) * 14) !important;
    pointer-events: none;
  }
  .sound-only .eyebrow {
    letter-spacing: 0.4em;
  }
  .judge .fast-slow {
    grid-template-columns: 1fr;
    justify-items: center;
    align-content: center;
  }
  .fast-slow dd {
    font-size: 1.3em;
    font-weight: 700;
  }
  .timing {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    justify-items: center;
    font-size: 0.8em;
  }
  .timing-track {
    position: relative;
    width: calc(var(--px) * 4);
    background: currentColor;
    opacity: 0.35;
  }
  .timing-mark {
    position: absolute;
    left: calc(var(--px) * -4);
    width: calc(var(--px) * 12);
    height: calc(var(--px) * 3);
    transform: translateY(50%);
    background: currentColor;
  }
  .bpm {
    display: grid !important;
    grid-template-rows: auto auto;
    justify-items: center;
  }
  .bpm strong {
    font-size: 2.2em;
    font-weight: 700;
  }
  .bpm-range {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: end;
    width: 100%;
    font-weight: 700;
  }
  .bpm-range > :last-child {
    text-align: right;
  }
  .tempo {
    display: flex !important;
    align-items: center;
    justify-content: space-between;
  }
  .tempo strong {
    font-size: 1.3em;
  }
  .cabinet-details {
    overflow: auto;
    overscroll-behavior: contain;
    font-size: calc(var(--px) * 10);
  }
  .cabinet-details .hud-extra {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(150px, 100%), 1fr));
    gap: calc(var(--px) * 6);
    padding: calc(var(--px) * 6);
  }
`;
