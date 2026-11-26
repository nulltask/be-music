import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vite-plus/test';
import { parseChart } from '@be-music/chart-parser';
import { clickWAV, jigChartBMS, writeJigChart } from './chart.ts';

describe('jigChartBMS', () => {
  test('puts a lane 1 note on every beat of every measure', () => {
    const text = jigChartBMS({ measures: 3, bpm: 150 });
    expect(text).toContain('#BPM 150\r\n');
    expect(text).toContain('#WAV01 click.wav\r\n');
    expect(text.match(/^#\d{3}11:01010101$/gm)).toEqual(['#00111:01010101', '#00211:01010101', '#00311:01010101']);
  });

  test('parses as a chart with four notes a measure on lane 1', () => {
    const chart = parseChart(jigChartBMS({ measures: 2, bpm: 120 }), 'latency-jig.bms');
    const notes = chart.events.filter((event) => event.channel === '11');
    expect(notes).toHaveLength(8);
    expect(chart.resources.wav['01']).toBe('click.wav');
  });
});

describe('clickWAV', () => {
  test('is a mono 16-bit WAV with a full-scale first millisecond, then silence', () => {
    const bytes = clickWAV(48_000, 10);
    const view = new DataView(bytes.buffer);
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('RIFF');
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(48_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(480 * 2);
    expect(view.getInt16(44, true)).toBe(32_767);
    expect(view.getInt16(44 + 47 * 2, true)).toBe(32_767);
    expect(view.getInt16(44 + 48 * 2, true)).toBe(0);
    expect(bytes.byteLength).toBe(44 + 480 * 2);
  });
});

describe('writeJigChart', () => {
  test('writes the chart and its click', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'latency-jig-'));
    try {
      await writeJigChart(join(dir, 'jig'), { measures: 1, bpm: 120 });
      expect((await readdir(join(dir, 'jig'))).sort()).toEqual(['click.wav', 'latency-jig.bms']);
      expect(await readFile(join(dir, 'jig', 'latency-jig.bms'), 'utf8')).toContain('#00111:01010101');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
