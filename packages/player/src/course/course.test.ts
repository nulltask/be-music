import { describe, expect, test } from 'vite-plus/test';
import { createEmptyJson } from '@be-music/json';
import {
  applyCourseLongNoteConstraint,
  courseConstraintGroup,
  createCourseStageRef,
  decodeCourseText,
  isClassCourseConstraints,
  normalizeCourseConstraints,
  normalizeCourseTrophies,
  parseBeatorajaCourseData,
  parseBeatorajaCourseFile,
  parseBeatorajaRandomCourseData,
  parseCourseConstraint,
  parseLr2CourseFile,
  parseLr2NonstopConnections,
  parseTableHeaderCourses,
  resolveCourseStages,
  resolveTableModeKeys,
} from './index.ts';
import { parseCourseXml } from './text.ts';

const MD5_A = '0123456789abcdef0123456789abcdef';
const MD5_B = 'fedcba9876543210fedcba9876543210';
const SHA_A = 'a'.repeat(64);

describe('course constraints', () => {
  test('parseCourseConstraint reads table names and beatoraja enum constants', () => {
    expect(parseCourseConstraint('grade_mirror')).toBe('grade_mirror');
    expect(parseCourseConstraint('MIRROR')).toBe('grade_mirror');
    expect(parseCourseConstraint('GAUGE_24KEYS')).toBe('gauge_24k');
    expect(parseCourseConstraint('mirror')).toBeUndefined();
    expect(parseCourseConstraint('toString')).toBeUndefined();
  });

  test('normalizeCourseConstraints keeps the first constraint of each group and drops unknown names', () => {
    expect(
      normalizeCourseConstraints(['grade_mirror', 'CLASS', 'no_good', 'NO_GREAT', 'gauge_lr2', 'x', 1, 'hcn']),
    ).toEqual(['grade_mirror', 'no_good', 'gauge_lr2', 'hcn']);
    expect(courseConstraintGroup('no_speed')).toBe('speed');
  });

  test('a lane-option constraint makes a class course', () => {
    expect(isClassCourseConstraints(['grade_random'])).toBe(true);
    expect(isClassCourseConstraints(['gauge_lr2', 'ln'])).toBe(false);
  });

  test('normalizeCourseTrophies keeps the trophies beatoraja validates', () => {
    expect(
      normalizeCourseTrophies([
        { name: 'goldmedal', missrate: 2.5, scorerate: 85 },
        { name: 'zero', missrate: 0, scorerate: 50 },
        { name: 'full', missrate: 5, scorerate: 100 },
        { missrate: 5, scorerate: 50 },
        null,
      ]),
    ).toEqual([{ name: 'goldmedal', missRate: 2.5, scoreRate: 85 }]);
  });

  test('createCourseStageRef needs a well-formed hash and lower-cases it', () => {
    expect(createCourseStageRef({ md5: MD5_A.toUpperCase(), title: 'T' })).toEqual({ md5: MD5_A, title: 'T' });
    expect(createCourseStageRef({ md5: 'xyz', sha256: SHA_A })).toEqual({ sha256: SHA_A });
    expect(createCourseStageRef({ md5: 'xyz', title: 'T' })).toBeUndefined();
  });
});

describe('course text', () => {
  test('decodeCourseText honours a BOM, the XML declaration, then UTF-8, then Shift_JIS', () => {
    const sjis = Uint8Array.of(0x92, 0x69); // 「段」 in Shift_JIS
    expect(decodeCourseText(sjis)).toBe('段');
    expect(decodeCourseText(new TextEncoder().encode('段'))).toBe('段');
    expect(decodeCourseText(Uint8Array.of(0xef, 0xbb, 0xbf, ...new TextEncoder().encode('a')))).toBe('a');
    const declared = Uint8Array.of(
      ...new TextEncoder().encode('<?xml version="1.0" encoding="shift_jis"?>'),
      0x92,
      0x69,
    );
    expect(decodeCourseText(declared)).toBe('<?xml version="1.0" encoding="shift_jis"?>段');
  });

  test('parseCourseXml reads elements, entities, CDATA and skips comments and declarations', () => {
    const root = parseCourseXml(
      '<?xml version="1.0"?><!-- c --><list a="1"><item>x &amp; &lt;y&gt; &#x41;</item><item><![CDATA[<z>]]></item><e/></list>',
    );
    expect(root?.name).toBe('list');
    expect(root?.children.map((child) => [child.name, child.text])).toEqual([
      ['item', 'x & <y> A'],
      ['item', '<z>'],
      ['e', ''],
    ]);
    expect(parseCourseXml('no element')).toBeUndefined();
  });
});

