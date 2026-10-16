import { createEmptyJson } from '@be-music/json';
import type { LibraryChart } from '@be-music/scene-model';
import { describe, expect, it, vi } from 'vite-plus/test';
import type { AudioService } from '../runtime/audio-service.ts';
import type { PixiSceneHost } from '../scene/host.ts';
import type { SessionKeyTarget } from '../session/session-scene.ts';
import { phantomSkin } from '../skins/phantom/index.ts';
import { BuiltInDecideView, resolveBuiltInDecideTiming } from '../view/built-in/decide-view.ts';
import { createDecideScene } from './decide.ts';
import type { BuiltInKit } from './family-kit.ts';

const CHART: LibraryChart = {
  id: 'chart',
  sourceId: 'source',
  sourceLabel: 'Source',
  sourceKind: 'directory',
  chartPath: 'song/chart.bms',
  directoryLabel: 'song',
  fileLabel: 'chart.bms',
  title: 'Chart',
  totalNotes: 0,
  chart: createEmptyJson('bms'),
};

/** A host with a ticker the test fires and a canvas whose pointer listeners it keeps. */
function createFakeHost() {
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

function createFakeAudio() {
  const audio = {
    playJingle: vi.fn(async () => true),
    stopOwned: vi.fn(),
  };
  return { audio, service: audio as unknown as AudioService };
}

const NO_KEYS: SessionKeyTarget = { addEventListener: () => undefined, removeEventListener: () => undefined };

describe('resolveBuiltInDecideTiming', () => {
  it("moves on after the skin's decide duration, 2000 ms by default, with input open at once", () => {
    const draw = () => undefined;
    expect(
      resolveBuiltInDecideTiming({ family: 'built-in', skin: { ...phantomSkin, decide: { durationMs: 3500, draw } } }),
    ).toEqual({
      inputDelayMs: 0,
      autoAdvanceMs: 3500,
      fadeOutMs: 0,
    });
    expect(
      resolveBuiltInDecideTiming({ family: 'built-in', skin: { ...phantomSkin, decide: { draw } } }).autoAdvanceMs,
    ).toBe(2000);
  });

  it('moves on at once for a skin without a decide screen', () => {
    expect(resolveBuiltInDecideTiming({ family: 'built-in', skin: phantomSkin }).autoAdvanceMs).toBe(0);
  });
});

describe('createDecideScene', () => {
  function create(kit: BuiltInKit = { family: 'built-in', skin: { ...phantomSkin, decide: undefined } }) {
    const { audio, service } = createFakeAudio();
    const on = { continue: vi.fn(), cancel: vi.fn() };
    const clock = { now: 1000 };
    const jingle = { bytes: new Uint8Array([1]) };
    const scene = createDecideScene(kit, {
      chart: CHART,
      sounds: { decideBgm: jingle },
      audio: service,
      on,
      keyTarget: NO_KEYS,
      now: () => clock.now,
    });
    return { scene, audio, on, clock, jingle };
  }

  it('is the built-in decide screen', () => {
    const { scene } = create();
    expect(scene.identity).toEqual({ kind: 'decide', family: 'built-in' });
    scene.dispose();
  });

  it('plays the decide jingle while it shows and stops it as it leaves', async () => {
    const { scene, audio, jingle } = create();
    const { host } = createFakeHost();
    await scene.enter(host);
    expect(audio.playJingle).toHaveBeenCalledWith(jingle, { owner: expect.any(Object) });
    const owner = (audio.playJingle.mock.calls[0] as unknown[])[1] as { owner: object };
    scene.exit();
    expect(audio.stopOwned).toHaveBeenCalledWith(owner.owner);
    scene.dispose();
  });

  it('continues at once for a skin without a decide screen', async () => {
    const { scene, on } = create();
    await scene.enter(createFakeHost().host);
    expect(on.continue).toHaveBeenCalledTimes(1);
    scene.dispose();
  });

  it('asks to continue on a click on the canvas, and stops listening as it leaves', () => {
    const view = new BuiltInDecideView({ family: 'built-in', skin: phantomSkin });
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
