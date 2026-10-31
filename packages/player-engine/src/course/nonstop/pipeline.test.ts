import { computeChartFingerprint, computePlayFingerprint, resolveChart } from '@be-music/chart-model';
import { createEmptyJSON, type BeMusicJSON } from '@be-music/chart-source';
import { parseChart } from '@be-music/chart-parser';
import { describe, expect, test } from 'vite-plus/test';
import { manualPlay } from '../../index.ts';
import type { BeMusicReplay, ReplayInputEvent } from '../../replay/format.ts';
import { simulateCourseReplay } from '../../replay/course.ts';
import { parseBeatorajaCourseData } from '../beatoraja.ts';
import {
  buildNonstopCourseReplay,
  prepareNonstopCourse,
  resolveNonstopRun,
  type NonstopCourseStage,
  type PreparedNonstopCourse,
} from './pipeline.ts';

const bms = (...lines: string[]) => parseChart(lines.join('\n'), 'bms');

/**
 * Two stages at 240 BPM (1 s a measure). The first rolls a `#RANDOM` for its last note's lane; the second ends on a long
 * note.
 */
const STAGES: NonstopCourseStage[] = [
  {
    chart: bms(
      '#BPM 240',
      '#WAV01 a.wav',
      '#00111:0101',
      '#RANDOM 2',
      '#IF 1',
      '#00212:01',
      '#ENDIF',
      '#IF 2',
      '#00213:01',
      '#ENDIF',
    ),
    chartPath: 'a/a.bms',
    facts: { title: 'A', sha256: 'a'.repeat(64), md5: 'a'.repeat(32) },
  },
  {
    chart: bms('#BPM 240', '#WAV01 b.wav', '#LNOBJ ZZ', '#00211:00010001', '#00312:01ZZ'),
    chartPath: 'b/b.bms',
    facts: { title: 'B', subtitle: '[ANOTHER]', md5: 'b'.repeat(32) },
  },
];

const DEFINITION = {
  ...parseBeatorajaCourseData({ name: 'Nonstop', hash: [{ md5: 'a'.repeat(32) }] })!,
  kind: 'nonstop' as const,
};

function prepare(options: Partial<Parameters<typeof prepareNonstopCourse>[1]> = {}): PreparedNonstopCourse {
  const prepared = prepareNonstopCourse(STAGES, {
    constraints: ['hcn'],
    connections: ['cut'],
    random: () => 0,
    ...options,
  });
  if (!prepared.ok) throw new Error(`prepare failed: ${prepared.reason}`);
  return prepared.course;
}

/** Presses every note of `chart` dead on, up to `untilUs`. */
function presses(chart: BeMusicJSON, untilUs = Number.POSITIVE_INFINITY): ReplayInputEvent[] {
  const events: ReplayInputEvent[] = [];
  for (const note of resolveChart(chart).notes) {
    const timeUs = Math.round(note.seconds * 1_000_000);
    if (timeUs >= untilUs) continue;
    const upUs = note.endSeconds !== undefined ? Math.round(note.endSeconds * 1_000_000) : timeUs + 40_000;
    events.push({ seq: 0, timeUs, action: 'down', channels: [note.channel] });
    events.push({ seq: 0, timeUs: upUs, action: 'up', channels: [note.channel] });
  }
  return events.sort((left, right) => left.timeUs - right.timeUs).map((event, seq) => ({ ...event, seq }));
}

async function play(course: PreparedNonstopCourse, untilUs?: number): Promise<BeMusicReplay> {
  let recorded: BeMusicReplay | undefined;
  await manualPlay(course.chart, {
    speed: 16,
    leadInMs: 0,
    audio: false,
    tui: false,
    replayInputs: presses(course.chart, untilUs),
    course: { kind: 'nonstop' },
    recordReplay: {},
    onReplayRecorded: (replay) => {
      recorded = replay;
    },
  });
  if (untilUs !== undefined) {
    recorded!.play.aborted = true;
    recorded!.play.abortedAtUs = untilUs;
  }
  return recorded!;
}

