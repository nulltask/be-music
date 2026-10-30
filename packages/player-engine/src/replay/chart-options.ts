import type { ChartOptionProgram, ChartOptionState } from '@be-music/chart-model';
import { expectRecord, ReplayParseError } from './parse.ts';

/** Parse only supported effective profile fields, independently of current source-command compilation. */
export function parseChartOptionProgram(raw: unknown): ChartOptionProgram {
  const program = expectRecord(raw, 'chart.chartOptions');
  if (Object.keys(program).some((key) => !['version', 'initial', 'cues'].includes(key)))
    throw new ReplayParseError('chart.chartOptions: unknown program field');
  if (program.version !== 1) throw new ReplayParseError('chart.chartOptions.version: expected 1');
  const state = (rawState: unknown): ChartOptionState => {
    const value = expectRecord(rawState, 'chart.chartOptions state');
    if (Object.keys(value).some((key) => key !== 'hiSpeed'))
      throw new ReplayParseError('chart.chartOptions: unknown effective state field');
    if (value.hiSpeed === undefined) return {};
    if (
      typeof value.hiSpeed !== 'number' ||
      !Number.isFinite(value.hiSpeed) ||
      value.hiSpeed < 0.25 ||
      value.hiSpeed > 100
    )
      throw new ReplayParseError('chart.chartOptions.hiSpeed: expected 0.25..100');
    return { hiSpeed: value.hiSpeed };
  };
  if (!Array.isArray(program.cues)) throw new ReplayParseError('chart.chartOptions.cues: expected an array');
  let previous = 0;
  return {
    version: 1,
    initial: state(program.initial),
    cues: program.cues.map((rawCue) => {
      const cue = expectRecord(rawCue, 'chart.chartOptions cue');
      if (Object.keys(cue).some((key) => key !== 'timeUs' && key !== 'state'))
        throw new ReplayParseError('chart.chartOptions: unknown cue field');
      if (typeof cue.timeUs !== 'number' || !Number.isSafeInteger(cue.timeUs) || cue.timeUs < previous)
        throw new ReplayParseError('chart.chartOptions.timeUs: expected nondecreasing nonnegative safe integer');
      previous = cue.timeUs;
      return { timeUs: cue.timeUs, state: state(cue.state) };
    }),
  };
}
