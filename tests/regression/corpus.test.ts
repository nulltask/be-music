import { readdir } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSampleTriggers, createTimingResolver } from '@be-music/audio-renderer/triggers';
import { resolveChartPlayVariant, resolveChartReferenceBpm } from '@be-music/chart';
import type { BeMusicEvent, BeMusicJson } from '@be-music/json';
import { parseChart, parseChartFile } from '@be-music/parser';
import type { RandomDraws } from '@be-music/chart';
import { manualPlay, resolvePlayChart } from '@be-music/player';
import { extractTimedNotes } from '@be-music/player/playable-notes';
import {
  simulatePlaylogRulesets,
  type BeMusicPlaylog,
  type PlaylogInputEvent,
  type PlaylogNote,
  type PlaylogRulesetResult,
} from '@be-music/player/playlog';
import { stringifyBms, stringifyBmson } from '@be-music/stringifier';
import { describe, expect, test } from 'vite-plus/test';

/**
 * Regression corpus: every chart in `examples/test` is pushed through the whole pipeline — parse, `#RANDOM` resolution,
 * timing, sample triggers, the engine's prepared note list, the three ruleset simulators under fixed input streams,
 * and stringify — and the observable output of each stage is pinned in `__expected__/<chart>.json`.
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

/**
 * Press offsets cycled per note in the `offset` scenario, chosen to land in every LR2 window from PGREAT to a missed
 * POOR on both the FAST and the SLOW side.
 */
const OFFSET_SCENARIO_US = [0, 12_000, -12_000, 30_000, -30_000, 70_000, -70_000, 150_000] as const;
/** Every Nth scorable note is left unpressed in the `offset` scenario. */
const OFFSET_SCENARIO_SKIP_EVERY = 7;
/** How long a tap is held, capped so it never runs into the lane's next press. */
const TAP_HOLD_US = 40_000;

const roundUs = (seconds: number): number => Math.round(seconds * 1_000_000);
const round6 = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

