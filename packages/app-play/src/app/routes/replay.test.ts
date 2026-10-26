import type { ReplaySlotStore } from '../../services/replay-slots.ts';
import { createEmptyJSON } from '@be-music/chart-source';
import type { BrowserDroppedFile, BrowserChartCollection } from '@be-music/player-browser/collection';
import { parseReplay, type BeMusicReplay } from '@be-music/player-engine/replay';
import type { LibraryChart } from '@be-music/player-scene-model';
import { describe, expect, test, vi } from 'vite-plus/test';
import { ReplayRoute, type ReplayRouteDeps } from './replay.ts';

vi.mock('@be-music/player-engine/replay', () => ({ parseReplay: vi.fn() }));

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
    },
    setStatus: vi.fn<ReplayRouteDeps['setStatus']>(),
    setPlayStatus: vi.fn<ReplayRouteDeps['setPlayStatus']>(),
    playChart: vi.fn<ReplayRouteDeps['playChart']>(async () => {}),
    showSelect: vi.fn<ReplayRouteDeps['showSelect']>(async () => {}),
    // Slot 2 of chart `a` holds a replay; the store is a fake, as the replay module is mocked here.
    replaySlots: {
      targetOf: vi.fn((entry: { kind: string }) => ({ kind: entry.kind as 'chart' | 'course', id: 'bmfp0:a' })),
      store: {
        exists: vi.fn(() => [false, true, false, false]),
        read: vi.fn<ReplaySlotStore['read']>(async () => ({ kind: 'chart', replay: replay({}, 'manual') })),
      } as unknown as ReplaySlotStore,
    },
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
    vi.mocked(parseReplay).mockReturnValueOnce(replay({}));
    await h.route.startReplayReplayFromFile(FILE);
    expect(h.deps.setStatus).toHaveBeenLastCalledWith('Replay: song not loaded (untitled)');
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

  test('a replay slot plays back on its chart, as a dropped replay does', async () => {
    const h = harness();
    expect(h.route.startReplayFromSlot({ kind: 'chart', chart: h.charts[0]! }, 1)).toBe(true);
    await vi.waitFor(() => expect(h.deps.playChart).toHaveBeenCalledOnce());
    expect(h.deps.playChart).toHaveBeenCalledWith(h.charts[0], { autoPlay: false, replay: replay({}, 'manual') });
    expect(h.deps.setPlayStatus).toHaveBeenCalledWith('Replaying slot 2: a');
  });

  test('an empty slot starts nothing, and a slot that cannot be read says so', async () => {
    const h = harness();
    expect(h.route.startReplayFromSlot({ kind: 'chart', chart: h.charts[0]! }, 0)).toBe(false);
    vi.mocked(h.deps.replaySlots.store.read).mockRejectedValueOnce(new Error('broken'));
    expect(h.route.startReplayFromSlot({ kind: 'chart', chart: h.charts[0]! }, 1)).toBe(true);
    await vi.waitFor(() => expect(h.deps.setStatus).toHaveBeenCalledWith('Replay slot 2 could not be read'));
    expect(h.deps.playChart).not.toHaveBeenCalled();
  });
});
