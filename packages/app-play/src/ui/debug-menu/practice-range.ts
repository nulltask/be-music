// The PRACTICE range picker (#948): the note-density graph of the chart under the cursor, with a start and an end
// handle to drag. The handles snap to measure starts and write START TIME / END TIME, which the picker follows back.
// The rules (snapping, the 1000 ms minimum, END 0 = to the end) are `practice-range.ts` in player-scene-model.
import { resolveChart } from '@be-music/chart-model';
import type { FolderApi } from 'tweakpane';
import {
  binPracticeNoteDensity,
  dragPracticeRangeHandle,
  findPracticeMeasureAt,
  formatPracticeTime,
  pickPracticeRangeHandle,
  practiceTimeToX,
  practiceXToTime,
  resolvePracticeRangeChart,
  resolveShownPracticeRange,
  type LibraryChart,
  type PracticeRange,
  type PracticeRangeChart,
  type PracticeRangeHandle,
} from '@be-music/player-scene-model';
import type { DebugMenu } from './index.ts';

const GRAPH_HEIGHT = 56;
/** Each density column is this many CSS pixels wide. */
const COLUMN_WIDTH = 2;
/** Measure ticks are drawn only while they lie at least this many CSS pixels apart. */
const MIN_TICK_SPACING = 4;

const RANGE_CHARTS = new WeakMap<LibraryChart, PracticeRangeChart | null>();

/** The picker's view of `chart`, resolved once per library chart; `undefined` for a chart that fails to resolve. */
function practiceRangeChartOf(chart: LibraryChart): PracticeRangeChart | undefined {
  let cached = RANGE_CHARTS.get(chart);
  if (cached === undefined) {
    try {
      cached = resolvePracticeRangeChart(resolveChart(chart.chart));
    } catch {
      cached = null;
    }
    RANGE_CHARTS.set(chart, cached);
  }
  return cached ?? undefined;
}

/** A measure number as BMS writes it (`#009`). */
function formatMeasure(measure: number | undefined): string {
  return measure === undefined ? '' : ` · #${String(measure).padStart(3, '0')}`;
}

/** The picker's DOM: a graph to drag on and a line with the range's times and measures. */
export class PracticeRangePicker {
  public readonly element: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly caption: HTMLDivElement;
  private readonly readRange: () => PracticeRange;
  private readonly writeRange: (range: PracticeRange) => void;
  private libraryChart: LibraryChart | undefined;
  private shown = false;
  private disabledState = false;
  private dragging: { handle: PracticeRangeHandle; pointerId: number } | undefined;

