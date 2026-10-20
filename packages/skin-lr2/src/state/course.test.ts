import { describe, expect, it } from 'vite-plus/test';
import type { CourseView } from '@be-music/player-scene-model';
import {
  lr2ShowsCourseCombo,
  resolveLR2JudgeCombo,
  resolveLR2CourseStageDifficultyOps,
  resolveLR2CourseConnectionText,
  resolveLR2CourseDraftInfo,
  resolveLR2CourseMakerAction,
  resolveLR2CourseMakerButtonState,
  resolveLR2CourseMakerOps,
  resolveLR2CourseMakerText,
  resolveLR2CourseNumber,
  resolveLR2CourseOps,
  resolveLR2CourseText,
  resolveLR2NonstopStage,
} from './course.ts';

function course(stageCount: number, stageIndex?: number, kind: CourseView['kind'] = 'grade'): CourseView {
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

describe('resolveLR2CourseOps', () => {
  it('lights the course and kind ops on the select screen', () => {
    expect(resolveLR2CourseOps(course(4))).toEqual([290, 293]);
    expect(resolveLR2CourseOps(course(4, undefined, 'nonstop'))).toEqual([290, 291]);
    expect(resolveLR2CourseOps(course(4, undefined, 'expert'))).toEqual([290, 292]);
  });

  it('lights 280 + index for a stage that is not the last, 289 for the last', () => {
    expect(resolveLR2CourseOps(course(4, 0))).toEqual([290, 293, 280]);
    expect(resolveLR2CourseOps(course(4, 2))).toEqual([290, 293, 282]);
    expect(resolveLR2CourseOps(course(4, 3))).toEqual([290, 293, 289]);
    expect(resolveLR2CourseOps(course(1, 0))).toEqual([290, 293, 289]);
  });

  it('has no stage op past the ninth stage unless it is the last', () => {
    expect(resolveLR2CourseOps(course(10, 8))).toEqual([290, 293, 288]);
    expect(resolveLR2CourseOps(course(11, 9))).toEqual([290, 293]);
    expect(resolveLR2CourseOps(course(10, 9))).toEqual([290, 293, 289]);
  });
});

describe('resolveLR2CourseNumber', () => {
  it('reads the stage levels on 250-259', () => {
    expect(resolveLR2CourseNumber(250, course(3))).toBe(10);
    expect(resolveLR2CourseNumber(252, course(3))).toBe(12);
    expect(resolveLR2CourseNumber(253, course(3))).toBeUndefined();
    expect(resolveLR2CourseNumber(104, course(3))).toBeUndefined();
  });
});

describe('resolveLR2CourseText', () => {
  it('reads stage titles, subtitles and the course title', () => {
    expect(resolveLR2CourseText(150, course(3))).toBe('Song 1');
    expect(resolveLR2CourseText(152, course(3))).toBe('Song 3');
    expect(resolveLR2CourseText(153, course(3))).toBe('');
    expect(resolveLR2CourseText(160, course(3))).toBe('[ANOTHER]');
    expect(resolveLR2CourseText(161, course(3))).toBe('');
    expect(resolveLR2CourseText(170, course(3))).toBe('Dan');
    expect(resolveLR2CourseText(10, course(3))).toBeUndefined();
  });
});

describe('lr2ShowsCourseCombo', () => {
  it('counts the whole course in expert and grade courses only', () => {
    expect(lr2ShowsCourseCombo('grade')).toBe(true);
    expect(lr2ShowsCourseCombo('expert')).toBe(true);
    expect(lr2ShowsCourseCombo('nonstop')).toBe(false);
  });
});

describe('resolveLR2CourseConnectionText', () => {
  it('names the NONSTOP connections on 171-179 and shows DISABLE for other courses', () => {
    const nonstop: CourseView = { ...course(3), kind: 'nonstop', connections: ['cut', 'blank1', 'fade-fit'] };
    expect(resolveLR2CourseConnectionText(171, nonstop)).toBe('CUT');
    expect(resolveLR2CourseConnectionText(172, nonstop)).toBe('BLANK1');
    expect(resolveLR2CourseConnectionText(173, nonstop)).toBe('FADE+FIT');
    expect(resolveLR2CourseConnectionText(179, nonstop)).toBe('FADE');
    expect(resolveLR2CourseConnectionText(171, course(3))).toBe('DISABLE');
    expect(resolveLR2CourseConnectionText(170, nonstop)).toBeUndefined();
  });
});

describe('resolveLR2NonstopStage', () => {
  it('moves on only at stages that follow a BLANK connection', () => {
    const stages = [
      { windowStart: 0, lr2StageMarker: false },
      { windowStart: 20, lr2StageMarker: false },
      { windowStart: 40, lr2StageMarker: true },
    ];
    expect(resolveLR2NonstopStage(stages, 10)).toBe(0);
    expect(resolveLR2NonstopStage(stages, 30)).toBe(0);
    expect(resolveLR2NonstopStage(stages, 45)).toBe(2);
  });
});

describe('LR2 course maker', () => {
  const draft = {
    kind: 'nonstop' as const,
    name: 'Mine',
    stages: [
      { md5: '1'.repeat(32), keyMode: 7, title: 'One', subtitle: '[ANOTHER]' },
      { md5: '2'.repeat(32), keyMode: 7, title: 'Two' },
    ],
  };

  it('lights 571 and 590 + the songs added while making, else 572 and 580 + N under the stage count', () => {
    expect(resolveLR2CourseMakerOps(draft)).toEqual([571, 592]);
    expect(resolveLR2CourseMakerOps({ ...draft, stages: [] })).toEqual([571, 590]);
    expect(resolveLR2CourseMakerOps(undefined)).toEqual([572]);
    expect(resolveLR2CourseMakerOps(undefined, 3)).toEqual([572, 580, 581, 582]);
  });

  it('shows the course being made on the course texts', () => {
    const info = resolveLR2CourseDraftInfo(draft);
    expect(resolveLR2CourseText(150, info)).toBe('One');
    expect(resolveLR2CourseText(151, info)).toBe('Two');
    expect(resolveLR2CourseText(152, info)).toBe('');
    // Texts 160-164: the subtitles of the songs added so far.
    expect(resolveLR2CourseText(160, info)).toBe('[ANOTHER]');
    expect(resolveLR2CourseText(161, info)).toBe('');
    expect(resolveLR2CourseText(170, info)).toBe('Mine');
    expect(resolveLR2CourseText(170, resolveLR2CourseDraftInfo({ ...draft, name: '' }, 'Type it'))).toBe('Type it');
    expect(resolveLR2CourseMakerText(198, 'cut-fit')).toBe('CUT+FIT');
    expect(resolveLR2CourseMakerText(197, 'cut-fit')).toBeUndefined();
  });

  it('maps the course-maker buttons', () => {
    expect(resolveLR2CourseMakerAction(230)).toEqual({ kind: 'finish' });
    expect(resolveLR2CourseMakerAction(231)).toEqual({ kind: 'cancel' });
    expect(resolveLR2CourseMakerAction(232)).toBeUndefined();
    expect(resolveLR2CourseMakerAction(233)).toEqual({ kind: 'delete' });
    expect(resolveLR2CourseMakerAction(240)).toEqual({ kind: 'connection', slot: 0 });
    expect(resolveLR2CourseMakerAction(248)).toEqual({ kind: 'connection', slot: 8 });
    expect(resolveLR2CourseMakerAction(268)).toEqual({ kind: 'default-connection' });
  });

  it('draws the connection buttons at the value they edit', () => {
    const nonstop: CourseView = { ...course(3), kind: 'nonstop', connections: ['blank1', 'cut'] };
    expect(resolveLR2CourseMakerButtonState(240, nonstop, 'fade')).toBe(4);
    expect(resolveLR2CourseMakerButtonState(241, nonstop, 'fade')).toBe(2);
    expect(resolveLR2CourseMakerButtonState(245, nonstop, 'fade')).toBe(0);
    expect(resolveLR2CourseMakerButtonState(240, course(3), 'fade')).toBe(0);
    expect(resolveLR2CourseMakerButtonState(268, undefined, 'blank2')).toBe(5);
    expect(resolveLR2CourseMakerButtonState(230, undefined, 'fade')).toBeUndefined();
  });
});

describe('resolveLR2JudgeCombo', () => {
  it('shows the course combo next to the judgement in an expert or grade course', () => {
    expect(resolveLR2JudgeCombo(12, 340, 'grade')).toBe(340);
    expect(resolveLR2JudgeCombo(12, 340, 'expert')).toBe(340);
  });

  it('shows the stage combo in a NONSTOP course and outside a course', () => {
    expect(resolveLR2JudgeCombo(12, 340, 'nonstop')).toBe(12);
    expect(resolveLR2JudgeCombo(12, undefined, undefined)).toBe(12);
    expect(resolveLR2JudgeCombo(12, undefined, 'grade')).toBe(12);
  });
});

describe('resolveLR2CourseStageDifficultyOps', () => {
  it('lights 700 + 10 × stage + difficulty for the first five stages', () => {
    const course: CourseView = {
      kind: 'grade',
      title: 'Dan',
      stages: [
        { title: 'a', difficulty: 2 },
        { title: 'b', difficulty: 4 },
        { title: 'c' },
        { title: 'd', difficulty: 5 },
        { title: 'e', difficulty: 3 },
        { title: 'f', difficulty: 1 },
      ],
    };
    expect(resolveLR2CourseStageDifficultyOps(course)).toEqual([702, 714, 720, 735, 743]);
  });

  it('reads 0 for a stage the course lacks and for a bar that is not a course, as LR2 does', () => {
    expect(
      resolveLR2CourseStageDifficultyOps({ kind: 'expert', title: 'x', stages: [{ title: 'a', difficulty: 1 }] }),
    ).toEqual([701, 710, 720, 730, 740]);
    expect(resolveLR2CourseStageDifficultyOps(undefined)).toEqual([700, 710, 720, 730, 740]);
  });
});