describe('prepareNonstopCourse', () => {
  test('resolves each stage with its draws, applies the long-note constraint and stitches the stages', () => {
    let seen: readonly BeMusicJSON[] = [];
    const course = prepare({
      title: 'Nonstop',
      assetPath: (stageCharts) => {
        seen = stageCharts;
        return (stage, _kind, path) => `s${stage}/${path}`;
      },
    });
    expect(course).toMatchObject({ connections: ['cut'], placement: 'intended', stitch: 3 });
    expect(course.stageDraws).toEqual([[{ command: 'RANDOM', range: 2, value: 1 }], []]);
    // The stage charts as played: control flow resolved and HCN applied.
    expect(course.stageCharts.map((chart) => chart.sourceFormat === 'bms' && chart.bms.lnMode)).toEqual([3, 3]);
    expect(course.stageCharts[0]!.bms.controlFlow).toEqual([]);
    expect(seen).toEqual(course.stageCharts);
    expect(Object.values(course.chart.resources.wav).sort()).toEqual(['s0/a.wav', 's1/b.wav']);
    expect(course.chart.metadata.title).toBe('Nonstop');
    expect(course.map.stages).toHaveLength(2);
  });

  test('rebuilds the same chart from the recorded draws', () => {
    const drawn = prepare({ random: () => 0.99 });
    expect(drawn.stageDraws[0]).toEqual([{ command: 'RANDOM', range: 2, value: 2 }]);
    const rebuilt = prepareNonstopCourse(
      STAGES.map((stage, index) => ({ chart: stage.chart, randomDraws: drawn.stageDraws[index]! })),
      { constraints: ['hcn'], connections: ['cut'] },
    );
    if (!rebuilt.ok) throw new Error(rebuilt.reason);
    const fingerprint = (chart: BeMusicJSON) => computePlayFingerprint(chart, { chartPath: undefined });
    expect(fingerprint(rebuilt.course.chart)).toBe(fingerprint(drawn.chart));
    expect(fingerprint(rebuilt.course.chart)).not.toBe(fingerprint(prepare().chart));
  });

  test('refuses what it cannot stitch, naming the stage', () => {
    expect(
      prepareNonstopCourse([STAGES[0]!, { chart: createEmptyJSON('bmson') }], {
        constraints: [],
        connections: [],
        placement: 'lr2',
      }),
    ).toEqual({
      ok: false,
      reason: 'bmson',
      stage: 1,
    });
    expect(prepareNonstopCourse(STAGES, { constraints: [], connections: [], stitch: 99 })).toEqual({
      ok: false,
      reason: 'stitch-version',
    });
    expect(prepareNonstopCourse([], { constraints: [], connections: [] })).toEqual({ ok: false, reason: 'no-stage' });
    const broken = { chart: { sourceFormat: 'bms' } as unknown as BeMusicJSON };
    expect(prepareNonstopCourse([STAGES[0]!, broken], { constraints: [], connections: [] })).toEqual({
      ok: false,
      reason: 'stage-chart',
      stage: 1,
    });
  });
});

describe('buildNonstopCourseReplay', () => {
  test('records the stitched play with each stage cut out of it, named by its chart', async () => {
    const course = prepare();
    const replay = await play(course);
    const log = buildNonstopCourseReplay(DEFINITION, course, replay, {
      createdAt: '2026-10-16T00:00:00.000Z',
      recorder: { name: 'test' },
    });
    expect(log).toMatchObject({
      createdAt: '2026-10-16T00:00:00.000Z',
      recorder: { name: 'test' },
      course: { name: 'Nonstop', kind: 'nonstop', constraints: [] },
    });
    expect(log.nonstop).toMatchObject({ connections: ['cut'], placement: 'intended', stitch: 3 });
    expect(log.nonstop!.stages[0]!.randomDraws).toEqual([{ command: 'RANDOM', range: 2, value: 1 }]);
    expect(log.stages.map((entry) => entry.played)).toEqual([true, true]);
    const [first, second] = log.stages;
    // Each stage names its chart as loaded, which keys the course on the Leaderboard.
    expect(first!.played && first!.replay.chart).toMatchObject({
      title: 'A',
      sha256: 'a'.repeat(64),
      chartFingerprint: computeChartFingerprint(STAGES[0]!.chart, { chartPath: 'a/a.bms' }),
    });
    expect(second!.played && second!.replay.chart).toMatchObject({ title: 'B', subtitle: '[ANOTHER]' });
    expect(log.results?.native).toMatchObject({ noteCount: 6, stagesPlayed: 2 });
    expect(simulateCourseReplay(log, { ruleset: 'lr2' })).toMatchObject({ noteCount: 6, missCount: 0 });
  });

  test('lists a stage the run never reached with its facts, hashes and chart fingerprint', async () => {
    const course = prepare();
    const log = buildNonstopCourseReplay(DEFINITION, course, await play(course, 1_500_000));
    expect(log.stages[0]).toMatchObject({ played: true });
    expect(log.stages[1]).toEqual({
      played: false,
      facts: expect.objectContaining({ sourceFormat: 'bms', lnMode: 3 }),
      md5: 'b'.repeat(32),
      chartFingerprint: computeChartFingerprint(STAGES[1]!.chart, { chartPath: 'b/b.bms' }),
    });
    expect(simulateCourseReplay(log, { ruleset: 'lr2' })).toMatchObject({ lamp: 'FAILED', stagesPlayed: 1 });
  });
});

describe('resolveNonstopRun', () => {
  test('gives the run a rebuild from the stage charts and the recorded draws must match', async () => {
    const course = prepare();
    const replay = await play(course);
    const log = buildNonstopCourseReplay(DEFINITION, course, replay);
    const rebuilt = prepareNonstopCourse(
      STAGES.map((stage, index) => ({
        chart: stage.chart,
        randomDraws: log.nonstop!.stages[index]!.randomDraws ?? [],
      })),
      { constraints: ['hcn'], connections: log.nonstop!.connections, placement: log.nonstop!.placement },
    );
    if (!rebuilt.ok) throw new Error(rebuilt.reason);
    expect(resolveNonstopRun(rebuilt.course, replay)).toEqual(log.nonstop);
  });
});
