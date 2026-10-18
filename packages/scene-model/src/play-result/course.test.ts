import { createEmptyJson } from '@be-music/json';
import { parseBeatorajaCourseData } from '@be-music/player/course';
import type { BeMusicCoursePlaylog, BeMusicPlaylog, PlaylogCourseResult } from '@be-music/player/playlog';
import { describe, expect, test } from 'vite-plus/test';
import type { LibraryChart, LibraryCourse } from '../library/entries.ts';
import { joinCourseStageHistories, playResultFromCourseRun } from './course.ts';

const MD5 = ['1', '2', '3'].map((digit) => digit.repeat(32));

function chart(id: string): LibraryChart {
  return {
    id,
    sourceId: 'drop1',
    sourceLabel: 'pack',
    sourceKind: 'directory',
    chartPath: `${id}.bms`,
    directoryLabel: 'pack',
    fileLabel: `${id}.bms`,
    title: id,
    totalNotes: 10,
    chart: createEmptyJson('bms'),
  };
}

function course(kind?: 'nonstop'): LibraryCourse {
  const definition = parseBeatorajaCourseData({ name: 'Dan', hash: MD5.map((md5) => ({ md5 })), constraint: [] })!;
  return {
    id: 'dan#0',
    definition: kind === undefined ? definition : { ...definition, kind },
    stages: ['a', 'b', 'c'].map((id) => ({ title: id, chart: chart(id) })),
    playable: true,
  };
}

describe('playResultFromCourseRun', () => {
  const result: PlaylogCourseResult = {
    ruleset: 'lr2',
    judge: { pgreat: 36, great: 0, good: 0, bad: 0, poor: 0, emptyPoor: 0 },
    fast: 0,
    slow: 0,
    exScore: 72,
    noteCount: 36,
    missCount: 0,
    maxCombo: 36,
    djLevel: 'AAA',
    gauge: { type: 'GRADE', final: 100, cleared: true },
    stagesPlayed: 3,
    lamp: 'MAX',
    trophy: 'goldmedal',
    stages: [],
  };
  const courseLog = (judgeRuleset?: 'lr2' | 'beatoraja'): BeMusicCoursePlaylog => {
    const playlog = {
      play: { mode: 'manual', autoScratch: false, gauge: 'GROOVE', ...(judgeRuleset ? { judgeRuleset } : {}) },
    } as unknown as BeMusicPlaylog;
    return { stages: [{ played: true, playlog }] } as unknown as BeMusicCoursePlaylog;
  };

  test('shows an LR2 course on the stage results’ 200000 scale, with the stages’ play time, as a course run', () => {
    const data = playResultFromCourseRun(course(), result, courseLog(), undefined, { playSeconds: 241.5 });
    expect(data.score).toMatchObject({ exScore: 72, score: 200000, total: 36, perfect: 36 });
    expect(data.playSeconds).toBe(241.5);
    expect(data.run).toBe('course');
    expect(data.lamp).toBe('MAX');
    expect(data.judgeRuleset).toBe('lr2');
  });

  test('names the course in the song panel and carries the course view and the stages reached', () => {
    const data = playResultFromCourseRun(course(), result, courseLog());
    expect(data.song).toMatchObject({ id: 'course:dan#0', title: 'Dan', subtitle: '3 / 3 STAGES · goldmedal' });
    expect(data.course).toMatchObject({ kind: 'expert', title: 'Dan' });
    expect(data.course?.stageIndex).toBeUndefined();
    expect(data.courseRun).toEqual({ stagesPlayed: 3, trophy: 'goldmedal' });
  });

  test('keeps the EX score where the ruleset scores with it', () => {
    expect(playResultFromCourseRun(course(), result, courseLog('beatoraja')).score.score).toBe(72);
  });

  test('reads a NONSTOP run as one play, timed by the stitched play', () => {
    const data = playResultFromCourseRun(course('nonstop'), result, courseLog(), {
      gaugeHistory: [{ progress: 1, value: 50 }],
      scoreHistory: [],
      playSeconds: 180,
    });
    expect(data.playSeconds).toBe(180);
    expect(data.run).toBe('nonstop');
    expect(data.gaugeHistory).toEqual([{ progress: 1, value: 50 }]);
  });

  test('keeps every stage graph for a joined course graph', () => {
    const stage = { gaugeHistory: [{ progress: 0, value: 100 }], scoreHistory: [] };
    const data = playResultFromCourseRun(course(), result, courseLog(), stage, { stageHistories: [stage, stage] });
    expect(data.courseRun?.stageHistories).toEqual([stage, stage]);
  });
});

describe('joinCourseStageHistories', () => {
  test('lays the stages side by side by length, the EX score running on, an unreached stage at gauge 0', () => {
    const joined = joinCourseStageHistories(
      [
        {
          gaugeHistory: [
            { progress: 0, value: 100 },
            { progress: 1, value: 60 },
          ],
          scoreHistory: [
            { progress: 0, exScore: 0 },
            { progress: 1, exScore: 30 },
          ],
        },
        {
          gaugeHistory: [
            { progress: 0, value: 60 },
            { progress: 1, value: 10 },
          ],
          scoreHistory: [
            { progress: 0, exScore: 0 },
            { progress: 1, exScore: 10 },
          ],
        },
      ],
      [2, 1, 1],
    );
    expect(joined.gaugeHistory).toEqual([
      { progress: 0, value: 100 },
      { progress: 0.5, value: 60 },
      { progress: 0.5, value: 60 },
      { progress: 0.75, value: 10 },
      { progress: 0.75, value: 0 },
      { progress: 1, value: 0 },
    ]);
    expect(joined.scoreHistory).toEqual([
      { progress: 0, exScore: 0 },
      { progress: 0.5, exScore: 30 },
      { progress: 0.5, exScore: 30 },
      { progress: 0.75, exScore: 40 },
      { progress: 0.75, exScore: 40 },
      { progress: 1, exScore: 40 },
    ]);
  });

  test('shares the width evenly when no stage has a length', () => {
    const joined = joinCourseStageHistories([], [0, 0]);
    expect(joined.gaugeHistory.map((sample) => sample.progress)).toEqual([0, 0.5, 0.5, 1]);
  });
});
