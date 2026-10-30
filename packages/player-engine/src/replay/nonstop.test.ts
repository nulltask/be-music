import { resolveChart } from '@be-music/chart-model';
import { parseChart } from '@be-music/chart-parser';
import { describe, expect, test } from 'vite-plus/test';
import { stitchNonstopCourse } from '../course/nonstop/compose.ts';
import { manualPlay } from '../index.ts';
import { checkCourseReplayEligibility } from './course-eligibility.ts';
import { createCourseReplay, parseCourseReplay, serializeCourseReplay, simulateCourseReplay } from './course.ts';
import type { BeMusicReplay, ReplayInputEvent } from './format.ts';
import { resolveNonstopNoteStages, resolveNonstopReplayStages, splitNonstopReplay } from './nonstop.ts';
import { simulateReplay } from './simulate.ts';

const bms = (...lines: string[]) => parseChart(lines.join('\n'), 'bms');

/**
 * Two stages at 240 BPM (1 s a measure). Stage 1 ends on its measure-2 line (three notes); stage 2's four notes start a
 * quarter measure into its measure 2, so they follow stage 1's last note by 0.25 s once placed.
 */
const STAGES = [
  bms('#BPM 240', '#WAV01 a.wav', '#00111:0101', '#00212:01'),
  bms('#BPM 240', '#WAV01 b.wav', '#00211:00010001', '#00312:00010001'),
];

function stitch() {
  const result = stitchNonstopCourse(
    STAGES.map((chart) => ({ chart })),
    { connections: ['cut'], title: 'Nonstop' },
  );
  if (!result.ok) throw new Error(`stitch failed: ${result.reason}`);
  return result;
}

/** Presses every note of the stitched chart except those `miss` names (by time order). */
function presses(chart: ReturnType<typeof stitch>['chart'], miss: (index: number) => boolean): ReplayInputEvent[] {
  const events: ReplayInputEvent[] = [];
  resolveChart(chart)
    .notes.map((note) => ({ timeUs: Math.round(note.seconds * 1_000_000), channel: note.channel }))
    .sort((left, right) => left.timeUs - right.timeUs)
    .forEach((note, index) => {
      if (miss(index)) return;
      events.push({ seq: events.length, timeUs: note.timeUs, action: 'down', channels: [note.channel] });
      events.push({ seq: events.length, timeUs: note.timeUs + 40_000, action: 'up', channels: [note.channel] });
    });
  return events.sort((left, right) => left.timeUs - right.timeUs || left.seq - right.seq);
}

async function playStitched(miss: (index: number) => boolean = () => false) {
  const stitched = stitch();
  let replay: BeMusicReplay | undefined;
  await manualPlay(stitched.chart, {
    speed: 16,
    leadInMs: 0,
    audio: false,
    tui: false,
    replayInputs: presses(stitched.chart, miss),
    course: { kind: 'nonstop' },
    recordReplay: {},
    onReplayRecorded: (recorded) => {
      replay = recorded;
    },
  });
  return { stitched, replay: replay! };
}

