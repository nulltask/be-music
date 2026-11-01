import { describe, expect, test } from 'vite-plus/test';
import { resolveChart } from '@be-music/chart-model';
import { parseBMS, parseBmson } from '@be-music/chart-parser';
import { stringifyBmson } from './index.ts';
import { MAX_EXACT_BMSON_RESOLUTION, resolveExactBmsonResolution } from './bmson-output-resolution.ts';

function bms(...lines: string[]) {
  return parseBMS(['#TITLE r', '#BPM 120', '#WAV01 a.wav', ...lines].join('\n'));
}

/** Every note's time in the chart and in its bmson output, in seconds. */
function noteTimes(source: ReturnType<typeof bms>, resolution?: number) {
  const output = parseBmson(stringifyBmson(source, resolution === undefined ? {} : { resolution }));
  const times = (json: ReturnType<typeof bms>) => resolveChart(json).notes.map((note) => note.seconds);
  return {
    before: times(source),
    after: times(output),
    resolution: JSON.parse(stringifyBmson(source)).info.resolution,
  };
}

describe('resolveExactBmsonResolution', () => {
  test('keeps 240 for a chart on the 240 grid, and grows it in steps of 240 for finer ones', () => {
    expect(resolveExactBmsonResolution(bms('#00111:0101'))).toBe(240);
    // 1/192 of a measure is 1/48 beat; 1/384 is 1/96 beat.
    expect(resolveExactBmsonResolution(bms(`#00111:01${'00'.repeat(190)}01`))).toBe(240);
    expect(resolveExactBmsonResolution(bms(`#00111:01${'00'.repeat(382)}01`))).toBe(480);
    // An odd denominator: 1/7 of a measure is 4/7 beat.
    expect(resolveExactBmsonResolution(bms('#00111:01000000000001'))).toBe(1680);
  });

  test('follows fractional measure lengths into the measures after them', () => {
    // A 0.703125 (45/64) measure starts the next one 45/16 beats later: a 16th of a beat fits 240.
    expect(resolveExactBmsonResolution(bms('#00102:0.703125', '#00111:01', '#00211:01'))).toBe(240);
    // Halving a 1.234375 (79/64) measure puts a note at 79/32 beat: a 32nd of a beat needs 480.
    expect(resolveExactBmsonResolution(bms('#00102:1.234375', '#00111:0101', '#00211:01'))).toBe(480);
  });

  test('caps the resolution, and rounds to the cap past it', () => {
    // 1/997 of a measure (a prime) needs 997 × 240 pulses per beat.
    expect(resolveExactBmsonResolution(bms(`#00111:01${'00'.repeat(995)}01`))).toBe(MAX_EXACT_BMSON_RESOLUTION);
    expect(resolveExactBmsonResolution(bms('#00102:0.1234567890123', '#00211:01'))).toBe(MAX_EXACT_BMSON_RESOLUTION);
  });
});

describe('bmson output resolution', () => {
  test('keeps every note time of a fine-grid chart exactly', () => {
    // A 1/384 note (a 96th of a beat), a 0.75 measure, and sevenths of a measure after it: lcm(240, 96, 7).
    const { before, after, resolution } = noteTimes(
      bms(`#00111:01${'00'.repeat(382)}01`, '#00202:0.75', '#00211:01', '#00311:01000000000001'),
    );
    expect(resolution).toBe(3360);
    expect(after).toEqual(before);
  });

  test('keeps an extreme-BPM gimmick chart in time where 240 drifts', () => {
    const source = bms(
      '#BPMFE 0.703125',
      '#BPMFF 9999999',
      '#00108:FE',
      `#00111:01${'00'.repeat(382)}01`,
      '#00208:FF',
      '#00311:0101',
    );
    const exact = noteTimes(source);
    for (const [index, seconds] of exact.before.entries()) expect(exact.after[index]).toBeCloseTo(seconds, 6);
    const fixed = noteTimes(source, 240);
    expect(Math.max(...fixed.after.map((seconds, index) => Math.abs(seconds - fixed.before[index]!)))).toBeGreaterThan(
      0.1,
    );
  });

  test('keeps an explicit resolution and a bmson source resolution', () => {
    const source = bms(`#00111:01${'00'.repeat(382)}01`);
    expect(JSON.parse(stringifyBmson(source, { resolution: 240 })).info.resolution).toBe(240);
    const bmson = parseBmson(
      JSON.stringify({ version: '1.0.0', info: { init_bpm: 120, resolution: 96 }, sound_channels: [] }),
    );
    expect(JSON.parse(stringifyBmson(bmson)).info.resolution).toBe(96);
  });
});
