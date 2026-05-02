import { describe, expect, test } from 'vitest';
import { loadSongCollectionFromFiles } from './library.ts';
import type { LoadProgress } from './types.ts';

/**
 * The drag-drop loader fires `LoadProgress` events as it walks the
 * `reading` and `parsing` phases so the host UI can show a
 * determinate progress bar. Without progress, a thousand-file folder
 * drop looks indistinguishable from a frozen page. These tests pin
 * the contract: every file produces a reading event, every chart
 * produces a parsing event, and the totals stay in sync with the
 * actual work.
 *
 * The fixture `File`s are minimal stubs — `arrayBuffer()` returns a
 * tiny but valid BMS chart so `loadSongCollectionFromFiles` actually
 * parses them and we exercise the parsing-phase emitter end-to-end.
 */

function makeFile(path: string, contents = ''): File {
  // Browsers in node's vitest environment expose the global `File`
  // class; the chart parser only consults `name`,
  // `webkitRelativePath`, and `arrayBuffer()`, so a thin stub is
  // enough — no need to spin up a real Blob.
  const bytes = new TextEncoder().encode(contents);
  const stub: Partial<File> = {
    name: path.split('/').at(-1) ?? path,
    webkitRelativePath: path,
    arrayBuffer: () => Promise.resolve(bytes.buffer),
  };
  return stub as File;
}

const MINIMAL_BMS = ['#TITLE Test', '#BPM 120', '#PLAYER 1', '#00111:0F'].join('\n');

describe('loadSongCollectionFromFiles progress events', () => {
  test('reports the reading phase with a monotonic current and a guaranteed terminal event', async () => {
    const events: LoadProgress[] = [];
    await loadSongCollectionFromFiles(
      [makeFile('Song/main.bms', MINIMAL_BMS), makeFile('Song/kick.wav'), makeFile('Song/snare.wav')],
      { onProgress: (event) => events.push(event) },
    );
    const reading = events.filter((event) => event.phase === 'reading');
    // Reads are pooled in parallel and per-file progress is
    // throttled to ~30 fps so a 4000-file drop doesn't generate a
    // 4000-call storm. The contract is therefore relaxed:
    //   - At least an initial 0/N + a terminal N/N event must fire.
    //   - `current` must never go backwards.
    //   - The last event hits 100% (drives the host's
    //     "load done" transition).
    expect(reading.length).toBeGreaterThanOrEqual(2);
    expect(reading[0]).toMatchObject({ current: 0, total: 3 });
    expect(reading.at(-1)).toMatchObject({ current: 3, total: 3 });
    const currents = reading.map((event) => event.current);
    for (let i = 1; i < currents.length; i += 1) {
      expect(currents[i]!).toBeGreaterThanOrEqual(currents[i - 1]!);
    }
  });

  test('reports a parsing event per chart file (skipping non-charts)', async () => {
    const events: LoadProgress[] = [];
    await loadSongCollectionFromFiles(
      [
        makeFile('Pack/A/main.bms', MINIMAL_BMS),
        makeFile('Pack/A/kick.wav'),
        makeFile('Pack/B/extra.bms', MINIMAL_BMS),
      ],
      { onProgress: (event) => events.push(event) },
    );
    const parsing = events.filter((event) => event.phase === 'parsing');
    // Two BMS charts → "0 / 2" prelude + per-chart events == 3 events.
    expect(parsing.length).toBe(3);
    expect(parsing[0]).toMatchObject({ current: 0, total: 2 });
    expect(parsing.at(-1)).toMatchObject({ current: 2, total: 2 });
  });

  test('omits the parsing prelude when no chart files are present', async () => {
    // A theme-only / no-chart drop must NOT emit a "0 / 0" parsing
    // event — the UI would otherwise flash a determinate "Parsing
    // 0 / 0" before disappearing, which is jarring.
    const events: LoadProgress[] = [];
    await loadSongCollectionFromFiles([makeFile('Theme/cover.png')], {
      onProgress: (event) => events.push(event),
    });
    expect(events.some((event) => event.phase === 'parsing')).toBe(false);
  });

  test('survives without an onProgress callback (calls are guarded)', async () => {
    // The progress hook is optional; supplying no options must not
    // throw. Acts as a safety net so existing callers (and tests)
    // that haven't migrated keep working.
    const collection = await loadSongCollectionFromFiles([makeFile('Song/main.bms', MINIMAL_BMS)]);
    expect(collection.songs.length).toBe(1);
  });
});
