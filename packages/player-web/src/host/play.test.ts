import { createEmptyJson } from '@be-music/json';
import { parseChart } from '@be-music/parser';
import type { LibraryChart } from '@be-music/scene-model';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { BrowserSongEntry } from '../collection/types.ts';
import type { AudioService } from '../runtime/audio-service.ts';
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

afterEach(() => {
  vi.restoreAllMocks();
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

  it('a disposed play ends without leading anywhere', () => {
    const { scene, on } = create();
    scene.dispose({ preserveAudioTail: true });
    expect(on.finish).not.toHaveBeenCalled();
    expect(on.exit).not.toHaveBeenCalled();
    expect(scene.disposed).toBe(true);
  });
});
