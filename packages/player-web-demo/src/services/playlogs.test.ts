import type { BeMusicCoursePlaylog, BeMusicPlaylog } from '@be-music/player/playlog';
import { describe, expect, test, vi } from 'vite-plus/test';
import { PlaylogAutoSave } from './playlogs.ts';

const CREATED_AT = '2026-10-19T03:00:00.000Z';

function playlog(title = 'Fixture A'): BeMusicPlaylog {
  return {
    format: 'be-music-playlog',
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

function courseLog(): BeMusicCoursePlaylog {
  return {
    format: 'be-music-course-playlog',
    version: 0,
    createdAt: CREATED_AT,
    course: { name: 'FIX GRADE', kind: 'grade', constraints: [], trophies: [] },
    stages: [{ played: true, playlog: playlog() }],
  };
}

function setup() {
  const download = vi.fn<(blob: Blob, filename: string) => void>();
  const warn = vi.fn<(message: string, error: unknown) => void>();
  return { download, warn, autoSave: new PlaylogAutoSave({ download, warn }) };
}

describe('PlaylogAutoSave', () => {
  test("saves a play's log by the setting latched at its start", async () => {
    const { autoSave, download } = setup();
    autoSave.latch(true);
    autoSave.savePlay(playlog());
    expect(download).toHaveBeenCalledTimes(1);
    const [blob, filename] = download.mock.calls[0]!;
    expect(filename).toMatch(/^Fixture A-2026-10-19T03-00-00-000Z\.bmplay\.json$/);
    expect(JSON.parse(await blob.text())).toMatchObject({ format: 'be-music-playlog', chart: { title: 'Fixture A' } });
  });

  test('saves nothing when the setting was off at the start, or the play recorded no log', () => {
    const { autoSave, download } = setup();
    autoSave.savePlay(playlog());
    autoSave.latch(true);
    autoSave.savePlay(undefined);
    expect(download).not.toHaveBeenCalled();
  });

  test("saves a course's log by the setting latched at its last stage's start, like that stage's own log", async () => {
    const { autoSave, download } = setup();
    // The last stage started with the setting on; the checkbox can be changed again once the stage's result shows, but
    // the course result that follows goes by the latched value.
    autoSave.latch(true);
    autoSave.savePlay(playlog());
    autoSave.saveCourse(courseLog());
    expect(download).toHaveBeenCalledTimes(2);
    const [blob, filename] = download.mock.calls[1]!;
    expect(filename).toMatch(/^FIX GRADE-2026-10-19T03-00-00-000Z\.bmcourse\.json$/);
    expect(JSON.parse(await blob.text())).toMatchObject({ format: 'be-music-course-playlog' });
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
    expect(() => autoSave.savePlay(playlog())).not.toThrow();
    expect(() => autoSave.saveCourse(courseLog())).not.toThrow();
    expect(warn).toHaveBeenCalledWith('play-log auto-save failed', expect.any(Error));
    expect(warn).toHaveBeenCalledWith('course play-log auto-save failed', expect.any(Error));
  });
});
