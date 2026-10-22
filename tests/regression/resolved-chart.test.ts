import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectSampleTriggers,
  createTimingResolver,
  resolveChart,
  resolveChartPlayVariant,
  type ResolvedChart,
  type ResolvedNote,
} from '@be-music/chart-model';
import type { BeMusicJSON } from '@be-music/chart-source';
import { parseChartFile } from '@be-music/chart-parser';
import { resolvePlayChart } from '@be-music/player-engine';
import { extractTimedNotes, type TimedLandmineNote, type TimedPlayableNote } from '@be-music/player-engine/display';
import { describe, expect, test } from 'vite-plus/test';

/**
 * Equivalence of the Resolved layer with what the consumers compute: for every chart in `tests/fixtures` and every
 * `#RANDOM` draw the corpus pins, `resolveChart` must give the same notes, triggers and tempo map as
 *
 * - the consumer helpers it replaces (`extractTimedNotes`, `collectSampleTriggers`, `createTimingResolver`), under both long-note inference settings, and
 * - the pinned output of the whole pipeline in `__expected__/<chart>.json` (the engine's prepared note list, the
 *   sample triggers, tempo / STOP points, play variant and judge-rank / TOTAL facts), which the corpus suite recorded
 *   before the Resolved layer existed.
 */

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureDir = resolve(rootDir, 'tests/fixtures');
const expectedDir = resolve(dirname(fileURLToPath(import.meta.url)), '__expected__');
const CHART_EXTENSIONS = new Set(['.bms', '.bme', '.bml', '.pms', '.bmson']);
const RANDOM_VARIANTS: ReadonlyArray<{ id: string; random: () => number }> = [
  { id: 'random-low', random: () => 0 },
  { id: 'random-high', random: () => 0.999_999_9 },
];

const roundUs = (seconds: number): number => Math.round(seconds * 1_000_000);
const round6 = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

interface ExpectedVariant {
  playVariant: string;
  timing: { tempo: string[]; stops: string[] };
  sampleTriggers: string[];
  replayChart: {
    judgeRank: {
      sourceRank?: number;
      sourceExRank?: number;
      timeline?: Array<{ timeUs: number; exRankValue: number }>;
    };
    total?: number;
    lnMode: number;
  };
  notes: string[];
}

describe('resolved chart equivalence', async () => {
  const charts = (await readdir(fixtureDir))
    .filter((entry) => CHART_EXTENSIONS.has(extname(entry).toLowerCase()))
    .sort();

  test('covers the whole corpus', () => {
    expect(charts.length).toBeGreaterThanOrEqual(25);
  });

  for (const name of charts) {
    test(name, async () => {
      const path = resolve(fixtureDir, name);
      const parsed = await parseChartFile(path);
      const expected = JSON.parse(await readFile(resolve(expectedDir, `${name}.json`), 'utf8')) as {
        variants: Record<string, ExpectedVariant>;
      };
      const hasControlFlow = parsed.sourceFormat === 'bms' && parsed.bms.controlFlow.length > 0;
      const variants = hasControlFlow ? RANDOM_VARIANTS : [{ id: 'default', random: () => 0 }];
      for (const variant of variants) {
        const { chart, randomDraws } = resolvePlayChart(parsed, { random: variant.random });
        for (const inferBmsLNTypeWhenMissing of [false, true]) {
          const resolved = resolveChart(chart, { randomDraws, chartPath: path, inferBmsLNTypeWhenMissing });
          expect(resolved.randomDraws).toBe(randomDraws);
          expect(resolved.hasUnresolvedControlFlow).toBe(false);
          expectConsumerEquivalence(resolved, chart, path, inferBmsLNTypeWhenMissing);
        }
        expectPinnedEquivalence(resolveChart(chart, { randomDraws, chartPath: path }), expected.variants[variant.id]!);
      }
    });
  }
});

