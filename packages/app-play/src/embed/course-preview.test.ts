import { describe, expect, it } from 'vite-plus/test';
import { parseChart } from '@be-music/chart-parser';
import { computeChartFileHashes, type BrowserChartCollection } from '@be-music/player-browser/collection';
import type { LibraryChart, PlayResult } from '@be-music/player-scene-model';
import { loadEmbedCourses, previewCourseOptions, PreviewCourseRun } from './course-preview.ts';

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);
const bytes = encode('#TITLE First\n#BPM 120\n#00111:01\n#00211:01');
const chart: LibraryChart = {
  id: 'a',
  sourceId: 'pack',
  sourceLabel: 'pack',
  sourceKind: 'zip',
  chartPath: 'pack/a.bms',
  fileLabel: 'a.bms',
  directoryLabel: 'pack',
  title: 'First',
  totalNotes: 2,
  chart: parseChart(new TextDecoder().decode(bytes), 'bms'),
};
const hashes = (await computeChartFileHashes(
  { id: 'pack', kind: 'zip', label: 'pack', files: new Map([['pack/a.bms', bytes]]) },
  chart.chartPath,
))!;
const courseJSON = (md5 = hashes.md5): Uint8Array =>
  encode(
    JSON.stringify([
      { name: 'Expert', hash: [{ md5 }, { sha256: hashes.sha256 }], constraint: ['NO_SPEED', 'HCN'] },
      { name: 'Grade', hash: [{ sha256: hashes.sha256 }], constraint: ['CLASS'] },
    ]),
  );
function collection(path = 'pack/course/expert.json', content = courseJSON()): BrowserChartCollection {
  return {
    sources: [
      {
        id: 'pack',
        kind: 'zip',
        label: 'pack',
        files: new Map([
          ['pack/a.bms', bytes],
          [path, content],
        ]),
      },
    ],
    charts: [chart],
    errors: [],
  };
}
function outcome(gauge = 80): PlayResult {
  return {
    stageOutcome: {
      ruleset: 'be-music/native',
      judge: { pgreat: 2, great: 0, good: 0, bad: 0, poor: 0, emptyPoor: 0 },
      fast: 0,
      slow: 0,
      exScore: 4,
      noteCount: 2,
      maxCombo: 2,
      gauge: { type: 'GRADE', final: gauge, cleared: gauge > 0 },
      course: { combo: 2, maxCombo: 2 },
    },
  } as PlayResult;
}

describe('loadEmbedCourses', () => {
  it('resolves a beatoraja file by case-insensitive path suffix and both file hash formats', async () => {
    const courses = await loadEmbedCourses(collection(), 'COURSE\\EXPERT.JSON');
    expect(courses.map((course) => course.definition.name)).toEqual(['Expert', 'Grade']);
    expect(courses[0]!.stages.map((stage) => stage.chart)).toEqual([chart, chart]);
    expect(courses.every((course) => course.playable)).toBe(true);
  });
  it('accepts explicitly selected beatoraja JSON outside the course directory', async () => {
    expect(await loadEmbedCourses(collection('expert.json'), './expert.json')).toHaveLength(2);
  });
  it('reads LR2 course kinds and connections with the shared parser', async () => {
    const xml = `<courselist>${[0, 1, 2].map((type) => `<course><title>LR2 ${type}</title><type>${type}</type><hash>${'0'.repeat(10)}${type}${'0'.repeat(21)}${hashes.md5}${hashes.md5}</hash></course>`).join('')}</courselist>`;
    const courses = await loadEmbedCourses(collection('pack/list.lr2crs', encode(xml)), 'list.LR2CRS');
    expect(courses.map((course) => course.definition.kind)).toEqual(['expert', 'nonstop', 'grade']);
    expect(courses.every((course) => course.playable)).toBe(true);
    expect(courses[1]!.definition.connections).toEqual(['fade']);
  });
  it('keeps courses with missing stages unplayable rather than substituting another chart', async () => {
    const [course] = await loadEmbedCourses(collection(undefined, courseJSON('0'.repeat(32))), 'expert.json');
    expect(course!.playable).toBe(false);
    expect(course!.stages[0]!.chart).toBeUndefined();
  });
  it('reports a missing course file without falling back to chart playback', async () => {
    await expect(loadEmbedCourses(collection(), 'missing.lr2crs')).rejects.toThrow('not found');
    await expect(loadEmbedCourses(collection(), 'pert.json')).rejects.toThrow('not found');
  });
  it('reports ambiguity and allows the full archive path to disambiguate', async () => {
    const pack = collection();
    (pack.sources[0]!.files as Map<string, Uint8Array>).set('other/expert.json', courseJSON());
    await expect(loadEmbedCourses(pack, 'expert.json')).rejects.toThrow('More than one');
    expect(await loadEmbedCourses(pack, 'pack/course/expert.json')).toHaveLength(2);
  });
  it('prefers an exact archive path over the suffix of a longer path', async () => {
    const pack = collection();
    (pack.sources[0]!.files as Map<string, Uint8Array>).set('other/pack/course/expert.json', courseJSON());
    expect(await loadEmbedCourses(pack, 'pack/course/expert.json')).toHaveLength(2);
  });
  it('reports an unsupported file or a file with no valid course', async () => {
    await expect(loadEmbedCourses(collection('bad.txt'), 'bad.txt')).rejects.toThrow('.lr2crs');
    await expect(loadEmbedCourses(collection('bad.json', encode('{')), 'bad.json')).rejects.toThrow('no valid');
    await expect(loadEmbedCourses(collection('bad.json', encode('[]')), 'bad.json')).rejects.toThrow('no valid');
  });
});

describe('PreviewCourseRun', () => {
  it('applies course long-note constraints and carries gauge and course combo to the next stage without a replay', async () => {
    const [course] = await loadEmbedCourses(collection(), 'expert.json');
    const run = new PreviewCourseRun(course!);
    const first = run.next()!;
    expect(first.index).toBe(0);
    expect(first.stage.chart.bms.lnMode).toBe(3);
    expect(first.hiSpeedLocked).toBe(true);
    const next = run.finish(outcome())!;
    expect(next.index).toBe(1);
    expect(next.course.carryIn).toEqual({ gauge: 80, combo: 2, maxCombo: 2 });
    expect(previewCourseOptions(course!, next)).toMatchObject({
      settings: { hiSpeedLocked: true },
      course: { stage: { kind: 'expert', carryIn: { gauge: 80 } } },
    });
    expect(run.finish(outcome())).toBeUndefined();
  });
  it('ends at a failed stage, and a fresh run starts from the first stage', async () => {
    const [course] = await loadEmbedCourses(collection(), 'expert.json');
    const run = new PreviewCourseRun(course!);
    expect(run.finish(outcome(0))).toBeUndefined();
    expect(new PreviewCourseRun(course!).next()!.index).toBe(0);
  });
  it('builds NONSTOP course context without a staged run', async () => {
    const [course] = await loadEmbedCourses(collection(), 'expert.json');
    expect(previewCourseOptions(course!).course.stage).toEqual({ kind: 'expert' });
  });
});
