// Writes the latency jig's test chart (docs/latency-jig.md): `node scripts/latency-jig/chart.ts <outDir> [measures]`.
// A note on lane 1 every beat, each with a click keysound whose first sample is full scale, so the jig sees a sharp
// onset. Pressing lane 1 anywhere in the chart sounds the nearest note's click.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface JigChartOptions {
  /** How many measures of notes (4 beats each). */
  measures: number;
  bpm: number;
}

export const JIG_CHART_DEFAULTS: JigChartOptions = { measures: 300, bpm: 120 };

/** The chart as BMS text: lane 1 (`#xxx11`) gets a note on every beat, all playing `click.wav`. */
export function jigChartBMS(options: JigChartOptions = JIG_CHART_DEFAULTS): string {
  const lines = [
    '#PLAYER 1',
    '#GENRE LATENCY JIG',
    '#TITLE Latency Jig Click',
    '#ARTIST Be-Music',
    `#BPM ${options.bpm}`,
    '#PLAYLEVEL 1',
    '#RANK 3',
    '#TOTAL 1000',
    '#WAV01 click.wav',
  ];
  for (let measure = 1; measure <= options.measures; measure += 1) {
    lines.push(`#${String(measure).padStart(3, '0')}11:01010101`);
  }
  return lines.join('\r\n') + '\r\n';
}

/**
 * A mono 16-bit WAV: one millisecond at full scale, then silence to `lengthMs`. The step from silence to full scale is
 * the onset the jig detects.
 */
export function clickWAV(sampleRate = 44_100, lengthMs = 50): Uint8Array {
  const frames = Math.round((sampleRate * lengthMs) / 1000);
  const clickFrames = Math.max(1, Math.round(sampleRate / 1000));
  const bytes = new Uint8Array(44 + frames * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + frames * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, frames * 2, true);
  for (let frame = 0; frame < clickFrames && frame < frames; frame += 1) view.setInt16(44 + frame * 2, 32_767, true);
  return bytes;
}

/** Writes `latency-jig.bms` and `click.wav` into `outDir`. */
export async function writeJigChart(outDir: string, options: JigChartOptions = JIG_CHART_DEFAULTS): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'latency-jig.bms'), jigChartBMS(options));
  await writeFile(join(outDir, 'click.wav'), clickWAV());
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = process.argv[2];
  const measures = process.argv[3] === undefined ? JIG_CHART_DEFAULTS.measures : Number(process.argv[3]);
  if (outDir === undefined || !Number.isInteger(measures) || measures < 1 || measures > 999) {
    console.error('usage: node scripts/latency-jig/chart.ts <outDir> [measures (1-999)]');
    process.exit(1);
  }
  await writeJigChart(outDir, { ...JIG_CHART_DEFAULTS, measures });
  console.log(`wrote ${join(outDir, 'latency-jig.bms')} and click.wav (${measures} measures)`);
}
