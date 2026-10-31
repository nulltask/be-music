import { describe, expect, test } from 'vite-plus/test';
import {
  collectBMSExWAVVolumeMultipliers,
  collectBmsWAVVolumeMultipliers,
  parseBMSExWAV,
  resolveBmsWAVResources,
  wavCmdVolumePercentToLinearGain,
} from './wav-directives.ts';
import { createEmptyJSON } from '@be-music/chart-source';
import { resolveChart } from './resolved-chart.ts';
import { computeChartFingerprint, computePlayFingerprint } from './fingerprint.ts';

test('intrinsic audio gain does not change chart or play identity', () => {
  const chart = createEmptyJSON();
  chart.events = [{ measure: 1, channel: '11', position: [0, 1], value: '01' }];
  const options = { chartPath: 'chart.bms' };
  const before = [computeChartFingerprint(chart, options), computePlayFingerprint(chart, options)];
  chart.resources.wavGain = { '01': 0.77 };
  expect([computeChartFingerprint(chart, options), computePlayFingerprint(chart, options)]).toEqual(before);
});

test('intrinsic gain composes once with WAVCMD and EXWAV without integer-percentage rounding', () => {
  const chart = createEmptyJSON();
  chart.bms.wavCmds = ['01 01 33', '01 02 50'];
  chart.bms.exWAV = { '01': 'v -600 a.wav' };
  chart.resources.wavGain = { '01': 0.77, '02': 1.41, '03': 0 };
  expect([...collectBmsWAVVolumeMultipliers(chart)]).toEqual([
    ['01', 0.33 * 10 ** (-6 / 20) * 0.77],
    ['02', 0.5 * 1.41],
    ['03', 0],
  ]);
});

test('EXWAV owns a shared slot, supplies EXWAV-only slots and preserves the authored maps', () => {
  const chart = createEmptyJSON('bms');
  chart.resources.wav = { '01': 'ordinary.wav', '03': 'fallback.wav' };
  chart.bms.exWAV = { '01': 'v -600 extended.wav', '02': 'p 0 only.wav', '03': 'broken' };
  chart.events = ['01', '02', '03'].map((value) => ({ measure: 0, channel: '01', position: [0, 1], value }));
  expect(resolveBmsWAVResources(chart)).toEqual({ '01': 'extended.wav', '02': 'only.wav', '03': 'fallback.wav' });
  expect(resolveChart(chart).sampleTriggers.map((trigger) => trigger.samplePath)).toEqual([
    'extended.wav',
    'only.wav',
    'fallback.wav',
  ]);
  expect(chart.resources.wav).toEqual({ '01': 'ordinary.wav', '03': 'fallback.wav' });
});

test.each(['v nope bad.wav', 'pv 0 bad.wav', 'p 3oops bad.wav', 'pp 0 1 bad.wav', 'x 1 bad.wav', 'v 1e3 bad.wav'])(
  'malformed EXWAV does not replace a WAV filename: %s',
  (raw) => {
    const chart = createEmptyJSON('bms');
    chart.resources.wav['01'] = 'fallback.wav';
    chart.bms.exWAV['01'] = raw;
    expect(parseBMSExWAV(raw)).toBeUndefined();
    expect(resolveBmsWAVResources(chart)['01']).toBe('fallback.wav');
  },
);

test.each([
  [0, 0],
  [50, 0.5],
  [100, 1],
  [127, 1.27],
  [200, 2],
  [-1, 0],
  [Number.NaN, 1],
  [Infinity, 1],
])('MacBeat volume %s resolves to gain %s', (percent, gain) => {
  expect(wavCmdVolumePercentToLinearGain(percent)).toBe(gain);
});

test('EXWAV playback volume respects attenuation-only bounds and the silent endpoint', () => {
  const gains = collectBMSExWAVVolumeMultipliers({
    '01': 'v -10000 silent.wav',
    '02': 'v -12000 below.wav',
    '03': 'v 600 above.wav',
    '04': 'v 0 unity.wav',
  });
  expect([...gains.values()]).toEqual([0, 0, 1, 1]);
});

describe('EXWAV whitespace parameters', () => {
  test('reads the published nanasigroove vfp example without treating parameters as the filename', () => {
    expect(parseBMSExWAV('vfp -50 100 -10000 aaa.wav')).toEqual({
      volumeMillibels: -50,
      frequencyHz: 100,
      pan: -10000,
      filename: 'aaa.wav',
    });
  });

  test('accepts mixed-case flags, tabs and a filename containing spaces', () => {
    expect(parseBMSExWAV('PvF\t500\t-600\t48000\tmy sample.wav')).toEqual({
      pan: 500,
      volumeMillibels: -600,
      frequencyHz: 48000,
      filename: 'my sample.wav',
    });
  });

  test.each(['pv', 'vp', 'pf', 'fp', 'vf', 'fv', 'pvf', 'pfv', 'vpf', 'vfp', 'fpv', 'fvp'])(
    'consumes exactly the parameters declared by %s',
    (flags) => {
      const values: Record<string, number> = { p: -500, v: -200, f: 44100 };
      const parsed = parseBMSExWAV(
        `${flags} ${flags
          .split('')
          .map((flag) => values[flag])
          .join(' ')} a b.wav`,
      );
      expect(parsed?.filename).toBe('a b.wav');
      expect(parsed?.pan).toBe(flags.includes('p') ? -500 : undefined);
      expect(parsed?.volumeMillibels).toBe(flags.includes('v') ? -200 : undefined);
      expect(parsed?.frequencyHz).toBe(flags.includes('f') ? 44100 : undefined);
    },
  );

  test('requires a filename after all whitespace parameters', () => {
    expect(parseBMSExWAV('pvf 0 -200 48000')).toBeUndefined();
    expect(parseBMSExWAV('pvf 0 -200')).toBeUndefined();
  });

  test('retains earlier comma-separated Be-Music input', () => {
    expect(parseBMSExWAV('pvf 500,-600,48000 my sample.wav')).toEqual(
      parseBMSExWAV('pvf 500 -600 48000 my sample.wav'),
    );
  });

  test('applies the same volume multiplier for both parameter spellings', () => {
    const multipliers = collectBMSExWAVVolumeMultipliers({
      '01': 'pvf 0 -600 48000 one.wav',
      '02': 'pvf 0,-600,48000 two.wav',
    });
    expect(multipliers.get('01')).toBeCloseTo(10 ** (-6 / 20));
    expect(multipliers.get('02')).toBe(multipliers.get('01'));
  });
});
