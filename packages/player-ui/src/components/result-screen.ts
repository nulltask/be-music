import { html, nothing, type CSSResultGroup, type TemplateResult } from 'lit';
import type { BeMusicDOMResultFrame } from '@be-music/player-skin-sdk';
import { FrameElement } from '../base.ts';
import { screenStyles } from '../styles/screen.ts';
import { formatEnumLabel } from '../labels.ts';
import { stats } from '../templates.ts';

export class BeMusicResultScreenElement extends FrameElement<BeMusicDOMResultFrame> {
  static override styles: CSSResultGroup = screenStyles;
  protected override render(): TemplateResult | typeof nothing {
    const f = this.frame;
    if (!f) return nothing;
    const r = f.result;
    // A two-player play (LR2 BATTLE) shows both players' results side by side.
    const players = r.secondPlayer
      ? ([
          ['1P', r],
          ['2P', r.secondPlayer],
        ] as const)
      : ([['', r]] as const);
    return html`<section class="screen" part="screen">
      <div class="center">
        <div class="heading" part="header">
          <p class="eyebrow" part="eyebrow"><slot name="eyebrow">Play result</slot></p>
          <h1 part="title">${r.chart.title}</h1>
        </div>
        <div class="players" part="players" data-count=${players.length}>
          ${players.map(
            ([label, p]) =>
              html`<div class="panel player" part=${label ? `panel player-${label}` : 'panel'}>
                <div class="verdict">
                  <p class="muted">
                    ${label ? `${label} ` : ''}${formatEnumLabel(p.lamp ?? (p.cleared ? 'CLEARED' : 'FAILED'))}
                  </p>
                  <p class="stat" part="stat">${p.score.exScore} / ${p.score.total * 2}</p>
                  <p class="muted">EX SCORE</p>
                </div>
                ${stats([['Max combo', p.maxCombo], ['Gauge', `${p.gauge.toFixed(1)}%`], ...(['perfect', 'great', 'good', 'bad', 'poor', 'emptyPoor'] as const).map((key) => [formatEnumLabel(key), p.score[key]] as const)])}
                <be-music-gauge-panel
                  exportparts="panel:gauge-panel,graph:gauge-graph"
                  .data=${{ value: p.gauge, label: p.score.total > 0 ? 'Gauge' : '', cleared: p.cleared, history: p.gaugeHistory }}
                ></be-music-gauge-panel>
              </div>`,
          )}
        </div>
        <div class="actions" part="actions">
          <button class="btn" ?disabled=${!f.inputReady} @click=${() => this.emit('continue-request', undefined)}>
            Continue</button
          ><button
            class="btn"
            data-variant="outline"
            ?disabled=${!f.inputReady}
            @click=${() => this.emit('retry-request', undefined)}
          >
            Retry
          </button>
        </div>
        <slot></slot>
      </div>
    </section>`;
  }
}
