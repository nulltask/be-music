import { readdir } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectSampleTriggers,
  createTimingResolver,
  resolveChartPlayVariant,
  resolveChartReferenceBPM,
} from '@be-music/chart-model';
import type { BeMusicEvent, BeMusicJSON } from '@be-music/chart-source';
import { parseChart, parseChartFile } from '@be-music/chart-parser';
import type { RandomDraws } from '@be-music/chart-model';
import { resolvePlayChart } from '@be-music/player-engine';
import { extractTimedNotes } from '@be-music/player-engine/display';
import { simulateReplayRulesets, type ReplayNote, type ReplayRulesetResult } from '@be-music/player-engine/replay';
import { stringifyBMS, stringifyBmson } from '@be-music/chart-writer';
import { describe, expect, test } from 'vite-plus/test';
import {
  buildScenarios,
  ENGINE_REPLAY_SPEED,
  findEngineSimulatorMismatches,
  replayEngine,
  replayEngineRulesets,
  round6,
  summarizeEngineReplay,
} from './play-scenarios.ts';

/**
 * Regression corpus: every chart in `examples/test` is pushed through the whole pipeline — parse, `#RANDOM` resolution,
 * timing, sample triggers, the engine's prepared note list, the three ruleset simulators and the live engine's replays
 * under fixed input streams, and stringify — and the observable output of each stage is pinned in
 * `__expected__/<chart>.json`.
 *
 * The unit tests next to each source file assert what a function should do. This suite records what the toolchain
 * currently DOES on real chart files, so a refactor that moves logic between packages fails here the moment any
 * stage's output shifts, even in a corner no unit test thought to cover. A diff in an expected file is not automatically
 * a bug: when the change is intended, regenerate with `pnpm test:regression -u` and review the diff like code.
 */

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureDir = resolve(rootDir, 'examples/test');
const CHART_EXTENSIONS = new Set(['.bms', '.bme', '.bml', '.pms', '.bmson']);

/** Fixed `#RANDOM` draws: the lowest and the highest branch of every block. */
const RANDOM_VARIANTS: ReadonlyArray<{ id: string; random: () => number }> = [
  { id: 'random-low', random: () => 0 },
  { id: 'random-high', random: () => 0.999_999_9 },
];

const roundUs = (seconds: number): number => Math.round(seconds * 1_000_000);

describe('regression corpus', async () => {
  const charts = (await readdir(fixtureDir))
    .filter((entry) => CHART_EXTENSIONS.has(extname(entry).toLowerCase()))
    .sort();

  test('the corpus is not empty', () => {
    // Guards against the fixture directory being renamed out from under this suite, which would pass vacuously.
    expect(charts.length).toBeGreaterThanOrEqual(25);
  });

  // Charts run concurrently: almost all of a chart's time goes to engine replays waiting on their tick loop, and the
  // longest charts need several seconds of it.
  for (const name of charts) {
    test.concurrent(name, { timeout: 60_000 }, async ({ expect }) => {
      const expected = await buildExpected(resolve(fixtureDir, name), name);
      await expect(`${JSON.stringify(expected, null, 2)}\n`).toMatchFileSnapshot(`__expected__/${name}.json`);
    });
  }
});

async function buildExpected(path: string, name: string): Promise<Record<string, unknown>> {
  const parsed = await parseChartFile(path);
  const hasControlFlow = parsed.sourceFormat === 'bms' && parsed.bms.controlFlow.length > 0;
  const variants = hasControlFlow ? RANDOM_VARIANTS : [{ id: 'default', random: () => 0 }];

  const resolvedVariants: Record<string, unknown> = {};
  for (const variant of variants) {
    resolvedVariants[variant.id] = await buildResolvedExpected(parsed, path, variant.random);
  }

  return {
    chart: name,
    parse: summarizeParse(parsed),
    stringify: summarizeStringify(parsed),
    variants: resolvedVariants,
  };
}

function summarizeParse(json: BeMusicJSON): Record<string, unknown> {
  const { controlFlow, ...bms } = json.bms;
  return {
    sourceFormat: json.sourceFormat,
    metadata: json.metadata,
    resources: json.resources,
    measures: json.measures,
    bms: json.sourceFormat === 'bms' ? bms : undefined,
    bmson: json.sourceFormat === 'bmson' ? json.bmson : undefined,
    controlFlow: controlFlow.map((entry) =>
      entry.kind === 'directive' ? `${entry.command} ${entry.value ?? ''}`.trim() : entry.kind,
    ),
    events: json.events.map(formatEvent),
  };
}

function formatEvent(event: BeMusicEvent): string {
  const base = `${event.measure}:${event.channel}@${event.position[0]}/${event.position[1]}=${event.value}`;
  return event.bmson === undefined ? base : `${base} ${JSON.stringify(event.bmson)}`;
}

/**
 * Stringifies the chart back to its own format and re-parses it. The output text is pinned so stringifier changes
 * show up as a readable diff, and the playable notes of the re-parsed chart are compared against the original's so
 * a lossy round trip is visible in the expected file instead of hidden behind a text diff.
 */
function summarizeStringify(json: BeMusicJSON): Record<string, unknown> {
  const isBmson = json.sourceFormat === 'bmson';
  const text = isBmson ? stringifyBmson(json) : stringifyBMS(json, { eol: '\n' });
  const reparsed = parseChart(text, isBmson ? 'bmson' : 'bms');
  const before = formatPlayableNotes(resolveForComparison(json));
  const after = formatPlayableNotes(resolveForComparison(reparsed));
  return {
    format: isBmson ? 'bmson' : 'bms',
    roundTripPlayableNotesEqual: JSON.stringify(before) === JSON.stringify(after),
    lines: text.split('\n'),
  };
}

