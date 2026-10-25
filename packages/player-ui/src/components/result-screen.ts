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
    return html`<section class="screen" part="screen">
      <div class="center">
        <p class="eyebrow">Play result</p>
        <h1>${r.chart.title}</h1>
        <p class="muted">${r.lamp ?? (r.cleared ? 'CLEARED' : 'FAILED')}</p>
        <div class="panel">
          <p class="stat">${r.score.exScore} / ${r.score.total * 2}</p>
          <p class="muted">EX SCORE</p>
          ${stats([['Max combo', r.maxCombo], ['Gauge', `${r.gauge.toFixed(1)}%`], ...(['perfect', 'great', 'good', 'bad', 'poor', 'emptyPoor'] as const).map((key) => [key.toUpperCase(), r.score[key]] as const)])}
          <be-music-gauge-panel
            exportparts="panel:gauge-panel,graph:gauge-graph"
            .data=${{ value: r.gauge, label: r.score.total > 0 ? 'Gauge' : '', cleared: r.cleared, history: r.gaugeHistory }}
          ></be-music-gauge-panel>
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
