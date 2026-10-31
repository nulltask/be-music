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

test('NONSTOP owns selections and misses in exclusive windows, seeds trimmed text and scales lifetime with FIT', () => {
  const stages = [
    { startSeconds: 0, endSeconds: 4, offsetSeconds: 0, rate: 1, timeline },
    {
      startSeconds: 4,
      endSeconds: 8,
      offsetSeconds: 2,
      rate: 2,
      timeline: { cues: [{ seconds: 1, key: '01', text: 'stage 2' }], missText: 'MISS 2' },
    },
    { startSeconds: 8, endSeconds: 10, offsetSeconds: 8, rate: 1, timeline: { cues: [] } },
  ];
  const text = new ChartTextController({ cues: [] }, Infinity, stages);
  text.addInput({ seconds: 3.9, action: 'trigger' });
  expect(text.read(3.99)).toBe('MISS');
  expect(text.read(4)).toBe('stage 2');
  text.addInput({ seconds: 4.1, action: 'trigger' });
  expect(text.read(4.34)).toBe('MISS 2');
  expect(text.read(4.36)).toBe('stage 2');
  text.addInput({ seconds: 7.9, action: 'trigger' });
  expect(text.read(8)).toBe('');
  expect(text.read(10)).toBe('');
  text.reset([{ seconds: 4.1, action: 'trigger' }]);
  expect(text.read(4.2)).toBe('MISS 2');
  text.reset();
  expect(text.read(4.2)).toBe('stage 2');
});

test('a stage reversal freezes its source text and miss lifetime only until its ownership ends', () => {
  const text = new ChartTextController({ cues: [] }, Infinity, [
    {
      startSeconds: 0,
      endSeconds: 4,
      offsetSeconds: -1,
      rate: 2,
      freezeSeconds: 1.5,
      timeline,
    },
  ]);
  // Source 1.4 s is course -0.3 s, outside ownership: it cannot introduce a miss.
  text.addInput({ seconds: -0.3, action: 'trigger' });
  expect(text.read(1)).toBe('normal');
  expect(text.read(4)).toBe('');
  const frozen = new ChartTextController({ cues: [] }, Infinity, [
    {
      startSeconds: 0,
      endSeconds: 4,
      offsetSeconds: 0,
      rate: 2,
      freezeSeconds: 1.5,
      timeline,
    },
  ]);
  frozen.addInput({ seconds: 0.7, action: 'trigger' });
  frozen.addInput({ seconds: 1, action: 'clear' });
  expect(frozen.read(3)).toBe('MISS');
  expect(frozen.read(4)).toBe('');
});
