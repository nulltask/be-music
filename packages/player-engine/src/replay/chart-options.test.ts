import { expect, test } from 'vite-plus/test';
import { parseChartOptionProgram } from './chart-options.ts';
const program = () => ({ version: 1, initial: { hiSpeed: 0.77 }, cues: [{ timeUs: 1, state: { hiSpeed: 100 } }] });
test('effective chart options retain exact display values and own all nested replay data', () => {
  const raw = program();
  const parsed = parseChartOptionProgram(raw);
  expect(parsed).toEqual(raw);
  parsed.initial.hiSpeed = 2;
  parsed.cues[0]!.state.hiSpeed = 3;
  expect(raw.initial.hiSpeed).toBe(0.77);
  expect(raw.cues[0]!.state.hiSpeed).toBe(100);
});
test.each([
  { ...program(), unknown: 1 },
  { ...program(), cues: [{ timeUs: 1, state: {}, unknown: 1 }] },
  { ...program(), version: 2 },
  { ...program(), initial: { unknown: 1 } },
  { ...program(), initial: { hiSpeed: 0.24 } },
  { ...program(), initial: { hiSpeed: 100.01 } },
  { ...program(), initial: { hiSpeed: NaN } },
  { ...program(), cues: null },
  { ...program(), cues: [{ timeUs: -1, state: {} }] },
  {
    ...program(),
    cues: [
      { timeUs: 2, state: {} },
      { timeUs: 1, state: {} },
    ],
  },
  { ...program(), cues: [{ timeUs: 1.5, state: {} }] },
])('rejects unsupported or malformed effective programs: %j', (value) => {
  expect(() => parseChartOptionProgram(value)).toThrow();
});
