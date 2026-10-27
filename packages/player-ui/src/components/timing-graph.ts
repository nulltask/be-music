import { html, nothing, type CSSResultGroup, type TemplateResult } from 'lit';
import { DataElement } from '../base.ts';
import type { BeMusicTimingData } from '../models.ts';
import { structureStyles } from '../styles/structure.ts';

export class BeMusicTimingGraphElement extends DataElement<BeMusicTimingData> {
  static override styles: CSSResultGroup = structureStyles;
  protected override render(): TemplateResult | typeof nothing {
    if (!this.data) return nothing;
    const hits = this.data.timings.slice(-32);
    const points = hits
      .map((hit, i) => `${(i / 31) * 220},${22 + Math.max(-100, Math.min(100, hit.deltaMs)) * 0.22}`)
      .join(' ');
    return html`<section class="panel" part="panel">
      <h3>Timing</h3>
      <svg
        part="graph"
        viewBox="0 0 220 44"
        preserveAspectRatio="none"
        role="img"
        aria-label="Recent timing offsets; early above and late below center"
      >
        <path d="M0 22H220" stroke="currentColor" stroke-dasharray="3 3"></path>
        <polyline
          fill="none"
          stroke="var(--be-music-timing-color,#ffa8b3)"
          stroke-width="1.5"
          points=${points}
        ></polyline>
      </svg>
      <p class="muted">±100 ms · latest 32 timed hits</p>
    </section>`;
  }
}
