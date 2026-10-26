import { createEmptyJSON } from '@be-music/chart-source';
import type { BrowserDroppedFile, BrowserChartCollection } from '@be-music/player-browser/collection';
import {
  parseCourseReplay,
  parseReplay,
  type BeMusicCourseReplay,
  type BeMusicReplay,
  type ReplayCourseStageEntry,
  type RulesetChartFacts,
} from '@be-music/player-engine/replay';
import type { LibraryChart } from '@be-music/player-scene-model';
import { describe, expect, test, vi } from 'vite-plus/test';
import { ReplayRoute, type ReplayRouteDeps } from './replay.ts';

vi.mock('@be-music/player-engine/replay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@be-music/player-engine/replay')>()),
  parseReplay: vi.fn(),
  parseCourseReplay: vi.fn(),
}));

function chartEntry(id: string, changes: Partial<LibraryChart> = {}): LibraryChart {
  return {
    id,
    sourceId: 'drop1',
    sourceLabel: 'pack',
    sourceKind: 'directory',
    chartPath: `${id}.bms`,
    directoryLabel: 'pack',
    fileLabel: `${id}.bms`,
    title: id,
    artist: 'artist',
    totalNotes: 10,
    chart: createEmptyJSON('bms'),
    ...changes,
  };
}

/** A replay recorded on `chart` (its SHA-256, path, title and artist as given), in `mode`. */
function replay(
  chart: { sha256?: string; chartPath?: string; title?: string; artist?: string },
  mode: 'auto' | 'manual' = 'auto',
): BeMusicReplay {
  return {
    chart: {
      ...(chart.sha256 !== undefined ? { sha256: chart.sha256 } : {}),
      ...(chart.title !== undefined ? { title: chart.title } : {}),
      ...(chart.artist !== undefined ? { artist: chart.artist } : {}),
    },
    play: { mode, ...(chart.chartPath !== undefined ? { native: { chartPath: chart.chartPath } } : {}) },
  } as unknown as BeMusicReplay;
}

const FILE = { name: 'a.bmplay.json', text: async () => '{}' } as unknown as BrowserDroppedFile;

/** The replay route over a library of `a`, `b` and `c` (whose chart files hash to `sha-a`, `sha-b`, `sha-c`). */
function harness() {
  const charts = [
    chartEntry('a'),
    chartEntry('b', { title: 'Twin', artist: 'one' }),
    chartEntry('c', { title: 'Twin', artist: 'two' }),
  ];
  const deps = {
    library: { collection: { sources: [], charts, errors: [] } as BrowserChartCollection },
    records: {
      resolveChartSHA256: vi.fn<ReplayRouteDeps['records']['resolveChartSHA256']>(async (chart) => `sha-${chart.id}`),
      resolveChartHashes: vi.fn<ReplayRouteDeps['records']['resolveChartHashes']>(async (chart) => ({
        sha256: `sha-${chart.id}`,
        md5: `md5-${chart.id}`,
      })),
    },
    setStatus: vi.fn<ReplayRouteDeps['setStatus']>(),
    setPlayStatus: vi.fn<ReplayRouteDeps['setPlayStatus']>(),
    playChart: vi.fn<ReplayRouteDeps['playChart']>(async () => {}),
    showSelect: vi.fn<ReplayRouteDeps['showSelect']>(async () => {}),
    startCourseReplay: vi.fn<ReplayRouteDeps['startCourseReplay']>(async () => {}),
    startNonstopCourse: vi.fn<ReplayRouteDeps['startNonstopCourse']>(async () => {}),
    showMissingReplayCharts: vi.fn<ReplayRouteDeps['showMissingReplayCharts']>(),
  };
  return { route: new ReplayRoute(deps), deps, charts };
}

