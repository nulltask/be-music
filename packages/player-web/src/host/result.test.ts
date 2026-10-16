import { createEmptyJson } from '@be-music/json';
import type { Lr2Skin } from '@be-music/lr2-skin';
import { LR2_TIMER } from '@be-music/lr2-skin/ids';
import type { PlayResult, SystemSoundSet } from '@be-music/scene-model';
import { describe, expect, it, vi } from 'vite-plus/test';
import type { AudioService } from '../runtime/audio-service.ts';
import type { PixiSceneHost } from '../scene/host.ts';
import type { SessionKeyTarget } from '../session/session-scene.ts';
import { phantomSkin } from '../skins/phantom/index.ts';
import { BUILT_IN_RESULT_TIMING, BuiltInResultView, resolveBuiltInRankLabel } from '../view/built-in/result-view.ts';
import { resolveLr2GraphReveal, resolveLr2ResultTimers, resolveLr2ResultTiming } from '../view/lr2/result-view.ts';
import type { Lr2Kit } from './family-kit.ts';
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

const NO_KEYS: SessionKeyTarget = { addEventListener: () => undefined, removeEventListener: () => undefined };

/** A host with a ticker the test fires, a canvas whose pointer listeners it keeps, a screen and a renderer. */
function createDrawingHost() {
  const ticks = new Set<() => void>();
  const pointer = new Set<() => void>();
  const host = {
    app: {
      ticker: {
        add: (callback: () => void) => ticks.add(callback),
        remove: (callback: () => void) => ticks.delete(callback),
      },
      canvas: {
        addEventListener: (_type: string, listener: () => void) => pointer.add(listener),
        removeEventListener: (_type: string, listener: () => void) => pointer.delete(listener),
      },
      screen: { width: 1280, height: 720 },
      renderer: { resolution: 1 },
    },
    setStageOrientation: vi.fn(),
  } as unknown as PixiSceneHost;
  return {
    host,
    pointer,
    tick: () => {
      for (const callback of Array.from(ticks)) callback();
    },
    click: () => {
      for (const listener of Array.from(pointer)) listener();
    },
  };
}

/** An LR2 result skin with nothing to draw, and its scene timing. */
function lr2ResultSkin(timing: Lr2Skin['timing'] = {}): Lr2Skin {
  return {
    width: 640,
    height: 480,
    timing,
    images: [],
    numbers: [],
    texts: [],
    bargraphs: [],
    sliders: [],
    gaugeCharts: [],
    scoreCharts: [],
    lr2FontPaths: [],
    systemFontSizes: [],
    files: new Map(),
  } as unknown as Lr2Skin;
}

describe('resolveLr2ResultTiming', () => {
  it("waits for the skin's #STARTINPUT, 1500 ms without one, with no auto advance or fade-out", () => {
    expect(resolveLr2ResultTiming({ timing: { startInput: 300 } })).toEqual({ inputDelayMs: 300, fadeOutMs: 0 });
    expect(resolveLr2ResultTiming({ timing: {} })).toEqual({ inputDelayMs: 1500, fadeOutMs: 0 });
    expect(resolveLr2ResultTiming({ timing: { startInput: -1 } }).inputDelayMs).toBe(0);
  });
});

describe('resolveLr2ResultTimers', () => {
  const frame = (nowMs: number, steps: { graphShownAtMs?: number; updateShownAtMs?: number } = {}) => ({
    clock: { nowMs, enteredAtMs: 1000 },
    inputOpenAtMs: 1300,
    ...steps,
  });

  it('runs timer 0 from the entry, and timers 1 and 150 once input has opened', () => {
    expect([...resolveLr2ResultTimers(frame(1299))]).toEqual([[LR2_TIMER.SCENE_START, 1000]]);
    expect([...resolveLr2ResultTimers(frame(1300))]).toEqual([
      [LR2_TIMER.SCENE_START, 1000],
      [LR2_TIMER.START_INPUT, 1300],
      [LR2_TIMER.RESULT_GRAPH_START, 1300],
    ]);
  });

  it('runs timer 151 from when the graphs showed and timer 152 from when the record update did', () => {
    const timers = resolveLr2ResultTimers(frame(5000, { graphShownAtMs: 2000, updateShownAtMs: 4000 }));
    expect(timers.get(LR2_TIMER.RESULT_GRAPH_END)).toBe(2000);
    expect(timers.get(LR2_TIMER.RESULT_UPDATE)).toBe(4000);
    expect(resolveLr2ResultTimers(frame(1500)).has(LR2_TIMER.RESULT_GRAPH_END)).toBe(false);
  });
});