function resolveForComparison(json: BeMusicJSON): BeMusicJSON {
  return resolvePlayChart(json, { random: () => 0 }).chart;
}

function formatPlayableNotes(json: BeMusicJSON): string[] {
  const { playableNotes, landmineNotes, invisibleNotes } = extractTimedNotes(json, { includeInvisible: true });
  return [
    ...playableNotes.map(
      (note) =>
        `${roundUs(note.seconds)} ${note.channel}` +
        (note.endSeconds === undefined ? '' : ` ->${roundUs(note.endSeconds)}`) +
        (note.longNoteMode === undefined ? '' : ` ln${note.longNoteMode}`),
    ),
    ...landmineNotes.map((note) => `${roundUs(note.seconds)} ${note.channel} mine`),
    ...invisibleNotes.map((note) => `${roundUs(note.seconds)} ${note.channel} invisible`),
  ].sort();
}

async function buildResolvedExpected(
  parsed: BeMusicJSON,
  path: string,
  random: () => number,
): Promise<Record<string, unknown>> {
  // Resolved once, the way the hosts do it: the engine plays this chart as is, with the draws it was resolved with.
  const { chart: json, randomDraws } = resolvePlayChart(parsed, { random });
  const timing = createTimingResolver(json);

  // A no-input run snapshots the note list the engine prepares for play (lane transforms, long-note modes, mine
  // damage, FREE ZONE); the scenarios' input streams are built from it. Each stream is then judged twice per ruleset:
  // by the pure simulator and by the live engine replaying it. Both are pinned side by side, and the two must agree on
  // every chart: `packages/player-engine/src/replay/equivalence.test.ts` reduces each rule to a minimal case, while this
  // catches whatever combination of rules a real chart reaches that no minimal case covered.
  const { replay } = await replayEngine(json, { randomDraws, inputs: [], speed: ENGINE_REPLAY_SPEED });
  const notes = replay.chart.notes;
  const play: Record<string, unknown> = {};
  for (const [id, inputs] of Object.entries(buildScenarios(notes))) {
    const simulated = simulateReplayRulesets({ ...replay, inputs });
    const replays = await replayEngineRulesets(json, { randomDraws, inputs, speed: ENGINE_REPLAY_SPEED });
    for (const { ruleset, replay } of replays) {
      expect(findEngineSimulatorMismatches(replay, simulated[ruleset]!), `${path} ${id} ${ruleset}`).toEqual([]);
    }
    play[id] = {
      inputs: inputs.length,
      ...Object.fromEntries(
        Object.entries(simulated).map(([ruleset, result]) => [ruleset, roundRulesetResult(result)]),
      ),
      engine: Object.fromEntries(replays.map(({ ruleset, replay }) => [ruleset, summarizeEngineReplay(replay)])),
    };
  }

  const { notes: _notes, ...chartFacts } = replay.chart;
  return {
    randomPatterns: formatRandomPatterns(randomDraws),
    title: json.metadata.title,
    playVariant: resolveChartPlayVariant({ chartPath: path, events: json.events, bms: json.bms }),
    referenceBPM: resolveChartReferenceBPM(json),
    timing: {
      tempo: timing.tempoPoints.map((point) => `${round6(point.beat)} ${point.bpm} ${roundUs(point.seconds)}`),
      stops: timing.stopPoints.map(
        (point) => `${round6(point.beat)} ${roundUs(point.seconds)} ${roundUs(point.cumulativeSeconds)}`,
      ),
    },
    sampleTriggers: collectSampleTriggers(json, timing).map(
      (trigger) =>
        `${roundUs(trigger.seconds)} ${trigger.channel} ${trigger.sampleKey}` +
        (trigger.sampleOffsetSeconds === 0 ? '' : ` +${roundUs(trigger.sampleOffsetSeconds)}`) +
        (trigger.sampleDurationSeconds === undefined ? '' : ` ~${roundUs(trigger.sampleDurationSeconds)}`),
    ),
    replayChart: chartFacts,
    notes: notes.map(formatReplayNote),
    play,
  };
}

function formatReplayNote(note: ReplayNote): string {
  return (
    `${note.timeUs} ${note.channel} ${note.type}` +
    (note.endTimeUs === undefined ? '' : ` ->${note.endTimeUs}`) +
    (note.lnMode === undefined ? '' : ` ln${note.lnMode}`) +
    (note.damage === undefined ? '' : ` dmg${note.damage}`)
  );
}

/** The `#RANDOM` / `#SETRANDOM` lines' outcomes as `value/range` (a `#SETRANDOM n` line reads `n/n`). */
function formatRandomPatterns(draws: RandomDraws): string[] {
  return draws
    .filter((draw) => draw.command === 'RANDOM' || draw.command === 'SETRANDOM')
    .map((draw) => (draw.command === 'SETRANDOM' ? `${draw.value}/${draw.value}` : `${draw.value}/${draw.range}`));
}

function roundRulesetResult(result: ReplayRulesetResult): ReplayRulesetResult {
  return { ...result, gauge: { ...result.gauge, final: round6(result.gauge.final) } };
}
