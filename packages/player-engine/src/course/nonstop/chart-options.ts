import {
  buildChartOptionTimeline,
  compileChartOptions,
  type ChartOptionDiagnostic,
  type ChartOptionState,
  type ChartOptionStateCue,
  type ResolvedChart,
} from '@be-music/chart-model';
import type { NonstopStagePlacement } from './plan.ts';

export interface NonstopChartOptionDiagnostic extends ChartOptionDiagnostic {
  stage: number;
  /** Unplaced source-chart time, when the diagnostic came from A6. `seconds` uses the course clock. */
  sourceSeconds?: number;
}

/** Place a stage's effective operations in its exclusive course window, including a trimmed initial selection. */
export function placeNonstopChartOptions(
  chart: ResolvedChart,
  placement: Pick<NonstopStagePlacement, 'offsetSeconds' | 'rate'>,
  window: { start: number; end: number },
  stage: number,
): { cues: ChartOptionStateCue[]; diagnostics: NonstopChartOptionDiagnostic[]; hasOperations: boolean } {
  const { program, diagnostics: sourceDiagnostics } = compileChartOptions(
    buildChartOptionTimeline(chart.source, chart.timing),
  );
  const place = (seconds: number) => placement.offsetSeconds + seconds / placement.rate;
  const startUs = Math.max(0, Math.round(window.start * 1_000_000));
  const endUs = Number.isFinite(window.end) ? Math.round(window.end * 1_000_000) : Infinity;
  const freezeUs = chart.reversal ? Math.round(chart.reversal.seconds * 1_000_000) : Infinity;
  const placed = program.cues
    .filter((cue) => cue.timeUs <= freezeUs)
    .map((cue) => ({ timeUs: Math.round(place(cue.timeUs / 1_000_000) * 1_000_000), state: { ...cue.state } }));
  let initial: ChartOptionState = { ...program.initial };
  for (const cue of placed) {
    if (cue.timeUs > startUs) break;
    initial = { ...cue.state };
  }
  const cues = [
    { timeUs: startUs, state: initial },
    ...placed.filter((cue) => cue.timeUs > startUs && cue.timeUs < endUs),
  ];
  const diagnostics = sourceDiagnostics.flatMap((diagnostic): NonstopChartOptionDiagnostic[] => {
    const sourceSeconds = diagnostic.seconds;
    if (
      sourceSeconds !== undefined &&
      (sourceSeconds * 1_000_000 > freezeUs || place(sourceSeconds) * 1_000_000 >= endUs)
    )
      return [];
    return [
      {
        ...diagnostic,
        stage,
        seconds:
          sourceSeconds === undefined ? startUs / 1_000_000 : Math.max(startUs / 1_000_000, place(sourceSeconds)),
        ...(sourceSeconds !== undefined ? { sourceSeconds } : {}),
      },
    ];
  });
  return { cues, diagnostics, hasOperations: cues.some((cue) => cue.state.hiSpeed !== undefined) };
}
