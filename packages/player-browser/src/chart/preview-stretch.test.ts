import { beforeEach, describe, expect, test, vi } from 'vite-plus/test';

const stretchMocks = vi.hoisted(() => ({
  // Each stretch call is recorded with the names of the buffers it took; the stretched buffers name their source.
  calls: [] as string[][],
  stretchAudioBuffers: vi.fn(async (_context: unknown, buffers: readonly AudioBuffer[], rate: number) => {
    stretchMocks.calls.push(buffers.map((buffer) => (buffer as unknown as { name: string }).name));
    return buffers.map(
      (buffer) =>
        ({
          name: `${(buffer as unknown as { name: string }).name}@${rate}`,
          duration: buffer.duration / rate,
        }) as unknown as AudioBuffer,
    );
  }),
}));

vi.mock('../runtime/time-stretch.ts', () => ({ stretchAudioBuffers: stretchMocks.stretchAudioBuffers }));

import {
  orderPreviewStretchBars,
  PreviewStretchStore,
  type PreviewStretchBar,
  type PreviewStretchRequest,
} from './preview-stretch.ts';

const SPEC = { rate: 0.8, algorithm: 'wsola' } as const;

function sample(name: string, duration = 1): AudioBuffer {
  return {
    name,
    duration,
    sampleRate: 1000,
    length: duration * 1000,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(duration * 1000),
  } as unknown as AudioBuffer;
}

const context = {
  createBuffer: (_channels: number, length: number, sampleRate: number) =>
    ({ name: 'part', duration: length / sampleRate, copyToChannel: () => undefined }) as unknown as AudioBuffer,
} as unknown as BaseAudioContext;

const BARS: PreviewStretchBar[] = [0, 2, 4, 6].map((startSeconds) => ({ startSeconds, endSeconds: startSeconds + 2 }));

/** Bar `n` (starting at 2n s) sounds the short sample `kN`; bar 1 also sounds the long sample `song`'s part. */
function requestsOf(bar: PreviewStretchBar): PreviewStretchRequest[] {
  const index = bar.startSeconds / 2;
  const requests: PreviewStretchRequest[] = [{ path: `k${index}`, source: sample(`k${index}`) }];
  if (index === 1)
    requests.push({ path: 'song', source: sample('song', 60), segment: { startSeconds: 1.7, endSeconds: 4.4 } });
  return requests;
}

/** A store over {@link BARS}, its background jobs run one per {@link step}. */
function storeOf() {
  const yields: (() => void)[] = [];
  const store = new PreviewStretchStore(
    context,
    async (bar) => requestsOf(bar),
    () => new Promise<void>((resolve) => yields.push(resolve)),
  );
  const settle = async (): Promise<void> => {
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
  };
  /** Lets the background run its next job. */
  const step = async (): Promise<void> => {
    yields.shift()?.();
    await settle();
  };
  return { store, step, settle, yields };
}

beforeEach(() => {
  stretchMocks.calls.length = 0;
  stretchMocks.stretchAudioBuffers.mockClear();
});

describe('orderPreviewStretchBars', () => {
  test('orders bars nearest the chart second first, the bar it lies in first, ties in the order given', () => {
    expect(orderPreviewStretchBars(BARS, 4.5).map((bar) => bar.startSeconds)).toEqual([4, 2, 6, 0]);
    expect(orderPreviewStretchBars(BARS, 0).map((bar) => bar.startSeconds)).toEqual([0, 2, 4, 6]);
  });
});

describe('PreviewStretchStore', () => {
  test('stretches what each bar sounds in the background, a sample at a time, nearest the bar picked first', async () => {
    const { store, step, settle } = storeOf();
    store.prepare(SPEC, BARS, 4.5);
    await settle();
    for (let index = 0; index < 4; index += 1) await step();
    expect(stretchMocks.calls).toEqual([['k2'], ['k1'], ['part'], ['k3'], ['k0']]);
  });

  test('a bar picked goes ahead of the background in one batch, and takes what the background stretched', async () => {
    const { store, step, settle } = storeOf();
    store.prepare(SPEC, BARS, 0);
    await settle();
    // The background has done bar 0 and waits.
    expect(stretchMocks.calls).toEqual([['k0']]);
    const results = await store.stretch(SPEC, [...requestsOf(BARS[0]!), ...requestsOf(BARS[3]!)]);
    // k0 was ready; bar 3's sample went to the stretcher alone.
    expect(stretchMocks.calls).toEqual([['k0'], ['k3']]);
    expect(results.map((result) => (result?.buffer as unknown as { name: string }).name)).toEqual(['k0@0.8', 'k3@0.8']);
    // A part of a long sample starts where it was cut.
    const [part] = await store.stretch(SPEC, [requestsOf(BARS[1]!)[1]!]);
    expect(part?.segmentStart).toBe(1.7);
    // The background goes on, skipping what is done.
    await step();
    await step();
    expect(stretchMocks.calls).toEqual([['k0'], ['k3'], ['part'], ['k1'], ['k2']]);
  });

  test('a new tempo drops what was stretched and does the bars again; no settings stop the background', async () => {
    const { store, step, settle, yields } = storeOf();
    store.prepare(SPEC, BARS, 0);
    await settle();
    store.prepare({ ...SPEC, rate: 1.2 });
    await step();
    await step();
    expect(stretchMocks.stretchAudioBuffers.mock.calls.map((call) => call[2])).toEqual([0.8, 1.2, 1.2]);
    expect(stretchMocks.calls.slice(1)).toEqual([['k0'], ['k1']]);
    store.prepare(undefined);
    const before = stretchMocks.calls.length;
    await step();
    await step();
    // The job under way ends; no other starts.
    expect(stretchMocks.calls.length - before).toBeLessThanOrEqual(1);
    expect(yields.length).toBeLessThanOrEqual(1);
  });
});
