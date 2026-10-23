import { parseChart } from '@be-music/chart-parser';
import { describe, expect, test } from 'vite-plus/test';
import { createNonstopStageTiming } from './stage.ts';

const bms = (...lines: string[]) => parseChart(lines.join('\n'), 'bms');

describe('createNonstopStageTiming', () => {
  test('reads the visible notes, tempo and measure-0 length LR2 places a stage by', () => {
    const timing = createNonstopStageTiming(
      bms(
        '#BPM 120',
        '#BPM01 240',
        '#00002:0.5',
        '#00101:01',
        '#00111:0001',
        '#00317:01', // free zone: dropped by LR2
        '#00412:00000001',
        '#00508:01',
        '#00616:01', // after the BPM change
      ),
    );
    expect(timing).toMatchObject({
      firstNote: 1.5,
      lastNote: 6,
      headerBPM: 120,
      finalBPM: 240,
      firstMeasureLength: 0.5,
    });
    // Measure 0 is half a measure at 120 BPM (1 s); measures 1-4 are 2 s each; from measure 5, 1 s each.
    expect(timing.secondsAt(1)).toBeCloseTo(1);
    expect(timing.secondsAt(1.5)).toBeCloseTo(2);
    expect(timing.secondsAt(6)).toBeCloseTo(10);
  });

  test("lowers LR2's first note by any object on a later line, not by earlier lines", () => {
    // In file order: a BGM object at measure 1 before the first note (ignored), the first note at measure 3, then a
    // BGA object at measure 2 on a later line (taken).
    const timing = createNonstopStageTiming(bms('#BPM 120', '#00101:01', '#00311:01', '#00204:01'));
    expect(timing.firstNote).toBe(3);
    expect(timing.lr2FirstNote).toBe(2);
  });

  test('reads 17 and 57 as visible lanes in a PMS chart only', () => {
    const chart = bms('#BPM 120', '#00117:01', '#00211:01');
    expect(createNonstopStageTiming(chart).firstNote).toBe(2);
    expect(createNonstopStageTiming(chart, { pms: true }).firstNote).toBe(1);
  });

  test('falls back to measure 0 for a chart without notes', () => {
    const timing = createNonstopStageTiming(bms('#BPM 150', '#00101:01'));
    expect(timing).toMatchObject({ firstNote: 0, lastNote: 0, finalBPM: 150 });
    expect(timing.lr2FirstNote).toBeUndefined();
  });
});

test('intended bmson timing includes extended keyboard lanes', () => {
  const chart = parseChart(
    JSON.stringify({
      version: '1.0.0',
      info: { init_bpm: 120, resolution: 240, mode_hint: 'keyboard-24k' },
      sound_channels: [
        {
          name: 'key.wav',
          notes: [
            { x: 24, y: 240 },
            { x: 25, y: 960 },
          ],
        },
      ],
    }),
    'bmson',
  );
  const stage = createNonstopStageTiming(chart);
  expect(stage.firstNote).toBe(0.25);
  expect(stage.lastNote).toBe(1);
  expect(stage.secondsAt(stage.firstNote)).toBe(0.5);
});
