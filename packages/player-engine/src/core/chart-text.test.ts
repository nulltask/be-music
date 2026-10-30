import { expect, test } from 'vite-plus/test';
import { ChartTextController, resolveChartTextInput } from './chart-text.ts';

const timeline = {
  cues: [
    { seconds: 1, key: '01', text: 'normal' },
    { seconds: 2, key: '02', text: 'next' },
  ],
  missText: 'MISS',
};

test('text selections and misses use the chart clock, with exclusive expiry and early clear', () => {
  const text = new ChartTextController(timeline);
  expect(text.read(0)).toBe('');
  expect(text.read(1)).toBe('normal');
  text.addInput({ seconds: 1.8, action: 'trigger' });
  expect(text.read(1.8)).toBe('MISS');
  expect(text.read(2)).toBe('MISS');
  expect(text.read(2.3)).toBe('next');
  text.addInput({ seconds: 2.4, action: 'trigger' });
  text.addInput({ seconds: 2.5, action: 'clear' });
  expect(text.read(2.49)).toBe('MISS');
  expect(text.read(2.5)).toBe('next');
});

test('missing and explicit empty miss text remain distinct', () => {
  for (const [missText, expected] of [
    [undefined, 'normal'],
    ['', ''],
  ] as const) {
    const text = new ChartTextController({ ...timeline, missText });
    text.addInput({ seconds: 1, action: 'trigger' });
    expect(text.read(1.1)).toBe(expected);
  }
});

test('out-of-order inputs, equal-time clear and seek reconstruction are deterministic', () => {
  const text = new ChartTextController(timeline);
  text.addInput({ seconds: 2.1, action: 'clear' });
  text.addInput({ seconds: 2, action: 'trigger' });
  expect(text.read(2.05)).toBe('MISS');
  expect(text.read(2.1)).toBe('next');
  text.reset([{ seconds: 2, action: 'trigger' }]);
  expect(text.read(2.05)).toBe('MISS');
  text.reset();
  expect(text.read(2.05)).toBe('next');
  text.addInput({ seconds: 2, action: 'trigger' });
  text.addInput({ seconds: 2, action: 'clear' });
  expect(text.read(2)).toBe('next');
});

test('reversal freezes text selection and ignores later judgment inputs', () => {
  const text = new ChartTextController(timeline, 1.5);
  text.addInput({ seconds: 2, action: 'trigger' });
  expect(text.read(3)).toBe('normal');
  text.addInput({ seconds: 1.4, action: 'trigger' });
  expect(text.read(5)).toBe('MISS');
});

test('only actual poor-display effects drive the miss text', () => {
  expect(resolveChartTextInput({ kind: 'poor-bga', action: 'trigger', seconds: 1 })).toEqual({
    seconds: 1,
    action: 'trigger',
  });
  expect(resolveChartTextInput({ kind: 'poor-bga', action: 'clear', seconds: 2 })).toEqual({
    seconds: 2,
    action: 'clear',
  });
  expect(resolveChartTextInput({ kind: 'record-empty-poor' })).toBeUndefined();
});
