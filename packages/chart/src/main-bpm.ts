import type { ResolvedChart } from './resolved-chart.ts';

/** What {@link resolveChartMainBpm} reads of a resolved chart. */
export interface MainBpmChart {
  readonly notes: ReadonlyArray<Pick<ResolvedChart['notes'][number], 'kind' | 'beat' | 'endBeat' | 'lnMode'>>;
  readonly timing: Pick<ResolvedChart['timing'], 'bpmAtBeat'>;
}

/**
 * The chart's main BPM: the BPM the most judged notes sit at. It is beatoraja's main BPM, which its play screen pegs
 * HS-FIX `MAINBPM` to and takes the white and green numbers at the main BPM at (`LaneRenderer.init`: a count of
 * `TimeLine.getTotalNotes()` per timeline BPM; its song database and BPM graph count the same way). A tap and a
 * long-note head count once; a long-note tail counts too when its mode judges it (CN / HCN); mines and invisible notes
 * do not count. A note on a BPM change counts at the new BPM. Unlike a time average or the BPM held longest, it is not
 * moved by the split-second BPM spikes of BPM × N + STOP gimmicks or by stretches without notes. Ties go to the BPM
 * reached first (beatoraja's pick among ties follows its `HashMap` order). `undefined` for a chart without notes.
 *
 * The browser player reads the main BPM only from here: HS-FIX `AVERAGE`, the play log's `visibleMs`, the HUD and the
 * beatoraja skins' main-BPM numbers and BPM graph.
 */
export function resolveChartMainBpm(chart: MainBpmChart): number | undefined {
  const counts = new Map<number, { count: number; firstBeat: number }>();
  const add = (beat: number): void => {
    const bpm = chart.timing.bpmAtBeat(beat);
    if (!Number.isFinite(bpm) || bpm <= 0) return;
    const entry = counts.get(bpm);
    if (entry) {
      entry.count += 1;
      entry.firstBeat = Math.min(entry.firstBeat, beat);
    } else {
      counts.set(bpm, { count: 1, firstBeat: beat });
    }
  };
  for (const note of chart.notes) {
    add(note.beat);
    if (note.kind === 'ln' && note.endBeat !== undefined && (note.lnMode === 2 || note.lnMode === 3)) {
      add(note.endBeat);
    }
  }
  let main: number | undefined;
  let best: { count: number; firstBeat: number } | undefined;
  for (const [bpm, entry] of counts) {
    if (!best || entry.count > best.count || (entry.count === best.count && entry.firstBeat < best.firstBeat)) {
      main = bpm;
      best = entry;
    }
  }
  return main;
}
