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
import { BeMusicBGAElement } from './components/bga.ts';
import { BeMusicPlaybackControlsElement } from './components/playback-controls.ts';
import { BeMusicPreviewHUDElement } from './components/preview-hud.ts';
import { BeMusicPreviewSelectElement } from './components/preview-select.ts';
import { BeMusicPreviewStartElement } from './components/preview-start.ts';
import { BeMusicLanesElement } from './components/lanes.ts';
import { BeMusicNotesElement } from './components/notes.ts';
import { BeMusicLaneCoversElement } from './components/lane-covers.ts';
import { BeMusicJudgeLineElement } from './components/judge-line.ts';
import { BeMusicBombsElement } from './components/bombs.ts';
import { BeMusicJudgmentDisplayElement } from './components/judgment-display.ts';
import { BeMusicPlayfieldElement } from './components/playfield.ts';
import { setBeMusicTheme, type BeMusicTheme } from './theme.ts';

/** How {@link defineBeMusicElements} registers the elements. */
export interface BeMusicElementsOptions {
  /**
   * Style sheets every element adds to its shadow root, such as `basecoatTheme` from
   * `@be-music/player-ui/themes/basecoat`. Without one the elements are headless: layout only, for the page to style
   * through custom properties and parts. A later call without `theme` keeps the one set.
   */
  readonly theme?: BeMusicTheme;
}

/** Explicit and idempotent: importing the package never registers global elements. */
export function defineBeMusicElements(
  registry: CustomElementRegistry | undefined = globalThis.customElements,
  options: BeMusicElementsOptions = {},
): void {
  if (!registry) throw new Error('Be-Music elements must be registered in a browser.');
  if (options.theme) setBeMusicTheme(registry, options.theme);
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
    ['be-music-bga', BeMusicBGAElement],
    ['be-music-lanes', BeMusicLanesElement],
    ['be-music-notes', BeMusicNotesElement],
    ['be-music-lane-covers', BeMusicLaneCoversElement],
    ['be-music-judge-line', BeMusicJudgeLineElement],
    ['be-music-bombs', BeMusicBombsElement],
    ['be-music-judgment-display', BeMusicJudgmentDisplayElement],
    ['be-music-playfield', BeMusicPlayfieldElement],
    ['be-music-playback-controls', BeMusicPlaybackControlsElement],
    ['be-music-preview-hud', BeMusicPreviewHUDElement],
    ['be-music-preview-select', BeMusicPreviewSelectElement],
    ['be-music-preview-start', BeMusicPreviewStartElement],
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
    'be-music-bga': BeMusicBGAElement;
    'be-music-lanes': BeMusicLanesElement;
    'be-music-notes': BeMusicNotesElement;
    'be-music-lane-covers': BeMusicLaneCoversElement;
    'be-music-judge-line': BeMusicJudgeLineElement;
    'be-music-bombs': BeMusicBombsElement;
    'be-music-judgment-display': BeMusicJudgmentDisplayElement;
    'be-music-playfield': BeMusicPlayfieldElement;
    'be-music-playback-controls': BeMusicPlaybackControlsElement;
    'be-music-preview-hud': BeMusicPreviewHUDElement;
    'be-music-preview-select': BeMusicPreviewSelectElement;
    'be-music-preview-start': BeMusicPreviewStartElement;
  }
}