describe('NONSTOP replays', () => {
  test('cuts each stage out of the stitched play with its own notes, inputs and carried state', async () => {
    const { stitched, replay } = await playStitched((index) => index === 1);
    const noteStages = resolveNonstopNoteStages(stitched.chart, stitched.map, replay.chart.notes);
    expect(noteStages.filter((stage) => stage === 0)).toHaveLength(3);
    expect(noteStages.filter((stage) => stage === 1)).toHaveLength(4);
    const stages = resolveNonstopReplayStages(stitched.map);
    const [first, second] = splitNonstopReplay(
      { replay, stages, noteStages },
      [
        { title: 'A', md5: 'a'.repeat(32) },
        { title: 'B', md5: 'b'.repeat(32) },
      ],
      { ruleset: 'lr2' },
    );
    expect(first!.chart).toMatchObject({ title: 'A', noteCount: 3 });
    expect(second!.chart).toMatchObject({ title: 'B', noteCount: 4 });
    // Stage 2's notes are timed from its own zero: its first note is a quarter into its measure 2 (2.25 s).
    expect(second!.chart.notes[0]!.timeUs).toBe(2_250_000);
    expect(first!.inputs).toHaveLength(4);
    expect(second!.inputs).toHaveLength(8);
    expect(first!.play.course).toEqual({ kind: 'nonstop', rate: 1 });
    // Stage 2 starts from where the stitched play stood at its window.
    const before = simulateReplay(
      {
        ...replay,
        inputs: replay.inputs.filter((input) => input.timeUs < stages[1]!.windowStartUs),
        play: { ...replay.play, aborted: true, abortedAtUs: stages[1]!.windowStartUs },
      },
      { ruleset: 'lr2' },
    );
    expect(second!.play.course?.carryIn).toEqual({
      gauge: before.gauge.final,
      combo: before.course?.combo ?? 0,
      maxCombo: before.course?.maxCombo ?? before.maxCombo,
    });
    // A cut-out stage replays on its own.
    expect(simulateReplay(second!, { ruleset: 'lr2' }).judge.pgreat).toBe(4);
  });

  test('judges a later stage with its own #RANK, and replays and cuts it out with it', async () => {
    // Stage 2 is VERY HARD (PGREAT ±8 ms); stage 1 has no #RANK (NORMAL, ±18 ms). Every note is hit 12 ms late.
    const stitched = stitchNonstopCourse(
      [
        { chart: STAGES[0]! },
        { chart: bms('#RANK 0', '#BPM 240', '#WAV01 b.wav', '#00211:00010001', '#00312:00010001') },
      ],
      { connections: ['cut'] },
    );
    if (!stitched.ok) throw new Error('stitch failed');
    const inputs = presses(stitched.chart, () => false).map((input) => ({ ...input, timeUs: input.timeUs + 12_000 }));
    let replay: BeMusicReplay | undefined;
    const summary = await manualPlay(stitched.chart, {
      speed: 16,
      leadInMs: 0,
      audio: false,
      tui: false,
      replayInputs: inputs,
      course: { kind: 'nonstop' },
      stageRanks: stitched.map.stageRanks,
      recordReplay: {},
      onReplayRecorded: (recorded) => {
        replay = recorded;
      },
    });
    expect(summary).toMatchObject({ perfect: 3, great: 4 });
    expect(replay!.chart.judgeRank.stageRanks).toEqual([
      { timeUs: Math.round(stitched.map.stageRanks[0]!.seconds * 1_000_000), rank: 0, table: 'chart' },
    ]);
    expect(simulateReplay(replay!, { ruleset: 'lr2' }).judge).toMatchObject({ pgreat: 3, great: 4 });
    const [, second] = splitNonstopReplay(
      {
        replay: replay!,
        stages: resolveNonstopReplayStages(stitched.map),
        noteStages: resolveNonstopNoteStages(stitched.chart, stitched.map, replay!.chart.notes),
      },
      [{}, {}],
      { ruleset: 'lr2' },
    );
    expect(simulateReplay(second!, { ruleset: 'lr2' }).judge).toMatchObject({ pgreat: 0, great: 4 });
  });

  test('takes the course result from the stitched play and round-trips through the file format', async () => {
    const { stitched, replay } = await playStitched();
    const noteStages = resolveNonstopNoteStages(stitched.chart, stitched.map, replay.chart.notes);
    // The first stage was resolved with a `#RANDOM` draw; the second had no control flow.
    const stages = resolveNonstopReplayStages(stitched.map, [[{ command: 'RANDOM', range: 2, value: 1 }], []]);
    expect(stages.map((stage) => stage.randomDraws)).toEqual([[{ command: 'RANDOM', range: 2, value: 1 }], undefined]);
    const split = splitNonstopReplay(
      { replay, stages, noteStages },
      [{ chartFingerprint: 'bmfp0:a' }, { chartFingerprint: 'bmfp0:b' }],
      { ruleset: 'lr2' },
    );
    const log = createCourseReplay({
      course: { name: 'Nonstop', kind: 'nonstop', constraints: [], trophies: [] },
      stages: split.map((stageLog) => ({ played: true as const, replay: stageLog })),
      nonstop: { connections: ['cut'], placement: 'intended', replay, stages, noteStages },
    });
    const run = simulateReplay(replay, { ruleset: 'lr2' });
    const course = simulateCourseReplay(log, { ruleset: 'lr2' });
    expect(course).toMatchObject({
      judge: run.judge,
      exScore: run.exScore,
      noteCount: 7,
      maxCombo: run.maxCombo,
      stagesPlayed: 2,
      missCount: 0,
    });
    expect(course.stages).toHaveLength(2);
    expect(log.results?.native).toMatchObject({ noteCount: 7, stagesPlayed: 2 });
    const parsed = parseCourseReplay(serializeCourseReplay(log));
    expect(parsed.nonstop).toEqual(log.nonstop);
    expect(() =>
      parseCourseReplay({ ...JSON.parse(serializeCourseReplay(log)), nonstop: { ...log.nonstop, noteStages: [0] } }),
    ).toThrow(/noteStages/);
    // The stitching rule version round-trips and must be a positive integer.
    const json = JSON.parse(serializeCourseReplay(log));
    expect(parseCourseReplay({ ...json, nonstop: { ...json.nonstop, stitch: 2 } }).nonstop?.stitch).toBe(2);
    expect(() => parseCourseReplay({ ...json, nonstop: { ...json.nonstop, stitch: 0 } })).toThrow(/nonstop\.stitch/);
    // Ranked on its stitched play, keyed by the stage charts the cut-out stages name.
    expect(checkCourseReplayEligibility(log)).toMatchObject({
      eligible: true,
      stages: [],
      nonstop: { playFingerprint: replay.chart.playFingerprint },
    });
    // A NONSTOP run played at another tempo is practice: stored, not ranked, on its stitched play.
    const slowed = { ...log.nonstop!.replay, play: { ...log.nonstop!.replay.play, tempo: 0.9 } };
    expect(checkCourseReplayEligibility({ ...log, nonstop: { ...log.nonstop!, replay: slowed } })).toMatchObject({
      eligible: true,
      unranked: 'tempo',
    });
    expect(() =>
      parseCourseReplay({
        ...JSON.parse(serializeCourseReplay(log)),
        nonstop: {
          ...log.nonstop,
          stages: [{ ...stages[0], randomDraws: [{ command: 'RANDOM', range: 2, value: 3 }] }, stages[1]],
        },
      }),
    ).toThrow(/nonstop\.stages\[0\]\.randomDraws\[0\]\.value/);
  });
});

test('split NONSTOP replay preserves each stage display program on its local clock', async () => {
  const { stitched, replay } = await playStitched();
  const stages = resolveNonstopReplayStages(stitched.map);
  const second = stages[1]!;
  replay.chart.chartOptions = {
    version: 1,
    initial: { hiSpeed: 0.77 },
    cues: [
      { timeUs: second.windowStartUs, state: { hiSpeed: 100 } },
      { timeUs: second.windowStartUs + 100000, state: { hiSpeed: 0.25 } },
    ],
  };
  const stageLogs = splitNonstopReplay(
    { replay, stages, noteStages: resolveNonstopNoteStages(stitched.chart, stitched.map, replay.chart.notes) },
    [{}, {}],
    { ruleset: 'lr2' },
  );
  const program = stageLogs[1]!.chart.chartOptions!;
  expect(program).toBeDefined();
  expect(program.cues).toContainEqual({ timeUs: second.windowStartUs - second.offsetUs, state: { hiSpeed: 100 } });
  expect(program.cues).toContainEqual({
    timeUs: second.windowStartUs + 100000 - second.offsetUs,
    state: { hiSpeed: 0.25 },
  });
});
