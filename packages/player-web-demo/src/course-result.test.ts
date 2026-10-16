import { createEmptyJson } from '@be-music/json';
import { parseBeatorajaCourseData, type NonstopConnection } from '@be-music/player/course';
import type {
  BeMusicCoursePlaylog,
  BeMusicPlaylog,
  PlaylogCourseResult,
  PlaylogRulesetResult,
} from '@be-music/player/playlog';
import type { BrowserCourseEntry, BrowserSongEntry } from '@be-music/player-web/collection';
import type { BeMusicSongRecord } from '@be-music/player-web/skin';
import { describe, expect, test } from 'vite-plus/test';
import {
  buildCourseResultData,
  buildCourseResultSummary,
  courseRecordKey,
  joinCourseStageHistories,
  lookupCourseRecord,
  resolveResultPresentation,
  skipsCourseStageResult,
} from './course-result.ts';

const MD5 = ['1', '2', '3'].map((digit) => digit.repeat(32));

function song(id: string): BrowserSongEntry {
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

function course(constraint: string[] = ['MIRROR', 'GAUGE_LR2', 'NO_SPEED', 'HCN']): BrowserCourseEntry {
  const definition = parseBeatorajaCourseData({ name: 'Dan', hash: MD5.map((md5) => ({ md5 })), constraint })!;
  return {
    id: 'dan#0',
    definition,
    stages: ['a', 'b', 'c'].map((id) => ({ title: id, song: song(id) })),
    playable: true,
  };
}

function stageLog(native: Partial<PlaylogRulesetResult>): BeMusicPlaylog {
  return {
    results: {
      native: {
        ruleset: 'be-music/native',
        judge: { pgreat: 10, great: 0, good: 0, bad: 0, poor: 0, emptyPoor: 0 },
        fast: 0,
        slow: 0,
        exScore: 20,
        noteCount: 10,
        maxCombo: 10,
        gauge: { type: 'GRADE', final: 90, cleared: true },
        course: { combo: 10, maxCombo: 10 },
        ...native,
      },
    },
  } as unknown as BeMusicPlaylog;
}

describe('courseRecordKey', () => {
  test('courseRecordKey is stable across constraint order', () => {
    const a = courseRecordKey(course(['MIRROR', 'GAUGE_LR2']));
    expect(a).toBe(courseRecordKey(course(['GAUGE_LR2', 'MIRROR'])));
    expect(a).toBe(`course:grade:gauge_lr2+grade_mirror:${MD5.join(',')}`);
  });

  test('courseRecordKey keys a NONSTOP course by its connections and placement', () => {
    const base = course([]);
    const nonstop = (connections: NonstopConnection[]): BrowserCourseEntry => ({
      ...base,
      definition: { ...base.definition, kind: 'nonstop', connections },
    });
    const key = courseRecordKey(nonstop(['fade', 'cut', 'blank1']), 'intended');
    expect(key).toBe(courseRecordKey(nonstop(['fade', 'cut', 'blank1', 'blank2']), 'intended'));
    expect(key).not.toBe(courseRecordKey(nonstop(['cut', 'cut', 'blank1']), 'intended'));
    expect(key).not.toBe(courseRecordKey(nonstop(['fade', 'cut', 'blank1']), 'lr2'));
    // Other course kinds have no connections, so the placement does not split them.
    expect(courseRecordKey(base, 'lr2')).toBe(courseRecordKey(base));
  });
});

describe('buildCourseResultSummary', () => {
  test('reads the course result as one run', () => {
    const summary = buildCourseResultSummary({
      ruleset: 'beatoraja',
      judge: { pgreat: 50, great: 20, good: 5, bad: 2, poor: 3, emptyPoor: 1 },
      fast: 7,
      slow: 9,
      exScore: 120,
      noteCount: 90,
      missCount: 16,
      maxCombo: 40,
      djLevel: 'B',
      gauge: { type: 'CLASS', final: 36.5, cleared: true },
      stagesPlayed: 3,
      lamp: 'NORMAL',
      stages: [],
    });
    expect(summary).toMatchObject({
      total: 90,
      perfect: 50,
      great: 20,
      good: 5,
      bad: 2,
      poor: 3,
      emptyPoor: 1,
      fast: 7,
      slow: 9,
      exScore: 120,
      score: 120,
      gauge: { type: 'CLASS', current: 36.5, cleared: true },
      course: { maxCombo: 40 },
    });
  });
});

describe('buildCourseResultData', () => {
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
    stages: [],
  };
  const courseLog = (judgeRuleset?: 'lr2' | 'beatoraja'): BeMusicCoursePlaylog => {
    const playlog = stageLog({});
    playlog.play = { mode: 'manual', autoScratch: false, gauge: 'GROOVE', ...(judgeRuleset ? { judgeRuleset } : {}) };
    return { stages: [{ played: true, playlog }] } as unknown as BeMusicCoursePlaylog;
  };

  test('shows LR2 courses on the stage results’ 200000 scale and the stages’ play time', () => {
    const data = buildCourseResultData(course([]), result, courseLog(), undefined, { playSeconds: 241.5 });
    expect(data.score).toMatchObject({ exScore: 72, score: 200000 });
    expect(data.playSeconds).toBe(241.5);
    expect(data.courseResult).toBe(true);
  });

  test('keeps the EX score where the ruleset scores with it', () => {
    expect(buildCourseResultData(course([]), result, courseLog('beatoraja')).score.score).toBe(72);
  });

  test('reads a NONSTOP run as one play, timed by the stitched play', () => {
    const base = course([]);
    const nonstop: BrowserCourseEntry = { ...base, definition: { ...base.definition, kind: 'nonstop' } };
    const data = buildCourseResultData(nonstop, result, courseLog(), {
      gaugeHistory: [],
      scoreHistory: [],
      playSeconds: 180,
    });
    expect(data.playSeconds).toBe(180);
    expect(data.courseResult).toBeUndefined();
  });
});

