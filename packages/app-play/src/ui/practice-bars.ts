import { html, nothing, render } from 'lit';
import { resolveChart } from '@be-music/chart-model';
import type { AudioService } from '@be-music/player-browser/audio';
import type { BrowserAssetSource } from '@be-music/player-browser/collection';
import type { LibraryChart } from '@be-music/player-scene-model';
import {
  defineBeMusicElements,
  layoutChartScore,
  type BeMusicUIEvent,
  type ChartScoreBarRange,
  type ChartScoreLayout,
} from '@be-music/player-ui';
import { onPlayerLangChange, playerText } from '../player-copy.ts';
import { describePracticeBars, practiceBarWindow, type PracticeBarsMemory } from './practice-bars-model.ts';

// The PRACTICE bar picker: started with PRACTICE on, a chart opens its score (`<be-music-chart-score>`) before it
// plays. A press on a bar sounds that bar alone, cutting the one sounding short; Shift or a drag picks a run of bars;
// Start plays the run in a loop (the play's `practiceRange`), or the whole chart with no bars picked. beatoraja picks its
// range in milliseconds on the play screen instead (`PracticeConfiguration`).

/** What the picker needs of the page: the audio service the auditions play on, and the bars each chart was picked on. */
export interface PracticeBarsDialogDeps {
  readonly audio: Pick<AudioService, 'preview' | 'stopOwned'>;
  readonly memory: PracticeBarsMemory;
}

/** The score of each chart, laid out once; `null` for a chart that could not be. */
const LAYOUTS = new WeakMap<LibraryChart, ChartScoreLayout | null>();

function layoutOf(chart: LibraryChart): ChartScoreLayout | undefined {
  let layout = LAYOUTS.get(chart);
  if (layout === undefined) {
    try {
      const laidOut = layoutChartScore(resolveChart(chart.chart));
      layout = laidOut.bars.length > 0 ? laidOut : null;
    } catch {
      layout = null;
    }
    LAYOUTS.set(chart, layout);
  }
  return layout ?? undefined;
}

/** The picker's modal dialog, made once and opened for each chart started with PRACTICE on. */
export class PracticeBarsDialog {
  private readonly dialog: HTMLDialogElement;
  private readonly audio: PracticeBarsDialogDeps['audio'];
  private readonly memory: PracticeBarsMemory;
  private chart: LibraryChart | undefined;
  private source: BrowserAssetSource | undefined;
  private layout: ChartScoreLayout | undefined;
  private selection: ChartScoreBarRange | undefined;
  private previewing: number | undefined;
  private previewTimer: ReturnType<typeof setTimeout> | undefined;
  private settle: ((start: boolean) => void) | undefined;

  constructor(deps: PracticeBarsDialogDeps) {
    this.audio = deps.audio;
    this.memory = deps.memory;
    defineBeMusicElements();
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'dialog practice-bars-dialog';
    this.dialog.setAttribute('aria-labelledby', 'practice-bars-title');
    // The modal owns the keyboard: the select screen behind it takes no keys. Enter starts; Escape cancels.
    for (const type of ['keydown', 'keyup'] as const)
      this.dialog.addEventListener(type, (event) => {
        event.stopPropagation();
        const target = event.composedPath()[0];
        const onButton = target instanceof HTMLElement && target.tagName === 'BUTTON';
        if (type === 'keydown' && event.key === 'Enter' && !onButton && !event.defaultPrevented) {
          event.preventDefault();
          this.finish(true);
        }
      });
    this.dialog.addEventListener('close', () => this.finish(false));
    document.body.append(this.dialog);
    onPlayerLangChange(() => {
      if (this.dialog.open) this.paint();
    });
  }

