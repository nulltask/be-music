import { html, nothing, render } from 'lit';
import { resolveChart } from '@be-music/chart-model';
import type { AudioService } from '@be-music/player-browser/audio';
import type { BrowserAssetSource } from '@be-music/player-browser/collection';
import { practiceReadsJudgeRankAndTotal, type RulesetId } from '@be-music/player-engine/ruleset';
import {
  keepPracticeGauge,
  type LibraryChart,
  type PlayOptions,
  type PracticeGaugeCategory,
} from '@be-music/player-scene-model';
import {
  chartScoreRangeTimes,
  defineBeMusicElements,
  layoutChartScore,
  type BeMusicUIEvent,
  type ChartScoreBarRange,
  type ChartScoreLayout,
} from '@be-music/player-ui';
import { onPlayerLangChange, playerLang, playerText } from '../player-copy.ts';
import { optionLabel } from './options/labels.ts';
import { practiceGaugeItems } from './options/play-option-items.ts';
import { describePracticeBars, practiceBarWindow, type PracticeBarsMemory } from './practice-bars-model.ts';

// The PRACTICE bar picker: started with PRACTICE on, a chart opens its score (`<be-music-chart-score>`) before it
// plays. A press on a bar sounds that bar alone, cutting the one sounding short; Shift or a drag picks a run of bars;
// Start plays the run in a loop (the play's `practiceRange`), or the whole chart with no bars picked. beatoraja picks its
// range in milliseconds on the play screen instead (`PracticeConfiguration`).

/** The PRACTICE settings the picker sets, the same play options as the Options dialog's Practice page. */
export type PracticeSettings = Pick<
  PlayOptions,
  'practiceGauge' | 'practiceGaugeCategory' | 'practiceStartGauge' | 'practiceJudgeRank' | 'practiceTotal'
>;

/** GAUGE CATEGORY's choices, as the Options dialog lists them. */
const GAUGE_CATEGORIES: readonly (readonly [string, PracticeGaugeCategory])[] = [
  ['Play mode', 'MODE'],
  ['FIVEKEYS', 'FIVEKEYS'],
  ['SEVENKEYS', 'SEVENKEYS'],
  ['PMS', 'PMS'],
  ['KEYBOARD', 'KEYBOARD'],
  ['LR2', 'LR2'],
];

/**
 * What the picker needs of the page: the audio service the auditions play on, the bars each chart was picked on, and
 * the play options it reads and sets (PRACTICE's settings, saved as the Options dialog saves them).
 */
export interface PracticeBarsDialogDeps {
  readonly audio: Pick<AudioService, 'preview' | 'stopOwned'>;
  readonly memory: PracticeBarsMemory;
  /** The play options in force. */
  readonly playOptions: () => Readonly<PlayOptions>;
  /** The judge ruleset, whose gauges and tables PRACTICE reads. */
  readonly ruleset: () => RulesetId;
  /** Sets play options as the Options dialog does: kept, saved and shown on its controls. */
  readonly setPlayOptions: (changes: Partial<PlayOptions>) => void;
}

/** How long a run picked must stay as it is before it sounds, so a drag does not restart it at every bar. */
const RANGE_PREVIEW_SETTLE_MS = 150;

/** The score of each chart, laid out once; `null` for a chart that could not be. */
const LAYOUTS = new WeakMap<LibraryChart, ChartScoreLayout | null>();