describe('resolveLr2GraphReveal', () => {
  it('shows nothing before its timer or its start, then sweeps to all of it at its end', () => {
    expect(resolveLr2GraphReveal(undefined, 500, 2000)).toBe(0);
    expect(resolveLr2GraphReveal(499, 500, 2000)).toBe(0);
    expect(resolveLr2GraphReveal(1250, 500, 2000)).toBe(0.5);
    expect(resolveLr2GraphReveal(2000, 500, 2000)).toBe(1);
    expect(resolveLr2GraphReveal(9000, 500, 2000)).toBe(1);
  });

  it('shows all of a graph whose end is not after its start, once started', () => {
    expect(resolveLr2GraphReveal(0, 0, 0)).toBe(1);
    expect(resolveLr2GraphReveal(100, 200, 200)).toBe(0);
  });
});

describe('createResultScene with an LR2 kit', () => {
  function create(timing: Lr2Skin['timing'] = { startInput: 300 }) {
    const audio = { playJingle: vi.fn(async () => true), stopOwned: vi.fn() };
    const on = { continue: vi.fn(), retry: vi.fn() };
    const clock = { now: 1000 };
    const kit: Lr2Kit = { family: 'lr2', skin: lr2ResultSkin(timing) };
    const scene = createResultScene(kit, {
      result: RESULT,
      sounds: {},
      audio: audio as unknown as AudioService,
      on,
      keyTarget: NO_KEYS,
      now: () => clock.now,
    });
    return { scene, audio, on, clock, kit };
  }

  it('is the LR2 result screen', () => {
    const { scene } = create();
    expect(scene.identity).toEqual({ kind: 'result', family: 'lr2' });
    scene.dispose();
  });

  it("takes clicks once the skin's #STARTINPUT has passed: the graphs, the record update, then on", async () => {
    const { scene, on, clock } = create();
    const fake = createDrawingHost();
    await scene.enter(fake.host);
    clock.now = 1299;
    fake.tick();
    fake.click();
    clock.now = 1300;
    fake.tick();
    fake.click();
    fake.click();
    expect(on.continue).not.toHaveBeenCalled();
    fake.click();
    expect(on.continue).toHaveBeenCalledTimes(1);
    scene.dispose();
    expect(fake.pointer.size).toBe(0);
  });

  it("plays the verdict's jingle, else the generic one, and never the other verdict's", async () => {
    const clear = { bytes: new Uint8Array([1]) };
    const fail = { bytes: new Uint8Array([2]) };
    const generic = { bytes: new Uint8Array([3]) };
    const played = async (cleared: boolean, sounds: SystemSoundSet) => {
      const audio = { playJingle: vi.fn(async () => true), stopOwned: vi.fn() };
      const scene = createResultScene(
        { family: 'lr2', skin: lr2ResultSkin() },
        {
          result: { ...RESULT, cleared },
          sounds,
          audio: audio as unknown as AudioService,
          on: { continue: () => undefined },
          keyTarget: NO_KEYS,
          now: () => 0,
        },
      );
      await scene.enter(createDrawingHost().host);
      scene.dispose();
      return audio.playJingle.mock.calls.map((call) => (call as unknown[])[0]);
    };
    expect(await played(true, { clear, fail, result: generic })).toEqual([clear]);
    expect(await played(false, { clear, fail, result: generic })).toEqual([fail]);
    expect(await played(true, { fail, result: generic })).toEqual([generic]);
    expect(await played(true, { fail })).toEqual([]);
    expect(await played(false, { clear })).toEqual([]);
  });

  it('keeps its family and its skin', () => {
    const { scene, kit } = create();
    expect(() => scene.updateKit({ family: 'built-in', skin: phantomSkin })).not.toThrow();
    expect(() => scene.updateKit({ family: 'lr2', skin: lr2ResultSkin() })).not.toThrow();
    expect(() => scene.updateKit(kit)).not.toThrow();
    scene.dispose();
  });
});
