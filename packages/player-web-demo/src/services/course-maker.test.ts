import { parseChart } from '@be-music/parser';
import type { BrowserSongCollection } from '@be-music/player-web/collection';
import type { SelectScene } from '@be-music/player-web/host';
import type { LibraryChart } from '@be-music/scene-model';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import { CourseMakerService } from './course-maker.ts';

function song(id: string): LibraryChart {
  return {
    id,
    sourceId: 'drop1',
    sourceLabel: 'pack',
    sourceKind: 'directory',
    chartPath: `${id}.bms`,
    directoryLabel: 'pack',
    fileLabel: `${id}.bms`,
    title: id.toUpperCase(),
    totalNotes: 1,
    chart: parseChart('#00111:01\n#00118:01', 'bms'),
  };
}

const SONGS = ['a', 'b', 'c', 'd', 'e', 'f'].map(song);

function harness() {
  const statuses: string[] = [];
  const collection: BrowserSongCollection = { sources: [], charts: SONGS, errors: [] };
  const view = { setLibrary: vi.fn() };
  const refreshMadeCourses = vi.fn(async () => {});
  const service = new CourseMakerService({
    resolveChartHashes: async (entry) => ({ sha256: entry.id.repeat(64), md5: entry.id.repeat(32) }),
    collection: () => collection,
    refreshMadeCourses,
    selectView: () => view as unknown as SelectScene,
    setStatus: (text) => {
      statuses.push(text);
    },
  });
  return { service, statuses, collection, view, refreshMadeCourses };
}

beforeEach(() => {
  // Saving the courses needs IndexedDB, which the tests run without; the service reports it and goes on.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CourseMakerService', () => {
  test('plays a decided chart unless a course is being made, which takes it instead', async () => {
    const { service, statuses } = harness();
    expect(service.addSongToCourseBeingMade(SONGS[0]!)).toBe(false);
    service.maker.start('expert');
    expect(service.addSongToCourseBeingMade(SONGS[0]!)).toBe(true);
    await vi.waitFor(() => expect(statuses).toEqual(['Added A to the course (1 / 5)']));
    expect(service.maker.draft?.stages.map((stage) => stage.md5)).toEqual(['a'.repeat(32)]);
  });

  test('saves the course when one more chart is decided once it holds five', async () => {
    const { service, statuses, refreshMadeCourses } = harness();
    service.maker.start('grade');
    for (const entry of SONGS.slice(0, 5)) {
      service.addSongToCourseBeingMade(entry);
      await vi.waitFor(() => expect(service.maker.draft?.stages.length).toBe(SONGS.indexOf(entry) + 1));
    }
    expect(service.addSongToCourseBeingMade(SONGS[5]!)).toBe(true);
    expect(service.maker.draft).toBeUndefined();
    expect(service.maker.courses.map((course) => course.name)).toEqual(['DAN 1']);
    expect(statuses).toContain('Saved the course "DAN 1"');
    // The saved courses are listed again, even when this browser cannot keep them.
    await vi.waitFor(() => expect(refreshMadeCourses).toHaveBeenCalledTimes(1));
    expect(statuses).toContain('Could not save your courses in this browser; they last until the page is closed');
  });

  test('redraws the select screen with the same library while a course is being made', () => {
    const { service, collection, view } = harness();
    service.maker.start('nonstop');
    expect(view.setLibrary).toHaveBeenCalledTimes(1);
    expect(view.setLibrary.mock.calls[0]![0]).toBe(collection);
  });
});
