import { describe, expect, it } from 'vite-plus/test';
import type { SceneCourseInfo } from '../course-info.ts';
import {
  resolveBeatorajaCourseConstraintOps,
  resolveBeatorajaCourseStageOps,
  resolveBeatorajaCourseText,
} from './course.ts';

function course(stageCount: number, stageIndex?: number): SceneCourseInfo {
  return {
    kind: 'grade',
    title: 'Dan',
    stages: Array.from({ length: stageCount }, (_, index) => ({ title: `Song ${index + 1}` })),
    ...(stageIndex !== undefined ? { stageIndex } : {}),
  };
}

describe('resolveBeatorajaCourseConstraintOps', () => {
  it('lights one GRADEBAR op per constraint', () => {
    expect(resolveBeatorajaCourseConstraintOps(['grade_mirror', 'gauge_lr2', 'no_speed', 'hcn'])).toEqual([
      1003, 1010, 1005, 1017,
    ]);
    expect(resolveBeatorajaCourseConstraintOps(['grade', 'grade_random', 'no_good', 'no_great'])).toEqual([
      1002, 1004, 1006, 1007,
    ]);
    expect(resolveBeatorajaCourseConstraintOps(['gauge_5k', 'gauge_7k', 'gauge_9k', 'gauge_24k', 'ln', 'cn'])).toEqual([
      1011, 1012, 1013, 1014, 1015, 1016,
    ]);
    expect(resolveBeatorajaCourseConstraintOps([])).toEqual([]);
  });
});

describe('resolveBeatorajaCourseStageOps', () => {
  it('lights MODE_COURSE and the stage op', () => {
    expect(resolveBeatorajaCourseStageOps(course(4, 0))).toEqual([290, 280]);
    expect(resolveBeatorajaCourseStageOps(course(4, 2))).toEqual([290, 282]);
    expect(resolveBeatorajaCourseStageOps(course(4, 3))).toEqual([290, 289]);
    expect(resolveBeatorajaCourseStageOps(course(6, 3))).toEqual([290, 283]);
  });

  it('has no stage op past the fourth stage unless it is the last', () => {
    expect(resolveBeatorajaCourseStageOps(course(6, 4))).toEqual([290]);
    expect(resolveBeatorajaCourseStageOps(course(6, 5))).toEqual([290, 289]);
  });

  it('lights only MODE_COURSE without a stage (course result)', () => {
    expect(resolveBeatorajaCourseStageOps(course(4))).toEqual([290]);
  });
});

describe('resolveBeatorajaCourseText', () => {
  it('reads the stage titles on 150-159', () => {
    expect(resolveBeatorajaCourseText(150, course(3))).toBe('Song 1');
    expect(resolveBeatorajaCourseText(152, course(3))).toBe('Song 3');
    expect(resolveBeatorajaCourseText(153, course(3))).toBe('');
    expect(resolveBeatorajaCourseText(159, course(10))).toBe('Song 10');
    expect(resolveBeatorajaCourseText(10, course(3))).toBeUndefined();
    expect(resolveBeatorajaCourseText(160, course(3))).toBeUndefined();
  });

  it('marks a missing stage on the select screen', () => {
    expect(resolveBeatorajaCourseText(151, course(3), { missingStages: new Set([1]) })).toBe('(no song) Song 2');
  });
});
