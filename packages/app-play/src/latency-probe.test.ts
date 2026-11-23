import { describe, expect, it } from 'vite-plus/test';
import type { LatencyProbe, LatencyProbeClockSample, LatencyProbePress } from '@be-music/player-browser/audio';
import { createLatencyProbeConsole, isLatencyProbeRequested, latencyProbeSummaryTable } from './latency-probe.ts';

describe('isLatencyProbeRequested', () => {
  it('turns on with the parameter, with or without a value', () => {
    expect(isLatencyProbeRequested('https://play.be-music.app/?latency-probe')).toBe(true);
    expect(isLatencyProbeRequested('https://play.be-music.app/?latency-probe=1')).toBe(true);
  });

  it('stays off without it, with 0, or on a malformed URL', () => {
    expect(isLatencyProbeRequested('https://play.be-music.app/')).toBe(false);
    expect(isLatencyProbeRequested('https://play.be-music.app/?latency-probe=0')).toBe(false);
    expect(isLatencyProbeRequested('not a url')).toBe(false);
  });
});

describe('createLatencyProbeConsole', () => {
  it('summarises one play or all, and downloads two CSV files', async () => {
    let presses: LatencyProbePress[] = [
      { play: 1, code: 'KeyZ', eventAtMs: 0, handlerAtMs: 1, keysoundAtMs: 2, keysoundContextSeconds: 1 },
      { play: 2, code: 'KeyS', eventAtMs: 10, handlerAtMs: 11 },
    ];
    let samples: LatencyProbeClockSample[] = [{ play: 1, atMs: 0, contextSeconds: 1, sampleRate: 48_000 }];
    const probe: LatencyProbe = {
      recordPress: () => undefined,
      recordKeysoundStart: () => undefined,
      attachClock: () => () => undefined,
      presses: () => presses,
      clockSamples: () => samples,
      clear: () => {
        presses = [];
        samples = [];
      },
    };

    const saved: Array<{ filename: string; text: string }> = [];
    const api = createLatencyProbeConsole(
      probe,
      (blob, filename) => void blob.text().then((text) => saved.push({ filename, text })),
      () => new Date('2026-11-23T04:05:06.789Z'),
    );
    expect(api.summary().presses).toBe(2);
    expect(api.summary(1)).toMatchObject({ presses: 1, withKeysound: 1 });
    expect(api.summary(2)).toMatchObject({ presses: 1, withKeysound: 0 });

    api.download();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saved.map((entry) => entry.filename)).toEqual([
      'latency-presses-2026-11-23T04-05-06Z.csv',
      'latency-clock-2026-11-23T04-05-06Z.csv',
    ]);
    expect(saved[0]?.text.split('\n')).toHaveLength(4);

    api.clear();
    expect(api.presses()).toEqual([]);
  });
});

describe('latencyProbeSummaryTable', () => {
  it('rounds each distribution into a row and adds the reported latencies', () => {
    const table = latencyProbeSummaryTable({
      presses: 2,
      withKeysound: 1,
      dispatch: { count: 2, minMs: 1, medianMs: 1.234, p95Ms: 2, p99Ms: 2, maxMs: 2, meanMs: 1.5, stdevMs: 0.5 },
      outputLatencyMs: 21.456,
    });
    expect(table).toEqual({
      dispatch: { count: 2, median: 1.23, p95: 2, p99: 2, max: 2, stdev: 0.5 },
      outputLatency: { median: 21.46 },
    });
  });
});
