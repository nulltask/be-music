import { describe, expect, test } from 'vite-plus/test';
import { collectBMSExWAVVolumeMultipliers, parseBMSExWAV } from './wav-directives.ts';

describe('EXWAV whitespace parameters', () => {
  test('reads the published nanasigroove vfp example without treating parameters as the filename', () => {
    expect(parseBMSExWAV('vfp -50 100 -10000 aaa.wav')).toEqual({
      volumeCentibels: -50,
      frequencyHz: 100,
      pan: -10000,
      filename: 'aaa.wav',
    });
  });

  test('accepts mixed-case flags, tabs and a filename containing spaces', () => {
    expect(parseBMSExWAV('PvF\t500\t-600\t48000\tmy sample.wav')).toEqual({
      pan: 500,
      volumeCentibels: -600,
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
      expect(parsed?.volumeCentibels).toBe(flags.includes('v') ? -200 : undefined);
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