  /**
   * Opens the score of `chart` on the bars it was last practised on, and resolves once the player starts (`true`, with
   * the bars kept in the memory) or backs out (`false`).
   */
  public open(chart: LibraryChart, source: BrowserAssetSource | undefined): Promise<boolean> {
    this.finish(false);
    this.chart = chart;
    this.source = source;
    this.layout = undefined;
    this.selection = this.memory.pickFor(chart.id)?.bars;
    this.previewing = undefined;
    this.paint(true);
    if (!this.dialog.open) this.dialog.showModal();
    // Lay the chart out after the dialog shows, so a long chart's layout does not hold the press that opened it.
    requestAnimationFrame(() => {
      if (this.chart !== chart) return;
      this.layout = layoutOf(chart);
      if (this.selection !== undefined && this.layout?.bars[this.selection.last] === undefined)
        this.selection = undefined;
      this.paint();
    });
    return new Promise((resolve) => {
      this.settle = resolve;
    });
  }

  private finish(start: boolean): void {
    const settle = this.settle;
    if (settle === undefined) return;
    this.settle = undefined;
    if (start && this.chart !== undefined) this.memory.remember(this.chart.id, this.layout, this.selection);
    this.stopPreview();
    if (this.dialog.open) this.dialog.close();
    settle(start);
  }

  private stopPreview(): void {
    if (this.previewTimer !== undefined) clearTimeout(this.previewTimer);
    this.previewTimer = undefined;
    this.previewing = undefined;
    this.audio.stopOwned(this);
  }

  /** Sounds bar `index` alone, cutting the bar sounding short. */
  private preview(index: number): void {
    const bar = this.layout?.bars[index];
    if (bar === undefined || this.chart === undefined) return;
    if (this.previewTimer !== undefined) clearTimeout(this.previewTimer);
    this.previewing = index;
    if (this.source !== undefined)
      this.audio.preview.playWindow({ chart: this.chart, source: this.source }, practiceBarWindow(bar), this);
    // The outline goes once the bar has played through.
    this.previewTimer = setTimeout(
      () => {
        this.previewTimer = undefined;
        if (this.previewing !== index) return;
        this.previewing = undefined;
        this.paint();
      },
      Math.max(200, bar.endMs - bar.startMs),
    );
  }

  private onSelection(event: BeMusicUIEvent<'bar-selection-change'>): void {
    const { first, last, bar, extend } = event.detail;
    this.selection = { first, last };
    if (!extend) this.preview(bar);
    this.paint();
  }

  private paint(loading = false): void {
    const copy = playerText().practice;
    const chart = this.chart;
    render(
      html`<div>
        <header>
          <h2 id="practice-bars-title">${copy.title}</h2>
          <p class="practice-bars-chart">
            ${chart?.title ?? ''}${chart?.subtitle ? html` <span>${chart.subtitle}</span>` : nothing}
          </p>
          <p>${copy.lead}</p>
        </header>
        <div class="practice-bars-score">
          ${
            loading
              ? html`<p class="practice-bars-note">${copy.loading}</p>`
              : this.layout === undefined
                ? nothing
                : html`<be-music-chart-score
                    .layout=${this.layout}
                    .selection=${this.selection}
                    .previewing=${this.previewing}
                    @bar-selection-change=${(event: BeMusicUIEvent<'bar-selection-change'>) => this.onSelection(event)}
                  ></be-music-chart-score>`
          }
        </div>
        <p class="practice-bars-caption" aria-live="polite">
          ${loading ? nothing : describePracticeBars(this.layout, this.selection, copy)}
        </p>
        <div class="practice-bars-buttons">
          <button
            class="btn"
            type="button"
            data-size="sm"
            data-variant="outline"
            ?disabled=${this.selection === undefined}
            @click=${() => {
              this.selection = undefined;
              this.paint();
            }}
          >
            ${copy.clear}
          </button>
          <button class="btn" type="button" data-size="sm" data-variant="outline" @click=${() => this.finish(false)}>
            ${copy.cancel}
          </button>
          <button class="btn" type="button" data-size="sm" ?disabled=${loading} @click=${() => this.finish(true)}>
            ${copy.start}
          </button>
        </div>
      </div>`,
      this.dialog,
    );
  }
}
