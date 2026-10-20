// What a beatoraja play skin reads of the chart being played: its traits (for the `HAS_*` / `NO_*` ops), each side's
// last note (for the end-of-notes timers) and its tempo facts (for the BPM and white-number readouts). The ids
// themselves come from `@be-music/beatoraja-skin/scene`; this file only reads the chart.

import type { BeatorajaChartTraits, BeatorajaPlayChartFacts } from '@be-music/beatoraja-skin/scene';
import type { BeMusicJSON } from '@be-music/json';
import { resolveChartBPMRange } from '../bpm-range.ts';
import type { BeatorajaChartNoteDistribution } from './note-distribution.ts';
import { beatorajaEventBeat, computeBeatorajaMeasureBaseBeats } from './timing.ts';

/**
 * The traits of a chart a play skin gates chrome on: long notes (any `5x` / `6x` channel), BPM changes (`03` / `08`),
 * STOPs (`09`), text (`99`), BGA (a `#BMP` table), and the stage file, banner and back image the header names. Read off
 * the channels, as the play scene has always read them.
 */
export function beatorajaPlayChartTraits(chart: BeMusicJSON): BeatorajaChartTraits {
  let longNote = false;
  let bpmChange = false;
  let stop = false;
  let text = false;
  for (const event of chart.events ?? []) {
    const channel = event.channel;
    if (channel.length === 2) {
      const first = channel[0];
      if (first === '5' || first === '6') longNote = true;
      else if (channel === '03' || channel === '08') bpmChange = true;
      else if (channel === '09') stop = true;
      else if (channel === '99') text = true;
    }
    if (longNote && bpmChange && stop && text) break;
  }
  const meta = chart.metadata;
  return {
    longNote,
    bpmChange,
    stop,
    text,
    bga: Object.keys(chart.resources?.bmp ?? {}).length > 0,
    stageFile: Boolean(meta.stageFile),
    banner: Boolean(meta.banner),
    backBMP: Boolean(meta.backBMP),
  };
}

/**
 * The beat of each side's last note: 1P on the `1x` and `5x` channels, 2P on `2x` and `6x` (BGM, mines and invisible
 * objects do not count, so the end of the notes is the last note to play). A side without notes is left out and never
 * reaches its end.
 */
export function computeBeatorajaLastNoteBeats(chart: BeMusicJSON): { 1?: number; 2?: number } {
  const measureBaseBeat = computeBeatorajaMeasureBaseBeats(chart);
  const last: { 1?: number; 2?: number } = {};
  for (const event of chart.events ?? []) {
    if (event.value === '00' || event.value === '') continue;
    const channel = event.channel;
    if (channel.length < 2 || channel === '01') continue;
    const head = channel[0];
    const side = head === '1' || head === '5' ? 1 : head === '2' || head === '6' ? 2 : undefined;
    if (side === undefined) continue;
    const beat = beatorajaEventBeat(event, measureBaseBeat);
    if (beat === undefined) continue;
    const previous = last[side];
    if (previous === undefined || beat > previous) last[side] = beat;
  }
  return last;
}

const NO_CHART: BeatorajaPlayChartFacts = { bpm: 0, minBPM: 0, maxBPM: 0 };

/**
 * The tempo facts a play skin's numbers read: the header BPM and `#PLAYLEVEL`, the main BPM and the tempo changes of
 * the note distribution, and the tempo map's lowest and highest BPM (resolved only when a skin asks for them).
 */
export function beatorajaPlayChartFacts(
  chart: BeMusicJSON | undefined,
  distribution: Pick<BeatorajaChartNoteDistribution, 'mainBPM' | 'bpmSegments'> | undefined,
): BeatorajaPlayChartFacts {
  if (chart === undefined) return NO_CHART;
  return {
    bpm: chart.metadata.bpm,
    ...(distribution !== undefined ? { mainBPM: distribution.mainBPM, bpmSegments: distribution.bpmSegments } : {}),
    ...(chart.metadata.playLevel !== undefined ? { playLevel: chart.metadata.playLevel } : {}),
    get minBPM(): number {
      return resolveChartBPMRange(chart).min;
    },
    get maxBPM(): number {
      return resolveChartBPMRange(chart).max;
    },
  };
}