describe('parseLr2CourseFile', () => {
  const header = (type: number): string => `${'0'.repeat(10)}${type}${'0'.repeat(17)}5190`;

  test('reads the courses of a course list', () => {
    const xml = `<?xml version="1.0" encoding="shift_jis"?>
<courselist>
  <course>
    <title>発狂初段</title>
    <line>7</line>
    <type>2</type>
    <hash>${header(2)}${MD5_A.toUpperCase()}${MD5_B}</hash>
  </course>
  <course>
    <title>EXPERT</title>
    <line>14</line>
    <type>0</type>
    <hash>${header(0)}${MD5_B}</hash>
  </course>
</courselist>`;
    const courses = parseLr2CourseFile(xml);
    expect(courses).toHaveLength(2);
    expect(courses[0]).toEqual({
      name: '発狂初段',
      kind: 'grade',
      stages: [{ md5: MD5_A }, { md5: MD5_B }],
      constraints: ['grade_mirror', 'gauge_lr2'],
      trophies: [],
      release: true,
      keyMode: 7,
      source: { format: 'lr2crs', type: 2, header: header(2), hash: `${header(2)}${MD5_A}${MD5_B}` },
    });
    expect(courses[1]).toMatchObject({ name: 'EXPERT', kind: 'expert', constraints: [], keyMode: 14 });
  });

  test('falls back to the header for the type, keeps ten stages and skips broken courses', () => {
    const many = Array.from({ length: 12 }, () => MD5_A).join('');
    const xml = `<courselist>
      <course><title>N</title><hash>${header(2)}${many}</hash></course>
      <course><title>no stage</title><type>2</type><hash>${header(2)}</hash></course>
      <course><title>bad type</title><type>7</type><hash>${header(7)}${MD5_A}</hash></course>
      <course><title>bad hash</title><type>0</type><hash>${header(0)}${'z'.repeat(32)}</hash></course>
      <course><Title>case</Title><type>0</type><hash>${header(0)}${MD5_A}</hash></course>
    </courselist>`;
    const courses = parseLr2CourseFile(new TextEncoder().encode(xml));
    expect(courses.map((course) => [course.name, course.kind, course.stages.length])).toEqual([
      ['N', 'grade', 10],
      ['', 'expert', 1],
    ]);
  });

  test('reads a NONSTOP course connection after each stage from the header digits', () => {
    const stages = [MD5_A, MD5_B, MD5_A, MD5_B].join('');
    const nonstopHeader = `2405x${'0'.repeat(5)}1${'0'.repeat(21)}`;
    const xml = `<courselist>
      <course><title>NS</title><type>1</type><hash>${nonstopHeader}${stages}</hash></course>
      <course><title>EX</title><type>0</type><hash>${header(0)}${MD5_A}${MD5_B}</hash></course>
    </courselist>`;
    const [nonstop, expert] = parseLr2CourseFile(xml);
    expect(nonstop?.connections).toEqual(['cut', 'blank1', 'fade']);
    expect(expert?.connections).toBeUndefined();
    expect(parseLr2NonstopConnections('0123459x')).toEqual([
      'fade',
      'fade-fit',
      'cut',
      'cut-fit',
      'blank1',
      'blank2',
      'fade',
      'fade',
      'fade',
      'fade',
    ]);
  });

  test('gives no course for a file that is not a course list', () => {
    expect(parseLr2CourseFile('<other/>')).toEqual([]);
    expect(parseLr2CourseFile('')).toEqual([]);
  });
});

