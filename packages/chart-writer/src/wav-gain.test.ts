import { expect, test } from 'vite-plus/test';
import { createEmptyJSON } from '@be-music/chart-source';
import { parseBMS, parseBmson } from '@be-music/chart-parser';
import { collectBmsWAVVolumeMultipliers } from '@be-music/chart-model';
import { stringifyBMS, stringifyBmson } from './index.ts';

test.each([false, true])(
  'BMS export preserves exactly representable gain even with skipped preservation: %s',
  (skipPreservationValidation) => {
    const chart = parseBMS('#BPM 120\n#WAV01 a.wav\n#WAVCMD 01 01 50\n#00111:01');
    chart.resources.wavGain = { '01': 0.8 };
    const output = stringifyBMS(chart, { skipPreservationValidation });
    const parsed = parseBMS(output);
    expect(collectBmsWAVVolumeMultipliers(parsed).get('01')).toBe(0.4);
    expect(output).toContain('#WAVCMD 01 01 40');
    expect(chart.bms.wavCmds).toEqual(['01 01 50']);
    expect(chart.resources.wavGain).toEqual({ '01': 0.8 });
  },
);

test.each([false, true])(
  'BMS export rejects fractional percentage loss instead of rounding: %s',
  (skipPreservationValidation) => {
    const chart = createEmptyJSON();
    chart.resources.wavGain = { '01': 0.77 };
    chart.bms.wavCmds = ['01 01 33'];
    expect(() => stringifyBMS(chart, { skipPreservationValidation })).toThrow(/exactly/);
  },
);

test.each([false, true])('bmson export rejects non-unity intrinsic gain: %s', (skipPreservationValidation) => {
  const chart = parseBmson(JSON.stringify({ version: '1.0.0', info: { init_bpm: 120 }, sound_channels: [] }));
  chart.resources.wavGain = { '01': 0.77 };
  expect(() => stringifyBmson(chart, { skipPreservationValidation })).toThrow(/gain/);
});

test('unity maps do not change native output', () => {
  const chart = createEmptyJSON();
  const baseline = stringifyBMS(chart);
  chart.resources.wavGain = { '01': 1 };
  expect(stringifyBMS(chart)).toBe(baseline);
});

test('unity-only long gain slots do not introduce native BMS resource definitions', () => {
  const chart = parseBmson(
    JSON.stringify({ version: '1.0.0', info: { init_bpm: 120, mode_hint: 'beat-7k' }, sound_channels: [] }),
  );
  const baseline = stringifyBMS(chart);
  chart.resources.wavGain = { '100': 1 };
  expect(stringifyBMS(chart)).toBe(baseline);
});

test('invalid gains and unresolved control-flow exports fail explicitly', () => {
  const chart = createEmptyJSON();
  chart.resources.wavGain = { '01': -1 };
  expect(() => stringifyBMS(chart)).toThrow(/gain/);
  const branched = parseBMS('#RANDOM 2\n#IF 1\n#WAV01 a.wav\n#ENDIF\n#ENDRANDOM');
  branched.resources.wavGain = { '01': 0.8 };
  expect(() => stringifyBMS(branched)).toThrow(/control flow/);
});