describe('ReplayRoute', () => {
  test('a replay plays back on its chart, with the mode it was recorded in', async () => {
    const h = harness();
    const log = replay({ sha256: 'SHA-B' });
    vi.mocked(parseReplay).mockReturnValueOnce(log);
    await h.route.startReplayReplayFromFile(FILE);
    expect(h.deps.setPlayStatus).toHaveBeenCalledWith('Replaying: Twin');
    expect(h.deps.playChart).toHaveBeenCalledWith(h.charts[1], { autoPlay: true, replay: log });

    const manual = replay({ sha256: 'sha-a' }, 'manual');
    vi.mocked(parseReplay).mockReturnValueOnce(manual);
    await h.route.startReplayReplayFromFile(FILE);
    expect(h.deps.playChart).toHaveBeenLastCalledWith(h.charts[0], { autoPlay: false, replay: manual });
  });

  test('the chart is found by its file hash first, then by its recorded path, then by title and artist', async () => {
    const h = harness();
    // The hash wins over a path that names another chart.
    vi.mocked(parseReplay).mockReturnValueOnce(replay({ sha256: 'sha-c', chartPath: 'a.bms' }));
    await h.route.startReplayReplayFromFile(FILE);
    expect(h.deps.playChart).toHaveBeenLastCalledWith(h.charts[2], expect.anything());

    vi.mocked(parseReplay).mockReturnValueOnce(replay({ sha256: 'sha-gone', chartPath: 'b.bms', title: 'a' }));
    await h.route.startReplayReplayFromFile(FILE);
    expect(h.deps.playChart).toHaveBeenLastCalledWith(h.charts[1], expect.anything());

    vi.mocked(parseReplay).mockReturnValueOnce(replay({ chartPath: 'gone.bms', title: 'Twin', artist: 'two' }));
    await h.route.startReplayReplayFromFile(FILE);
    expect(h.deps.playChart).toHaveBeenLastCalledWith(h.charts[2], expect.anything());

    // A log without an artist takes the first chart of that title.
    vi.mocked(parseReplay).mockReturnValueOnce(replay({ title: 'Twin' }));
    await h.route.startReplayReplayFromFile(FILE);
    expect(h.deps.playChart).toHaveBeenLastCalledWith(h.charts[1], expect.anything());
    expect(h.deps.setStatus).not.toHaveBeenCalled();
  });

  test('a log whose chart is not loaded says so and plays nothing', async () => {
    const h = harness();
    vi.mocked(parseReplay).mockReturnValueOnce(replay({ title: 'Twin', artist: 'three' }));
    await h.route.startReplayReplayFromFile(FILE);
    expect(h.deps.setStatus).toHaveBeenLastCalledWith('Replay: song not loaded (Twin)');
    // The select screen comes back, and a dialog names the chart.
    expect(h.deps.showMissingReplayCharts).toHaveBeenLastCalledWith(
      'Load this chart to watch the replay, then drop the replay again.',
      ['Twin / three'],
    );
    vi.mocked(parseReplay).mockReturnValueOnce(replay({}));
    await h.route.startReplayReplayFromFile(FILE);
    expect(h.deps.setStatus).toHaveBeenLastCalledWith('Replay: song not loaded (untitled)');
    expect(h.deps.showMissingReplayCharts).toHaveBeenLastCalledWith(expect.any(String), ['untitled chart']);
    expect(h.deps.showSelect).toHaveBeenCalledTimes(2);
    expect(h.deps.playChart).not.toHaveBeenCalled();
    expect(h.deps.setPlayStatus).not.toHaveBeenCalled();
  });

  test('a file that is no replay says so', async () => {
    const h = harness();
    vi.mocked(parseReplay).mockImplementationOnce(() => {
      throw new Error('not a replay');
    });
    await h.route.startReplayReplayFromFile(FILE);
    expect(h.deps.setStatus).toHaveBeenCalledWith('Replay: invalid replay (not a replay)');
    expect(h.deps.showSelect).toHaveBeenCalledOnce();
    expect(h.deps.playChart).not.toHaveBeenCalled();
  });

  test('a replay that fails to start says so and goes back to the select screen', async () => {
    const h = harness();
    vi.mocked(parseReplay).mockReturnValueOnce(replay({ sha256: 'sha-a' }));
    h.deps.playChart.mockRejectedValueOnce(new Error('arrangement differs'));
    await h.route.startReplayReplayFromFile(FILE);
    expect(h.deps.setStatus).toHaveBeenCalledWith('Replay failed: arrangement differs');
    expect(h.deps.showSelect).toHaveBeenCalledOnce();
  });
});

const COURSE_FILE = { name: 'Dan-20260101.bmcourse.json', text: async () => '{}' } as unknown as BrowserDroppedFile;

