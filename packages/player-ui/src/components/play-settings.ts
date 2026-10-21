import { html, nothing, type TemplateResult } from 'lit';
import { DataElement } from '../base.ts';
import type { BeMusicSettingsData } from '../models.ts';
import { stats } from '../templates.ts';

export class BeMusicPlaySettingsElement extends DataElement<BeMusicSettingsData> {
  protected override render(): TemplateResult | typeof nothing {
    const d = this.data;
    if (!d) return nothing;
    const { view, options: o, runtime: r } = d;
    return html`<section class="card" part="panel">
        <h3>Speed &amp; lanes</h3>
        ${stats([
          ['Hi-speed', view.hiSpeed.player.toFixed(2)],
          ['Drawn speed', view.hiSpeed.drawn.toFixed(2)],
          ['HS-FIX', view.hsFix ?? o.hsFix],
          ['Green number', r.greenNumber === undefined ? '—' : Math.round(r.greenNumber)],
          ['Visible time', r.visibleMs === undefined ? '—' : `${Math.round(r.visibleMs)} ms`],
          [
            'BPM range',
            r.minBPM === undefined || r.maxBPM === undefined ? '—' : `${Math.round(r.minBPM)}–${Math.round(r.maxBPM)}`,
          ],
          ['Main BPM', r.mainBPM === undefined ? '—' : Math.round(r.mainBPM)],
        ])}${view.covers.map((c) => html`<p class="muted">${c.side} · SUD ${c.suddenOn ? Math.round(c.sudden * 100) + '%' : 'OFF'} · HID ${c.hiddenOn ? Math.round(c.hidden * 100) + '%' : 'OFF'} · LIFT ${Math.round(c.lift * 100)}%</p>`)}
      </section>
      <section class="card" part="panel">
        <h3>Play settings</h3>
        ${stats([
          ['Ruleset', r.rulesetLabel ?? '—'],
          ['Random 1P / 2P', `${o.random1P} / ${o.random2P}`],
          ['Gauge 1P / 2P', `${o.gauge1P} / ${o.gauge2P}`],
          ['Auto scratch', `1P ${o.autoScratch1P ? 'ON' : 'OFF'} / 2P ${o.autoScratch2P ? 'ON' : 'OFF'}`],
          ['DP flip', o.dpFlip ? 'ON' : 'OFF'],
          ['BGA', o.bga],
        ])}
      </section>`;
  }
}
