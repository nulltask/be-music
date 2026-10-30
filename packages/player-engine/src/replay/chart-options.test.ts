import { expect, test } from 'vite-plus/test';
import { parseChartOptionProgram, shiftChartOptionProgram } from './chart-options.ts';
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

test('cut stage programs seed their played start, keep FIT time, and clear at the exclusive stage end', () => {
  const source = {
    version: 1 as const,
    initial: { hiSpeed: 0.77 },
    cues: [
      { timeUs: 8_000_000, state: { hiSpeed: 100 } },
      { timeUs: 10_000_000, state: { hiSpeed: 0.25 } },
      { timeUs: 12_000_000, state: {} },
    ],
  };
  const before = structuredClone(source);
  const stage = shiftChartOptionProgram(source, {
    windowStartUs: 8_000_000,
    windowEndUs: 12_000_000,
    offsetUs: 4_000_000,
  });
  expect(stage).toEqual({
    version: 1,
    initial: {},
    cues: [
      { timeUs: 4_000_000, state: { hiSpeed: 100 } },
      { timeUs: 6_000_000, state: { hiSpeed: 0.25 } },
      { timeUs: 8_000_000, state: {} },
    ],
  });
  expect(parseChartOptionProgram(stage)).toEqual(stage);
  stage.cues[0]!.state.hiSpeed = 2;
  expect(source).toEqual(before);
});
test('a stage starting at local zero records its active initial state and preserves equal-time order', () => {
  const source = {
    version: 1 as const,
    initial: { hiSpeed: 0.77 },
    cues: [
      { timeUs: 2, state: { hiSpeed: 100 } },
      { timeUs: 3, state: { hiSpeed: 1 } },
      { timeUs: 3, state: { hiSpeed: 2 } },
    ],
  };
  expect(shiftChartOptionProgram(source, { windowStartUs: 2, offsetUs: 2 })).toEqual({
    version: 1,
    initial: { hiSpeed: 100 },
    cues: [
      { timeUs: 1, state: { hiSpeed: 1 } },
      { timeUs: 1, state: { hiSpeed: 2 } },
    ],
  });
});
