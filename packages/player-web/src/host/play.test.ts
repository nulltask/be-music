import { createEmptyJson } from '@be-music/json';
import { parseChart } from '@be-music/parser';
import type { LibraryChart } from '@be-music/scene-model';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { BrowserSongEntry } from '../collection/types.ts';
import type { AudioService } from '../runtime/audio-service.ts';
import type { PixiSceneHost } from '../scene/host.ts';
import type { SessionKeyTarget } from '../session/session-scene.ts';
import { phantomSkin } from '../skins/phantom/index.ts';
import { createDecideScene } from './decide.ts';
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
