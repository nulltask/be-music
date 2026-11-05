import { css, html, nothing, svg, type CSSResultGroup, type PropertyDeclarations, type TemplateResult } from 'lit';
import { BeMusicElement } from '../base.ts';
import {
  chartScoreRowAt,
  DEFAULT_CHART_SCORE_METRICS,
  resolveChartScoreColumn,
  resolveChartScoreLanes,
  type ChartScoreBarBox,
  type ChartScoreLaneGeometry,
} from '../chart-score/geometry.ts';
import {
  packChartScoreColumns,
  selectChartScoreBars,
  type ChartScoreBar,
  type ChartScoreBarRange,
  type ChartScoreLane,
  type ChartScoreLayout,
} from '../chart-score/layout.ts';
import { structureStyles } from '../styles/structure.ts';

/** How tall a note is drawn, in CSS pixels; it sits on its timing line. */
const NOTE_HEIGHT = 3;

function laneClass(lane: ChartScoreLane | undefined): string {
  if (lane === undefined) return 'key';
  if (lane.kind !== 'key') return 'scratch';
  return lane.tone === 'black' ? 'black' : 'white';
}

function formatBPM(bpm: number): string {
  return Number.isInteger(bpm) ? String(bpm) : bpm.toFixed(bpm >= 100 ? 0 : 1);
}

/** A measure number as BMS writes it (`012`). */
function formatMeasure(measure: number): string {
  return String(measure).padStart(3, '0');
}

/**
 * A chart's score as a printed score shows it: its bars in columns, bottom to top and left to right, each with its
 * measure number, its notes, long notes and mines on their lanes, its bar and beat lines, and its tempo changes and
 * stops beside it. Lay a resolved chart out with `layoutChartScore` and hand it over as `layout`.
 *
 * The bars are a selection: a press picks a bar, Shift (or a drag) runs the selection from the bar pressed first, and
 * the arrow keys move between bars (Shift extends) and Space presses. Each pick fires `bar-selection-change`; `previewing` marks the bar
 * the host is sounding.
 */
export class BeMusicChartScoreElement extends BeMusicElement {
  static override properties: PropertyDeclarations = {
    layout: { attribute: false },
    selection: { attribute: false },
    previewing: { attribute: false },
    columnBeats: { type: Number, attribute: 'column-beats' },
    beatHeight: { type: Number, attribute: 'beat-height' },
    disabled: { type: Boolean, reflect: true },
  };
  static override styles: CSSResultGroup = [
    structureStyles,
    css`
      :host {
        --chart-score-background: var(--be-music-chart-score-background, #050608);
        --chart-score-lane: var(--be-music-chart-score-lane, #0d0f14);
        --chart-score-lane-edge: var(--be-music-chart-score-lane-edge, #262a33);
        --chart-score-bar-line: var(--be-music-chart-score-bar-line, #8a90a0);
        --chart-score-beat-line: var(--be-music-chart-score-beat-line, #262a33);
        --chart-score-white: var(--be-music-chart-score-white, #f2f4f8);
        --chart-score-black: var(--be-music-chart-score-black, #4f8dff);
        --chart-score-scratch: var(--be-music-chart-score-scratch, #ff4d6a);
        --chart-score-mine: var(--be-music-chart-score-mine, #b02a2a);
        --chart-score-tempo: var(--be-music-chart-score-tempo, #6fdc8c);
        --chart-score-stop: var(--be-music-chart-score-stop, #ffb347);
        --chart-score-text: var(--be-music-chart-score-text, #a6adbb);
        --chart-score-accent: var(--be-music-chart-score-accent, #4f9cff);
        --chart-score-preview: var(--be-music-chart-score-preview, #ffd34f);
        color: var(--chart-score-text);
        user-select: none;
        -webkit-user-select: none;
      }
      .columns {
        display: flex;
        align-items: flex-end;
        gap: var(--be-music-chart-score-column-gap, 10px);
        overflow-x: auto;
        padding: 4px 0;
        background: var(--chart-score-background);
        touch-action: pan-x;
      }
      svg {
        display: block;
        flex: none;
        shape-rendering: crispEdges;
        font:
          9px/1 ui-monospace,
          SFMono-Regular,
          Menlo,
          monospace;
      }
      .lane {
        fill: var(--chart-score-lane);
      }
      .lane-edge {
        fill: var(--chart-score-lane-edge);
      }
      .beat-line {
        fill: var(--chart-score-beat-line);
      }
      .bar-line {
        fill: var(--chart-score-bar-line);
      }
      .white {
        fill: var(--chart-score-white);
      }
      .black {
        fill: var(--chart-score-black);
      }
      .scratch {
        fill: var(--chart-score-scratch);
      }
      .ln-body {
        opacity: 0.55;
      }
      .mine {
        fill: var(--chart-score-mine);
      }
      .tempo {
        fill: var(--chart-score-tempo);
      }
      .stop {
        fill: var(--chart-score-stop);
      }
      text {
        fill: var(--chart-score-text);
        shape-rendering: auto;
      }
      text.tempo {
        fill: var(--chart-score-tempo);
      }
      text.stop {
        fill: var(--chart-score-stop);
      }
      .hit {
        fill: transparent;
        cursor: pointer;
        outline: none;
      }
      :host([disabled]) .hit {
        cursor: default;
      }
      .selected {
        fill: var(--chart-score-accent);
        opacity: 0.22;
        pointer-events: none;
      }
      .selected-edge {
        fill: var(--chart-score-accent);
        pointer-events: none;
      }
      .previewing {
        fill: none;
        stroke: var(--chart-score-preview);
        stroke-width: 2;
        pointer-events: none;
      }
      .hit:focus-visible {
        stroke: var(--chart-score-text);
        stroke-width: 1;
        stroke-dasharray: 2 2;
      }
      .empty {
        padding: 12px;
      }
    `,
  ];

