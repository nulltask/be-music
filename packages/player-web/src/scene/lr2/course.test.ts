import { describe, expect, it } from 'vite-plus/test';
import type { SceneCourseInfo } from '../course-info.ts';
import {
  lr2ShowsCourseCombo,
  resolveLr2JudgeCombo,
  resolveLr2CourseConnectionText,
  resolveLr2CourseDraftInfo,
  resolveLr2CourseMakerAction,
  resolveLr2CourseMakerButtonState,
  resolveLr2CourseMakerOps,
  resolveLr2CourseMakerText,
  resolveLr2CourseNumber,
  resolveLr2CourseOps,
  resolveLr2CourseText,
  resolveLr2NonstopStage,
} from './course.ts';

function course(stageCount: number, stageIndex?: number, kind: SceneCourseInfo['kind'] = 'grade'): SceneCourseInfo {
  return {
    kind,
    title: 'Dan',
    stages: Array.from({ length: stageCount }, (_, index) => ({
      title: `Song ${index + 1}`,
      ...(index === 0 ? { subtitle: '[ANOTHER]' } : {}),
      level: 10 + index,
    })),
    ...(stageIndex !== undefined ? { stageIndex } : {}),
  };
}

describe('resolveLr2CourseOps', () => {
  it('lights the course and kind ops on the select screen', () => {
    expect(resolveLr2CourseOps(course(4))).toEqual([290, 293]);
    expect(resolveLr2CourseOps(course(4, undefined, 'nonstop'))).toEqual([290, 291]);
    expect(resolveLr2CourseOps(course(4, undefined, 'expert'))).toEqual([290, 292]);
  });

  it('lights 280 + index for a stage that is not the last, 289 for the last', () => {
    expect(resolveLr2CourseOps(course(4, 0))).toEqual([290, 293, 280]);
    expect(resolveLr2CourseOps(course(4, 2))).toEqual([290, 293, 282]);
    expect(resolveLr2CourseOps(course(4, 3))).toEqual([290, 293, 289]);
    expect(resolveLr2CourseOps(course(1, 0))).toEqual([290, 293, 289]);
  });

  it('has no stage op past the ninth stage unless it is the last', () => {
    expect(resolveLr2CourseOps(course(10, 8))).toEqual([290, 293, 288]);
    expect(resolveLr2CourseOps(course(11, 9))).toEqual([290, 293]);
    expect(resolveLr2CourseOps(course(10, 9))).toEqual([290, 293, 289]);
  });
});

describe('resolveLr2CourseNumber', () => {
  it('reads the stage levels on 250-259', () => {
    expect(resolveLr2CourseNumber(250, course(3))).toBe(10);
    expect(resolveLr2CourseNumber(252, course(3))).toBe(12);
    expect(resolveLr2CourseNumber(253, course(3))).toBeUndefined();
    expect(resolveLr2CourseNumber(104, course(3))).toBeUndefined();
  });
});

describe('resolveLr2CourseText', () => {
  it('reads stage titles, subtitles and the course title', () => {
    expect(resolveLr2CourseText(150, course(3))).toBe('Song 1');
    expect(resolveLr2CourseText(152, course(3))).toBe('Song 3');
    expect(resolveLr2CourseText(153, course(3))).toBe('');
    expect(resolveLr2CourseText(160, course(3))).toBe('[ANOTHER]');
    expect(resolveLr2CourseText(161, course(3))).toBe('');
    expect(resolveLr2CourseText(170, course(3))).toBe('Dan');
    expect(resolveLr2CourseText(10, course(3))).toBeUndefined();
  });
});

describe('lr2ShowsCourseCombo', () => {
  it('counts the whole course in expert and grade courses only', () => {
    expect(lr2ShowsCourseCombo('grade')).toBe(true);
    expect(lr2ShowsCourseCombo('expert')).toBe(true);
    expect(lr2ShowsCourseCombo('nonstop')).toBe(false);
  });
});

describe('resolveLr2CourseConnectionText', () => {
  it('names the NONSTOP connections on 171-179 and shows DISABLE for other courses', () => {
    const nonstop: SceneCourseInfo = { ...course(3), kind: 'nonstop', connections: ['cut', 'blank1', 'fade-fit'] };
    expect(resolveLr2CourseConnectionText(171, nonstop)).toBe('CUT');
    expect(resolveLr2CourseConnectionText(172, nonstop)).toBe('BLANK1');
    expect(resolveLr2CourseConnectionText(173, nonstop)).toBe('FADE+FIT');
    expect(resolveLr2CourseConnectionText(179, nonstop)).toBe('FADE');
    expect(resolveLr2CourseConnectionText(171, course(3))).toBe('DISABLE');
    expect(resolveLr2CourseConnectionText(170, nonstop)).toBeUndefined();
  });
});

