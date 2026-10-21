import { BeMusicScoreSummaryElement } from './components/score-summary.ts';
import { BeMusicJudgmentTableElement } from './components/judgment-table.ts';
import { BeMusicGaugePanelElement } from './components/gauge-panel.ts';
import { BeMusicTimingGraphElement } from './components/timing-graph.ts';
import { BeMusicPlaySettingsElement } from './components/play-settings.ts';
import { BeMusicChartListElement } from './components/chart-list.ts';
import { BeMusicChartDetailsElement } from './components/chart-details.ts';
import { BeMusicPlayOptionsElement } from './components/play-options.ts';
import { BeMusicSelectScreenElement } from './components/select-screen.ts';
import { BeMusicResultScreenElement } from './components/result-screen.ts';
import { BeMusicDecideScreenElement } from './components/decide-screen.ts';
import { BeMusicGameplayHUDElement } from './components/gameplay-hud.ts';

/** Explicit and idempotent: importing the package never registers global elements. */
export function defineBeMusicElements(registry: CustomElementRegistry | undefined = globalThis.customElements): void {
  if (!registry) throw new Error('Be-Music elements must be registered in a browser.');
  for (const [tag, constructor] of [
    ['be-music-score-summary', BeMusicScoreSummaryElement],
    ['be-music-judgment-table', BeMusicJudgmentTableElement],
    ['be-music-gauge-panel', BeMusicGaugePanelElement],
    ['be-music-timing-graph', BeMusicTimingGraphElement],
    ['be-music-play-settings', BeMusicPlaySettingsElement],
    ['be-music-chart-list', BeMusicChartListElement],
    ['be-music-chart-details', BeMusicChartDetailsElement],
    ['be-music-play-options', BeMusicPlayOptionsElement],
    ['be-music-select-screen', BeMusicSelectScreenElement],
    ['be-music-result-screen', BeMusicResultScreenElement],
    ['be-music-decide-screen', BeMusicDecideScreenElement],
    ['be-music-gameplay-hud', BeMusicGameplayHUDElement],
  ] as const) {
    const existing = registry.get(tag);
    if (existing && existing !== constructor)
      throw new Error(`Custom element ${tag} is already registered by another implementation.`);
    if (!existing) registry.define(tag, constructor);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'be-music-score-summary': BeMusicScoreSummaryElement;
    'be-music-judgment-table': BeMusicJudgmentTableElement;
    'be-music-gauge-panel': BeMusicGaugePanelElement;
    'be-music-timing-graph': BeMusicTimingGraphElement;
    'be-music-play-settings': BeMusicPlaySettingsElement;
    'be-music-chart-list': BeMusicChartListElement;
    'be-music-chart-details': BeMusicChartDetailsElement;
    'be-music-play-options': BeMusicPlayOptionsElement;
    'be-music-select-screen': BeMusicSelectScreenElement;
    'be-music-result-screen': BeMusicResultScreenElement;
    'be-music-decide-screen': BeMusicDecideScreenElement;
    'be-music-gameplay-hud': BeMusicGameplayHUDElement;
  }
}