  declare layout: ChartScoreLayout | undefined;
  /** The bars selected, as `bar-selection-change` last reported them (or as the host sets them). */
  declare selection: ChartScoreBarRange | undefined;
  /** The bar the host is sounding, outlined. */
  declare previewing: number | undefined;
  /** How many beats a column holds (default 16: four 4/4 bars). */
  declare columnBeats: number;
  /** How tall a beat is, in CSS pixels (default 16). */
  declare beatHeight: number;
  /** Takes no presses: the selection shows, but stays. */
  declare disabled: boolean;

  /** The bar a Shift press or a drag runs the selection from. */
  private anchor: number | undefined;
  /** The bar the keyboard is on. */
  private focusBar = 0;
  private dragPointer: number | undefined;

  constructor() {
    super();
    this.columnBeats = 16;
    this.beatHeight = DEFAULT_CHART_SCORE_METRICS.beatHeight;
    this.disabled = false;
  }

  protected override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has('layout')) {
      this.anchor = undefined;
      this.dragPointer = undefined;
      this.focusBar = Math.max(0, Math.min(this.focusBar, (this.layout?.bars.length ?? 1) - 1));
    }
  }

  /** Picks bar `index`, alone or with `extend` as a run from the anchor, and reports it. */
  private pick(index: number, extend: boolean): void {
    if (this.disabled || this.layout === undefined) return;
    const bars = this.layout.bars;
    if (index < 0 || index >= bars.length) return;
    const range = selectChartScoreBars(this.anchor, index, extend);
    if (!extend || this.anchor === undefined) this.anchor = index;
    this.focusBar = index;
    const previous = this.selection;
    this.selection = range;
    if (previous?.first === range.first && previous.last === range.last && extend) return;
    this.emit('bar-selection-change', { first: range.first, last: range.last, bar: index, extend });
  }

  private barIndexOf(event: Event): number | undefined {
    const target = event.composedPath()[0];
    const value = target instanceof Element ? target.getAttribute('data-bar') : null;
    return value === null ? undefined : Number(value);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    const index = this.barIndexOf(event);
    if (index === undefined || this.disabled || event.button !== 0) return;
    event.preventDefault();
    // A press moves the keyboard to the bar without the focus ring the keys show.
    (event.composedPath()[0] as SVGElement).focus?.({ preventScroll: true, focusVisible: false } as FocusOptions);
    this.dragPointer = event.pointerId;
    this.pick(index, event.shiftKey);
  };

  private readonly onPointerOver = (event: PointerEvent): void => {
    if (this.dragPointer !== event.pointerId) return;
    const index = this.barIndexOf(event);
    if (index !== undefined && index !== this.focusBar) this.pick(index, true);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    // A touch keeps its target: read the bar under the finger instead.
    if (this.dragPointer !== event.pointerId || event.pointerType === 'mouse') return;
    const root = this.renderRoot as ShadowRoot;
    const under = root.elementFromPoint?.(event.clientX, event.clientY);
    const value = under?.getAttribute('data-bar');
    if (value === null || value === undefined) return;
    const index = Number(value);
    if (index !== this.focusBar) this.pick(index, true);
  };

  private readonly endDrag = (event: PointerEvent): void => {
    if (this.dragPointer === event.pointerId) this.dragPointer = undefined;
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const bars = this.layout?.bars.length ?? 0;
    if (bars === 0 || this.disabled) return;
    let next: number | undefined;
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') next = this.focusBar + 1;
    else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') next = this.focusBar - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = bars - 1;
    else if (event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      this.pick(this.focusBar, event.shiftKey);
      return;
    } else return;
    event.preventDefault();
    event.stopPropagation();
    next = Math.max(0, Math.min(bars - 1, next));
    if (event.shiftKey) this.pick(next, true);
    else {
      this.focusBar = next;
      this.requestUpdate();
    }
    void this.updateComplete.then(() => {
      const hit = this.renderRoot.querySelector<SVGElement>(`[data-bar="${next}"]`);
      hit?.focus({ preventScroll: false });
    });
  };

  protected override render(): TemplateResult {
    const layout = this.layout;
    if (layout === undefined || layout.bars.length === 0)
      return html`<div class="empty muted" part="empty">No bars to show</div>`;
    const metrics = {
      ...DEFAULT_CHART_SCORE_METRICS,
      beatHeight: this.beatHeight || DEFAULT_CHART_SCORE_METRICS.beatHeight,
    };
    const lanes = resolveChartScoreLanes(layout.lanes, metrics);
    const columns = packChartScoreColumns(layout.bars, this.columnBeats || 16);
    return html`<div
      class="columns"
      part="columns"
      role="group"
      aria-label="Chart score"
      @pointerdown=${this.onPointerDown}
      @pointerover=${this.onPointerOver}
      @pointermove=${this.onPointerMove}
      @pointerup=${this.endDrag}
      @pointercancel=${this.endDrag}
      @keydown=${this.onKeyDown}
    >
      ${columns.map((column) =>
        this.renderColumn(
          column.map((index) => layout.bars[index]!),
          layout,
          lanes,
          metrics.beatHeight,
        ),
      )}
    </div>`;
  }

  private renderColumn(
    bars: readonly ChartScoreBar[],
    layout: ChartScoreLayout,
    lanes: ChartScoreLaneGeometry,
    beatHeight: number,
  ): TemplateResult {
    const column = resolveChartScoreColumn(bars, this.columnBeats || 16, beatHeight);
    const laneWidth = lanes.right - lanes.left;
    return html`<svg
      part="column"
      width=${lanes.width}
      height=${column.height + 1}
      style=${`width: ${lanes.width}px; height: ${column.height + 1}px`}
      viewBox="0 0 ${lanes.width} ${column.height + 1}"
    >
      ${lanes.lanes.map(
        (box) => svg`<rect class="lane" x=${box.x} y="0" width=${box.width} height=${column.height + 1}></rect>
          <rect class="lane-edge" x=${box.x + box.width - 1} y="0" width="1" height=${column.height + 1}></rect>`,
      )}
      ${bars.map((bar, slot) => this.renderBar(bar, column.bars[slot]!, layout, lanes, laneWidth))}
    </svg>`;
  }

  private renderBar(
    bar: ChartScoreBar,
    box: ChartScoreBarBox,
    layout: ChartScoreLayout,
    lanes: ChartScoreLaneGeometry,
    laneWidth: number,
  ): TemplateResult {
    const height = box.bottom - box.top;
    const selected =
      this.selection !== undefined && bar.index >= this.selection.first && bar.index <= this.selection.last;
    const beatLines: number[] = [];
    for (let beat = 1; beat < bar.beats - 1e-9; beat += 1) beatLines.push(chartScoreRowAt(box, beat / bar.beats));
    const laneBox = (lane: number): { x: number; width: number } => lanes.lanes[lane] ?? { x: lanes.left, width: 0 };
    const tempoX = lanes.right + 3;
    const labels: TemplateResult[] = [];
    if (bar.index === 0)
      labels.push(svg`<text class="tempo" x=${tempoX} y=${box.bottom - 2}>${formatBPM(layout.initialBPM)}</text>`);
    for (const tempo of bar.tempos) {
      const y = chartScoreRowAt(box, tempo.position);
      labels.push(svg`<rect class="tempo" x=${lanes.left} y=${y - 1} width=${laneWidth} height="1"></rect>
        <text class="tempo" x=${tempoX} y=${Math.max(box.top + 8, y + 3)}>${formatBPM(tempo.bpm)}</text>`);
    }
    for (const stop of bar.stops) {
      const y = chartScoreRowAt(box, stop.position);
      labels.push(svg`<rect class="stop" x=${lanes.left} y=${y - 1} width=${laneWidth} height="1"></rect>
        <text class="stop" x=${tempoX} y=${Math.max(box.top + 8, y - 6)}>S${stop.durationMs}</text>`);
    }
    return svg`<g part="bar">
      ${beatLines.map((y) => svg`<rect class="beat-line" x=${lanes.left} y=${y - 1} width=${laneWidth} height="1"></rect>`)}
      <rect class="bar-line" x=${lanes.left} y=${box.bottom - 1} width=${laneWidth} height="1"></rect>
      <text x="1" y=${box.bottom - 2}>${formatMeasure(bar.measure)}</text>
      ${
        selected
          ? svg`<rect class="selected" x=${lanes.left} y=${box.top} width=${laneWidth} height=${height}></rect>
            <rect class="selected-edge" x=${lanes.left - 3} y=${box.top} width="2" height=${height}></rect>`
          : nothing
      }
      ${bar.longNotes.map((ln) => {
        const lane = laneBox(ln.lane);
        const tone = laneClass(layout.lanes[ln.lane]);
        const bottom = chartScoreRowAt(box, ln.from);
        const top = chartScoreRowAt(box, ln.to);
        // The body runs from the head's line (or the bar line it continues over) up to the tail's cap.
        const bodyTop = ln.tail ? top - NOTE_HEIGHT : top;
        return svg`<rect class="${tone} ln-body ln-mode-${ln.mode}" x=${lane.x + 2} y=${bodyTop} width=${Math.max(1, lane.width - 5)} height=${Math.max(1, bottom - bodyTop)}></rect>
          ${ln.head ? svg`<rect class=${tone} x=${lane.x + 1} y=${bottom - NOTE_HEIGHT} width=${lane.width - 3} height=${NOTE_HEIGHT}></rect>` : nothing}
          ${ln.tail ? svg`<rect class=${tone} x=${lane.x + 1} y=${top - NOTE_HEIGHT} width=${lane.width - 3} height=${NOTE_HEIGHT}></rect>` : nothing}`;
      })}
      ${bar.notes.map((note) => {
        const lane = laneBox(note.lane);
        const y = chartScoreRowAt(box, note.position);
        return svg`<rect class=${laneClass(layout.lanes[note.lane])} x=${lane.x + 1} y=${y - NOTE_HEIGHT} width=${lane.width - 3} height=${NOTE_HEIGHT}></rect>`;
      })}
      ${bar.mines.map((mine) => {
        const lane = laneBox(mine.lane);
        const y = chartScoreRowAt(box, mine.position);
        return svg`<rect class="mine" x=${lane.x + 2} y=${y - 2} width=${lane.width - 5} height="2"></rect>`;
      })}
      ${labels}
      ${
        this.previewing === bar.index
          ? svg`<rect class="previewing" x=${lanes.left} y=${box.top + 1} width=${laneWidth - 1} height=${height - 2}></rect>`
          : nothing
      }
      <rect
        class="hit"
        data-bar=${bar.index}
        x="0"
        y=${box.top}
        width=${lanes.width}
        height=${height}
        role="button"
        tabindex=${bar.index === this.focusBar ? 0 : -1}
        aria-pressed=${selected ? 'true' : 'false'}
        aria-label=${`Bar ${formatMeasure(bar.measure)}, ${bar.noteCount} notes`}
      ></rect>
    </g>`;
  }
}