describe('resolveLr2NonstopStage', () => {
  it('moves on only at stages that follow a BLANK connection', () => {
    const stages = [
      { windowStart: 0, lr2StageMarker: false },
      { windowStart: 20, lr2StageMarker: false },
      { windowStart: 40, lr2StageMarker: true },
    ];
    expect(resolveLr2NonstopStage(stages, 10)).toBe(0);
    expect(resolveLr2NonstopStage(stages, 30)).toBe(0);
    expect(resolveLr2NonstopStage(stages, 45)).toBe(2);
  });
});

describe('LR2 course maker', () => {
  const draft = {
    kind: 'nonstop' as const,
    name: 'Mine',
    stages: [
      { md5: '1'.repeat(32), keyMode: 7, title: 'One' },
      { md5: '2'.repeat(32), keyMode: 7, title: 'Two' },
    ],
  };

  it('lights 571 and 590 + the songs added while making, else 572 and 580 + N under the stage count', () => {
    expect(resolveLr2CourseMakerOps(draft)).toEqual([571, 592]);
    expect(resolveLr2CourseMakerOps({ ...draft, stages: [] })).toEqual([571, 590]);
    expect(resolveLr2CourseMakerOps(undefined)).toEqual([572]);
    expect(resolveLr2CourseMakerOps(undefined, 3)).toEqual([572, 580, 581, 582]);
  });

  it('shows the course being made on the course texts', () => {
    const info = resolveLr2CourseDraftInfo(draft);
    expect(resolveLr2CourseText(150, info)).toBe('One');
    expect(resolveLr2CourseText(151, info)).toBe('Two');
    expect(resolveLr2CourseText(152, info)).toBe('');
    expect(resolveLr2CourseText(170, info)).toBe('Mine');
    expect(resolveLr2CourseText(170, resolveLr2CourseDraftInfo({ ...draft, name: '' }, 'Type it'))).toBe('Type it');
    expect(resolveLr2CourseMakerText(198, 'cut-fit')).toBe('CUT+FIT');
    expect(resolveLr2CourseMakerText(197, 'cut-fit')).toBeUndefined();
  });

  it('maps the course-maker buttons', () => {
    expect(resolveLr2CourseMakerAction(230)).toEqual({ kind: 'finish' });
    expect(resolveLr2CourseMakerAction(231)).toEqual({ kind: 'cancel' });
    expect(resolveLr2CourseMakerAction(232)).toBeUndefined();
    expect(resolveLr2CourseMakerAction(233)).toEqual({ kind: 'delete' });
    expect(resolveLr2CourseMakerAction(240)).toEqual({ kind: 'connection', slot: 0 });
    expect(resolveLr2CourseMakerAction(248)).toEqual({ kind: 'connection', slot: 8 });
    expect(resolveLr2CourseMakerAction(268)).toEqual({ kind: 'default-connection' });
  });

  it('draws the connection buttons at the value they edit', () => {
    const nonstop: SceneCourseInfo = { ...course(3), kind: 'nonstop', connections: ['blank1', 'cut'] };
    expect(resolveLr2CourseMakerButtonState(240, nonstop, 'fade')).toBe(4);
    expect(resolveLr2CourseMakerButtonState(241, nonstop, 'fade')).toBe(2);
    expect(resolveLr2CourseMakerButtonState(245, nonstop, 'fade')).toBe(0);
    expect(resolveLr2CourseMakerButtonState(240, course(3), 'fade')).toBe(0);
    expect(resolveLr2CourseMakerButtonState(268, undefined, 'blank2')).toBe(5);
    expect(resolveLr2CourseMakerButtonState(230, undefined, 'fade')).toBeUndefined();
  });
});

describe('resolveLr2JudgeCombo', () => {
  it('shows the course combo next to the judgement in an expert or grade course', () => {
    expect(resolveLr2JudgeCombo(12, 340, 'grade')).toBe(340);
    expect(resolveLr2JudgeCombo(12, 340, 'expert')).toBe(340);
  });

  it('shows the stage combo in a NONSTOP course and outside a course', () => {
    expect(resolveLr2JudgeCombo(12, 340, 'nonstop')).toBe(12);
    expect(resolveLr2JudgeCombo(12, undefined, undefined)).toBe(12);
    expect(resolveLr2JudgeCombo(12, undefined, 'grade')).toBe(12);
  });
});
