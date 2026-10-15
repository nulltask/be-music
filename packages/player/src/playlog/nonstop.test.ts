import { resolveChart } from '@be-music/chart';
import { parseChart } from '@be-music/parser';
import { describe, expect, test } from 'vite-plus/test';
import { stitchNonstopCourse } from '../course/nonstop/compose.ts';
import { manualPlay } from '../index.ts';
import { checkCoursePlaylogEligibility } from './course-eligibility.ts';
import { createCoursePlaylog, parseCoursePlaylog, serializeCoursePlaylog, simulateCoursePlaylog } from './course.ts';
import type { BeMusicPlaylog, PlaylogInputEvent } from './format.ts';
import { resolveNonstopNoteStages, resolveNonstopPlaylogStages, splitNonstopPlaylog } from './nonstop.ts';
import { simulatePlaylog } from './simulate.ts';

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
function presses(chart: ReturnType<typeof stitch>['chart'], miss: (index: number) => boolean): PlaylogInputEvent[] {
  const events: PlaylogInputEvent[] = [];
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
  let playlog: BeMusicPlaylog | undefined;
  await manualPlay(stitched.chart, {
    speed: 16,
    leadInMs: 0,
    audio: false,
    tui: false,
    replayInputs: presses(stitched.chart, miss),
    course: { kind: 'nonstop' },
    recordPlaylog: {},
    onPlaylogRecorded: (recorded) => {
      playlog = recorded;
    },
  });
  return { stitched, playlog: playlog! };
}

describe('NONSTOP play logs', () => {
  test('cuts each stage out of the stitched play with its own notes, inputs and carried state', async () => {
    const { stitched, playlog } = await playStitched((index) => index === 1);
    const noteStages = resolveNonstopNoteStages(stitched.chart, stitched.map, playlog.chart.notes);
    expect(noteStages.filter((stage) => stage === 0)).toHaveLength(3);
    expect(noteStages.filter((stage) => stage === 1)).toHaveLength(4);
    const stages = resolveNonstopPlaylogStages(stitched.map);
    const [first, second] = splitNonstopPlaylog(
      { playlog, stages, noteStages },
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
    const before = simulatePlaylog(
      {
        ...playlog,
        inputs: playlog.inputs.filter((input) => input.timeUs < stages[1]!.windowStartUs),
        play: { ...playlog.play, aborted: true, abortedAtUs: stages[1]!.windowStartUs },
      },
      { ruleset: 'lr2' },
    );
    expect(second!.play.course?.carryIn).toEqual({
      gauge: before.gauge.final,
      combo: before.course?.combo ?? 0,
      maxCombo: before.course?.maxCombo ?? before.maxCombo,
    });
    // A cut-out stage replays on its own.
    expect(simulatePlaylog(second!, { ruleset: 'lr2' }).judge.pgreat).toBe(4);
  });

  test('takes the course result from the stitched play and round-trips through the file format', async () => {
    const { stitched, playlog } = await playStitched();
    const noteStages = resolveNonstopNoteStages(stitched.chart, stitched.map, playlog.chart.notes);
    // The first stage was resolved with a `#RANDOM` draw; the second had no control flow.
    const stages = resolveNonstopPlaylogStages(stitched.map, [[{ command: 'RANDOM', range: 2, value: 1 }], []]);
    expect(stages.map((stage) => stage.randomDraws)).toEqual([[{ command: 'RANDOM', range: 2, value: 1 }], undefined]);
    const split = splitNonstopPlaylog(
      { playlog, stages, noteStages },
      [{ chartFingerprint: 'bmfp0:a' }, { chartFingerprint: 'bmfp0:b' }],
      { ruleset: 'lr2' },
    );
    const log = createCoursePlaylog({
      course: { name: 'Nonstop', kind: 'nonstop', constraints: [], trophies: [] },
      stages: split.map((stageLog) => ({ played: true as const, playlog: stageLog })),
      nonstop: { connections: ['cut'], placement: 'intended', playlog, stages, noteStages },
    });
    const run = simulatePlaylog(playlog, { ruleset: 'lr2' });
    const course = simulateCoursePlaylog(log, { ruleset: 'lr2' });
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
    const parsed = parseCoursePlaylog(serializeCoursePlaylog(log));
    expect(parsed.nonstop).toEqual(log.nonstop);
    expect(() =>
      parseCoursePlaylog({ ...JSON.parse(serializeCoursePlaylog(log)), nonstop: { ...log.nonstop, noteStages: [0] } }),
    ).toThrow(/noteStages/);
    // Ranked on its stitched play, keyed by the stage charts the cut-out stages name.
    expect(checkCoursePlaylogEligibility(log)).toMatchObject({
      eligible: true,
      stages: [],
      nonstop: { playFingerprint: playlog.chart.playFingerprint },
    });
    expect(() =>
      parseCoursePlaylog({
        ...JSON.parse(serializeCoursePlaylog(log)),
        nonstop: {
          ...log.nonstop,
          stages: [{ ...stages[0], randomDraws: [{ command: 'RANDOM', range: 2, value: 3 }] }, stages[1]],
        },
      }),
    ).toThrow(/nonstop\.stages\[0\]\.randomDraws\[0\]\.value/);
  });
});
