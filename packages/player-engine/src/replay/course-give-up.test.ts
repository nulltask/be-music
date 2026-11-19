import { expect, test } from 'vite-plus/test';
import { parseChart } from '@be-music/chart-parser';
import { CourseRun, parseLR2CourseFile } from '../course/index.ts';
import type { RulesetId } from '../ruleset/index.ts';
import { runRecordedPlay } from '../test-support/recorded-play.ts';
import { parseCourseReplay, serializeCourseReplay, simulateCourseReplay } from './course.ts';
import type { BeMusicReplay } from './format.ts';
import { simulateReplay } from './simulate.ts';

/** Three notes, one a second (BPM 240 plays a measure a second). */
const chart = parseChart('#BPM 240\n#00111:01\n#00212:01\n#00313:01', 'bms');
const everyNote = ['11', '12', '13'].flatMap((channel, index) => [
  { seq: index * 2, action: 'down' as const, channels: [channel], source: 0, timeUs: (index + 1) * 1_000_000 },
  {
    seq: index * 2 + 1,
    action: 'up' as const,
    channels: [channel],
    source: 0,
    timeUs: (index + 1) * 1_000_000 + 50_000,
  },
]);

/**
 * The stage log the engine writes for a stage given up with ESC at `atUs`: its inputs up to there, marked aborted, with
 * the result the stage stood at.
 */
function givenUpAt(replay: BeMusicReplay, atUs: number, ruleset: RulesetId): BeMusicReplay {
  const log: BeMusicReplay = {
    ...replay,
    inputs: replay.inputs.filter((input) => input.timeUs <= atUs),
    play: { ...replay.play, aborted: true, abortedAtUs: atUs },
  };
  return { ...log, results: { native: simulateReplay(log, { ruleset }) } };
}

const definition = parseLR2CourseFile(
  `<courselist><course><title>Give up</title><type>0</type><hash>${'0'.repeat(32)}${'a'.repeat(32)}${'b'.repeat(32)}</hash></course></courselist>`,
)[0]!;

for (const ruleset of ['lr2', 'beatoraja'] as const) {
  test(`a stage given up ${ruleset === 'lr2' ? 'goes on to the next stage on LR2' : 'ends the run on beatoraja'}'s course gauge, and the course replay re-simulates the run`, async () => {
    const run = new CourseRun(definition, [
      { chart, chartPath: 'a.bms' },
      { chart, chartPath: 'b.bms' },
    ]);
    const first = run.nextStage()!;
    const played = await runRecordedPlay(chart, everyNote, ruleset, { gauge: 'GROOVE', course: first.course });
    // Given up after the first note, a PGREAT: the gauge holds.
    const givenUp = givenUpAt(played.replay, 1_500_000, ruleset);
    expect(givenUp.results!.native!.judge.pgreat).toBe(1);
    expect(run.giveUp(givenUp)).toBe(ruleset === 'lr2' ? 'next' : 'finished');
    if (ruleset === 'lr2') {
      const second = run.nextStage()!;
      // The next stage starts from the gauge the stage was given up at.
      expect(second.course.carryIn?.gauge).toBe(givenUp.results!.native!.gauge.final);
      const next = await runRecordedPlay(chart, everyNote, ruleset, { gauge: 'GROOVE', course: second.course });
      expect(run.recordStage(next.replay)).toBe('finished');
    }
    const courseLog = parseCourseReplay(serializeCourseReplay(run.buildReplay()));
    const native = courseLog.results!.native!;
    // A stage was given up, so the course is FAILED either way.
    expect(native).toMatchObject({
      stagesPlayed: ruleset === 'lr2' ? 2 : 1,
      lamp: 'FAILED',
      gauge: { cleared: false },
    });
    const simulated = simulateCourseReplay(courseLog, { ruleset });
    expect(simulated.stagesPlayed).toBe(native.stagesPlayed);
    expect(simulated.judge).toEqual(native.judge);
    expect(simulated.gauge).toEqual(native.gauge);
    expect(simulated.lamp).toBe(native.lamp);
  });
}
