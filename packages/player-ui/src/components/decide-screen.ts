import { css, html, nothing, type CSSResultGroup, type TemplateResult } from 'lit';
import type { BeMusicDOMDecideFrame } from '@be-music/player-skin-sdk';
import { FrameElement } from '../base.ts';
import { screenStyles } from '../styles/screen.ts';

export class BeMusicDecideScreenElement extends FrameElement<BeMusicDOMDecideFrame> {
  static override styles: CSSResultGroup = [
    screenStyles,
    css`
      .title-image {
        display: block;
        max-inline-size: 100%;
        max-block-size: 30vh;
        object-fit: contain;
      }
    `,
  ];
  protected override render(): TemplateResult | typeof nothing {
    const f = this.frame;
    if (!f) return nothing;
    return html`<section class="screen" part="screen">
      <div class="center">
        <div class="heading" part="header">
          <p class="eyebrow" part="eyebrow"><slot name="eyebrow">Up next</slot></p>
          <h1 part="title">
            ${f.titleImage ? html`<img class="title-image" src=${f.titleImage} alt=${f.chart.title} />` : f.chart.title}
          </h1>
          <p class="muted">${f.chart.artist ?? ''}</p>
        </div>
        <progress part="progress" max="1" .value=${f.progress ?? 0} aria-label="Chart loading"></progress>
        <div class="actions" part="actions">
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
