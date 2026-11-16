import { describe, expect, test } from 'vite-plus/test';
import { parseBMS, parseLRX } from '../../chart-parser/src/index.ts';
import { resolveLRXPlayEndSeconds } from './lrx-play-end.ts';
import { resolveChart } from './resolved-chart.ts';

// BPM 120: 480 ticks is 0.5 s.
const chart = (...notes: string[]) =>
  resolveChart(parseLRX({ lrs: `<LRS><n c="301" s="0" p="120" /><n c="300" s="0" />${notes.join('')}</LRS>` }));

describe('resolveLRXPlayEndSeconds', () => {
  test('ends at the end-of-song note when the chart has one', () => {
    expect(resolveLRXPlayEndSeconds(chart('<n c="1" s="960" p="0" />', '<n c="309" s="1920" />'))).toBe(2);
  });

  test('without one, ends 3 s after the last sound note starts, whatever lane or column it is on', () => {
    // A lane note at 1 s, a BGM note at 1.5 s, a long note from 0.5 s to 2.5 s.
    const json = chart(
      '<n c="1" s="960" p="0" />',
      '<n c="100" s="1440" p="1" />',
      '<n c="2" s="480" e="2400" p="2" />',
    );
    expect(resolveLRXPlayEndSeconds(json)).toBe(4.5);
  });

  test('keeps whole milliseconds, as plugout does', () => {
    // 100 ticks at 120 BPM is 0.104166… s.
    expect(resolveLRXPlayEndSeconds(chart('<n c="1" s="0" p="0" />', '<n c="309" s="100" />'))).toBe(0.104);
  });

  test('is undefined for any other chart', () => {
    expect(resolveLRXPlayEndSeconds(resolveChart(parseBMS('#BPM 120\n#00111:01\n')))).toBeUndefined();
  });
});