describe('regression corpus', async () => {
  const charts = (await readdir(fixtureDir))
    .filter((entry) => CHART_EXTENSIONS.has(extname(entry).toLowerCase()))
    .sort();

  test('the corpus is not empty', () => {
    // Guards against the fixture directory being renamed out from under this suite, which would pass vacuously.
    expect(charts.length).toBeGreaterThanOrEqual(25);
  });

  for (const name of charts) {
    test(name, async () => {
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

function summarizeParse(json: BeMusicJson): Record<string, unknown> {
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
function summarizeStringify(json: BeMusicJson): Record<string, unknown> {
  const isBmson = json.sourceFormat === 'bmson';
  const text = isBmson ? stringifyBmson(json) : stringifyBms(json, { eol: '\n' });
  const reparsed = parseChart(text, isBmson ? 'bmson' : 'bms');
  const before = formatPlayableNotes(resolveForComparison(json));
  const after = formatPlayableNotes(resolveForComparison(reparsed));
  return {
    format: isBmson ? 'bmson' : 'bms',
    roundTripPlayableNotesEqual: JSON.stringify(before) === JSON.stringify(after),
    lines: text.split('\n'),
  };
}

function resolveForComparison(json: BeMusicJson): BeMusicJson {
  return resolvePlayChart(json, { random: () => 0 }).chart;
}

function formatPlayableNotes(json: BeMusicJson): string[] {
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
  parsed: BeMusicJson,
  path: string,
  random: () => number,
): Promise<Record<string, unknown>> {
  // Resolved once, the way the hosts do it: the engine plays this chart as is, with the draws it was resolved with.
  const { chart: json, randomDraws } = resolvePlayChart(parsed, { random });
  const timing = createTimingResolver(json);

  // The engine runs once, with no input, purely to snapshot the note list it prepares for play (lane transforms,
  // long-note modes, mine damage, FREE ZONE). Play outcomes come from the ruleset simulators instead: the engine
  // judges on a wall-clock tick loop, and its replay summary still shifts between runs (gauge order around the
  // 100 % clamp, trailing releases dropped once the loop ends), so pinning it here would make this suite flaky.
  // Engine/simulator agreement is `packages/player/src/playlog/equivalence.test.ts`'s job.
  const playlog = await recordNoInputPlaylog(json, randomDraws);
  const notes = playlog.chart.notes;
  const scenarios: Record<string, PlaylogInputEvent[]> = {
    missed: [],
    perfect: buildInputs(
      notes,
      () => 0,
      () => false,
    ),
    offset: buildInputs(
      notes,
      (index) => OFFSET_SCENARIO_US[index % OFFSET_SCENARIO_US.length]!,
      (index) => index % OFFSET_SCENARIO_SKIP_EVERY === OFFSET_SCENARIO_SKIP_EVERY - 1,
    ),
  };

  const { notes: _notes, ...chartFacts } = playlog.chart;
  return {
    randomPatterns: formatRandomPatterns(randomDraws),
    title: json.metadata.title,
    playVariant: resolveChartPlayVariant({ chartPath: path, events: json.events, bms: json.bms }),
    referenceBpm: resolveChartReferenceBpm(json),
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
    playlogChart: chartFacts,
    notes: notes.map(formatPlaylogNote),
    play: Object.fromEntries(
      Object.entries(scenarios).map(([id, inputs]) => [
        id,
        {
          inputs: inputs.length,
          ...Object.fromEntries(
            Object.entries(simulatePlaylogRulesets({ ...playlog, inputs })).map(([ruleset, result]) => [
              ruleset,
              roundRulesetResult(result),
            ]),
          ),
        },
      ]),
    ),
  };
}

function formatPlaylogNote(note: PlaylogNote): string {
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

async function recordNoInputPlaylog(json: BeMusicJson, randomDraws: RandomDraws): Promise<BeMusicPlaylog> {
  let playlog: BeMusicPlaylog | undefined;
  await manualPlay(json, {
    randomDraws,
    speed: 64,
    leadInMs: 0,
    audio: false,
    tui: false,
    writeOutput: () => {},
    replayInputs: [],
    recordPlaylog: {},
    onPlaylogRecorded: (recorded) => {
      playlog = recorded;
    },
  });
  if (playlog === undefined) {
    throw new Error('manualPlay finished without recording a playlog');
  }
  return playlog;
}

/**
 * Builds a replay input stream that presses every scorable note on its own lane. `offsetUs` shifts a note's press
 * (and, for long notes, its release) and `skip` leaves a note unpressed; both are keyed by the note's index among
 * the pressable notes so the stream is deterministic. Presses on one lane never overlap: a press waits for the
 * lane's previous release, and a tap is released before the lane's next press.
 */
function buildInputs(
  notes: readonly PlaylogNote[],
  offsetUs: (index: number) => number,
  skip: (index: number) => boolean,
): PlaylogInputEvent[] {
  const pressable = notes.filter((note) => note.type !== 'mine' && note.type !== 'invisible');
  const byChannel = new Map<string, Array<{ note: PlaylogNote; index: number }>>();
  pressable.forEach((note, index) => {
    if (skip(index)) {
      return;
    }
    const lane = byChannel.get(note.channel) ?? [];
    lane.push({ note, index });
    byChannel.set(note.channel, lane);
  });

  const events: Array<Omit<PlaylogInputEvent, 'seq'>> = [];
  for (const [channel, lane] of byChannel) {
    let lastUpUs = Number.NEGATIVE_INFINITY;
    lane.forEach(({ note, index }, position) => {
      const offset = offsetUs(index);
      const downUs = Math.max(note.timeUs + offset, lastUpUs + 1);
      const next = lane[position + 1];
      const nextDownUs = next === undefined ? Number.POSITIVE_INFINITY : next.note.timeUs + offsetUs(next.index);
      const naturalUpUs = note.endTimeUs === undefined ? downUs + TAP_HOLD_US : note.endTimeUs + offset;
      const upUs = Math.max(downUs + 1, Math.min(naturalUpUs, nextDownUs - 1));
      events.push({ timeUs: downUs, action: 'down', channels: [channel] });
      events.push({ timeUs: upUs, action: 'up', channels: [channel] });
      lastUpUs = upUs;
    });
  }

  // Releases sort ahead of presses that share a timestamp, then lanes in channel order, so `seq` is stable.
  events.sort(
    (left, right) =>
      left.timeUs - right.timeUs ||
      (left.action === right.action ? 0 : left.action === 'up' ? -1 : 1) ||
      left.channels[0]!.localeCompare(right.channels[0]!),
  );
  return events.map((event, seq) => ({ seq, ...event }));
}

function roundRulesetResult(result: PlaylogRulesetResult): PlaylogRulesetResult {
  return { ...result, gauge: { ...result.gauge, final: round6(result.gauge.final) } };
}
