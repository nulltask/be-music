import { createEmptyJson } from '@be-music/json';
import type { PlayResult } from '@be-music/scene-model';
import { describe, expect, it, vi } from 'vite-plus/test';
import type { AudioService } from '../runtime/audio-service.ts';
import type { PixiSceneHost } from '../scene/host.ts';
import { phantomSkin } from '../skins/phantom/index.ts';
import { BUILT_IN_RESULT_TIMING, BuiltInResultView, resolveBuiltInRankLabel } from '../view/built-in/result-view.ts';
import { createResultScene } from './result.ts';

const RESULT: PlayResult = {
  score: { total: 10, perfect: 10, great: 0, good: 0, bad: 0, poor: 0, emptyPoor: 0, exScore: 20, score: 20 },
  maxCombo: 10,
  gauge: 100,
  cleared: true,
  playSeconds: 30,
  song: {
    id: 'chart',
    sourceId: 'source',
    sourceLabel: 'Source',
    sourceKind: 'directory',
    chartPath: 'song/chart.bms',
    directoryLabel: 'song',
    fileLabel: 'chart.bms',
    title: 'Chart',
    totalNotes: 10,
    chart: createEmptyJson('bms'),
  },
  gaugeHistory: [],
  scoreHistory: [],
};

/** A host with a canvas whose pointer listeners the test keeps. */
function createFakeHost() {
  const pointer = new Set<() => void>();
  const host = {
    app: {
      ticker: { add: () => undefined, remove: () => undefined },
      canvas: {
        addEventListener: (_type: string, listener: () => void) => pointer.add(listener),
        removeEventListener: (_type: string, listener: () => void) => pointer.delete(listener),
      },
    },
  } as unknown as PixiSceneHost;
  return {
    host,
    pointer,
    click: () => {
      for (const listener of Array.from(pointer)) listener();
    },
  };
}

describe('createResultScene', () => {
  it('is the built-in result screen', () => {
    const scene = createResultScene(
      { family: 'built-in', skin: phantomSkin },
      {
        result: RESULT,
        sounds: {},
        audio: {} as AudioService,
        on: { continue: () => undefined },
        keyTarget: { addEventListener: () => undefined, removeEventListener: () => undefined },
      },
    );
    expect(scene.identity).toEqual({ kind: 'result', family: 'built-in' });
    scene.dispose();
  });
});

describe('BuiltInResultView', () => {
  it("waits LR2's default 1500 ms for input and has no auto advance or fade-out", () => {
    expect(BUILT_IN_RESULT_TIMING).toEqual({ inputDelayMs: 1500, fadeOutMs: 0 });
    expect(new BuiltInResultView({ family: 'built-in', skin: phantomSkin }).timing).toBe(BUILT_IN_RESULT_TIMING);
  });

  it('presses on with a click on the canvas, and stops listening as it leaves', () => {
    const view = new BuiltInResultView({ family: 'built-in', skin: phantomSkin });
    const fake = createFakeHost();
    const emit = vi.fn();
    view.attach(fake.host, emit);
    fake.click();
    expect(emit).toHaveBeenCalledWith({ type: 'continue' });
    view.detach();
    expect(fake.pointer.size).toBe(0);
    fake.click();
    expect(emit).toHaveBeenCalledTimes(1);
    view.dispose();
  });
});

describe('resolveBuiltInRankLabel', () => {
  it('ranks the EX score as IIDX does, and a chart without notes as AAA', () => {
    expect(resolveBuiltInRankLabel(20, 10)).toBe('AAA');
    expect(resolveBuiltInRankLabel(0, 10)).toBe('F');
    expect(resolveBuiltInRankLabel(0, 0)).toBe('AAA');
  });
});
