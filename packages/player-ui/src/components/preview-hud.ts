import { css, html, nothing, type CSSResultGroup, type PropertyDeclarations, type TemplateResult } from 'lit';
import type { BeMusicDOMGameplayFrame } from '@be-music/player-skin-sdk';
import { FrameElement } from '../base.ts';
import { resolveGameplayPanels } from '../gameplay-data.ts';
import { PREVIEW_PORTRAIT_FONT_RATIO, resolvePreviewInfoBox } from '../preview-layout.ts';
import { structureStyles } from '../styles/structure.ts';

/**
 * The HUD of a preview: the chart's facts, score, combo, gauge and judgments beside or under the BGA
 * (`resolvePreviewInfoBox`), and video-player controls
 * along the bottom of the stage. Lay it over `be-music-playfield`; the volume, mute and full-screen state are the
 * host's, set as properties, and so is hiding the controls (`controlsHidden`) while the viewer is idle. A click on the
 * stage pauses and resumes the play unless the host turns it off (`stageTapPauses`), as it does while the viewer plays.
 */
export class BeMusicPreviewHUDElement extends FrameElement<BeMusicDOMGameplayFrame> {
  static override properties: PropertyDeclarations = {
    ...FrameElement.properties,
    volume: { type: Number },
    muted: { type: Boolean },
    fullscreen: { type: Boolean },
    controlsHidden: { type: Boolean, attribute: 'controls-hidden', reflect: true },
    stageTapPauses: { type: Boolean, attribute: false },
  };
  static override styles: CSSResultGroup = [
    structureStyles,
    css`
      :host {
        display: block;
        position: absolute;
        inset: 0;
        container-type: size;
        pointer-events: none;
      }
      .stage {
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        width: min(100cqw, calc(100cqh * var(--stage-ratio, 1)));
        height: min(100cqh, calc(100cqw / var(--stage-ratio, 1)));
        container-type: size;
        font-size: clamp(9px, 2.6cqh, 15px);
        font-variant-numeric: tabular-nums;
      }
      /* A tall stage sets the facts in their own band, so their type follows the stage's width to fit it. */
      .stage[data-orientation='portrait'] {
        font-size: max(9px, calc(min(100cqw, 100cqh * var(--stage-ratio, 1)) * var(--portrait-font-ratio)));
      }
      .stage-hit {
        position: absolute;
        inset: 0;
        padding: 0;
        border: 0;
        border-radius: 0;
        background: transparent;
        pointer-events: auto;
        cursor: pointer;
      }
      /* The shared button hover fills the control; this hit target must stay clear of the lanes and BGA. */
      .stage-hit:hover,
      .stage-hit:active,
      .stage-hit:focus,
      .stage-hit:focus-visible {
        background: transparent;
        border-color: transparent;
      }
      .info {
        position: absolute;
        display: grid;
        /* Rows keep their height in a box too short for them: the facts clip at the bottom instead of overlapping. */
        grid-auto-rows: max-content;
        align-content: start;
        gap: 0.4em;
        overflow: hidden;
        pointer-events: none;
        container-type: inline-size;
        container-name: preview-info;
      }
      @container preview-info (max-width: 22rem) {
        .judgments {
          gap: 0 0.45em;
        }
      }
      h2 {
        font-size: 1.15em;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .line {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .judgments {
        display: flex;
        flex-wrap: wrap;
        gap: 0 0.9em;
        margin: 0;
      }
      .judgments div {
        display: flex;
        gap: 0.35em;
      }
      dd {
        margin: 0;
      }
      .resume {
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        /* Sized by its icon, which follows the stage's height, not by the theme's fixed icon-button size. */
        width: auto;
        height: auto;
        padding: 0.6em;
        pointer-events: auto;
      }
      .resume svg {
        width: clamp(30px, 10cqh, 52px);
        height: clamp(30px, 10cqh, 52px);
        margin-left: 6%;
        background: none;
        fill: currentColor;
      }
      be-music-playback-controls {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        pointer-events: auto;
        transition: opacity 0.3s ease;
      }
      :host([controls-hidden]) be-music-playback-controls {
        opacity: 0;
        pointer-events: none;
      }
    `,
  ];
  declare volume: number;
  declare muted: boolean;
  declare fullscreen: boolean;
  /** Fades the video controls out; the host sets it when the viewer has been idle during a play. */
  declare controlsHidden: boolean;
  /** A click on the stage pauses and resumes the play. Off, the stage takes no clicks: only the controls pause. */
  declare stageTapPauses: boolean;

