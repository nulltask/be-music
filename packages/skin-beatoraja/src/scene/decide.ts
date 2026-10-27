import { clamp } from '@be-music/shared-utils/core';
import type { LibraryChart } from '@be-music/player-scene-model';
import { BEATORAJA_NUM, BEATORAJA_OP } from '../runtime-ids.ts';
import { beatorajaDifficultyOps } from './select.ts';

/** What the decide screen's skin reads: the chart about to be played, and how far the play behind it has loaded. */
export interface BeatorajaDecideInput {
  readonly chart: Pick<LibraryChart, 'playLevel' | 'bpm' | 'chart'>;
  /**
   * The BPM the most judged notes of the chart as the play will play it sit at (beatoraja's MAINBPM,
   * `resolveChartMainBPM` of `@be-music/chart-model`, the rule the play reads); the listed BPM when 0 or absent.
   */
  readonly mainBPM?: number;
  /** How far the play behind the screen has loaded, 0..1. */
  readonly progress: number;
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0;
}

/**
 * The ops the decide screen lights: the chart's difficulty ops (`beatorajaDifficultyOps`: beatoraja's `LEVEL_*` and
 * LR2's `DIFFICULTY_*`, which skins gate the title and the level on), and `NOW_LOADING` while the play loads, then
 * `LOADED` (the loading bar shows on the one, a "press to continue" prompt on the other).
 */
export function resolveBeatorajaDecideOps(input: BeatorajaDecideInput): number[] {
  return [
    ...beatorajaDifficultyOps(input.chart.chart.metadata.difficulty),
    clampUnit(input.progress) < 1 ? BEATORAJA_OP.NOW_LOADING : BEATORAJA_OP.LOADED,
  ];
}

/** `#PLAYLEVEL` as a whole number: a number truncated, text parsed, 0 without a readable one. */
function playLevelNumber(level: number | string | undefined): number {
  if (level === undefined) return 0;
  const parsed = typeof level === 'number' ? Math.trunc(level) : Number.parseInt(String(level), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The decide screen's number (`value[].ref`): the chart's `#PLAYLEVEL` (96), its main BPM (92,
 * {@link BeatorajaDecideInput.mainBPM}) and its BPM as the library lists it on the other BPM numbers (90, 91 and 160),
 * rounded, and the loading progress in whole percent (165). Every other id reads 0: there is no score, combo or record
 * before the play, and a skin's stat readouts still show.
 */
export function resolveBeatorajaDecideNumber(id: number, input: BeatorajaDecideInput): number {
  switch (id) {
    case BEATORAJA_NUM.PLAYLEVEL:
      return playLevelNumber(input.chart.playLevel);
    case BEATORAJA_NUM.MAINBPM:
      return Math.round(input.mainBPM !== undefined && input.mainBPM > 0 ? input.mainBPM : (input.chart.bpm ?? 0));
    case BEATORAJA_NUM.MAXBPM:
    case BEATORAJA_NUM.MINBPM:
    case BEATORAJA_NUM.NOWBPM:
      return Math.round(input.chart.bpm ?? 0);
    case BEATORAJA_NUM.LOADING_PROGRESS:
      return Math.round(clampUnit(input.progress) * 100);
    default:
      return 0;
  }
}

/** The decide screen's bar graph (`graph[].type`) as a fill ratio: the loading progress (102), else `undefined`. */
export function resolveBeatorajaDecideGraphValue(type: number, input: BeatorajaDecideInput): number | undefined {
  return type === 102 ? clampUnit(input.progress) : undefined;
}