describe('beatoraja courses', () => {
  test('parseBeatorajaCourseData validates as CourseData.validate does', () => {
    expect(
      parseBeatorajaCourseData({
        name: 'Dan',
        hash: [{ title: 'one', md5: MD5_A }, { sha256: SHA_A }],
        constraint: ['MIRROR', 'GAUGE_7KEYS', 'NO_SPEED', 'LN', 'CLASS'],
        trophy: [{ name: 'gold', missrate: 2, scorerate: 80 }],
      }),
    ).toEqual({
      name: 'Dan',
      kind: 'grade',
      stages: [
        { md5: MD5_A, title: 'one' },
        { sha256: SHA_A, title: 'course 2' },
      ],
      constraints: ['grade_mirror', 'gauge_7k', 'no_speed', 'ln'],
      trophies: [{ name: 'gold', missRate: 2, scoreRate: 80 }],
      release: true,
      source: { format: 'beatoraja-json' },
    });
    expect(parseBeatorajaCourseData({ hash: [{ md5: MD5_A }], release: false })).toMatchObject({
      name: 'No Course Title',
      kind: 'expert',
      release: false,
    });
    expect(parseBeatorajaCourseData({ name: 'x', hash: [] })).toBeUndefined();
    expect(parseBeatorajaCourseData({ name: 'x', hash: [{ md5: MD5_A }, { title: 'no hash' }] })).toBeUndefined();
  });

  test('parseBeatorajaCourseFile reads an array or a single object and ignores bad JSON', () => {
    const one = { name: 'A', hash: [{ md5: MD5_A }] };
    expect(parseBeatorajaCourseFile(JSON.stringify([one, { hash: [] }, one]))).toHaveLength(2);
    expect(parseBeatorajaCourseFile(new TextEncoder().encode(JSON.stringify(one)))).toHaveLength(1);
    expect(parseBeatorajaCourseFile('{')).toEqual([]);
  });

  test('parseBeatorajaRandomCourseData keeps each stage filter', () => {
    expect(
      parseBeatorajaRandomCourseData({
        name: 'R',
        stage: [{ sql: ' level = 12 ' }, {}, { sql: '' }],
        constraint: ['grade'],
        rconstraint: ['distinct'],
      }),
    ).toEqual({
      name: 'R',
      stages: [{ filter: 'level = 12' }, {}, {}],
      constraints: ['grade'],
      trophies: [],
      distinct: true,
    });
    expect(parseBeatorajaRandomCourseData({ name: 'R', stage: [] })).toBeUndefined();
  });
});

describe('parseTableHeaderCourses', () => {
  test('reads grouped courses, charts with sha256 and the table mode', () => {
    const groups = parseTableHeaderCourses({
      mode: 'beat-7k',
      course: [
        [
          {
            name: 'sl0',
            constraint: ['grade_mirror', 'gauge_lr2', 'ln'],
            trophy: [{ name: 'silvermedal', missrate: 5, scorerate: 70 }],
            md5: [MD5_A, MD5_B],
          },
        ],
        [{ name: 'charts', charts: [{ sha256: SHA_A, title: 'S', md5: MD5_A }] }],
        [{ name: 'broken', charts: [{ title: 'no hash' }] }],
      ],
    });
    expect(groups).toHaveLength(2);
    expect(groups[0]![0]).toMatchObject({
      name: 'sl0',
      kind: 'grade',
      stages: [{ md5: MD5_A }, { md5: MD5_B }],
      constraints: ['grade_mirror', 'gauge_lr2', 'ln'],
      trophies: [{ name: 'silvermedal', missRate: 5, scoreRate: 70 }],
      keyMode: 7,
      source: { format: 'table', legacyGrade: false },
    });
    expect(groups[1]![0]).toMatchObject({ kind: 'expert', stages: [{ sha256: SHA_A, md5: MD5_A, title: 'S' }] });
  });

  test('names a stage without a title `course N`, as beatoraja does', () => {
    const [course] = parseTableHeaderCourses({
      course: [{ charts: [{ md5: MD5_A, title: 'A' }, { md5: MD5_B }, { md5: MD5_A, title: '' }] }],
    })[0]!;
    expect(course!.stages.map((stage) => stage.title)).toEqual(['A', 'course 2', 'course 3']);
    const [byMd5] = parseTableHeaderCourses({ course: [{ md5: [MD5_A, MD5_B] }] })[0]!;
    expect(byMd5!.stages.map((stage) => stage.title)).toEqual(['course 1', 'course 2']);
  });

  test('reads a single group and the legacy grade list', () => {
    expect(parseTableHeaderCourses({ course: [{ md5: [MD5_A] }] })[0]![0]).toMatchObject({
      name: '新規段位',
      kind: 'expert',
    });
    expect(
      parseTableHeaderCourses({ grade: [{ name: 'G', md5: [MD5_A], constraint: ['no_good'] }] })[0]![0],
    ).toMatchObject({
      kind: 'grade',
      constraints: ['grade_mirror', 'gauge_lr2'],
      source: { format: 'table', legacyGrade: true },
    });
    expect(parseTableHeaderCourses({ course: [], grade: [{ md5: [MD5_A] }] })).toHaveLength(1);
    expect(parseTableHeaderCourses(null)).toEqual([]);
  });

  test('resolveTableModeKeys maps the mode hints', () => {
    expect(resolveTableModeKeys('popn-9k')).toBe(9);
    expect(resolveTableModeKeys('beat-8k')).toBeUndefined();
  });
});

