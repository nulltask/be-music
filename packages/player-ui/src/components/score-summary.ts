import { html, nothing, css, type CSSResultGroup, type PropertyDeclarations, type TemplateResult } from 'lit';
import { DataElement } from '../base.ts';
import type { BeMusicScoreData } from '../models.ts';
import { previewHost, previewTheme } from '../styles/preview-theme.ts';
import { stats } from '../templates.ts';

export class BeMusicScoreSummaryElement extends DataElement<BeMusicScoreData> {
  static override properties: PropertyDeclarations = { ...DataElement.properties, compact: { type: Boolean } };
  static override styles: CSSResultGroup = [
    previewTheme,
    previewHost,
    css`
      .summary {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 6px;
      }
      strong {
        font-size: var(--be-music-score-size, 1.8em);
        font-variant-numeric: tabular-nums;
        margin-right: auto;
      }
      .combo {
        display: var(--be-music-compact-combo-display, block);
        margin-top: 3px;
        font-size: 0.85em;
      }
      @container be-music (max-width: 16rem) {
        .summary strong {
          flex-basis: 100%;
          margin-right: 0;
        }
      }
    `,
  ];
  declare compact: boolean;
  protected override render(): TemplateResult | typeof nothing {
    const d = this.data;
    if (!d) return nothing;
    const rate = d.maximum > 0 ? `${((d.exScore / d.maximum) * 100).toFixed(2)}%` : '—';
    if (this.compact)
      return html`<div part="summary" class="summary">
          <span class="muted">EX SCORE</span><strong part="value">${d.exScore}</strong><span>${d.rank ?? '—'}</span
          ><span class="muted">${rate}</span>
        </div>
        <p class="combo">Combo <b>${d.combo}</b> · Max ${d.maxCombo}</p>`;
    return html`<section class="card" part="panel">
      <h3>Score &amp; progress</h3>
      ${stats([
        ['Score', d.score],
        ['EX score', `${d.exScore} / ${d.maximum}`],
        ['Score rate', rate],
        ['Rank', d.rank ?? '—'],
        ['Notes judged', `${d.judgedNotes} / ${d.totalNotes}`],
        ['Remaining', Math.max(0, d.totalNotes - d.judgedNotes)],
        ['Max combo', d.maxCombo],
        ['BP', d.missCount],
        ['EX rate (judged)', d.judgedNotes > 0 ? `${((d.exScore / (d.judgedNotes * 2)) * 100).toFixed(2)}%` : '—'],
        ['Course combo / max', d.courseCombo ? `${d.courseCombo.combo} / ${d.courseCombo.maxCombo}` : '—'],
      ])}
    </section>`;
  }
}