function expectConsumerEquivalence(
  resolved: ResolvedChart,
  chart: BeMusicJSON,
  path: string,
  inferBmsLNTypeWhenMissing: boolean,
): void {
  const playVariant = resolveChartPlayVariant({
    chartPath: path,
    events: chart.events,
    bms: chart.bms,
    bmson: chart.bmson,
  });
  expect(resolved.playVariant).toBe(playVariant);

  const extracted = extractTimedNotes(chart, {
    includeLandmine: true,
    includeInvisible: true,
    inferBmsLNTypeWhenMissing,
    playVariant,
  });
  expect(resolved.notes.map(describeResolved)).toEqual(extracted.playableNotes.map(describeTimed));
  expect(resolved.shadowedNotes.map(describeResolved)).toEqual(extracted.shadowedNotes.map(describeTimed));
  expect(resolved.invisibleNotes.map(describeResolved)).toEqual(extracted.invisibleNotes.map(describeTimed));
  expect(resolved.mines.map(describeResolved)).toEqual(extracted.landmineNotes.map(describeTimed));
  // Same source events, in the same order.
  expect(resolved.notes.map((note) => note.event)).toEqual(extracted.playableNotes.map((note) => note.event));

  const timing = createTimingResolver(chart);
  expect(resolved.timing.tempoPoints).toEqual(timing.tempoPoints);
  expect(resolved.timing.stopPoints).toEqual(timing.stopPoints);
  expect(resolved.sampleTriggers).toEqual(collectSampleTriggers(chart, timing, { inferBmsLNTypeWhenMissing }));
}

function expectPinnedEquivalence(resolved: ResolvedChart, expected: ExpectedVariant): void {
  expect(resolved.playVariant).toBe(expected.playVariant);
  expect(
    resolved.timing.tempoPoints.map((point) => `${round6(point.beat)} ${point.bpm} ${roundUs(point.seconds)}`),
  ).toEqual(expected.timing.tempo);
  expect(
    resolved.timing.stopPoints.map(
      (point) => `${round6(point.beat)} ${roundUs(point.seconds)} ${roundUs(point.cumulativeSeconds)}`,
    ),
  ).toEqual(expected.timing.stops);
  expect(
    resolved.sampleTriggers.map(
      (trigger) =>
        `${roundUs(trigger.seconds)} ${trigger.channel} ${trigger.sampleKey}` +
        (trigger.sampleOffsetSeconds === 0 ? '' : ` +${roundUs(trigger.sampleOffsetSeconds)}`) +
        (trigger.sampleDurationSeconds === undefined ? '' : ` ~${roundUs(trigger.sampleDurationSeconds)}`),
    ),
  ).toEqual(expected.sampleTriggers);

  // The engine's prepared note list, as the replay records it.
  const lines = [
    ...resolved.notes.map((note) => {
      if (note.freeZone) {
        return `${roundUs(note.seconds)} ${note.channel} freezone ->${roundUs(note.endSeconds!)}`;
      }
      return note.kind === 'ln'
        ? `${roundUs(note.seconds)} ${note.channel} long ->${roundUs(note.endSeconds!)} ln${note.lnMode}`
        : `${roundUs(note.seconds)} ${note.channel} normal`;
    }),
    ...resolved.mines.map((mine) => `${roundUs(mine.seconds)} ${mine.channel} mine dmg${mine.damage}`),
    ...resolved.invisibleNotes.map((note) => `${roundUs(note.seconds)} ${note.channel} invisible`),
  ];
  expect(lines.sort()).toEqual([...expected.notes].sort());

  const { judgeRank, total, lnMode } = expected.replayChart;
  expect(resolved.lnMode).toBe(lnMode);
  expect(resolved.judgeRank.rank).toBe(judgeRank.sourceRank);
  expect(resolved.judgeRank.exRank).toBe(judgeRank.sourceExRank);
  expect(
    resolved.judgeRank.changes.map((change) => ({ timeUs: roundUs(change.seconds), exRankValue: change.exRankValue })),
  ).toEqual(judgeRank.timeline ?? []);
  expect(resolved.total.value).toBe(total);
}

function describeResolved(note: ResolvedNote): string {
  return `${note.channel} ${note.beat} ${note.seconds} ${note.endBeat} ${note.endSeconds} ${note.lnMode}`;
}

function describeTimed(note: TimedPlayableNote | TimedLandmineNote): string {
  const playable = note as TimedPlayableNote;
  return `${note.channel} ${note.beat} ${note.seconds} ${playable.endBeat} ${playable.endSeconds} ${playable.longNoteMode}`;
}
