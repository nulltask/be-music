import type { BeMusicCourseReplay, BeMusicReplay } from '@be-music/player/replay';
import { afterEach, describe, expect, test, vi } from 'vite-plus/test';
import demoPackageJSON from '../../package.json' with { type: 'json' };
import { REPLAY_RECORDER, ReplayAutoSave } from './replays.ts';

// The build's commit is a define of the demo's Vite build, which the test run does not have.
vi.hoisted(() => {
  (globalThis as { __BE_MUSIC_BUILD__?: string }).__BE_MUSIC_BUILD__ = '5760628d';
});

const CREATED_AT = '2026-10-19T03:00:00.000Z';

describe('REPLAY_RECORDER', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('names the web app, its version and the commit it was built from', () => {
    expect(REPLAY_RECORDER).toEqual({
      name: 'be-music-web',
      version: demoPackageJSON.version,
      build: '5760628d',
      platform: 'web',
    });
  });

  test('names no build when the commit could not be resolved', async () => {
    vi.stubGlobal('__BE_MUSIC_BUILD__', '');
    vi.resetModules();
    const { REPLAY_RECORDER: recorder } = await import('./replays.ts');
    expect(recorder).toEqual({ name: 'be-music-web', version: demoPackageJSON.version, platform: 'web' });
  });
});

function replay(title = 'Fixture A'): BeMusicReplay {
  return {
    format: 'be-music-replay',
    version: 0,
    clock: { unit: 'us', origin: 'chart-zero' },
    createdAt: CREATED_AT,
    chart: {
      title,
      sourceFormat: 'bms',
      laneMode: '7keys',
      lnMode: 1,
      judgeRank: { percent: 75 },
      noteCount: 0,
      notes: [],
    },
    inputs: [],
    play: { mode: 'manual', autoScratch: false, gauge: 'GROOVE', judgeRuleset: 'lr2' },
  };
}

function courseLog(): BeMusicCourseReplay {
  return {
    format: 'be-music-course-replay',
    version: 0,
    createdAt: CREATED_AT,
    course: { name: 'FIX GRADE', kind: 'grade', constraints: [], trophies: [] },
    stages: [{ played: true, replay: replay() }],
  };
}

function setup() {
  const download = vi.fn<(blob: Blob, filename: string) => void>();
  const warn = vi.fn<(message: string, error: unknown) => void>();
  return { download, warn, autoSave: new ReplayAutoSave({ download, warn }) };
}

describe('ReplayAutoSave', () => {
  test("saves a play's log by the setting latched at its start", async () => {
    const { autoSave, download } = setup();
    autoSave.latch(true);
    autoSave.savePlay(replay());
    expect(download).toHaveBeenCalledTimes(1);
    const [blob, filename] = download.mock.calls[0]!;
    expect(filename).toMatch(/^Fixture A-2026-10-19T03-00-00-000Z\.bmplay\.json$/);
    expect(JSON.parse(await blob.text())).toMatchObject({ format: 'be-music-replay', chart: { title: 'Fixture A' } });
  });

  test('saves nothing when the setting was off at the start, or the play recorded no log', () => {
    const { autoSave, download } = setup();
    autoSave.savePlay(replay());
    autoSave.latch(true);
    autoSave.savePlay(undefined);
    expect(download).not.toHaveBeenCalled();
  });

  test("saves a course's log by the setting latched at its last stage's start, like that stage's own log", async () => {
    const { autoSave, download } = setup();
    // The last stage started with the setting on; the checkbox can be changed again once the stage's result shows, but
    // the course result that follows goes by the latched value.
    autoSave.latch(true);
    autoSave.savePlay(replay());
    autoSave.saveCourse(courseLog());
    expect(download).toHaveBeenCalledTimes(2);
    const [blob, filename] = download.mock.calls[1]!;
    expect(filename).toMatch(/^FIX GRADE-2026-10-19T03-00-00-000Z\.bmcourse\.json$/);
    expect(JSON.parse(await blob.text())).toMatchObject({ format: 'be-music-course-replay' });
  });

  test("does not save a course's log when the setting was off at its last stage's start", () => {
    const { autoSave, download } = setup();
    autoSave.latch(false);
    autoSave.saveCourse(courseLog());
    expect(download).not.toHaveBeenCalled();
    expect(autoSave.enabled).toBe(false);
  });

  test('a failed download is reported and does not throw', () => {
    const { autoSave, download, warn } = setup();
    download.mockImplementation(() => {
      throw new Error('blocked');
    });
    autoSave.latch(true);
    expect(() => autoSave.savePlay(replay())).not.toThrow();
    expect(() => autoSave.saveCourse(courseLog())).not.toThrow();
    expect(warn).toHaveBeenCalledWith('replay auto-save failed', expect.any(Error));
    expect(warn).toHaveBeenCalledWith('course replay auto-save failed', expect.any(Error));
  });
});