  constructor() {
    super();
    this.volume = 1;
    this.muted = false;
    this.fullscreen = false;
    this.controlsHidden = false;
    this.stageTapPauses = true;
  }

  protected override render(): TemplateResult | typeof nothing {
    const f = this.frame;
    if (!f) return nothing;
    const { score, gauge, judgments, title, facts, seconds } = resolveGameplayPanels(f);
    const { stage } = f.layout;
    const info = resolvePreviewInfoBox(f.layout);
    const box = `left:${(info.left / stage.width) * 100}%;top:${(info.top / stage.height) * 100}%;width:${((info.right - info.left) / stage.width) * 100}%;bottom:${((stage.height - info.bottom) / stage.height) * 100}%`;
    const bpm = f.bpm === undefined ? undefined : `BPM ${Math.round(f.bpm)}`;
    const rate = score.maximum > 0 ? `${((score.exScore / score.maximum) * 100).toFixed(2)}%` : '—';
    const playing = f.stage !== 'paused' && f.stage !== 'ending';
    return html`<section
      class="stage"
      part="stage"
      data-orientation=${stage.height > stage.width ? 'portrait' : 'landscape'}
      style=${`--stage-ratio:${stage.width / stage.height};--portrait-font-ratio:${PREVIEW_PORTRAIT_FONT_RATIO}`}
    >
      ${
        this.stageTapPauses
          ? html`<button
              class="stage-hit"
              part="stage-hit"
              aria-label=${playing ? 'Pause' : 'Play'}
              @click=${() => this.emit('pause-request', undefined)}
            ></button>`
          : nothing
      }
      <div class="info" part="info" style=${box} aria-label="Chart and play status">
        ${
          f.course === undefined
            ? nothing
            : html`<p class="line muted" part="course">
                ${f.course.title} ·
                ${f.course.stageIndex === undefined ? `${f.course.stages.length} stages` : `Stage ${f.course.stageIndex + 1} / ${f.course.stages.length}`}
              </p>`
        }
        <h2 title=${title}>${title}</h2>
        <p class="line muted">${f.chart?.artist ?? ''}</p>
        <p class="line muted">${[facts, bpm].filter(Boolean).join(' · ')}</p>
        <p class="line">
          EX SCORE <b>${score.exScore}</b> · ${score.rank ?? '—'} · ${rate} · Combo <b>${score.combo}</b> /
          ${score.maxCombo}
        </p>
        <be-music-gauge-panel compact exportparts="meter:gauge-meter" .data=${gauge}></be-music-gauge-panel>
        <dl class="judgments" part="judgments">
          ${(
            [
              ['PG', judgments.perfect],
              ['GR', judgments.great],
              ['GD', judgments.good],
              ['BD', judgments.bad],
              ['PR', judgments.poor + judgments.emptyPoor],
              ['FAST', judgments.fast],
              ['SLOW', judgments.slow],
            ] as const
          ).map(
            ([label, value]) =>
              html`<div>
                <dt>${label}</dt>
                <dd>${value}</dd>
              </div>`,
          )}
        </dl>
      </div>
      ${
        f.stage === 'paused'
          ? html`<button
              class="btn resume"
              data-size="icon-lg"
              part="resume"
              aria-label="Play"
              @click=${() => this.emit('pause-request', undefined)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
            </button>`
          : nothing
      }
      <be-music-playback-controls
        exportparts="bar:controls,seek,play,mute,volume,time,fullscreen"
        .data=${{
          currentSeconds: seconds,
          durationSeconds: f.state.totalSeconds,
          playing,
          seekable: f.seekable,
          volume: this.volume,
          muted: this.muted,
          fullscreen: this.fullscreen,
        }}
      ></be-music-playback-controls>
    </section>`;
  }
}
