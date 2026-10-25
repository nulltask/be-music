import { expect, test } from 'vite-plus/test';
import { parseBMS, parseBMSBytes, resolveBMSControlFlowWithDraws } from '@be-music/chart-parser';
import { resolveLR2SoundFamilies } from './lr2-sound-families.ts';

test('loader families use filename bytes and keep unconfigured slots on the first group', () => {
  const chart = parseBMS('#WAV09 bb-1.wav\n#WAV01 aa-1.wav\n#WAV02 aa-2.ogg\n#WAV03 Aa-3.wav');
  const families = resolveLR2SoundFamilies(chart);
  expect([families[9], families[1], families[2], families[3], families[4]]).toEqual([0, 1, 1, 2, 0]);
});

test('an overwritten first declaration still establishes the native default loader family', () => {
  const chart = parseBMS('#WAV01 aa.wav\n#WAV02 bb.wav\n#WAV01 bb-2.wav\n#WAV03 aa-3.wav');
  expect(resolveLR2SoundFamilies(chart).slice(0, 5)).toEqual([0, 1, 1, 0, 0]);
});

test('active branch order controls loader group zero without re-rolling the branch', () => {
  const chart = parseBMS('#RANDOM 2\n#IF 1\n#WAV01 aa.wav\n#ELSE\n#WAV01 bb.wav\n#ENDIF\n#ENDRANDOM\n#WAV02 aa-2.wav');
  for (const [value, expected] of [
    [1, 0],
    [2, 1],
  ] as const) {
    const draws = [{ command: 'RANDOM', range: 2, value }] as const;
    const resolved = resolveBMSControlFlowWithDraws(chart, draws);
    expect(resolveLR2SoundFamilies(resolved, draws)[2]).toBe(expected);
  }
});

test('UTF-8 raw prefixes group different Japanese characters sharing the same first two bytes', () => {
  const chart = parseBMSBytes(new TextEncoder().encode('#WAV01 あ.wav\n#WAV02 い.wav\n#WAV03 う.wav'));
  expect(resolveLR2SoundFamilies(chart).slice(0, 4)).toEqual([0, 0, 0, 0]);
});

test('text-only non-ASCII names and stripped declaration order do not receive invented families', () => {
  expect(() => resolveLR2SoundFamilies(parseBMS('#WAV01 あ.wav'))).toThrow(/original filename bytes/);
  const chart = parseBMS('#WAV01 aa.wav');
  chart.preservation.bms.sourceLines = [];
  expect(() => resolveLR2SoundFamilies(chart)).toThrow(/declaration order/);
  expect(resolveLR2SoundFamilies(parseBMS('#00111:01')).every((group) => group === 0)).toBe(true);
});
