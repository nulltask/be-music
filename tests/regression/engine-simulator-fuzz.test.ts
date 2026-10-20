import { describe, expect, test } from 'vite-plus/test';
import { simulateReplay, type RulesetId } from '@be-music/player-engine/replay';
import {
  buildFuzzChart,
  buildFuzzInputs,
  createRandom,
  FUZZ_GAUGES,
  type FuzzMode,
  replayFuzzCase,
} from './fuzz-scenarios.ts';
import { findEngineSimulatorMismatches } from './play-scenarios.ts';

/**
 * Differential fuzzing of the live engine against the replay simulator: seeded random charts and input streams,
 * replayed through the engine under every ruleset, must give the same result when the recorded log is re-simulated.
 * The corpus pins real charts; this covers the timing corners (window edges, coinciding notes, early and late
 * releases, re-presses, mines held across, `#EXRANK` changes) that hand-written charts rarely reach.
 */

const MODES: readonly FuzzMode[] = ['7', '14', '5', '9', '24'];
const RULESETS: readonly RulesetId[] = ['lr2', 'beatoraja', 'iidx'];
// Rare corners need far more cases than a test run can afford: raise the count locally, e.g.
// `BE_MUSIC_FUZZ_SEEDS=1000 pnpm exec vp test run tests/regression/engine-simulator-fuzz.test.ts`.
const SEEDS_PER_MODE = Number(process.env.BE_MUSIC_FUZZ_SEEDS ?? 40);

describe('engine / simulator differential fuzz', () => {
  test.each(MODES)('%s keys', { timeout: 3_600_000 }, async (mode) => {
    const mismatches: string[] = [];
    for (let seed = 1; seed <= SEEDS_PER_MODE; seed += 1) {
      const random = createRandom(seed * 7919 + Number(mode));
      const chart = buildFuzzChart(mode, random);
      const autoScratch = random() < 0.2;
      const gauge = FUZZ_GAUGES[Math.floor(random() * FUZZ_GAUGES.length)]!;
      // The note list the engine resolves, read from a log recorded without input.
      const probe = await replayFuzzCase(chart, [], { ruleset: 'lr2', gauge: 'GROOVE', autoScratch: false });
      const inputs = buildFuzzInputs(probe.replay.chart.notes, random);
      const replays = await Promise.all(
        RULESETS.map(async (ruleset) => ({
          ruleset,
          replay: await replayFuzzCase(chart, inputs, { ruleset, gauge, autoScratch }),
        })),
      );
      for (const { ruleset, replay } of replays) {
        const fields = findEngineSimulatorMismatches(replay, simulateReplay(replay.replay, { ruleset }));
        if (fields.length > 0) {
          mismatches.push(
            `seed ${seed} ${ruleset} ${gauge}${autoScratch ? ' AUTO SCRATCH' : ''}: ${fields.join(', ')}`,
          );
        }
      }
    }
    expect(mismatches).toEqual([]);
  });
});