/** A course replay of `kind` whose stages are `stages` (played on the chart of that SHA-256, or unreached with an MD5). */
function courseReplay(
  kind: 'grade' | 'nonstop',
  stages: Array<{ sha256: string; title?: string } | { md5: string }>,
): BeMusicCourseReplay {
  return {
    format: 'be-music-course-replay',
    version: 1,
    course: { name: 'Dan', kind, constraints: ['grade'], trophies: [] },
    stages: stages.map((stage): ReplayCourseStageEntry =>
      'sha256' in stage
        ? { played: true, replay: replay({ sha256: stage.sha256, ...(stage.title ? { title: stage.title } : {}) }) }
        : { played: false, md5: stage.md5, facts: {} as RulesetChartFacts },
    ),
    ...(kind === 'nonstop'
      ? { nonstop: { connections: ['cut'], placement: 'intended', replay: replay({}), stages: [], noteStages: [] } }
      : {}),
  } as BeMusicCourseReplay;
}

describe('ReplayRoute course replays', () => {
  test('a course replay plays back as its course once every stage chart is found by its hashes', async () => {
    const h = harness();
    const log = courseReplay('grade', [{ sha256: 'sha-c' }, { sha256: 'SHA-A' }, { md5: 'md5-b' }]);
    vi.mocked(parseCourseReplay).mockReturnValueOnce(log);
    await h.route.startReplayReplayFromFile(COURSE_FILE);
    expect(h.deps.showMissingReplayCharts).not.toHaveBeenCalled();
    expect(h.deps.startCourseReplay).toHaveBeenCalledOnce();
    const [course, started] = h.deps.startCourseReplay.mock.calls[0]!;
    expect(started).toBe(log);
    expect(course.stages.map((stage) => stage.chart)).toEqual([h.charts[2], h.charts[0], h.charts[1]]);
    expect(course.definition).toMatchObject({ name: 'Dan', kind: 'grade', constraints: ['grade'] });
    expect(h.deps.setPlayStatus).toHaveBeenCalledWith('Replaying course: Dan');
    expect(h.deps.playChart).not.toHaveBeenCalled();
  });

  test('a NONSTOP course replay plays back as one chart, through its decide screen', async () => {
    const h = harness();
    const log = courseReplay('nonstop', [{ sha256: 'sha-a' }, { sha256: 'sha-b' }]);
    vi.mocked(parseCourseReplay).mockReturnValueOnce(log);
    await h.route.startReplayReplayFromFile(COURSE_FILE);
    expect(h.deps.startCourseReplay).not.toHaveBeenCalled();
    expect(h.deps.startNonstopCourse).toHaveBeenCalledWith(
      expect.objectContaining({ definition: expect.objectContaining({ kind: 'nonstop', connections: ['cut'] }) }),
      { decide: true, replay: log },
    );
  });

  test('a course replay with a stage chart missing lists the missing charts and does not start', async () => {
    const h = harness();
    vi.mocked(parseCourseReplay).mockReturnValueOnce(
      courseReplay('grade', [{ sha256: 'sha-a' }, { sha256: 'sha-gone', title: 'Gone' }, { md5: 'md5-gone' }]),
    );
    await h.route.startReplayReplayFromFile(COURSE_FILE);
    expect(h.deps.showMissingReplayCharts).toHaveBeenCalledWith(
      'Load these charts of Dan to replay the course, then drop its course replay again.',
      ['Stage 2: Gone', 'Stage 3: md5-gone'],
    );
    expect(h.deps.setStatus).toHaveBeenCalledWith('Course replay: 2 of 3 stage charts are not loaded');
    expect(h.deps.showSelect).toHaveBeenCalledOnce();
    expect(h.deps.startCourseReplay).not.toHaveBeenCalled();
    expect(h.deps.startNonstopCourse).not.toHaveBeenCalled();
  });

  test('a file that is no course replay says so', async () => {
    const h = harness();
    vi.mocked(parseCourseReplay).mockImplementationOnce(() => {
      throw new Error('not a course replay');
    });
    await h.route.startReplayReplayFromFile(COURSE_FILE);
    expect(h.deps.setStatus).toHaveBeenCalledWith('Course replay: invalid course replay (not a course replay)');
    expect(h.deps.showSelect).toHaveBeenCalledOnce();
    expect(h.deps.startCourseReplay).not.toHaveBeenCalled();
  });
});