describe('resolveCourseStages', () => {
  const charts = new Map([
    [MD5_A, 'chart A'],
    [SHA_A, 'chart S'],
  ]);
  const lookup = { bySha256: (hash: string) => charts.get(hash), byMd5: (hash: string) => charts.get(hash) };

  test('finds stages by SHA-256, then MD5, and reports a missing one', () => {
    const course = parseBeatorajaCourseData({
      hash: [{ sha256: SHA_A }, { md5: MD5_A, sha256: 'b'.repeat(64) }, { md5: MD5_B }],
    })!;
    const resolved = resolveCourseStages(course, lookup);
    expect(resolved.stages.map((stage) => stage.chart)).toEqual(['chart S', 'chart A', undefined]);
    expect(resolved.playable).toBe(false);
    expect(resolveCourseStages({ ...course, stages: course.stages.slice(0, 2) }, lookup).playable).toBe(true);
  });
});

describe('applyCourseLongNoteConstraint', () => {
  test('sets the mode only on charts that leave it undefined', () => {
    const bms = createEmptyJson('bms');
    expect(
      applyCourseLongNoteConstraint(bms, ['hcn']).sourceFormat === 'bms' && applyCourseLongNoteConstraint(bms, ['hcn']),
    ).toMatchObject({
      bms: { lnMode: 3 },
    });
    expect(bms.bms.lnMode).toBeUndefined();
    const declared = createEmptyJson('bms');
    declared.bms.lnMode = 1;
    expect(applyCourseLongNoteConstraint(declared, ['cn'])).toBe(declared);
    expect(applyCourseLongNoteConstraint(bms, ['grade'])).toBe(bms);
    const bmson = createEmptyJson('bmson');
    expect(applyCourseLongNoteConstraint(bmson, ['cn'])).toMatchObject({ bmson: { info: { lnType: 2 } } });
  });
});

describe('LR2 NONSTOP stage limit', () => {
  test('reads a NONSTOP course as its first five stages, as LR2 plays it', () => {
    const md5s = ['1', '2', '3', '4', '5', '6'].map((digit) => digit.repeat(32));
    const header = `${'0'.repeat(10)}1${'0'.repeat(21)}`;
    const [nonstop] = parseLr2CourseFile(
      `<courselist><course><title>N</title><type>1</type><hash>${header}${md5s.join('')}</hash></course></courselist>`,
    );
    expect(nonstop!.stages.map((stage) => stage.md5)).toEqual(md5s.slice(0, 5));
    expect(nonstop!.connections).toHaveLength(4);
    const [expert] = parseLr2CourseFile(
      `<courselist><course><title>E</title><type>0</type><hash>${header}${md5s.join('')}</hash></course></courselist>`,
    );
    expect(expert!.stages).toHaveLength(6);
  });
});
