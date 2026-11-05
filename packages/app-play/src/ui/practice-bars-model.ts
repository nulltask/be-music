// What the PRACTICE bar picker (`practice-bars.ts`) works out without the page: the window a bar's audition sounds, the
// line describing the bars picked, and the bars each chart was last practised on.

import type { ChartPreviewWindow } from '@be-music/player-browser/audio';
import {
  chartScoreRangeTimes,
  type ChartScoreBar,
  type ChartScoreBarRange,
  type ChartScoreLayout,
} from '@be-music/player-ui';
import { formatPracticeTime, type PracticeRange } from '@be-music/player-scene-model';
import type { PlayerCopy } from '../player-copy.ts';

/** The chart seconds a bar's audition sounds: the bar, from its line up to the next one. */
export function practiceBarWindow(bar: Pick<ChartScoreBar, 'startMs' | 'endMs'>): ChartPreviewWindow {
  return { startSeconds: bar.startMs / 1000, endSeconds: Math.max(bar.startMs, bar.endMs) / 1000 };
}

/** A measure number as BMS writes it (`012`), as the score labels its bars. */
function formatMeasure(measure: number): string {
  return String(measure).padStart(3, '0');
}

/** The line under the score: the bars picked, by measure number, and the chart times they span. */
export function describePracticeBars(
  layout: Pick<ChartScoreLayout, 'bars'> | undefined,
  range: ChartScoreBarRange | undefined,
  copy: PlayerCopy['practice'],
): string {
  if (layout === undefined) return copy.unreadable;
  const times = range === undefined ? undefined : chartScoreRangeTimes(layout, range);
  if (range === undefined || times === undefined) return copy.wholeChart;
  return copy.bars(
    formatMeasure(layout.bars[range.first]!.measure),
    formatMeasure(layout.bars[range.last]!.measure),
    formatPracticeTime(times.startMs),
    formatPracticeTime(times.endMs),
  );
}

/** The bars picked for a chart, and the PRACTICE range they make. */
export interface PracticeBarsPick {
  readonly bars: ChartScoreBarRange;
  readonly range: PracticeRange;
}

/**
 * The bars each chart was last practised on, for the page's life: the picker opens on them again, and a play of the
 * chart (its retry included) loops them. A chart started with no bars picked loops whole, and one started without
 * practice plays as a regular play.
 */
export class PracticeBarsMemory {
  private readonly picks = new Map<string, PracticeBarsPick>();
  /** Charts last started with "Play without practice": they play as regular plays until started with practice again. */
  private readonly skipped = new Set<string>();

  /** Starts the chart without practice: its plays (a retry included) are regular plays, its pick kept for later. */
  public skipPractice(chartId: string): void {
    this.skipped.add(chartId);
  }

  /** Whether the chart was last started without practice. */
  public skipsPractice(chartId: string): boolean {
    return this.skipped.has(chartId);
  }

  /** Keeps `bars` of `layout` as the chart's pick, or forgets it with no bars. Returns what is kept. */
  public remember(
    chartId: string,
    layout: Pick<ChartScoreLayout, 'bars'> | undefined,
    bars: ChartScoreBarRange | undefined,
  ): PracticeBarsPick | undefined {
    this.skipped.delete(chartId);
    const range = layout !== undefined && bars !== undefined ? chartScoreRangeTimes(layout, bars) : undefined;
    if (bars === undefined || range === undefined) {
      this.picks.delete(chartId);
      return undefined;
    }
    const pick = { bars, range };
    this.picks.set(chartId, pick);
    return pick;
  }

  /** The chart's last pick, if any. */
  public pickFor(chartId: string): PracticeBarsPick | undefined {
    return this.picks.get(chartId);
  }

  /** The PRACTICE range a play of the chart loops: its last pick, or `undefined` for the whole chart. */
  public rangeFor(chartId: string): PracticeRange | undefined {
    return this.picks.get(chartId)?.range;
  }
}
