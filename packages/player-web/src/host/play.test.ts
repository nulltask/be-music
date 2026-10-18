import {
  BEATORAJA_OP,
  TIMER_FADEOUT,
  TIMER_PLAY,
  TIMER_READY,
  TIMER_SCENE_START,
  type BeatorajaSkin,
} from '@be-music/beatoraja-skin';
import { createEmptyJson } from '@be-music/json';
import type { Lr2Skin } from '@be-music/lr2-skin';
import { parseChart } from '@be-music/parser';
import type { LibraryChart } from '@be-music/scene-model';
import type { Texture } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { BrowserSongEntry } from '../collection/types.ts';
import type { AudioService } from '../runtime/audio-service.ts';
import { BeatorajaPlaySkinView } from '../scene/beatoraja/skin-view.ts';
import type { PixiSceneHost } from '../scene/host.ts';
import { resolvePlaylogRecording } from '../session/play/play-engine.ts';
import type { PlaySceneSession } from '../session/play/play-scene-session.ts';
import { startPlaylogView } from '../session/play/play-view-settings.ts';
import type { SessionKeyTarget } from '../session/session-scene.ts';
import type { BeatorajaRenderContext } from '../skin/beatoraja/render.ts';
import type { BeatorajaTextureCache } from '../skin/beatoraja/textures.ts';
import { phantomSkin } from '../skins/phantom/index.ts';
import { resolveBeatorajaPlayTiming } from '../view/beatoraja/play-view.ts';
import { createDecideScene } from './decide.ts';
import type { BeatorajaKit } from './family-kit.ts';
import { resolveLr2LaneRect } from '../view/lr2/play-elements.ts';
import { resolveLr2PlayTiming } from '../view/lr2/play-view.ts';
import { createPlayScene, type PlaySceneOptions } from './play.ts';

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

/** A chart whose `#RANDOM 2` puts one note on lane 1 for a draw of 1 and two on lane 2 for a draw of 2. */
const RANDOM_CHART = parseChart(
  ['#BPM 120', '#RANDOM 2', '#IF 1', '#00111:01', '#ENDIF', '#IF 2', '#00112:0101', '#ENDIF', '#ENDRANDOM'].join('\n'),
  'bms',
);

/** A chart with one note on lane 1, then one on lane 2. */
const TWO_LANE_CHART = parseChart(['#BPM 120', '#00111:01', '#00112:0001'].join('\n'), 'bms');

/** A chart at 120 BPM that doubles to 240 BPM (`F0`) at measure 2. */
const TEMPO_CHART = parseChart(['#BPM 120', '#00111:01', '#00203:F0', '#00211:01'].join('\n'), 'bms');

const NO_KEYS: SessionKeyTarget = { addEventListener: () => undefined, removeEventListener: () => undefined };
const AUDIO = { stopOwned: vi.fn(), playJingle: vi.fn(async () => true) } as unknown as AudioService;

function create(overrides: Partial<PlaySceneOptions> = {}) {
  const on = { finish: vi.fn(), exit: vi.fn(), restart: vi.fn(), hiSpeed: vi.fn(), tempo: vi.fn() };
  const scene = createPlayScene(
    { family: 'built-in', skin: phantomSkin },
    {
      chart: { ...CHART, chart: RANDOM_CHART } as BrowserSongEntry,
      settings: { initialHiSpeed: 2.5 },
      audio: AUDIO,
      on,
      keyTarget: NO_KEYS,
      ...overrides,
    },
  );
  return { scene, on };
}

