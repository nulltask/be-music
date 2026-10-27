import type { BeatorajaSkin } from '@be-music/skin-beatoraja';
import { createEmptyJSON } from '@be-music/chart-source';
import type { LR2Skin } from '@be-music/skin-lr2';
import { parseChart } from '@be-music/chart-parser';
import type { LibraryChart } from '@be-music/player-scene-model';
import type { Texture } from 'pixi.js';
import { describe, expect, it, vi } from 'vite-plus/test';
import type { AudioService } from '../runtime/audio-service.ts';
import type { PixiSceneHost } from './scene-host.ts';
import type { SessionKeyTarget } from '../session/session-scene.ts';
import type { BeatorajaTextureCache } from '../skin/beatoraja/textures.ts';
import { synesthesiaSkin } from '../skins/synesthesia/index.ts';
import { resolveBeatorajaDecideTiming } from '../view/beatoraja/decide-view.ts';
import { BuiltInDecideView, resolveBuiltInDecideTiming } from '../view/built-in/decide-view.ts';
import { resolveLR2DecideTiming } from '../view/lr2/decide-view.ts';
import { createDecideScene } from './decide.ts';
import type { BeatorajaKit, BuiltInKit, LR2Kit } from './family-kit.ts';

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
  chart: createEmptyJSON('bms'),
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
      resolveBuiltInDecideTiming({
        family: 'built-in',
        skin: { ...synesthesiaSkin, decide: { durationMs: 3500, draw } },
      }),
    ).toEqual({
      inputDelayMs: 0,
      autoAdvanceMs: 3500,
      fadeOutMs: 0,
    });
    expect(
      resolveBuiltInDecideTiming({ family: 'built-in', skin: { ...synesthesiaSkin, decide: { draw } } }).autoAdvanceMs,
    ).toBe(2000);
  });

  it('moves on at once for a skin without a decide screen', () => {
    expect(resolveBuiltInDecideTiming({ family: 'built-in', skin: synesthesiaSkin }).autoAdvanceMs).toBe(0);
  });
});

