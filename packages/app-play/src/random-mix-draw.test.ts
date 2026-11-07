import { DEFAULT_LR2_RANDOM_MIX_SETTINGS } from '@be-music/player-engine/course';
import type { LibraryChart } from '@be-music/player-scene-model';
import { describe, expect, test, vi } from 'vite-plus/test';
import { RandomMixDraw, type RandomMixPoolChart } from './random-mix-draw.ts';

function poolChart(n: number, folder = `f${n}`): RandomMixPoolChart {
  return {
    folder,
    keyMode: 7,
    level: 5,
    chart: { id: `c${n}`, title: `Song ${n}`, artist: 'A' } as unknown as LibraryChart,
  };
}

const md5 = (n: number) => n.toString(16).padStart(32, '0');
const settings = { ...DEFAULT_LR2_RANDOM_MIX_SETTINGS, bpmRange: 0 };
const bpmOf = () => ({ min: 150, max: 150 });

function sequence(): () => number {
  let i = 0;
  return () => (i += 0.37) % 1;
}

describe('RandomMixDraw', () => {
  test('hashes only the songs it draws, one folder each, until the pool runs out', async () => {
    const pool = Array.from({ length: 200 }, (_, n) => poolChart(n));
    const md5Of = vi.fn(async (chart: LibraryChart) => md5(Number(chart.id.slice(1)) + 1));
    const draw = new RandomMixDraw(pool, { settings, bpmOf, md5Of, random: sequence() });
    const stages = await draw.take(3);
    expect(stages).toHaveLength(3);
    expect(md5Of).toHaveBeenCalledTimes(3);
    expect(new Set(stages.map((stage) => stage.chart.id)).size).toBe(3);
    expect(stages[0]!.stage).toMatchObject({ keyMode: 7, artist: 'A' });
    expect(stages[0]!.stage.md5).toMatch(/^[0-9a-f]{32}$/u);
    const small = new RandomMixDraw([poolChart(1), poolChart(2)], { settings, bpmOf, md5Of, random: sequence() });
    expect(await small.take(5)).toHaveLength(2);
  });

  test('skips a song that cannot be hashed and draws another', async () => {
    const draw = new RandomMixDraw([poolChart(1), poolChart(2)], {
      settings,
      bpmOf,
      md5Of: async (chart) => (chart.id === 'c1' ? undefined : md5(2)),
      random: sequence(),
    });
    expect((await draw.take(2)).map((stage) => stage.chart.id)).toEqual(['c2']);
  });

  test('an endless draw frees the folders once all are drawn, not repeating the last one while another is left', async () => {
    const draw = new RandomMixDraw([poolChart(1), poolChart(2), poolChart(3)], {
      settings,
      bpmOf,
      md5Of: async (chart) => md5(Number(chart.id.slice(1))),
      random: sequence(),
      endless: true,
    });
    const ids = (await draw.take(30)).map((stage) => stage.chart.id);
    expect(ids).toHaveLength(30);
    for (let index = 1; index < ids.length; index += 1) expect(ids[index]).not.toBe(ids[index - 1]);
    const lonely = new RandomMixDraw([poolChart(1)], {
      settings,
      bpmOf,
      md5Of: async () => md5(1),
      random: sequence(),
      endless: true,
    });
    // A pool of one folder repeats it.
    expect(await lonely.take(3)).toHaveLength(3);
  });

  test('draws charts whose BPM changes only when allowed', async () => {
    const pool = [poolChart(1), poolChart(2)];
    const ranged = { ...DEFAULT_LR2_RANDOM_MIX_SETTINGS, bpmRange: 10 };
    const changing = () => ({ min: 120, max: 180 });
    const md5Of = async (chart: LibraryChart) => md5(Number(chart.id.slice(1)));
    const strict = new RandomMixDraw(pool, { settings: ranged, bpmOf: changing, md5Of, random: sequence() });
    expect(await strict.take(2)).toHaveLength(0);
    const allowed = new RandomMixDraw(pool, {
      settings: ranged,
      bpmOf: changing,
      md5Of,
      random: sequence(),
      allowBPMChanges: true,
    });
    expect(await allowed.take(2)).toHaveLength(2);
  });
});
