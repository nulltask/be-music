import { resolveChart } from '@be-music/chart-model';
import type { BeMusicJSON, ChartDiagnostic } from '@be-music/chart-source';
import { html, nothing, render } from 'lit';
import { onPlayerLangChange, playerLang } from '../player-copy.ts';
import { mountAuxiliaryPanel } from './auxiliary-dock.ts';
import './collapsible-panel.ts';

const japanese: Record<ChartDiagnostic['code'], string> = {
  'legacy-bmson': '旧形式の bmson v0.21 を変換しました。',
  'unknown-mode-hint': '未対応または無効な bmson のモード指定です。',
  'stacked-note-length': '長さの異なる重複ノートとそのキー音を除外しました。',
  'missing-reference': '譜面内の参照先が定義されていません。',
  'unsupported-option': '未対応の譜面オプションです。',
  'invalid-option': '無効な譜面オプションです。',
  'unsupported-lane-type': '未対応のレーン構成です。',
  'unsupported-channel': '未対応のチャンネルです。',
};

/**
 * The host's warning list, shared by every select and decide skin: a panel in the auxiliary dock, closed until the player
 * opens it, kept open or closed across charts while the screen stays.
 */
export function createChartDiagnosticsPanel(fallback?: HTMLElement) {
  const cache = new WeakMap<BeMusicJSON, readonly ChartDiagnostic[]>();
  const card = document.createElement('aside');
  card.id = 'chart-diagnostics';
  card.className = 'chart-diagnostics';
  card.hidden = true;
  mountAuxiliaryPanel(card, 'chart-diagnostics', fallback);
  let diagnostics: readonly ChartDiagnostic[] = [];
  let expanded = false;
  function update(): void {
    const ja = playerLang() === 'ja';
    card.hidden = diagnostics.length === 0;
    card.setAttribute('aria-label', ja ? '譜面の警告' : 'Chart warnings');
    render(
      diagnostics.length === 0
        ? nothing
        : html`
            <be-music-collapsible-panel
              position="dock"
              .heading=${ja ? `譜面の警告 (${diagnostics.length})` : `Chart warnings (${diagnostics.length})`}
              .open=${expanded}
              @panel-toggle=${(event: CustomEvent<{ open: boolean }>) => {
                expanded = event.detail.open;
              }}
            >
              <ul class="chart-diagnostics-list">
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
            </be-music-collapsible-panel>
          `,
      card,
    );
  }
  onPlayerLangChange(update);
  return {
    show(chart?: BeMusicJSON, chartPath?: string): void {
      if (chart === undefined) {
        diagnostics = [];
        expanded = false;
      } else {
        diagnostics =
          cache.get(chart) ?? resolveChart(chart, { chartPath, inferBmsLNTypeWhenMissing: false }).diagnostics;
        cache.set(chart, diagnostics);
      }
      update();
    },
  };
}
