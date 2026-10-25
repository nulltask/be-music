import { html, nothing, type CSSResultGroup, type TemplateResult } from 'lit';
import type { BeMusicDOMDecideFrame } from '@be-music/player-skin-sdk';
import { FrameElement } from '../base.ts';
import { screenStyles } from '../styles/screen.ts';

export class BeMusicDecideScreenElement extends FrameElement<BeMusicDOMDecideFrame> {
  static override styles: CSSResultGroup = screenStyles;
  protected override render(): TemplateResult | typeof nothing {
    const f = this.frame;
    if (!f) return nothing;
    return html`<section class="screen" part="screen">
      <div class="center">
        <p class="eyebrow">Up next</p>
        <h1>${f.chart.title}</h1>
        <p class="muted">${f.chart.artist ?? ''}</p>
        <progress max="1" .value=${f.progress ?? 0} aria-label="Chart loading"></progress>
        <div class="actions">
          <button class="btn" ?disabled=${!f.inputReady} @click=${() => this.emit('continue-request', undefined)}>
            Start</button
          ><button class="btn" data-variant="outline" @click=${() => this.emit('cancel-request', undefined)}>
            Back
          </button>
        </div>
        <slot></slot>
      </div>
    </section>`;
  }
}