describe('createDecideScene', () => {
  function create(kit: BuiltInKit = { family: 'built-in', skin: { ...synesthesiaSkin, decide: undefined } }) {
    const { audio, service } = createFakeAudio();
    const on = { continue: vi.fn(), cancel: vi.fn() };
    const clock = { now: 1000 };
    const jingle = { bytes: new Uint8Array([1]) };
    const scene = createDecideScene(kit, {
      chart: CHART,
      sounds: { decideBGM: jingle },
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

  it("hands on the chart's #RANDOM branches it drew for the play", () => {
    const chart = parseChart(['#RANDOM 2', '#IF 2', '#00112:01', '#ENDIF', '#ENDRANDOM'].join('\n'), 'bms');
    const scene = createDecideScene(
      { family: 'built-in', skin: synesthesiaSkin },
      {
        chart: { ...CHART, chart },
        sounds: {},
        audio: createFakeAudio().service,
        random: () => 0.9,
        on: { continue: () => undefined, cancel: () => undefined },
        keyTarget: NO_KEYS,
      },
    );
    expect(scene.resolved.randomDraws).toEqual([{ command: 'RANDOM', range: 2, value: 2 }]);
    expect(scene.resolved.chart.events.map((event) => event.channel)).toEqual(['12']);
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
    const view = new BuiltInDecideView({ family: 'built-in', skin: synesthesiaSkin });
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

/** An LR2 decide skin with nothing to draw, and its scene timing. */
function lr2DecideSkin(timing: LR2Skin['timing'] = {}): LR2Skin {
  return {
    width: 640,
    height: 480,
    timing,
    images: [],
    numbers: [],
    texts: [],
    lr2FontPaths: [],
    systemFontSizes: [],
    files: new Map(),
  } as unknown as LR2Skin;
}

describe('resolveLR2DecideTiming', () => {
  it("opens input after the skin's #STARTINPUT and moves on 1200 ms later, with no fade-out without #FADEOUT", () => {
    expect(resolveLR2DecideTiming({ timing: { startInput: 300 } })).toEqual({
      inputDelayMs: 300,
      autoAdvanceMs: 1500,
      fadeOutMs: 0,
    });
  });

  it("fades out over the skin's #FADEOUT", () => {
    expect(resolveLR2DecideTiming({ timing: { startInput: 300, fadeOut: 200 } }).fadeOutMs).toBe(200);
    expect(resolveLR2DecideTiming({ timing: { fadeOut: -1 } }).fadeOutMs).toBe(0);
  });

  it('opens input after 1500 ms without #STARTINPUT, as the stock decide skin does', () => {
    expect(resolveLR2DecideTiming({ timing: {} })).toEqual({ inputDelayMs: 1500, autoAdvanceMs: 2700, fadeOutMs: 0 });
  });

  it('reads a negative #STARTINPUT as no delay', () => {
    expect(resolveLR2DecideTiming({ timing: { startInput: -50 } }).inputDelayMs).toBe(0);
  });
});

describe('createDecideScene with an LR2 kit', () => {
  function create(timing: LR2Skin['timing'] = { startInput: 300 }) {
    const { audio, service } = createFakeAudio();
    const on = { continue: vi.fn(), cancel: vi.fn() };
    const clock = { now: 1000 };
    const kit: LR2Kit = { family: 'lr2', skin: lr2DecideSkin(timing) };
    const scene = createDecideScene(kit, {
      chart: CHART,
      sounds: {},
      audio: service,
      on,
      keyTarget: NO_KEYS,
      now: () => clock.now,
    });
    return { scene, audio, on, clock, kit };
  }

  it('is the LR2 decide screen', () => {
    const { scene } = create();
    expect(scene.identity).toEqual({ kind: 'decide', family: 'lr2' });
    scene.dispose();
  });

  it("moves on by itself 1200 ms after the skin's #STARTINPUT", async () => {
    const { scene, on, clock } = create();
    const fake = createFakeHost();
    await scene.enter(fake.host);
    clock.now = 2499;
    fake.tick();
    expect(on.continue).not.toHaveBeenCalled();
    clock.now = 2500;
    fake.tick();
    expect(on.continue).toHaveBeenCalledTimes(1);
    scene.dispose();
  });

  it('continues on a click once #STARTINPUT has passed, and not before', async () => {
    const { scene, on, clock } = create();
    const fake = createFakeHost();
    await scene.enter(fake.host);
    clock.now = 1299;
    fake.tick();
    fake.click();
    expect(on.continue).not.toHaveBeenCalled();
    clock.now = 1300;
    fake.tick();
    fake.click();
    expect(on.continue).toHaveBeenCalledTimes(1);
    scene.dispose();
    expect(fake.pointer.size).toBe(0);
  });

  it('takes no auto-repeat of a key held from the select screen, and backs out on Escape', async () => {
    const listeners = new Set<(event: KeyboardEvent) => void>();
    const keyTarget: SessionKeyTarget = {
      addEventListener: (type, listener) => {
        if (type === 'keydown') listeners.add(listener);
      },
      removeEventListener: (_type, listener) => listeners.delete(listener),
    };
    const press = (key: string, timeStamp: number, repeat = false) => {
      const event = { key, code: key, repeat, timeStamp, target: null, preventDefault: vi.fn() };
      for (const listener of Array.from(listeners)) listener(event as unknown as KeyboardEvent);
      return event.preventDefault;
    };
    const on = { continue: vi.fn(), cancel: vi.fn() };
    const clock = { now: 1000 };
    const scene = createDecideScene(
      { family: 'lr2', skin: lr2DecideSkin({ startInput: 300 }) },
      { chart: CHART, sounds: {}, audio: createFakeAudio().service, on, keyTarget, now: () => clock.now },
    );
    const fake = createFakeHost();
    await scene.enter(fake.host);
    clock.now = 1400;
    fake.tick();
    press('Enter', 1400, true);
    expect(on.continue).not.toHaveBeenCalled();
    expect(press('Escape', 1400)).toHaveBeenCalled();
    expect(on.cancel).toHaveBeenCalledTimes(1);
    scene.dispose();
  });

  it("moves on once the skin's #FADEOUT has run", async () => {
    const { scene, on, clock } = create({ startInput: 300, fadeOut: 200 });
    const fake = createFakeHost();
    await scene.enter(fake.host);
    clock.now = 2500;
    fake.tick();
    clock.now = 2699;
    fake.tick();
    expect(on.continue).not.toHaveBeenCalled();
    clock.now = 2700;
    fake.tick();
    expect(on.continue).toHaveBeenCalledTimes(1);
    scene.dispose();
  });

  it('plays no jingle of its own when given none', async () => {
    const { scene, audio } = create();
    await scene.enter(createFakeHost().host);
    expect(audio.playJingle).not.toHaveBeenCalled();
    scene.dispose();
  });

  it('keeps its family and its skin', () => {
    const { scene, kit } = create();
    expect(() => scene.updateKit({ family: 'built-in', skin: synesthesiaSkin })).not.toThrow();
    expect(() => scene.updateKit({ family: 'lr2', skin: lr2DecideSkin() })).not.toThrow();
    expect(() => scene.updateKit(kit)).not.toThrow();
    scene.dispose();
  });
});

/** A beatoraja decide skin with nothing to draw, with the skin's timing fields. */
function beatorajaDecideKit(timing: Pick<BeatorajaSkin, 'scene' | 'input' | 'fadeout'> = {}): BeatorajaKit {
  const skin: BeatorajaSkin = { type: 6, w: 1280, h: 720, image: [], destination: [], ...timing };
  const empty = new Map<number | string, Texture>();
  const textures: BeatorajaTextureCache = {
    get: (id) => empty.get(id),
    values: () => empty.values(),
    pathOf: () => undefined,
  };
  return { family: 'beatoraja', kit: { skin, textures, files: new Map() } };
}

describe('resolveBeatorajaDecideTiming', () => {
  it("takes input after the skin's input, moves on after its scene and fades out over its fadeout", () => {
    expect(resolveBeatorajaDecideTiming({ scene: 2000, input: 300, fadeout: 200 })).toEqual({
      inputDelayMs: 300,
      autoAdvanceMs: 2000,
      fadeOutMs: 200,
      escapeWaitsForInput: true,
    });
  });

  it("falls back to decidemain.lua's 500 ms input, 3000 ms scene and 500 ms fadeout", () => {
    expect(resolveBeatorajaDecideTiming({})).toEqual({
      inputDelayMs: 500,
      autoAdvanceMs: 3000,
      fadeOutMs: 500,
      escapeWaitsForInput: true,
    });
    expect(resolveBeatorajaDecideTiming({ input: Number.NaN, fadeout: -1 })).toMatchObject({
      inputDelayMs: 500,
      fadeOutMs: 500,
    });
  });

  it('moves on at once when the skin sets scene to 0 or less, as upstream fades out once nowtime > scene', () => {
    expect(resolveBeatorajaDecideTiming({ scene: 0 }).autoAdvanceMs).toBe(0);
    expect(resolveBeatorajaDecideTiming({ scene: -1 }).autoAdvanceMs).toBe(0);
    expect(resolveBeatorajaDecideTiming({ scene: Number.NaN }).autoAdvanceMs).toBe(3000);
  });
});

describe('createDecideScene with a beatoraja kit', () => {
  function createAudioWithSkinSounds() {
    const skinSounds = { play: vi.fn(() => true), loop: vi.fn(() => true), stop: vi.fn(() => true) };
    const audio = {
      playJingle: vi.fn(async () => true),
      stopOwned: vi.fn(),
      skinSounds: { ...skinSounds, owned: vi.fn(() => skinSounds) },
    };
    return { audio, service: audio as unknown as AudioService };
  }

  function create(timing: Pick<BeatorajaSkin, 'scene' | 'input' | 'fadeout'> = { scene: 2000, input: 300 }) {
    const listeners = new Set<(event: KeyboardEvent) => void>();
    const keyTarget: SessionKeyTarget = {
      addEventListener: (type, listener) => {
        if (type === 'keydown') listeners.add(listener);
      },
      removeEventListener: (_type, listener) => listeners.delete(listener),
    };
    const press = (key: string, timeStamp: number) => {
      const event = { key, code: key, repeat: false, timeStamp, target: null, preventDefault: vi.fn() };
      for (const listener of Array.from(listeners)) listener(event as unknown as KeyboardEvent);
    };
    const { audio, service } = createAudioWithSkinSounds();
    const on = { continue: vi.fn(), cancel: vi.fn() };
    const clock = { now: 1000 };
    const jingle = { bytes: new Uint8Array([1]) };
    const scene = createDecideScene(beatorajaDecideKit(timing), {
      chart: CHART,
      sounds: { decideBGM: jingle },
      audio: service,
      on,
      keyTarget,
      now: () => clock.now,
    });
    return { scene, audio, on, clock, jingle, press };
  }

  it('is the beatoraja decide screen', () => {
    const { scene } = create();
    expect(scene.identity).toEqual({ kind: 'decide', family: 'beatoraja' });
    scene.dispose();
  });

  it("moves on by itself once the skin's scene is up, after its 500 ms fade-out", async () => {
    const { scene, on, clock } = create();
    const fake = createFakeHost();
    await scene.enter(fake.host);
    clock.now = 2999;
    fake.tick();
    clock.now = 3000;
    fake.tick();
    clock.now = 3499;
    fake.tick();
    expect(on.continue).not.toHaveBeenCalled();
    clock.now = 3500;
    fake.tick();
    expect(on.continue).toHaveBeenCalledTimes(1);
    scene.dispose();
  });

  it('leaves for the play at once on a scene of 0, before input opens, and Escape cannot call it back', async () => {
    const { scene, on, clock, press } = create({ scene: 0, input: 300, fadeout: 500 });
    const fake = createFakeHost();
    await scene.enter(fake.host);
    fake.tick();
    // The fade-out runs from the entry; Escape, once input would be open, no longer backs out.
    clock.now = 1300;
    press('Escape', 1300);
    fake.tick();
    clock.now = 1499;
    fake.tick();
    expect(on.continue).not.toHaveBeenCalled();
    clock.now = 1500;
    fake.tick();
    expect(on.continue).toHaveBeenCalledTimes(1);
    expect(on.cancel).not.toHaveBeenCalled();
    scene.dispose();
  });

  it("takes neither Enter nor Escape before the skin's input, then backs out on Escape", async () => {
    const { scene, on, clock, press } = create({ scene: 60_000, input: 300, fadeout: 0 });
    const fake = createFakeHost();
    await scene.enter(fake.host);
    press('Escape', 1299);
    press('Enter', 1299);
    clock.now = 1299;
    fake.tick();
    expect(on.cancel).not.toHaveBeenCalled();
    expect(on.continue).not.toHaveBeenCalled();
    clock.now = 1300;
    fake.tick();
    press('Escape', 1300);
    expect(on.cancel).toHaveBeenCalledTimes(1);
    scene.dispose();
  });

  it('takes no click, as beatoraja does not', async () => {
    const { scene, on, clock } = create({ scene: 60_000, input: 0, fadeout: 0 });
    const fake = createFakeHost();
    await scene.enter(fake.host);
    clock.now = 2000;
    fake.tick();
    fake.click();
    expect(fake.pointer.size).toBe(0);
    expect(on.continue).not.toHaveBeenCalled();
    scene.dispose();
  });

  it("plays the theme's decide sound and the skin's Lua sounds as the screen's own, and stops them as it leaves", async () => {
    const { scene, audio, jingle } = create();
    await scene.enter(createFakeHost().host);
    expect(audio.playJingle).toHaveBeenCalledWith(jingle, { owner: expect.any(Object) });
    const owner = (audio.playJingle.mock.calls[0] as unknown[])[1] as { owner: object };
    expect(audio.skinSounds.owned).toHaveBeenCalledWith(owner.owner);
    scene.exit();
    expect(audio.stopOwned).toHaveBeenCalledWith(owner.owner);
    scene.dispose();
  });

  it('keeps its family and its skin', () => {
    const { scene } = create();
    expect(() => scene.updateKit({ family: 'built-in', skin: synesthesiaSkin })).not.toThrow();
    expect(() => scene.updateKit(beatorajaDecideKit())).not.toThrow();
    scene.dispose();
  });
});