describe('skipsCourseStageResult', () => {
  test('skips every stage result when stage results are skipped', () => {
    expect(skipsCourseStageResult({ skipStageResults: true, autoPlay: false, courseGoesOn: false })).toBe(true);
  });

  test('skips an auto-played stage the course goes on after, as LR2 does, but not the last one', () => {
    expect(skipsCourseStageResult({ skipStageResults: false, autoPlay: true, courseGoesOn: true })).toBe(true);
    expect(skipsCourseStageResult({ skipStageResults: false, autoPlay: true, courseGoesOn: false })).toBe(false);
    expect(skipsCourseStageResult({ skipStageResults: false, autoPlay: false, courseGoesOn: true })).toBe(false);
  });
});

describe('lookupCourseRecord', () => {
  const dan = (): BrowserCourseEntry => {
    const entry = course(['MIRROR']);
    return {
      ...entry,
      definition: {
        ...entry.definition,
        trophies: [
          { name: 'bronzemedal', missRate: 10, scoreRate: 50 },
          { name: 'goldmedal', missRate: 2.5, scoreRate: 85 },
        ],
      },
    };
  };

  test('reads the record kept under the course key, with the trophy its bests earn', () => {
    const records = new Map<string, BeMusicSongRecord>([
      [courseRecordKey(dan()), { lamp: 'FAILED', exScore: 52, missCount: 0 }],
    ]);
    // 30 notes: 52 / 60 = 86.7 % score, no BP. beatoraja grants trophies on the bests, cleared or not.
    expect(lookupCourseRecord(dan(), records)).toEqual({
      lamp: 'FAILED',
      exScore: 52,
      missCount: 0,
      trophy: 'goldmedal',
    });
    records.set(courseRecordKey(dan()), { lamp: 'NORMAL', exScore: 40, missCount: 3 });
    expect(lookupCourseRecord(dan(), records)?.trophy).toBe('bronzemedal');
  });

  test('has no record for a course never played, a random course or a NEW COURSE bar', () => {
    const records = new Map([[courseRecordKey(dan()), { lamp: 'HARD' as const }]]);
    expect(lookupCourseRecord(course(['GAUGE_LR2']), records)).toBeUndefined();
    expect(lookupCourseRecord({ ...dan(), newCourse: true }, records)).toBeUndefined();
    const random = { ...dan(), random: { name: 'r', stages: [], constraints: [], trophies: [] } };
    expect(lookupCourseRecord(random as unknown as BrowserCourseEntry, records)).toBeUndefined();
    expect(lookupCourseRecord(dan(), records)).toEqual({ lamp: 'HARD' });
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

describe('resolveResultPresentation', () => {
  test('shows a course run on the course-result skin with the course jingles and no retry', () => {
    expect(resolveResultPresentation('course')).toEqual({
      courseResultSkin: true,
      courseJingles: true,
      quickRetry: false,
    });
  });

  test('shows a NONSTOP run as LR2 does: the result skin, the clear / fail jingles and quick retry', () => {
    expect(resolveResultPresentation('nonstop')).toEqual({
      courseResultSkin: false,
      courseJingles: false,
      quickRetry: true,
    });
  });

  test('offers quick retry on a single play only, not on a course stage', () => {
    expect(resolveResultPresentation('single').quickRetry).toBe(true);
    expect(resolveResultPresentation('stage').quickRetry).toBe(false);
  });
});
