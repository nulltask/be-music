import { resolveChart } from '@be-music/chart-model';
import type { BeMusicJSON, ChartDiagnostic } from '@be-music/chart-source';
import { html, nothing, render } from 'lit';
import { onPlayerLangChange, playerLang } from '../player-copy.ts';

const japanese: Record<ChartDiagnostic['code'], string> = {
  'legacy-bmson': '旧形式の bmson v0.21 を変換しました。',
  'unknown-mode-hint': '未対応または無効な bmson のモード指定です。',
  'stacked-note-length': '長さの異なる重複ノートとそのキー音を除外しました。',
  'missing-reference': '譜面内の参照先が定義されていません。',
  'unsupported-option': '未対応の譜面オプションです。',
  'invalid-option': '無効な譜面オプションです。',
};

/** The host's warning list is shared by every select and decide skin. */
export function createChartDiagnosticsPanel(root: HTMLElement) {
  const cache = new WeakMap<BeMusicJSON, readonly ChartDiagnostic[]>();
  let diagnostics: readonly ChartDiagnostic[] = [];
  function update(): void {
    const ja = playerLang() === 'ja';
    render(
      diagnostics.length === 0
        ? nothing
        : html`
            <details @keydown=${stopSceneKeys} @keyup=${stopSceneKeys}>
              <summary>${ja ? `譜面の警告 (${diagnostics.length})` : `Chart warnings (${diagnostics.length})`}</summary>
              <ul>
                ${diagnostics.map(({ code, message, subject, position }) => {
                  const location =
                    position.kind === 'field'
                      ? position.path
                      : `#${String(position.measure).padStart(3, '0')}${position.channel} ${position.position.join('/')}`;
                  return html`<li>
                    <code>${location}</code>
                    ${ja ? [japanese[code], subject].filter(Boolean).join(' ') : message}
                  </li>`;
                })}
              </ul>
            </details>
          `,
      root,
    );
  }
  onPlayerLangChange(update);
  return {
    show(chart?: BeMusicJSON, chartPath?: string): void {
      if (chart === undefined) {
        diagnostics = [];
      } else {
        diagnostics =
          cache.get(chart) ?? resolveChart(chart, { chartPath, inferBmsLNTypeWhenMissing: false }).diagnostics;
        cache.set(chart, diagnostics);
      }
      update();
    },
  };
}

function stopSceneKeys(event: KeyboardEvent): void {
  if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
}