function layoutOf(chart: LibraryChart): ChartScoreLayout | undefined {
  let layout = LAYOUTS.get(chart);
  if (layout === undefined) {
    try {
      const laidOut = layoutChartScore(resolveChart(chart.chart), { omitEmptyFirstBar: true });
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
  private readonly playOptions: PracticeBarsDialogDeps['playOptions'];
  private readonly ruleset: PracticeBarsDialogDeps['ruleset'];
  private readonly setPlayOptions: PracticeBarsDialogDeps['setPlayOptions'];
  private chart: LibraryChart | undefined;
  private source: BrowserAssetSource | undefined;
  private layout: ChartScoreLayout | undefined;
  private selection: ChartScoreBarRange | undefined;
  private previewing: ChartScoreBarRange | undefined;
  /** A run picked by a drag sounds once the drag rests on it, not at every bar it passes. */
  private rangePreviewTimer: ReturnType<typeof setTimeout> | undefined;
  private previewTimer: ReturnType<typeof setTimeout> | undefined;
  private settle: ((start: boolean) => void) | undefined;

  constructor(deps: PracticeBarsDialogDeps) {
    this.audio = deps.audio;
    this.memory = deps.memory;
    this.playOptions = deps.playOptions;
    this.ruleset = deps.ruleset;
    this.setPlayOptions = deps.setPlayOptions;
    defineBeMusicElements();
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'dialog practice-bars-dialog';
    this.dialog.setAttribute('aria-labelledby', 'practice-bars-title');
    // The modal owns the keyboard: the select screen behind it takes no keys. Enter starts; Escape cancels.
    for (const type of ['keydown', 'keyup'] as const)
      this.dialog.addEventListener(type, (event) => {
        event.stopPropagation();
        const target = event.composedPath()[0];
        // A button or a field takes its own Enter.
        const ownsEnter = target instanceof HTMLElement && ['BUTTON', 'INPUT', 'SELECT'].includes(target.tagName);
        if (type === 'keydown' && event.key === 'Enter' && !ownsEnter && !event.defaultPrevented) {
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
   * Opens the score of `chart` on the bars it was last practised on, and resolves once the player starts (`true`: the
   * bars picked are kept in the memory, or the chart is marked to play without practice) or backs out (`false`).
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

  /** Plays the chart as a regular play this time; PRACTICE stays on for the next start. */
  private playNormally(): void {
    const settle = this.settle;
    if (settle === undefined || this.chart === undefined) return;
    this.settle = undefined;
    this.memory.skipPractice(this.chart.id);
    this.stopPreview();
    if (this.dialog.open) this.dialog.close();
    settle(true);
  }

  /** Sets one PRACTICE setting and shows it as the play options took it (clamped to its range). */
  private setSetting<K extends keyof PracticeSettings>(key: K, value: PracticeSettings[K]): void {
    this.setPlayOptions({ [key]: value } as Partial<PlayOptions>);
    this.paint();
  }

  private renderSettings(): unknown {
    const options = this.playOptions();
    const ruleset = this.ruleset();
    const lang = playerLang();
    const label = (text: string) => optionLabel(text, lang);
    const gauge = keepPracticeGauge(options.practiceGauge, ruleset);
    const number = (
      key: 'practiceStartGauge' | 'practiceJudgeRank' | 'practiceTotal',
      text: string,
      min: number,
      max: number,
    ) =>
      html`<label class="practice-bars-field">
        <span>${label(text)}</span>
        <input
          class="input"
          type="number"
          inputmode="numeric"
          min=${min}
          max=${max}
          step="1"
          .value=${String(options[key])}
          @change=${(event: Event) => {
            const value = Number((event.target as HTMLInputElement).value);
            if (Number.isFinite(value)) this.setSetting(key, value);
            else this.paint();
          }}
        />
      </label>`;
    return html`<div class="practice-bars-settings">
      <label class="practice-bars-field">
        <span>${label('GAUGE TYPE')}</span>
        <select
          class="select"
          @change=${(event: Event) =>
            this.setSetting(
              'practiceGauge',
              (event.target as HTMLSelectElement).value as PracticeSettings['practiceGauge'],
            )}
        >
          ${practiceGaugeItems(ruleset).map(
            (item) => html`<option value=${item.value} ?selected=${item.value === gauge}>${item.text}</option>`,
          )}
        </select>
      </label>
      ${
        ruleset === 'beatoraja'
          ? html`<label class="practice-bars-field">
              <span>${label('GAUGE CATEGORY')}</span>
              <select
                class="select"
                @change=${(event: Event) =>
                  this.setSetting(
                    'practiceGaugeCategory',
                    (event.target as HTMLSelectElement).value as PracticeGaugeCategory,
                  )}
              >
                ${GAUGE_CATEGORIES.map(
                  ([text, value]) =>
                    html`<option value=${value} ?selected=${value === options.practiceGaugeCategory}>
                      ${label(text)}
                    </option>`,
                )}
              </select>
            </label>`
          : nothing
      }
      ${number('practiceStartGauge', 'GAUGE VALUE', 1, 120)}
      ${
        practiceReadsJudgeRankAndTotal(ruleset)
          ? html`${number('practiceJudgeRank', 'JUDGERANK (0 = chart)', 0, 400)}
            ${number('practiceTotal', 'TOTAL (0 = chart)', 0, 5000)}`
          : nothing
      }
    </div>`;
  }

  private stopPreview(): void {
    if (this.previewTimer !== undefined) clearTimeout(this.previewTimer);
    this.previewTimer = undefined;
    if (this.rangePreviewTimer !== undefined) clearTimeout(this.rangePreviewTimer);
    this.rangePreviewTimer = undefined;
    this.previewing = undefined;
    this.audio.stopOwned(this);
  }

  /** Sounds the bars `range` (one bar, or a run picked), cutting what is sounding short. */
  private preview(range: ChartScoreBarRange): void {
    const times = this.layout === undefined ? undefined : chartScoreRangeTimes(this.layout, range);
    if (times === undefined || this.chart === undefined) return;
    if (this.previewTimer !== undefined) clearTimeout(this.previewTimer);
    this.previewing = range;
    if (this.source !== undefined)
      this.audio.preview.playWindow({ chart: this.chart, source: this.source }, practiceBarWindow(times), this);
    // The outline goes once the bars have played through.
    this.previewTimer = setTimeout(
      () => {
        this.previewTimer = undefined;
        if (this.previewing !== range) return;
        this.previewing = undefined;
        this.paint();
      },
      Math.max(200, times.endMs - times.startMs),
    );
  }

  private onSelection(event: BeMusicUIEvent<'bar-selection-change'>): void {
    const { first, last, bar, extend } = event.detail;
    this.selection = { first, last };
    if (this.rangePreviewTimer !== undefined) clearTimeout(this.rangePreviewTimer);
    this.rangePreviewTimer = undefined;
    // A press sounds its bar at once; a run picked (Shift, a drag, Shift + arrows) sounds whole once it settles.
    if (!extend) this.preview({ first: bar, last: bar });
    else {
      const range = { first, last };
      this.rangePreviewTimer = setTimeout(() => {
        this.rangePreviewTimer = undefined;
        if (this.selection?.first !== range.first || this.selection.last !== range.last) return;
        this.preview(range);
        this.paint();
      }, RANGE_PREVIEW_SETTLE_MS);
    }
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
        ${this.renderSettings()}
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
          <button class="btn" type="button" data-size="sm" data-variant="outline" @click=${() => this.playNormally()}>
            ${copy.playNormally}
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