  /** `readRange` reads START TIME / END TIME as stored; `writeRange` stores a range a drag picks. */
  public constructor(readRange: () => PracticeRange, writeRange: (range: PracticeRange) => void) {
    this.readRange = readRange;
    this.writeRange = writeRange;
    this.element = document.createElement('div');
    this.element.className = 'practice-range';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'practice-range-graph';
    this.canvas.style.height = `${GRAPH_HEIGHT}px`;
    this.canvas.setAttribute('role', 'img');
    this.caption = document.createElement('div');
    this.caption.className = 'practice-range-caption';
    this.element.append(this.canvas, this.caption);
    this.canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    this.canvas.addEventListener('pointermove', (event) => this.onPointerMove(event));
    const endDrag = (event: PointerEvent): void => {
      if (this.dragging?.pointerId === event.pointerId) this.dragging = undefined;
    };
    this.canvas.addEventListener('pointerup', endDrag);
    this.canvas.addEventListener('pointercancel', endDrag);
    // The graph takes the pane's width, which is 0 until its folder first opens.
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => this.refresh()).observe(this.canvas);
  }

  /** Whether a play runs: the graph still shows the range but takes no drag. */
  public get disabled(): boolean {
    return this.disabledState;
  }
  public set disabled(value: boolean) {
    this.disabledState = value;
    if (value) this.dragging = undefined;
    this.element.classList.toggle('disabled', value);
  }

  /** Whether the picker shows (PRACTICE on); a hidden picker resolves no chart. */
  public setShown(shown: boolean): void {
    this.shown = shown;
    this.refresh();
  }

  /** The chart under the cursor on the select screen, or `undefined` on a folder, a course or no bar. */
  public setChart(chart: LibraryChart | undefined): void {
    if (chart === this.libraryChart) return;
    this.libraryChart = chart;
    this.dragging = undefined;
    this.refresh();
  }

  /** Draws the graph and the caption again from the stored range. */
  public refresh(): void {
    if (!this.shown) return;
    const chart = this.libraryChart === undefined ? undefined : practiceRangeChartOf(this.libraryChart);
    const width = Math.max(1, Math.round(this.canvas.clientWidth || this.element.clientWidth || 280));
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(GRAPH_HEIGHT * ratio);
    if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
    if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
    const context = this.canvas.getContext('2d');
    if (context === null) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, GRAPH_HEIGHT);
    if (chart === undefined) {
      this.caption.textContent = this.libraryChart === undefined ? 'Move the cursor to a chart' : 'No timing to show';
      this.canvas.setAttribute('aria-label', this.caption.textContent);
      return;
    }
    const colors = this.readColors();
    const range = resolveShownPracticeRange(this.readRange(), chart.lengthMs);
    const startX = practiceTimeToX(range.startMs, chart.lengthMs, width);
    const endX = practiceTimeToX(range.endMs, chart.lengthMs, width);
    // Measure ticks behind the density columns.
    const spacing = width / Math.max(1, chart.measures.length);
    if (spacing >= MIN_TICK_SPACING) {
      context.fillStyle = colors.tick;
      for (const measure of chart.measures) {
        context.fillRect(Math.round(practiceTimeToX(measure.startMs, chart.lengthMs, width)), 0, 1, GRAPH_HEIGHT);
      }
    }
    const bins = binPracticeNoteDensity(chart.noteTimesMs, chart.lengthMs, Math.floor(width / COLUMN_WIDTH));
    const peak = Math.max(1, ...bins);
    bins.forEach((count, index) => {
      if (count === 0) return;
      const x = index * COLUMN_WIDTH;
      const height = Math.max(1, (count / peak) * (GRAPH_HEIGHT - 4));
      const inside = x + COLUMN_WIDTH > startX && x < endX;
      context.fillStyle = inside ? colors.accent : colors.muted;
      context.fillRect(x, GRAPH_HEIGHT - height, COLUMN_WIDTH - 0.5, height);
    });
    // The range, framed by its two handles.
    context.fillStyle = colors.selection;
    context.fillRect(startX, 0, Math.max(0, endX - startX), GRAPH_HEIGHT);
    for (const x of [startX, endX]) {
      const left = Math.min(width - 2, Math.max(0, Math.round(x) - 1));
      context.fillStyle = colors.accent;
      context.fillRect(left, 0, 2, GRAPH_HEIGHT);
      context.fillRect(Math.min(width - 8, Math.max(0, left - 3)), 0, 8, 6);
      context.fillRect(Math.min(width - 8, Math.max(0, left - 3)), GRAPH_HEIGHT - 6, 8, 6);
    }
    const stored = this.readRange();
    const startMeasure = findPracticeMeasureAt(range.startMs, chart.measures)?.measure;
    const endText =
      stored.endMs > 0
        ? `${formatPracticeTime(range.endMs)}${formatMeasure(findPracticeMeasureAt(range.endMs, chart.measures)?.measure)}`
        : `end (${formatPracticeTime(chart.lengthMs)})`;
    this.caption.textContent = `${formatPracticeTime(range.startMs)}${formatMeasure(startMeasure)} → ${endText}`;
    this.canvas.setAttribute('aria-label', `PRACTICE range ${this.caption.textContent}`);
  }

  /** The theme's colors, read from the picker's CSS custom properties so the graph follows light and dark. */
  private readColors(): { accent: string; muted: string; tick: string; selection: string } {
    const style = getComputedStyle(this.element);
    const read = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;
    return {
      accent: read('--practice-range-accent', '#4f9cff'),
      muted: read('--practice-range-muted', 'rgb(160 160 160 / 0.55)'),
      tick: read('--practice-range-tick', 'rgb(255 255 255 / 0.08)'),
      selection: read('--practice-range-selection', 'rgb(79 156 255 / 0.14)'),
    };
  }

  private timeAt(event: PointerEvent, chart: PracticeRangeChart): number {
    const bounds = this.canvas.getBoundingClientRect();
    return practiceXToTime(event.clientX - bounds.left, chart.lengthMs, bounds.width);
  }

  private onPointerDown(event: PointerEvent): void {
    if (this.disabledState || this.libraryChart === undefined) return;
    const chart = practiceRangeChartOf(this.libraryChart);
    if (chart === undefined) return;
    event.preventDefault();
    const bounds = this.canvas.getBoundingClientRect();
    const range = resolveShownPracticeRange(this.readRange(), chart.lengthMs);
    const handle = pickPracticeRangeHandle(
      event.clientX - bounds.left,
      practiceTimeToX(range.startMs, chart.lengthMs, bounds.width),
      practiceTimeToX(range.endMs, chart.lengthMs, bounds.width),
    );
    this.dragging = { handle, pointerId: event.pointerId };
    this.canvas.setPointerCapture(event.pointerId);
    this.moveHandle(event, chart);
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.disabledState || this.dragging?.pointerId !== event.pointerId || this.libraryChart === undefined) return;
    const chart = practiceRangeChartOf(this.libraryChart);
    if (chart !== undefined) this.moveHandle(event, chart);
  }

  private moveHandle(event: PointerEvent, chart: PracticeRangeChart): void {
    if (this.dragging === undefined) return;
    const current = this.readRange();
    const next = dragPracticeRangeHandle(current, this.dragging.handle, this.timeAt(event, chart), chart);
    if (next.startMs === current.startMs && next.endMs === current.endMs) return;
    this.writeRange(next);
    this.refresh();
  }
}

/**
 * Adds the PRACTICE range picker to the Play options folder (with the menu as `this`). It shows only while PRACTICE is
 * on (`refreshRulesetChoices`), is disabled during a play with the other play options, and follows the chart under the
 * select screen's cursor (`setPracticeChart`).
 */
export function buildPracticeRangePicker(this: DebugMenu, folder: FolderApi): void {
  const picker = new PracticeRangePicker(
    () => ({ startMs: this.guiState.practiceStartMs, endMs: this.guiState.practiceEndMs }),
    ({ startMs, endMs }) => {
      this.guiState.practiceStartMs = startMs;
      this.guiState.practiceEndMs = endMs;
      this.setPlayOptions({ practiceStartMs: startMs, practiceEndMs: endMs });
      // START TIME and END TIME, right after the PRACTICE toggle.
      for (const controller of this.practiceControllers.slice(1, 3)) controller.refresh();
      this.scheduleSettingsSave();
    },
  );
  // A separator blade carries the picker: Tweakpane lays it out and hides or disables it like any other row.
  const blade = folder.addBlade({ view: 'separator' });
  blade.element.classList.add('practice-range-row');
  blade.element.replaceChildren(picker.element);
  this.practiceRangeBlade = blade;
  this.practiceRangePicker = picker;
  this.trackPlayOption({
    get disabled(): boolean {
      return picker.disabled;
    },
    set disabled(value: boolean) {
      blade.disabled = value;
      picker.disabled = value;
    },
    refresh: () => picker.refresh(),
  });
}
