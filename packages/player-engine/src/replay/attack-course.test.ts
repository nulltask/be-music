import { expect, test } from 'vite-plus/test';
import { parseChart } from '@be-music/chart-parser';
import { resolveChart } from '@be-music/chart-model';
import { CourseRun, prepareNonstopCourse, buildNonstopCourseReplay, parseLR2CourseFile } from '../course/index.ts';
import { runRecordedPlay } from '../test-support/recorded-play.ts';
import { parseCourseReplay, serializeCourseReplay, simulateCourseReplay } from './course.ts';

const chart = parseChart('#BPM 240\n#00111:01\n#00212:01\n#00313:01', 'bms');
const inputs = (gauge: string) =>
  ['11', '12', '13'].map((channel, index) => ({
    seq: index,
    action: 'down' as const,
    channels: [channel],
    timeUs: (index + 1) * 1000000 + (gauge === 'GROOVE' ? 0 : index === 0 ? 30000 : gauge === 'G-ATTACK' ? 80000 : 0),
  }));

for (const dropped of [false, true]) {
  test(`LR2 course counts a ${dropped ? 'dropped' : 'held'} long note once when checking completion`, async () => {
    const chart = parseChart('#BPM 240\n#LNOBJ ZZ\n#00111:01\n#00211:ZZ', 'bms');
    const definition = parseLR2CourseFile(
      `<courselist><course><title>Long note</title><type>0</type><hash>${'0'.repeat(32)}${'a'.repeat(32)}</hash></course></courselist>`,
    )[0]!;
    const course = new CourseRun(definition, [{ chart, chartPath: 'long.bms' }]);
    const played = await runRecordedPlay(
      chart,
      [
        { seq: 0, action: 'down', channels: ['11'], timeUs: 1080000 },
        { seq: 1, action: 'up', channels: ['11'], timeUs: dropped ? 1400000 : 2020000 },
      ],
      'lr2',
      { gauge: 'G-ATTACK', course: course.nextStage()!.course },
    );
    expect(course.recordStage(played.replay)).toBe('finished');
    const replay = parseCourseReplay(serializeCourseReplay(course.buildReplay()));
    expect(replay.results!.native!).toMatchObject({
      noteCount: 1,
      judge: { good: dropped ? 0 : 1, bad: dropped ? 1 : 0 },
      gauge: { cleared: true },
      lamp: dropped ? 'HARD' : 'FULL_COMBO',
    });
    expect(simulateCourseReplay(replay, { ruleset: 'lr2' }).gauge).toEqual(replay.results!.native!.gauge);
  });
}

for (const gauge of ['P-ATTACK', 'G-ATTACK'] as const)
  for (const kind of ['expert', 'grade'] as const) {
    test(`${gauge} ${kind} course preserves effective selection, stage carry and full replay simulation`, async () => {
      const definition = parseLR2CourseFile(
        `<courselist><course><title>Attack course</title><type>${kind === 'grade' ? 2 : 0}</type><hash>${'0'.repeat(32)}${'a'.repeat(32)}${'b'.repeat(32)}</hash></course></courselist>`,
      )[0]!;
      const run = new CourseRun(definition, [
        { chart, chartPath: 'a.bms' },
        { chart, chartPath: 'b.bms' },
      ]);
      const settings = run.playSettings({
        gauge,
        random1P: 'OFF',
        random2P: 'OFF',
        hiddenSudden1P: 'OFF',
        hiddenSudden2P: 'OFF',
        autoScratch1P: false,
        autoScratch2P: false,
        dpFlip: false,
        tempo: 1,
      });
      const effective = kind === 'grade' && gauge === 'G-ATTACK' ? 'GROOVE' : gauge;
      expect(settings.gauge).toBe(effective);
      for (let index = 0; index < 2; index++) {
        const stage = run.nextStage()!;
        if (index === 1) expect(stage.course.carryIn?.gauge).toBeCloseTo(effective === 'GROOVE' ? 100 : 99.2);
        const played = await runRecordedPlay(stage.stage.chart, inputs(effective), 'lr2', {
          gauge: settings.gauge,
          course: stage.course,
        });
        expect(played.replay.play.gauge).toBe(effective);
        expect(run.recordStage(played.replay)).toBe(index === 0 ? 'next' : 'finished');
      }
      const replay = parseCourseReplay(serializeCourseReplay(run.buildReplay()));
      const native = replay.results!.native!;
      expect(native.gauge.final).toBeCloseTo(effective === 'GROOVE' ? 100 : 98.4);
      expect(native.gauge.type).toBe(effective === 'GROOVE' ? 'GRADE' : gauge);
      expect(native).toMatchObject({ stagesPlayed: 2, lamp: 'FULL_COMBO', gauge: { cleared: true } });
      const simulated = simulateCourseReplay(replay, { ruleset: 'lr2' });
      expect(simulated.judge).toEqual(native.judge);
      expect(simulated.gauge).toEqual(native.gauge);
      expect(simulated.lamp).toBe(native.lamp);
      if (replay.stages[1]!.played) replay.stages[1]!.replay.play.course!.carryIn!.gauge = 5;
      expect(simulateCourseReplay(replay, { ruleset: 'lr2' }).gauge).toEqual(native.gauge);
    });
  }

test('G.ATTACK NONSTOP records and re-simulates one continuous gauge across both stages', async () => {
  const definition = parseLR2CourseFile(
    `<courselist><course><title>Attack NONSTOP</title><type>1</type><hash>${'0'.repeat(32)}${'a'.repeat(32)}${'b'.repeat(32)}</hash></course></courselist>`,
  )[0]!;
  const prepared = prepareNonstopCourse(
    [
      { chart, chartPath: 'a.bms' },
      { chart, chartPath: 'b.bms' },
    ],
    { constraints: [], connections: ['blank2'], random: () => 0 },
  );
  if (!prepared.ok) throw new Error(prepared.reason);
  const input = resolveChart(prepared.course.chart).notes.flatMap((note, index) => {
    const timeUs = Math.round(note.seconds * 1000000) + (index % 3 === 0 ? 30000 : 80000);
    return [
      { seq: index * 2, action: 'down' as const, channels: [note.channel], timeUs },
      { seq: index * 2 + 1, action: 'up' as const, channels: [note.channel], timeUs: timeUs + 20000 },
    ];
  });
  const run = await runRecordedPlay(prepared.course.chart, input, 'lr2', {
    gauge: 'G-ATTACK',
    course: { kind: 'nonstop' },
  });
  expect(run.summary).toMatchObject({ great: 2, good: 4 });
  expect(run.summary.gauge!.current).toBeCloseTo(98.4);
  const replay = parseCourseReplay(
    serializeCourseReplay(buildNonstopCourseReplay(definition, prepared.course, run.replay)),
  );
  expect(replay.nonstop!.stitch).toBe(2);
  const native = replay.results!.native!;
  const simulated = simulateCourseReplay(replay, { ruleset: 'lr2' });
  expect(native).toMatchObject({ stagesPlayed: 2, gauge: { type: 'G-ATTACK', cleared: true }, lamp: 'FULL_COMBO' });
  expect(simulated.gauge).toEqual(native.gauge);
  expect(simulated.judge).toEqual(native.judge);
});