/** A host with a ticker the test fires and a canvas the play listens on, and the window and document it listens on. */
function createFakeHost() {
  const ticks = new Set<() => void>();
  const listeners = new Map<string, Set<unknown>>();
  const target = () => ({
    addEventListener: (type: string, listener: unknown) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: unknown) => listeners.get(type)?.delete(listener),
  });
  vi.stubGlobal('window', { ...target(), setTimeout, clearTimeout, setInterval, clearInterval });
  // The be-music skin's surface asks for a canvas; one without a context leaves the skin undrawn.
  const createElement = () => ({ width: 0, height: 0, style: {}, getContext: () => null });
  vi.stubGlobal('document', {
    ...target(),
    hidden: false,
    visibilityState: 'visible',
    hasFocus: () => true,
    createElement,
  });
  const canvas = { ...target(), style: { touchAction: 'auto' }, focus: vi.fn() };
  const host = {
    app: {
      ticker: {
        add: (callback: () => void) => ticks.add(callback),
        remove: (callback: () => void) => ticks.delete(callback),
      },
      canvas,
      screen: { width: 1280, height: 720 },
      renderer: { resolution: 1 },
      stage: { children: [] },
    },
    setStageOrientation: vi.fn(),
    isDisposed: () => false,
    onAfterRender: () => () => undefined,
  } as unknown as PixiSceneHost;
  return {
    host,
    canvas,
    listening: (type: string) => listeners.get(type)?.size ?? 0,
    /** Hands `event` to every listener of `type` on the window, the document or the canvas. */
    fire: (type: string, event: object) => {
      for (const listener of Array.from(listeners.get(type) ?? [])) (listener as (event: object) => void)(event);
    },
    tick: () => {
      for (const callback of Array.from(ticks)) callback();
    },
    ticking: () => ticks.size,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('createPlayScene', () => {
  it('is the built-in play screen, with the settings it was made with', () => {
    const { scene } = create();
    expect(scene.identity).toEqual({ kind: 'play', family: 'built-in' });
    expect(scene.getHiSpeed()).toBe(2.5);
    expect(scene.getTempo()).toBe(1);
    expect(scene.isPaused()).toBe(false);
    expect(scene.progress()).toBeUndefined();
    scene.setHiSpeed(3);
    expect(scene.getHiSpeed()).toBe(3);
    scene.dispose();
  });

  it('loads the chart off stage and reports its progress', async () => {
    const { scene } = create();
    const progress: number[] = [];
    await scene.prepare((value) => progress.push(value));
    expect(progress).toEqual([0, 1]);
    const result = scene.progress();
    expect(result?.song.title).toBe('Chart');
    expect(result?.gaugeType).toBe('GROOVE');
    // The gauge's clear border (in percent), which a beatoraja result skin shows with the TOTAL the engine reports
    // (none before its first frame).
    expect(result?.gaugeBorder).toBe(80);
    expect(result?.gaugeTotal).toBeUndefined();
    scene.dispose();
  });

  it('plays the #RANDOM branches the decide screen drew (preResolved)', async () => {
    const decide = createDecideScene(
      { family: 'built-in', skin: phantomSkin },
      {
        chart: { ...CHART, chart: RANDOM_CHART },
        sounds: {},
        audio: AUDIO,
        random: () => 0.9,
        on: { continue: () => undefined, cancel: () => undefined },
        keyTarget: NO_KEYS,
      },
    );
    expect(decide.resolved.randomDraws).toEqual([{ command: 'RANDOM', range: 2, value: 2 }]);
    // Left to itself the play would draw 1 here.
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    const { scene: own } = create();
    await own.prepare();
    expect(own.progress()?.score.total).toBe(1);
    own.dispose();
    const { scene } = create({ preResolved: decide.resolved });
    await scene.prepare();
    expect(scene.progress()?.score.total).toBe(2);
    scene.dispose();
    decide.dispose();
  });

  it('shows a play prepared off stage, draws its frames once started, and stops listening as it leaves', async () => {
    vi.useFakeTimers();
    const fake = createFakeHost();
    const { scene, on } = create({ host: fake.host });
    await scene.prepare();
    await scene.enter(fake.host);
    // The play's own keys and the canvas's touch lanes listen from the entry on.
    expect(fake.listening('keydown')).toBe(1);
    expect(fake.listening('pointerdown')).toBe(2);
    expect(fake.canvas.style.touchAction).toBe('none');
    expect(scene.root.visible).toBe(false);
    scene.start();
    expect(fake.canvas.focus).toHaveBeenCalled();
    fake.tick();
    expect(scene.root.visible).toBe(true);
    // Escape's way out: the be-music fade-out, then the host hears of it.
    scene.requestExit();
    fake.tick();
    expect(on.exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(450);
    expect(on.exit).toHaveBeenCalledTimes(1);
    fake.tick();
    scene.exit();
    expect(fake.ticking()).toBe(0);
    expect(fake.listening('keydown')).toBe(0);
    expect(fake.canvas.style.touchAction).toBe('auto');
    scene.dispose();
  });

  it('draws the loading playfield when it loads while shown (no splash)', async () => {
    vi.useFakeTimers();
    const fake = createFakeHost();
    const { scene } = create();
    await scene.enter(fake.host);
    fake.tick();
    expect(scene.root.visible).toBe(false);
    await scene.prepare();
    fake.tick();
    expect(scene.root.visible).toBe(true);
    scene.dispose();
  });

  it('a disposed play ends without leading anywhere', () => {
    const { scene, on } = create();
    scene.dispose({ preserveAudioTail: true });
    expect(on.finish).not.toHaveBeenCalled();
    expect(on.exit).not.toHaveBeenCalled();
    expect(scene.disposed).toBe(true);
  });
});

/** An LR2 play skin drawing nothing, with `timing`; LR2's 640x480 unless `size` says otherwise. */
function lr2PlaySkin(timing: Lr2Skin['timing'] = {}, size = { width: 640, height: 480 }): Lr2Skin {
  return {
    ...size,
    timing,
    images: [],
    judgeLines: [],
    numbers: [],
    grooveGauges: [],
    bargraphs: [],
    sliders: [],
    texts: [],
    judges: {},
    judges2P: {},
    nowCombos: [],
    laneRects: [],
    measureLines: [],
    bgas: [],
    notes: {},
    customOptions: [],
    customFiles: [],
    lr2FontPaths: [],
    files: new Map(),
  } as unknown as Lr2Skin;
}

describe('resolveLr2PlayTiming', () => {
  it('gates the chart on #LOADSTART + #LOADEND, then #PLAYSTART, and ends on #FADEOUT and #CLOSE', () => {
    expect(
      resolveLr2PlayTiming({ timing: { loadStart: 100, loadEnd: 1500, playStart: 1500, fadeOut: 500, close: 1000 } }),
    ).toEqual({ loadEndOffsetMs: 1600, playStartOffsetMs: 3100, fadeOutMs: 500, closeMs: 1000 });
    expect(resolveLr2PlayTiming({ timing: {} })).toEqual({
      loadEndOffsetMs: 0,
      playStartOffsetMs: 0,
      fadeOutMs: 0,
      closeMs: 0,
    });
    expect(resolveLr2PlayTiming({ timing: { loadEnd: -5, fadeOut: -1 } }).fadeOutMs).toBe(0);
  });
});

describe('resolveLr2LaneRect', () => {
  it("scales the skin's #DST_NOTE rect onto the stage, down to the judgement line's bottom edge", () => {
    const skin = {
      ...lr2PlaySkin({}, { width: 1280, height: 720 }),
      laneRects: [undefined, { x: 100, y: 600, w: 60, h: 8 }],
    } as unknown as Lr2Skin;
    expect(resolveLr2LaneRect(skin, 1, { width: 640, height: 480 })).toEqual({ x: 50, w: 30, top: 60, bottom: 364 });
    expect(resolveLr2LaneRect(skin, 2, { width: 640, height: 480 })).toBeUndefined();
  });
});

describe('createPlayScene with an LR2 kit', () => {
  function createLr2(timing: Lr2Skin['timing'] = {}, overrides: Partial<PlaySceneOptions> = {}) {
    const on = { finish: vi.fn(), exit: vi.fn(), restart: vi.fn() };
    const scene = createPlayScene(
      { family: 'lr2', skin: lr2PlaySkin(timing) },
      {
        chart: { ...CHART, chart: RANDOM_CHART } as BrowserSongEntry,
        settings: { initialHiSpeed: 2 },
        audio: AUDIO,
        on,
        keyTarget: NO_KEYS,
        ...overrides,
      },
    );
    return { scene, on };
  }

  it('is the LR2 play screen', async () => {
    const { scene } = createLr2();
    expect(scene.identity).toEqual({ kind: 'play', family: 'lr2' });
    expect(scene.getHiSpeed()).toBe(2);
    await scene.prepare();
    expect(scene.progress()?.song.title).toBe('Chart');
    scene.dispose();
  });

  it("draws its frames once started and leaves through the skin's #FADEOUT and #CLOSE", async () => {
    vi.useFakeTimers();
    const fake = createFakeHost();
    const { scene, on } = createLr2({ fadeOut: 300, close: 200 }, { host: fake.host });
    await scene.prepare();
    await scene.enter(fake.host);
    expect(scene.root.visible).toBe(false);
    scene.start();
    fake.tick();
    expect(scene.root.visible).toBe(true);
    scene.requestExit();
    fake.tick();
    vi.advanceTimersByTime(300);
    expect(on.exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(on.exit).toHaveBeenCalledTimes(1);
    scene.exit();
    expect(fake.ticking()).toBe(0);
    scene.dispose();
  });

  it('keeps its family and skin when handed another kit', () => {
    const { scene } = createLr2();
    expect(() => scene.updateKit({ family: 'built-in', skin: phantomSkin })).not.toThrow();
    expect(() => scene.updateKit({ family: 'lr2', skin: lr2PlaySkin() })).not.toThrow();
    scene.dispose();
  });
});

describe('createPlayScene with a beatoraja kit', () => {
  /** The audio service the play's skin sounds go through. */
  const SKIN_AUDIO = {
    stopOwned: vi.fn(),
    playJingle: vi.fn(async () => true),
    skinSounds: { owned: () => ({ play: vi.fn(), loop: vi.fn(), stop: vi.fn() }) },
  } as unknown as AudioService;

  function beatorajaKit(skin: Partial<BeatorajaSkin> = {}): BeatorajaKit {
    const empty = new Map<number | string, Texture>();
    const textures: BeatorajaTextureCache = {
      get: (id) => empty.get(id),
      values: () => empty.values(),
      pathOf: () => undefined,
    };
    return {
      family: 'beatoraja',
      kit: {
        skin: { type: 0, w: 1280, h: 720, image: [], destination: [], fadeout: 300, ...skin },
        textures,
        files: new Map(),
      },
    };
  }

  function createBeatoraja(overrides: Partial<PlaySceneOptions> = {}) {
    const on = { finish: vi.fn(), exit: vi.fn(), restart: vi.fn(), hiSpeed: vi.fn() };
    const scene = createPlayScene(beatorajaKit(), {
      chart: { ...CHART, chart: RANDOM_CHART } as BrowserSongEntry,
      settings: {
        initialHiSpeed: 2,
        random1P: 'MIRROR',
        hsFix: 'MAXBPM',
        hiddenSudden1P: 'SUDDEN',
        laneCover: true,
        shutter: 0.3,
      },
      audio: SKIN_AUDIO,
      on,
      keyTarget: NO_KEYS,
      ...overrides,
    });
    const play = (scene as unknown as { playSession: PlaySceneSession }).playSession.play;
    return { scene, on, play };
  }

  const keydown = (key: string) => ({ key, code: key, shiftKey: false, repeat: false, preventDefault: vi.fn() });

  it('is the beatoraja play screen, timed by the skin', () => {
    const { scene } = createBeatoraja();
    expect(scene.identity).toEqual({ kind: 'play', family: 'beatoraja' });
    expect(scene.getHiSpeed()).toBe(2);
    expect(resolveBeatorajaPlayTiming({ fadeout: 300 })).toEqual({
      loadEndOffsetMs: 0,
      playStartOffsetMs: 1500,
      fadeOutMs: 300,
      closeMs: 0,
    });
    expect(resolveBeatorajaPlayTiming({}).fadeOutMs).toBe(500);
    scene.dispose();
  });

  it('starts its covers from the play options, as every family does, taking the cover keys', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    const { scene, play } = createBeatoraja();
    await scene.prepare();
    expect(play.options).toMatchObject({ coverKeys: true });
    // SUDDEN at the shutter's 0.3, the lane cover shown; HIDDEN+ keeps the height, off; no LIFT.
    expect(play.playState.view.covers).toEqual([
      { side: '1P', sudden: 0.3, suddenOn: true, hidden: 0.3, hiddenOn: false, lift: 0 },
    ]);
    scene.dispose();
  });

  it('scrolls under HS-FIX as every family does, and records it in the play log', async () => {
    const { scene, play } = createBeatoraja({
      chart: { ...CHART, chart: TEMPO_CHART } as BrowserSongEntry,
      settings: { initialHiSpeed: 2, hsFix: 'MAXBPM' },
    });
    await scene.prepare();
    // MAXBPM keeps the player's 2 at the chart's 120 BPM and draws it at its 240: half as fast.
    expect(play.playState.view.hsFix).toBe('MAXBPM');
    expect(play.playState.view.hiSpeed).toMatchObject({ player: 2, drawn: 1 });
    expect(play.scrollHiSpeed.target).toBe(1);
    expect(startPlaylogView(play)).toMatchObject({ hiSpeed: 1, hiSpeedScale: 'beatoraja', hsFix: 'MAXBPM' });
    scene.dispose();
  });

  it("plays the host's lane options, as every family does, and records them in the play log", async () => {
    const { scene, play } = createBeatoraja({
      chart: { ...CHART, chart: TWO_LANE_CHART } as BrowserSongEntry,
      settings: { initialHiSpeed: 2, random1P: 'MIRROR', random2P: 'OFF' },
    });
    await scene.prepare();
    expect(play.options).toMatchObject({ random1P: 'MIRROR', random2P: 'OFF' });
    // MIRROR swaps the chart's two lanes: lane 1's note plays on lane 2 and lane 2's on lane 1.
    expect(play.notes.map((note) => note.channel)).toEqual(['12', '11']);
    expect(resolvePlaylogRecording(play.options, play.song, {}).randomLane).toEqual({ p1: 'MIRROR', p2: 'OFF' });
    scene.dispose();
  });

  it("starts READY and the play at once, and leaves over the skin's fadeout", async () => {
    vi.useFakeTimers();
    const update = vi.spyOn(BeatorajaPlaySkinView.prototype, 'update');
    const fake = createFakeHost();
    const { scene, on } = createBeatoraja({ host: fake.host });
    await scene.prepare();
    await scene.enter(fake.host);
    scene.start();
    fake.tick();
    expect(scene.root.visible).toBe(true);
    const first = update.mock.calls.at(-1)![0] as BeatorajaRenderContext;
    expect(first.getTimerStart(TIMER_SCENE_START)).toBeDefined();
    expect(first.getTimerStart(TIMER_READY)).toBeUndefined();
    expect(first.activeOps.has(BEATORAJA_OP.NOW_LOADING)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    fake.tick();
    const loaded = update.mock.calls.at(-1)![0] as BeatorajaRenderContext;
    expect(loaded.getTimerStart(TIMER_READY)).toBeDefined();
    expect(loaded.getTimerStart(TIMER_PLAY)).toBe(loaded.getTimerStart(TIMER_READY));
    expect(loaded.activeOps.has(BEATORAJA_OP.LOADED)).toBe(true);
    scene.requestExit();
    fake.tick();
    expect((update.mock.calls.at(-1)![0] as BeatorajaRenderContext).getTimerStart(TIMER_FADEOUT)).toBeDefined();
    vi.advanceTimersByTime(299);
    expect(on.exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(on.exit).toHaveBeenCalledTimes(1);
    scene.exit();
    scene.dispose();
  });

  it('moves the covers with the cover keys and the wheel, unless a course locks them', async () => {
    const fake = createFakeHost();
    const { scene, play } = createBeatoraja({ host: fake.host });
    await scene.prepare();
    await scene.enter(fake.host);
    fake.fire('keydown', keydown('PageDown'));
    fake.fire('keydown', keydown('End'));
    fake.fire('keydown', keydown('h'));
    fake.fire('wheel', { deltaY: 1, shiftKey: true, preventDefault: vi.fn() });
    // From the play options' SUDDEN 0.3: PageDown and the Shift wheel lower SUDDEN+ by 0.01 and 0.025, End raises the
    // LIFT, and H switches HIDDEN+ on at its kept height.
    expect(play.playState.view.covers[0]).toEqual({
      side: '1P',
      sudden: 0.335,
      suddenOn: true,
      hidden: 0.3,
      hiddenOn: true,
      lift: 0.01,
    });
    scene.dispose();

    const locked = createBeatoraja({
      host: fake.host,
      settings: { hiSpeedLocked: true, hiddenSudden1P: 'SUDDEN', shutter: 0.3 },
    });
    await locked.scene.prepare();
    await locked.scene.enter(fake.host);
    fake.fire('keydown', keydown('PageDown'));
    fake.fire('wheel', { deltaY: 1, shiftKey: false, preventDefault: vi.fn() });
    expect(locked.play.playState.view.covers[0]).toMatchObject({ sudden: 0.3, suddenOn: true });
    locked.scene.dispose();
  });

  it('leaves the cover keys to a play that takes them (not the built-in or LR2 play)', async () => {
    const fake = createFakeHost();
    const { scene } = create({ host: fake.host });
    await scene.prepare();
    await scene.enter(fake.host);
    const play = (scene as unknown as { playSession: PlaySceneSession }).playSession.play;
    const before = play.playState.view.covers;
    fake.fire('keydown', keydown('PageDown'));
    expect(play.playState.view.covers).toBe(before);
    scene.dispose();
  });

  it('takes a kit of its own family (the skin options changed mid-play), and ignores another family', async () => {
    const { scene } = createBeatoraja();
    await scene.prepare();
    expect(scene.resolved?.chart).toBeDefined();
    expect(() => scene.updateKit(beatorajaKit({ fadeout: 100 }))).not.toThrow();
    expect(() => scene.updateKit({ family: 'built-in', skin: phantomSkin })).not.toThrow();
    scene.dispose();
    expect(scene.resolved).toBeUndefined();
  });
});
