import { describe, expect, it } from 'vite-plus/test';
import { parseLr2CourseFile } from './lr2crs.ts';
import {
  appendCourseDraftStage,
  buildLr2CourseHash,
  createCourseDraft,
  finishCourseDraft,
  LR2_COURSE_MAKER_MAX_STAGES,
  removeLastCourseDraftStage,
  serializeLr2CourseFile,
  stepLr2NonstopConnection,
  withNonstopConnection,
  type CourseDraft,
} from './maker.ts';

const MD5 = ['a', 'b', 'c', 'd', 'e', 'f'].map((digit) => digit.repeat(32));

function draftOf(kind: CourseDraft['kind'], count: number): CourseDraft {
  let draft = createCourseDraft(kind, 'My Course');
  for (let index = 0; index < count; index += 1) {
    const result = appendCourseDraftStage(draft, { md5: MD5[index]!, keyMode: 7, title: `Song ${index + 1}` });
    if (!result.ok) throw new Error(result.reason);
    draft = result.draft;
  }
  return draft;
}

describe('appendCourseDraftStage', () => {
  it('appends songs up to five, duplicates included', () => {
    const draft = draftOf('nonstop', 2);
    const again = appendCourseDraftStage(draft, { md5: MD5[0]!.toUpperCase(), keyMode: 7 });
    expect(again.ok && again.draft.stages.map((stage) => stage.md5)).toEqual([MD5[0], MD5[1], MD5[0]]);
    expect(
      appendCourseDraftStage(draftOf('nonstop', LR2_COURSE_MAKER_MAX_STAGES), { md5: MD5[5]!, keyMode: 7 }),
    ).toEqual({
      ok: false,
      reason: 'full',
    });
  });

  it("refuses a song in another key mode than the first one's, or without an MD5", () => {
    expect(appendCourseDraftStage(draftOf('expert', 1), { md5: MD5[1]!, keyMode: 14 })).toEqual({
      ok: false,
      reason: 'key-mode',
    });
    expect(appendCourseDraftStage(draftOf('expert', 0), { md5: 'xyz', keyMode: 7 })).toEqual({
      ok: false,
      reason: 'no-md5',
    });
  });

  it('drops the last song', () => {
    expect(removeLastCourseDraftStage(draftOf('grade', 3)).stages.map((stage) => stage.title)).toEqual([
      'Song 1',
      'Song 2',
    ]);
    expect(removeLastCourseDraftStage(draftOf('grade', 0)).stages).toEqual([]);
  });
});

describe('buildLr2CourseHash', () => {
  it('writes the connections, the type and the stage MD5s', () => {
    const hash = buildLr2CourseHash({ kind: 'nonstop', stageMd5s: MD5.slice(0, 2), connections: ['cut', 'blank2'] });
    expect(hash).toBe(`25${'0'.repeat(8)}1${'0'.repeat(21)}${MD5[0]}${MD5[1]}`);
    expect(buildLr2CourseHash({ kind: 'grade', stageMd5s: [MD5[0]!], connections: ['cut'] }).slice(0, 11)).toBe(
      `${'0'.repeat(10)}2`,
    );
  });
});

describe('finishCourseDraft', () => {
  it('gives a NONSTOP course the default connection after stages 1-5', () => {
    const course = finishCourseDraft(draftOf('nonstop', 3), { defaultConnection: 'blank1' })!;
    expect(course).toMatchObject({ name: 'My Course', kind: 'nonstop', keyMode: 7, connections: ['blank1', 'blank1'] });
    expect(course.source).toMatchObject({
      format: 'lr2crs',
      type: 1,
      header: `44444${'0'.repeat(5)}1${'0'.repeat(21)}`,
    });
    expect(course.stages.map((stage) => stage.title)).toEqual(['Song 1', 'Song 2', 'Song 3']);
  });

  it('reads like an LR2 grade course, and refuses an empty course', () => {
    expect(finishCourseDraft(draftOf('grade', 1))?.constraints).toEqual(['grade_mirror', 'gauge_lr2']);
    expect(finishCourseDraft(draftOf('expert', 0))).toBeUndefined();
  });
});

describe('stepLr2NonstopConnection', () => {
  it("steps through LR2's order, wrapping both ways", () => {
    expect(stepLr2NonstopConnection('fade', 1)).toBe('fade-fit');
    expect(stepLr2NonstopConnection('blank2', 1)).toBe('fade');
    expect(stepLr2NonstopConnection('fade', -1)).toBe('blank2');
  });
});

describe('withNonstopConnection', () => {
  it('changes one connection in the course and its hash', () => {
    const course = withNonstopConnection(finishCourseDraft(draftOf('nonstop', 3))!, 1, 'cut-fit');
    expect(course.connections).toEqual(['fade', 'cut-fit']);
    expect(course.source.format === 'lr2crs' && course.source.hash.slice(0, 2)).toBe('03');
    // A connection past the last stage is kept in the header only, as LR2 does.
    const past = withNonstopConnection(course, 5, 'blank1');
    expect(past.connections).toEqual(['fade', 'cut-fit']);
    expect(past.source.format === 'lr2crs' && past.source.header[5]).toBe('4');
  });

  it('leaves other courses and slots alone', () => {
    const expert = finishCourseDraft(draftOf('expert', 2))!;
    expect(withNonstopConnection(expert, 0, 'cut')).toBe(expert);
    const nonstop = finishCourseDraft(draftOf('nonstop', 2))!;
    expect(withNonstopConnection(nonstop, 9, 'cut')).toBe(nonstop);
  });
});

describe('serializeLr2CourseFile', () => {
  it('writes courses parseLr2CourseFile reads back', () => {
    const nonstop = withNonstopConnection(finishCourseDraft(draftOf('nonstop', 3))!, 0, 'cut');
    const grade = finishCourseDraft({ ...draftOf('grade', 2), name: 'A & <B>' })!;
    const text = serializeLr2CourseFile([nonstop, grade]);
    const [readNonstop, readGrade] = parseLr2CourseFile(text);
    const strip = ({ stages, ...rest }: typeof nonstop) => ({ ...rest, stages: stages.map(({ md5 }) => ({ md5 })) });
    expect(strip(readNonstop!)).toEqual(strip(nonstop));
    expect(strip(readGrade!)).toEqual(strip(grade));
  });

  it('rebuilds the hash of a course from another format, and skips one without MD5s', () => {
    const text = serializeLr2CourseFile([
      {
        name: 'Table',
        kind: 'expert',
        stages: [{ md5: MD5[0]! }],
        constraints: [],
        trophies: [],
        release: true,
        source: { format: 'beatoraja-json' },
      },
      {
        name: 'No MD5',
        kind: 'expert',
        stages: [{ sha256: 'f'.repeat(64) }],
        constraints: [],
        trophies: [],
        release: true,
        source: { format: 'beatoraja-json' },
      },
    ]);
    expect(parseLr2CourseFile(text).map((course) => course.name)).toEqual(['Table']);
  });
});
