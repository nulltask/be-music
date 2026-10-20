import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChartFile } from '@be-music/parser';
import { resolvePlayChart } from '@be-music/player';
import { describe, expect, test } from 'vite-plus/test';
import {
  buildScenarios,
  ENGINE_REPLAY_SPEED,
  replayEngine,
  replayEngineRulesets,
  summarizeEngineReplay,
} from './play-scenarios.ts';

/**
 * Speed independence of the engine replays the corpus pins: every chart, `#RANDOM` draw, input scenario and judge
 * ruleset is replayed again at a speed far from the corpus's, and must give exactly the pinned summary and re-record
 * exactly the input stream it was fed.
 *
 * `manualPlay` steps a replay on a fixed 1 ms chart-time grid (`advanceJudgeCoreReplay`), so neither the tick timing
 * nor `speed` may reach a judgment. The corpus itself covers repeat runs at its own speed — every run is compared
 * against the same pinned file — so this suite only adds the second speed. It picks a faster one rather than a slower
 * one: at 1024x one 16 ms tick spans about 16 s of chart time, which stresses the grid hardest (many steps and inputs
 * folded into each tick, the loop ending far past the last input) while costing a fraction of the corpus's own run.
 * Slower speeds (4x, 16x) were checked once by hand when the engine replays were first pinned; replaying the corpus at
 * 4x takes minutes, which is too slow for every test run.
 */

const DETERMINISM_SPEED = 1024;

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureDir = resolve(rootDir, 'examples/test');
const expectedDir = resolve(dirname(fileURLToPath(import.meta.url)), '__expected__');
const CHART_EXTENSIONS = new Set(['.bms', '.bme', '.bml', '.pms', '.bmson']);
const RANDOM_VARIANTS: ReadonlyArray<{ id: string; random: () => number }> = [
  { id: 'random-low', random: () => 0 },
  { id: 'random-high', random: () => 0.999_999_9 },
];

interface ExpectedCorpusFile {
  variants: Record<string, { play: Record<string, { engine: Record<string, unknown> }> }>;
}

describe('engine replay determinism', async () => {
  const charts = (await readdir(fixtureDir))
    .filter((entry) => CHART_EXTENSIONS.has(extname(entry).toLowerCase()))
    .sort();

  test('the speeds differ', () => {
    // Guards against the two speeds being aligned by an edit, which would make this suite repeat the corpus.
    expect(DETERMINISM_SPEED).not.toBe(ENGINE_REPLAY_SPEED);
  });

  for (const name of charts) {
    test.concurrent(name, { timeout: 60_000 }, async ({ expect }) => {
      const parsed = await parseChartFile(resolve(fixtureDir, name));
      const expected = JSON.parse(await readFile(resolve(expectedDir, `${name}.json`), 'utf8')) as ExpectedCorpusFile;
      const hasControlFlow = parsed.sourceFormat === 'bms' && parsed.bms.controlFlow.length > 0;
      const variants = hasControlFlow ? RANDOM_VARIANTS : [{ id: 'default', random: () => 0 }];

      for (const variant of variants) {
        const { chart: json, randomDraws } = resolvePlayChart(parsed, { random: variant.random });
        const { replay } = await replayEngine(json, { randomDraws, inputs: [], speed: DETERMINISM_SPEED });
        const pinnedPlay = expected.variants[variant.id]!.play;

        for (const [scenario, inputs] of Object.entries(buildScenarios(replay.chart.notes))) {
          const replays = await replayEngineRulesets(json, { randomDraws, inputs, speed: DETERMINISM_SPEED });
          for (const { ruleset, replay } of replays) {
            const where = `${variant.id} / ${scenario} / ${ruleset}`;
            expect(replay.replay.inputs, where).toEqual(inputs);
            // Round-tripped through JSON like the pinned file, which drops `undefined` fields.
            expect(JSON.parse(JSON.stringify(summarizeEngineReplay(replay))), where).toEqual(
              pinnedPlay[scenario]!.engine[ruleset],
            );
          }
        }
      }
    });
  }
});
