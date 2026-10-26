import { html, nothing, type CSSResultGroup, type TemplateResult } from 'lit';
import type { BeMusicDOMResultFrame } from '@be-music/player-skin-sdk';
import { FrameElement } from '../base.ts';
import { screenStyles } from '../styles/screen.ts';
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
        <p class="eyebrow">Play result</p>
        <h1>${r.chart.title}</h1>
        <div class="players" part="players" data-count=${players.length}>
          ${players.map(
            ([label, p]) =>
              html`<div class="panel" part=${label ? `panel player-${label}` : 'panel'}>
                <p class="muted">${label ? `${label} ` : ''}${p.lamp ?? (p.cleared ? 'CLEARED' : 'FAILED')}</p>
                <p class="stat">${p.score.exScore} / ${p.score.total * 2}</p>
                <p class="muted">${label ? `${label} ` : ''}EX SCORE</p>
                ${stats([['Max combo', p.maxCombo], ['Gauge', `${p.gauge.toFixed(1)}%`], ...(['perfect', 'great', 'good', 'bad', 'poor', 'emptyPoor'] as const).map((key) => [key.toUpperCase(), p.score[key]] as const)])}
                <be-music-gauge-panel
                  exportparts="panel:gauge-panel,graph:gauge-graph"
                  .data=${{ value: p.gauge, label: p.score.total > 0 ? 'Gauge' : '', cleared: p.cleared, history: p.gaugeHistory }}
                ></be-music-gauge-panel>
              </div>`,
          )}
        </div>
        <div class="actions">
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
