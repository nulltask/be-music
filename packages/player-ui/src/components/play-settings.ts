import { html, nothing, type CSSResultGroup, type TemplateResult } from 'lit';
import { DataElement } from '../base.ts';
import type { BeMusicSettingsData } from '../models.ts';
import { previewHost, previewTheme } from '../styles/preview-theme.ts';
import { stats } from '../templates.ts';

/** What follows the judge timing for each automatic adjustment. */
const JUDGE_TIMING_AUTO_ADJUST_LABELS: Readonly<
  Record<BeMusicSettingsData['options']['judgeTimingAutoAdjust'], string>
> = {
  OFF: '',
  BEATORAJA: ' · AUTO (beatoraja)',
  'LR2-ON': ' · AUTO (LR2)',
  'LR2-SILENT': ' · AUTO (LR2 SILENT)',
};

export class BeMusicPlaySettingsElement extends DataElement<BeMusicSettingsData> {
  static override styles: CSSResultGroup = [previewTheme, previewHost];
  protected override render(): TemplateResult | typeof nothing {
    const d = this.data;
    if (!d) return nothing;
    const { view, options: o, runtime: r } = d;
    return html`<section class="card" part="panel">
        <h3>Speed &amp; lanes</h3>
        ${stats([
          [
            'Speed mode',
            view.hiSpeed.floating
              ? 'FLOATING (AC 32 measured)'
              : view.hiSpeed.classic
                ? 'CLASSIC'
                : view.hiSpeed.normalLevel !== undefined
                  ? 'NORMAL'
                  : '—',
          ],
          ['Fixed display area', view.fixedDisplayArea ? 'ON' : 'OFF'],
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
          ['Ruleset', r.rulesetLabel === '____' ? '????' : (r.rulesetLabel ?? '—')],
          ['Random 1P / 2P', `${o.random1P} / ${o.random2P}`],
          ['Effective gauge', r.gaugeLabel ?? '—'],
          ['Gauge auto-shift', o.gaugeAutoShift.replaceAll('_', ' ')],
          [
            'Lowest shift gauge',
            o.gaugeAutoShift === 'BEST_CLEAR' || o.gaugeAutoShift === 'SELECT_TO_UNDER'
              ? o.bottomShiftableGauge === 'GROOVE'
                ? 'NORMAL'
                : o.bottomShiftableGauge
              : '—',
          ],
          ['Gauge 1P / 2P', `${o.gauge1P} / ${o.gauge2P}`],
          ['Long notes', o.longNoteModifier === 'LEGACY' ? 'LEGACY NOTE' : o.longNoteModifier.replaceAll('_', ' ')],
          ['LN add rate', o.longNoteModifier.startsWith('ADD_') ? `${Math.round(o.longNoteRate * 1000) / 10}%` : '—'],
          ['Auto scratch', `1P ${o.autoScratch1P ? 'ON' : 'OFF'} / 2P ${o.autoScratch2P ? 'ON' : 'OFF'}`],
          ['Judge timing', `${o.judgeTimingMs} ms${JUDGE_TIMING_AUTO_ADJUST_LABELS[o.judgeTimingAutoAdjust] ?? ''}`],
          ['DP flip', o.dpFlip ? 'ON' : 'OFF'],
          ['BGA', o.bga],
        ])}
      </section>`;
  }
}
