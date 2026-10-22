import { describe, expect, test } from 'vite-plus/test';
import { makeChart, makeReplay } from '../test-support/support.ts';
import { identifyPlay } from './submit.ts';

const chart = makeChart(['#00111:0101']);

describe('identifyPlay', () => {
  test('ignores when and by what software a play was recorded', () => {
    const play = makeReplay(chart, { noteCount: 4, hits: 3 });
    const redated = { ...play, createdAt: '2030-01-01T00:00:00.000Z', recorder: { name: 'x' } };
    const withNative = { ...play, play: { ...play.play, native: { skin: 'other' } } };
    expect(identifyPlay(redated, chart.playFingerprint)).toBe(identifyPlay(play, chart.playFingerprint));
    expect(identifyPlay(withNative, chart.playFingerprint)).toBe(identifyPlay(play, chart.playFingerprint));
  });

  test('changes with the inputs, the scoring settings, or the chart that was played', () => {
    const play = makeReplay(chart, { noteCount: 4, hits: 3 });
    const id = identifyPlay(play, chart.playFingerprint);
    expect(identifyPlay(makeReplay(chart, { noteCount: 4, hits: 2 }), chart.playFingerprint)).not.toBe(id);
    expect(identifyPlay({ ...play, play: { ...play.play, gauge: 'HARD' } }, chart.playFingerprint)).not.toBe(id);
    expect(identifyPlay(play, 'bmfp0:other')).not.toBe(id);
  });
});
