import { svg, html, nothing, css, type CSSResultGroup, type PropertyDeclarations, type TemplateResult } from 'lit';
import { DataElement } from '../base.ts';
import type { BeMusicGaugeData } from '../models.ts';
import { structureStyles } from '../styles/structure.ts';
import { stats } from '../templates.ts';

export class BeMusicGaugePanelElement extends DataElement<BeMusicGaugeData> {
  static override properties: PropertyDeclarations = { ...DataElement.properties, compact: { type: Boolean } };
  static override styles: CSSResultGroup = [
    structureStyles,
    css`
      label {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.85em;
      }
      meter {
        flex: 1;
        min-width: 0;
        height: 12px;
      }
    `,
  ];
  declare compact: boolean;
  protected override render(): TemplateResult | typeof nothing {
    const d = this.data;
    if (!d) return nothing;
    const value = Math.max(0, Math.min(100, d.value));
    const meter = html`<label part="meter"
      ><span>${d.label ?? 'Gauge'} · ${value.toFixed(1)}%</span
      ><meter min="0" max="100" .value=${value} aria-label=${d.label ?? 'Gauge'}></meter
    ></label>`;
    if (this.compact) return meter;
    const count = Math.min(96, d.history.length);
    const points = Array.from({ length: count }, (_, i) => {
      const sample = d.history[Math.round((i / Math.max(1, count - 1)) * (d.history.length - 1))]!;
      return `${sample.progress * 220},${44 - Math.max(0, Math.min(100, sample.value)) * 0.44}`;
    }).join(' ');
    const threshold = 44 - Math.max(0, Math.min(100, d.threshold ?? 0)) * 0.44;
    return html`<section class="panel" part="panel">
      <h3>Gauge</h3>
      ${meter}${stats([
        ['Clear threshold', d.survival ? 'Survival' : d.threshold === undefined ? '—' : `${d.threshold}%`],
        ['Status', d.survival ? (value > 0 ? 'Surviving' : 'Failed') : d.cleared ? 'Clear' : 'Below threshold'],
      ])}
      <svg part="graph" viewBox="0 0 220 44" preserveAspectRatio="none" role="img" aria-label="Gauge history">
        ${!d.survival && d.threshold !== undefined ? svg`<line x1="0" x2="220" y1=${threshold} y2=${threshold} stroke="currentColor" stroke-dasharray="3 3"></line>` : nothing}
        <polyline fill="none" stroke="var(--primary,#edf2fa)" stroke-width="2" points=${points}></polyline>
      </svg>
    </section>`;
  }
}
