import { html, nothing, render } from 'lit';
import { resolveChart } from '@be-music/chart-model';
import type { AudioService } from '@be-music/player-browser/audio';
import type { BrowserAssetSource } from '@be-music/player-browser/collection';
import { practiceReadsJudgeRankAndTotal, type RulesetId } from '@be-music/player-engine/ruleset';
import {
  keepPracticeGauge,
  practiceGaugeSource,
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
import { clampTempoPercent, TEMPO_PERCENT_MAX, TEMPO_PERCENT_MIN, tempoFromPercent } from '../play-tempo-settings.ts';
import { onPlayerLangChange, playerLang, playerText } from '../player-copy.ts';
import { optionLabel } from './options/labels.ts';
import { practiceGaugeItems } from './options/play-option-items.ts';
import {
  describePracticeBars,
  practiceBarWindow,
  practiceBaseBPM,
  shouldPreviewPickedBar,
  tempoPercentForBPM,
  type PracticeBarsMemory,
} from './practice-bars-model.ts';

// The PRACTICE bar picker: started with PRACTICE on, a chart opens its score (`<be-music-chart-score>`) before it
// plays. A press on a bar sounds that bar alone, cutting the one sounding short; Shift or a drag picks a run of bars,
// sounding each bar it takes in; the bars sound and the score reads its BPMs at the play tempo. Start plays the run in a
// loop (the play's `practiceRange`), or the whole chart with no bars picked. beatoraja picks its
// range in milliseconds on the play screen instead (`PracticeConfiguration`).

/** The PRACTICE settings the picker sets, the same play options as the Options dialog's Practice page. */
export type PracticeSettings = Pick<
  PlayOptions,
  | 'practiceGauge'
  | 'practiceGaugeCategory'
  | 'practiceStartGauge'
  | 'practiceJudgeRank'
  | 'practiceTotal'
  | 'practiceRestBefore'
  | 'practiceRestAfter'
  | 'practiceCarriedLongNotes'
>;

/** How a tempo change sounds, as the Options dialog's Tempo page lists it. */
const PITCH_MODES: readonly (readonly [string, PracticeTempo['pitchMode']])[] = [
  ['Pitch follows tempo (LR2)', 'pitch'],
  ['Keep pitch', 'keep-pitch'],
];

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
  /**
   * The play tempo as the Options dialog's Tempo page has it: the percent off the chart's own (0 when the tempo is off),
   * how a tempo change sounds, and the stretcher keep pitch uses.
   */
  readonly tempo: () => PracticeTempo;
  /** Sets the play tempo as the Options dialog's Tempo page does: kept, saved and shown on its controls. */
  readonly setTempo: (changes: Partial<Pick<PracticeTempo, 'percent' | 'pitchMode'>>) => void;
}

/** The play tempo the picker shows and sets ({@link PracticeBarsDialogDeps.tempo}). */
export interface PracticeTempo {
  readonly percent: number;
  readonly pitchMode: 'pitch' | 'keep-pitch';
  readonly stretchAlgorithm: 'wsola' | 'signalsmith';
}

