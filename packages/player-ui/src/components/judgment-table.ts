import { css, html, nothing, type CSSResultGroup, type TemplateResult } from 'lit';
import { DataElement } from '../base.ts';
import type { BeMusicJudgmentData } from '../models.ts';
import { previewHost, previewTheme } from '../styles/preview-theme.ts';
import { stats } from '../templates.ts';

const JUDGES = [
  ['PERFECT', 'perfect'],
  ['GREAT', 'great'],
  ['GOOD', 'good'],
  ['BAD', 'bad'],
  ['POOR', 'poor'],
] as const;
export class BeMusicJudgmentTableElement extends DataElement<BeMusicJudgmentData> {
  static override styles: CSSResultGroup = [
    previewTheme,
    previewHost,
    css`
      table {
        width: 100%;
      }
      @container be-music (max-width: 22rem) {
        th:nth-child(n + 3),
        td:nth-child(n + 3) {
          display: none;
        }
      }
    `,
  ];
  protected override render(): TemplateResult | typeof nothing {
    const d = this.data;
    if (!d) return nothing;
    return html`<section class="card" part="panel">
      <h3>Judgments</h3>
      <table part="table">
        <thead>
          <tr>
            <th scope="col">Judge</th>
            <th scope="col">Count</th>
            <th scope="col">Early</th>
            <th scope="col">Late</th>
          </tr>
        </thead>
        <tbody>
          ${JUDGES.map(
            ([judge, key]) =>
              html`<tr>
                <th scope="row">${judge}</th>
                <td>${d[key]}</td>
                <td>${d.earlyLate[judge].early}</td>
                <td>${d.earlyLate[judge].late}</td>
              </tr>`,
          )}
        </tbody>
      </table>
      ${stats([
        ['Empty POOR', d.emptyPoor],
        ['FAST / SLOW', `${d.fast} / ${d.slow}`],
        ['Last judgment', d.lastJudge ?? '—'],
        [
          'Last offset',
          d.lastDeltaMs === undefined ? '—' : `${d.lastDeltaMs > 0 ? '+' : ''}${d.lastDeltaMs.toFixed(1)} ms`,
        ],
      ])}
      <p class="muted">FAST / SLOW totals count GREAT and GOOD.</p>
    </section>`;
  }
}
