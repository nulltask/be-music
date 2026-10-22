import { css, html, nothing, type CSSResultGroup, type PropertyDeclarations, type TemplateResult } from 'lit';
import type { BeMusicDOMGameplayFrame } from '@be-music/player-skin-sdk';
import { FrameElement } from '../base.ts';
import { resolveGameplayPanels } from '../gameplay-data.ts';
import { resolvePreviewInfoBox } from '../preview-layout.ts';
import { baseStyles } from '../styles/base.ts';

/**
 * The HUD of a preview: the chart's facts, score, combo, gauge and judgments beside or under the BGA
 * (`resolvePreviewInfoBox`), and video-player controls
 * along the bottom of the stage. Lay it over `be-music-playfield`; the volume, mute and full-screen state are the
 * host's, set as properties, and so is hiding the controls (`controlsHidden`) while the viewer is idle.
 */
export class BeMusicPreviewHUDElement extends FrameElement<BeMusicDOMGameplayFrame> {
  static override properties: PropertyDeclarations = {
    ...FrameElement.properties,
    volume: { type: Number },
    muted: { type: Boolean },
    fullscreen: { type: Boolean },
    controlsHidden: { type: Boolean, attribute: 'controls-hidden', reflect: true },
  };
  static override styles: CSSResultGroup = [
    baseStyles,
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
      .info {
        position: absolute;
        display: grid;
        align-content: start;
        gap: 0.4em;
        overflow: hidden;
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
      .muted {
        color: var(--be-music-color-muted, #b8c7da);
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
      dt {
        color: var(--be-music-color-muted, #b8c7da);
      }
      dd {
        margin: 0;
      }
      .resume {
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        display: grid;
        place-items: center;
        width: clamp(56px, 18cqh, 96px);
        aspect-ratio: 1;
        border-radius: 50%;
        background: #05070bcc;
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

  constructor() {
    super();
    this.volume = 1;
    this.muted = false;
    this.fullscreen = false;
    this.controlsHidden = false;
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
    return html`<section class="stage" part="stage" style=${`--stage-ratio:${stage.width / stage.height}`}>
      <div class="info" part="info" style=${box} aria-label="Chart and play status">
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
              class="resume"
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
          playing: f.stage !== 'paused' && f.stage !== 'ending',
          seekable: f.seekable,
          volume: this.volume,
          muted: this.muted,
          fullscreen: this.fullscreen,
        }}
      ></be-music-playback-controls>
    </section>`;
  }
}
