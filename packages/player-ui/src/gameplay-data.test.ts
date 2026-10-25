import { describe, expect, it } from 'vite-plus/test';
import type { BeMusicDOMGameplayFrame } from '@be-music/player-skin-sdk';
import { resolveGameplayPanels } from './gameplay-data.ts';

function frame(overrides: Partial<BeMusicDOMGameplayFrame> = {}): BeMusicDOMGameplayFrame {
  return {
    chart: { title: 'Song', subtitle: '[ANOTHER]', genre: 'TRANCE', playLevel: 12, totalNotes: 500 },
    state: {
      totalSeconds: 120,
      gauge: 80,
      gaugeType: 'HARD',
      cleared: true,
      exScore: 600,
      combo: 40,
      maxCombo: 90,
      gaugeHistory: [],
      scoreHistory: [],
      judgeTimings: [],
      earlyLate: {},
      view: {},
    },
    runtime: { perfect: 200, great: 100, good: 3, bad: 2, poor: 1, fast: 9, slow: 7, playVariant: '7', rank: 'A' },
    emptyPoor: 4,
    seconds: 150,
    ...overrides,
  } as unknown as BeMusicDOMGameplayFrame;
}

describe('resolveGameplayPanels', () => {
  it('reads the score, BP and chart facts from the frame', () => {
    const panels = resolveGameplayPanels(frame());
    expect(panels.score).toMatchObject({ exScore: 600, maximum: 1000, judgedNotes: 306, missCount: 7, rank: 'A' });
    expect(panels.gauge).toMatchObject({ value: 80, label: 'HARD', cleared: true });
    expect(panels.judgments).toMatchObject({ perfect: 200, emptyPoor: 4, fast: 9, slow: 7 });
    expect(panels.title).toBe('Song [ANOTHER]');
    expect(panels.facts).toBe('TRANCE · 7 KEY · Lv. 12');
  });

  it('keeps the time played inside the chart', () => {
    expect(resolveGameplayPanels(frame()).seconds).toBe(120);
    expect(resolveGameplayPanels(frame({ seconds: -2 })).seconds).toBe(0);
  });
});

it('uses the host source label for P.ATTACK while retaining the state gauge id', () => {
  const current = frame();
  const panels = resolveGameplayPanels({
    ...current,
    state: { ...current.state, gaugeType: 'P-ATTACK' },
    runtime: { ...current.runtime, gaugeLabel: 'P.ATTACK' },
  });
  expect(panels.gauge.label).toBe('P.ATTACK');
});
