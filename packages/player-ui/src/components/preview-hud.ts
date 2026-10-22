import { css, html, nothing, type CSSResultGroup, type PropertyDeclarations, type TemplateResult } from 'lit';
import type { BeMusicDOMGameplayFrame } from '@be-music/player-skin-sdk';
import { FrameElement } from '../base.ts';
import { resolveGameplayPanels } from '../gameplay-data.ts';
import { baseStyles } from '../styles/base.ts';

/**
 * The HUD of a preview: the chart's facts, score, combo, gauge and judgments under the BGA, and video-player controls
 * along the bottom of the stage. Lay it over `be-music-playfield`; the volume, mute and full-screen state are the
 * host's, set as properties.
 */
export class BeMusicPreviewHUDElement extends FrameElement<BeMusicDOMGameplayFrame> {
  static override properties: PropertyDeclarations = {
    ...FrameElement.properties,
    volume: { type: Number },
    muted: { type: Boolean },
    fullscreen: { type: Boolean },
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
      .paused {
        position: absolute;
        left: 25%;
        top: 45%;
        transform: translate(-50%, -50%);
        padding: 0.3em 0.8em;
        border-radius: 6px;
        background: #05070bcc;
        font-size: 1.6em;
        font-weight: 700;
      }
      be-music-playback-controls {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        pointer-events: auto;
      }
    `,
  ];
  declare volume: number;
  declare muted: boolean;
  declare fullscreen: boolean;

  constructor() {
    super();
    this.volume = 1;
    this.muted = false;
    this.fullscreen = false;
  }

  protected override render(): TemplateResult | typeof nothing {
    const f = this.frame;
    if (!f) return nothing;
    const { score, gauge, judgments, title, facts, seconds } = resolveGameplayPanels(f);
    const { stage, bga, playfield } = f.layout;
    const left = bga ? bga.x : playfield.right + 24;
    const top = bga ? bga.y + bga.h + 12 : 16;
    const right = bga ? bga.x + bga.w : stage.width - 16;
    const box = `left:${(left / stage.width) * 100}%;top:${(top / stage.height) * 100}%;width:${((right - left) / stage.width) * 100}%;bottom:14%`;
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
      ${f.stage === 'paused' ? html`<p class="paused" part="paused" role="status">Paused</p>` : nothing}
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
