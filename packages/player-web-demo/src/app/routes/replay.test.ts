import { createEmptyJSON } from '@be-music/json';
import type { BrowserDroppedFile, BrowserSongCollection } from '@be-music/player-web/collection';
import { parsePlaylog, type BeMusicPlaylog } from '@be-music/player/playlog';
import type { LibraryChart } from '@be-music/scene-model';
import { describe, expect, test, vi } from 'vite-plus/test';
import { ReplayRoute, type ReplayRouteDeps } from './replay.ts';

vi.mock('@be-music/player/playlog', () => ({ parsePlaylog: vi.fn() }));

function song(id: string, changes: Partial<LibraryChart> = {}): LibraryChart {
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

/** A play log recorded on `chart` (its SHA-256, path, title and artist as given), in `mode`. */
function playlog(
  chart: { sha256?: string; chartPath?: string; title?: string; artist?: string },
  mode: 'auto' | 'manual' = 'auto',
): BeMusicPlaylog {
  return {
    chart: {
      ...(chart.sha256 !== undefined ? { sha256: chart.sha256 } : {}),
      ...(chart.title !== undefined ? { title: chart.title } : {}),
      ...(chart.artist !== undefined ? { artist: chart.artist } : {}),
    },
    play: { mode, ...(chart.chartPath !== undefined ? { native: { chartPath: chart.chartPath } } : {}) },
  } as unknown as BeMusicPlaylog;
}

const FILE = { name: 'a.bmplay.json', text: async () => '{}' } as unknown as BrowserDroppedFile;

/** The replay route over a library of `a`, `b` and `c` (whose chart files hash to `sha-a`, `sha-b`, `sha-c`). */
function harness() {
  const charts = [song('a'), song('b', { title: 'Twin', artist: 'one' }), song('c', { title: 'Twin', artist: 'two' })];
  const deps = {
    library: { collection: { sources: [], charts, errors: [] } as BrowserSongCollection },
    records: {
      resolveChartSHA256: vi.fn<ReplayRouteDeps['records']['resolveChartSHA256']>(async (chart) => `sha-${chart.id}`),
    },
    setStatus: vi.fn<ReplayRouteDeps['setStatus']>(),
    setPlayStatus: vi.fn<ReplayRouteDeps['setPlayStatus']>(),
    playSong: vi.fn<ReplayRouteDeps['playSong']>(async () => {}),
    showSelect: vi.fn<ReplayRouteDeps['showSelect']>(async () => {}),
  };
  return { route: new ReplayRoute(deps), deps, charts };
}

describe('ReplayRoute', () => {
  test('a play log plays back on its chart, with the mode it was recorded in', async () => {
    const h = harness();
    const log = playlog({ sha256: 'SHA-B' });
    vi.mocked(parsePlaylog).mockReturnValueOnce(log);
    await h.route.startPlaylogReplayFromFile(FILE);
    expect(h.deps.setPlayStatus).toHaveBeenCalledWith('Replaying: Twin');
    expect(h.deps.playSong).toHaveBeenCalledWith(h.charts[1], { autoPlay: true, replay: log });

    const manual = playlog({ sha256: 'sha-a' }, 'manual');
    vi.mocked(parsePlaylog).mockReturnValueOnce(manual);
    await h.route.startPlaylogReplayFromFile(FILE);
    expect(h.deps.playSong).toHaveBeenLastCalledWith(h.charts[0], { autoPlay: false, replay: manual });
  });

  test('the chart is found by its file hash first, then by its recorded path, then by title and artist', async () => {
    const h = harness();
    // The hash wins over a path that names another chart.
    vi.mocked(parsePlaylog).mockReturnValueOnce(playlog({ sha256: 'sha-c', chartPath: 'a.bms' }));
    await h.route.startPlaylogReplayFromFile(FILE);
    expect(h.deps.playSong).toHaveBeenLastCalledWith(h.charts[2], expect.anything());

    vi.mocked(parsePlaylog).mockReturnValueOnce(playlog({ sha256: 'sha-gone', chartPath: 'b.bms', title: 'a' }));
    await h.route.startPlaylogReplayFromFile(FILE);
    expect(h.deps.playSong).toHaveBeenLastCalledWith(h.charts[1], expect.anything());

    vi.mocked(parsePlaylog).mockReturnValueOnce(playlog({ chartPath: 'gone.bms', title: 'Twin', artist: 'two' }));
    await h.route.startPlaylogReplayFromFile(FILE);
    expect(h.deps.playSong).toHaveBeenLastCalledWith(h.charts[2], expect.anything());

    // A log without an artist takes the first chart of that title.
    vi.mocked(parsePlaylog).mockReturnValueOnce(playlog({ title: 'Twin' }));
    await h.route.startPlaylogReplayFromFile(FILE);
    expect(h.deps.playSong).toHaveBeenLastCalledWith(h.charts[1], expect.anything());
    expect(h.deps.setStatus).not.toHaveBeenCalled();
  });

  test('a log whose chart is not loaded says so and plays nothing', async () => {
    const h = harness();
    vi.mocked(parsePlaylog).mockReturnValueOnce(playlog({ title: 'Twin', artist: 'three' }));
    await h.route.startPlaylogReplayFromFile(FILE);
    expect(h.deps.setStatus).toHaveBeenLastCalledWith('Replay: song not loaded (Twin)');
    vi.mocked(parsePlaylog).mockReturnValueOnce(playlog({}));
    await h.route.startPlaylogReplayFromFile(FILE);
    expect(h.deps.setStatus).toHaveBeenLastCalledWith('Replay: song not loaded (untitled)');
    expect(h.deps.playSong).not.toHaveBeenCalled();
    expect(h.deps.setPlayStatus).not.toHaveBeenCalled();
  });

  test('a file that is no play log says so', async () => {
    const h = harness();
    vi.mocked(parsePlaylog).mockImplementationOnce(() => {
      throw new Error('not a play log');
    });
    await h.route.startPlaylogReplayFromFile(FILE);
    expect(h.deps.setStatus).toHaveBeenCalledWith('Replay: invalid play-log (not a play log)');
    expect(h.deps.playSong).not.toHaveBeenCalled();
  });

  test('a replay that fails to start says so and goes back to the select screen', async () => {
    const h = harness();
    vi.mocked(parsePlaylog).mockReturnValueOnce(playlog({ sha256: 'sha-a' }));
    h.deps.playSong.mockRejectedValueOnce(new Error('arrangement differs'));
    await h.route.startPlaylogReplayFromFile(FILE);
    expect(h.deps.setStatus).toHaveBeenCalledWith('Replay failed: arrangement differs');
    expect(h.deps.showSelect).toHaveBeenCalledOnce();
  });
});