/** A BPM for the Target BPM field: whole above 100, to a tenth below, as the score's readouts write it. */
function formatPracticeBPM(bpm: number): string {
  return bpm >= 100 ? String(Math.round(bpm)) : String(Math.round(bpm * 10) / 10);
}

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
  private readonly tempo: PracticeBarsDialogDeps['tempo'];
  private readonly setTempo: PracticeBarsDialogDeps['setTempo'];
  private chart: LibraryChart | undefined;
  private source: BrowserAssetSource | undefined;
  private layout: ChartScoreLayout | undefined;
  private selection: ChartScoreBarRange | undefined;
  private previewing: ChartScoreBarRange | undefined;
  private previewTimer: ReturnType<typeof setTimeout> | undefined;
  private settle: ((start: boolean) => void) | undefined;

  constructor(deps: PracticeBarsDialogDeps) {
    this.audio = deps.audio;
    this.memory = deps.memory;
    this.playOptions = deps.playOptions;
    this.ruleset = deps.ruleset;
    this.setPlayOptions = deps.setPlayOptions;
    this.tempo = deps.tempo;
    this.setTempo = deps.setTempo;
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
      // At a kept-pitch tempo, the chart's samples stretch in the background while the player picks.
      this.prepareStretch();
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
    this.stopStretch();
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
    this.stopStretch();
    if (this.dialog.open) this.dialog.close();
    settle(true);
  }

  /** Sets the play tempo, and stretches the chart's samples for it in the background, dropping the old tempo's. */
  private changeTempo(changes: Partial<Pick<PracticeTempo, 'percent' | 'pitchMode'>>): void {
    this.setTempo(changes);
    this.prepareStretch();
  }

  /**
   * Stretches what each bar sounds in the background for the play tempo when it keeps the pitch, nearest the bars
   * picked first (`AudioServicePreview.prepareWindows`); stops that otherwise.
   */
  private prepareStretch(): void {
    if (this.chart === undefined || this.source === undefined) return;
    const tempo = this.tempo();
    const times =
      this.layout === undefined || this.selection === undefined
        ? undefined
        : chartScoreRangeTimes(this.layout, this.selection);
    this.audio.preview.prepareWindows(
      { chart: this.chart, source: this.source },
      {
        tempo: tempoFromPercent(tempo.percent),
        keepPitch: tempo.pitchMode === 'keep-pitch',
        stretchAlgorithm: tempo.stretchAlgorithm,
      },
      // Each bar as a press on it sounds it.
      this.layout?.bars.map((bar) => practiceBarWindow(bar)),
      times === undefined ? 0 : times.startMs / 1000,
    );
  }

  /** Stops stretching in the background, keeping what was stretched for the next time the picker opens. */
  private stopStretch(): void {
    if (this.chart !== undefined && this.source !== undefined)
      this.audio.preview.prepareWindows({ chart: this.chart, source: this.source }, undefined);
  }

  /** Sets one PRACTICE setting and shows it as the play options took it (clamped to its range). */
  private setSetting<K extends keyof PracticeSettings>(key: K, value: PracticeSettings[K]): void {
    this.setPlayOptions({ [key]: value } as Partial<PlayOptions>);
    this.paint();
  }

  private renderSettings(): unknown {
    const options = this.playOptions();
    const tempo = this.tempo();
    const ruleset = this.ruleset();
    const lang = playerLang();
    const label = (text: string) => optionLabel(text, lang);
    const gauge = keepPracticeGauge(options.practiceGauge, ruleset);
    const number = (
      key: 'practiceStartGauge' | 'practiceJudgeRank' | 'practiceTotal' | 'practiceRestBefore' | 'practiceRestAfter',
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
    // The BPM the bars start at, at the play tempo; a BPM entered sets the tempo that plays them closest to it.
    const baseBPM = this.layout === undefined ? undefined : practiceBaseBPM(this.layout, this.selection);
    const playedBPM = baseBPM === undefined ? undefined : baseBPM * tempoFromPercent(tempo.percent);
    return html`<div class="practice-bars-settings">
      <fieldset class="practice-bars-group">
        <legend>${label('Tempo')}</legend>
        <label class="practice-bars-field">
          <span>${label('Tempo (%)')}</span>
          <input
            class="input"
            type="number"
            inputmode="numeric"
            min=${TEMPO_PERCENT_MIN}
            max=${TEMPO_PERCENT_MAX}
            step="1"
            .value=${String(tempo.percent)}
            @change=${(event: Event) => {
              const value = Number((event.target as HTMLInputElement).value);
              if (Number.isFinite(value)) this.changeTempo({ percent: clampTempoPercent(value) });
              this.paint();
            }}
          />
        </label>
        <label class="practice-bars-field">
          <span>${label('Target BPM')}</span>
          <input
            class="input"
            type="number"
            inputmode="decimal"
            min="1"
            step="any"
            ?disabled=${baseBPM === undefined}
            .value=${playedBPM === undefined ? '' : formatPracticeBPM(playedBPM)}
            @change=${(event: Event) => {
              const percent =
                baseBPM === undefined
                  ? undefined
                  : tempoPercentForBPM(Number((event.target as HTMLInputElement).value), baseBPM);
              if (percent !== undefined) this.changeTempo({ percent });
              // The field shows the BPM the tempo plays, whole percents apart, not the one typed.
              (event.target as HTMLInputElement).value =
                baseBPM === undefined ? '' : formatPracticeBPM(baseBPM * tempoFromPercent(this.tempo().percent));
              this.paint();
            }}
          />
        </label>
        <label class="practice-bars-field practice-bars-field-wide">
          <span>${label('Pitch')}</span>
          <select
            class="select"
            @change=${(event: Event) => {
              this.changeTempo({ pitchMode: (event.target as HTMLSelectElement).value as PracticeTempo['pitchMode'] });
              this.paint();
            }}
          >
            ${PITCH_MODES.map(
              ([text, value]) =>
                html`<option value=${value} ?selected=${value === tempo.pitchMode}>${label(text)}</option>`,
            )}
          </select>
        </label>
      </fieldset>
      <fieldset class="practice-bars-group">
        <legend>${label('Range')}</legend>
        ${number('practiceRestBefore', 'REST BEFORE (bars)', 0, 8)}
        ${number('practiceRestAfter', 'REST AFTER (bars)', 0, 8)}
        <label class="practice-bars-check">
          <input
            type="checkbox"
            .checked=${options.practiceCarriedLongNotes}
            @change=${(event: Event) =>
              this.setSetting('practiceCarriedLongNotes', (event.target as HTMLInputElement).checked)}
          />
          <span>${label('Keep LNs held into the bars')}</span>
        </label>
      </fieldset>
      <fieldset class="practice-bars-group">
        <legend>${label('Gauge and judge')}</legend>
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
            ${practiceGaugeItems(ruleset, gauge).map(
              (item) => html`<option value=${item.value} ?selected=${item.value === gauge}>${item.text}</option>`,
            )}
          </select>
        </label>
        ${
          practiceGaugeSource(gauge, ruleset) === 'beatoraja'
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
      </fieldset>
    </div>`;
  }

  private stopPreview(): void {
    if (this.previewTimer !== undefined) clearTimeout(this.previewTimer);
    this.previewTimer = undefined;
    this.previewing = undefined;
    this.audio.stopOwned(this);
  }

  /** Sounds the bars `range` (one bar, or a run picked), cutting what is sounding short. */
  private preview(range: ChartScoreBarRange): void {
    const times = this.layout === undefined ? undefined : chartScoreRangeTimes(this.layout, range);
    if (times === undefined || this.chart === undefined) return;
    if (this.previewTimer !== undefined) clearTimeout(this.previewTimer);
    this.previewing = range;
    // At the play tempo, as the play will sound: sped up with the pitch, or stretched at it.
    const tempo = this.tempo();
    const rate = tempoFromPercent(tempo.percent);
    if (this.source !== undefined)
      this.audio.preview.playWindow(
        { chart: this.chart, source: this.source },
        {
          ...practiceBarWindow(times),
          tempo: rate,
          keepPitch: tempo.pitchMode === 'keep-pitch',
          stretchAlgorithm: tempo.stretchAlgorithm,
        },
        this,
      );
    // The outline goes once the bars have played through.
    this.previewTimer = setTimeout(
      () => {
        this.previewTimer = undefined;
        if (this.previewing !== range) return;
        this.previewing = undefined;
        this.paint();
      },
      Math.max(200, (times.endMs - times.startMs) / rate),
    );
  }

  private onSelection(event: BeMusicUIEvent<'bar-selection-change'>): void {
    const { first, last, bar, extend } = event.detail;
    const before = this.selection;
    this.selection = { first, last };
    // A press sounds its bar; a run picked (Shift, a drag, Shift + arrows) sounds the bar it took in, at once, and a run
    // drawn back takes in none, so it sounds nothing new.
    if (shouldPreviewPickedBar(before, bar, extend)) this.preview({ first: bar, last: bar });
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
                    .tempo=${tempoFromPercent(this.tempo().percent)}
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
