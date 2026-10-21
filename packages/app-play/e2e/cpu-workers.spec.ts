import { parseBMS } from '@be-music/chart-parser';
import { computeChartFingerprint, computePlayFingerprint } from '@be-music/chart-model';
import type { BeMusicReplay } from '@be-music/player-engine/replay';
import { expect, openWithLibrary, SONGS, test } from './support.ts';

test('uses real workers for chart loading, playback preparation and WSOLA; persists concurrency', async ({ demo }) => {
  const workers: string[] = [];
  demo.page.on('worker', (worker) => workers.push(worker.url()));
  await demo.page.addInitScript(() => {
    const state = { sent: [] as string[], done: [] as number[], errors: [] as string[] };
    Object.defineProperty(window, '__cpuTasks', { value: state });
    // oxlint-disable-next-line typescript/unbound-method -- Called below with the original Worker as receiver.
    const original = Worker.prototype.postMessage;
    const registered = new WeakSet<Worker>();
    Worker.prototype.postMessage = function (message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
      if (!registered.has(this)) {
        registered.add(this);
        this.addEventListener('message', (event: MessageEvent<{ id: number; error?: string }>) => {
          state.done.push(event.data.id);
          if (event.data.error) state.errors.push(event.data.error);
        });
      }
      if (message && typeof message === 'object' && 'name' in message) state.sent.push(String(message.name));
      original.call(this, message, options as StructuredSerializeOptions);
    };
  });
  await openWithLibrary(demo, {
    'be-music-demo.worker-count': '2',
    'be-music-demo.play-tempo': JSON.stringify({
      tempoPercent: 20,
      tempoPitchMode: 'keep-pitch',
      tempoStretchAlgorithm: 'wsola',
    }),
  });
  expect(await demo.readOption(['Developer'], 'CPU workers')).toBe(2);
  expect(workers.filter((url) => url.includes('compute-worker')).length).toBeGreaterThan(0);
  await demo.setOption(['Developer'], 'CPU workers', 1);
  expect(await demo.page.evaluate(() => localStorage.getItem('be-music-demo.worker-count'))).toBe('1');
  await demo.setOption(['Play options'], 'Auto play', true);
  await demo.browseTo(SONGS, 'Fixture A');
  await demo.key('Enter');
  await demo.waitForResult(0);
  const tasks = await demo.page.evaluate(
    () => (window as unknown as { __cpuTasks: { sent: string[]; done: number[]; errors: string[] } }).__cpuTasks,
  );
  expect(tasks.sent).toContain('parse-chart');
  expect(tasks.sent).toContain('prepare-playback');
  expect(tasks.sent).toContain('stretch');
  expect(tasks.errors).toEqual([]);
  expect(tasks.done.length).toBe(tasks.sent.length);
});

test('the bundled worker expands ZIPs and builds compressed submission payloads', async ({ demo }) => {
  const workers: string[] = [];
  demo.page.on('worker', (worker) => workers.push(worker.url()));
  await openWithLibrary(demo, { 'be-music-demo.worker-count': '1' });
  const url = workers.find((value) => value.includes('compute-worker'));
  if (!url) throw new Error('Compute worker did not start');
  // The library already proved that the deployed worker bundle can parse charts. Exercise its other data-only jobs
  // through the same message boundary, without requiring a real leaderboard account or submitting a score.
  const { zipSync, strToU8 } = await import('fflate');
  const zip = Array.from(zipSync({ 'a.txt': strToU8('worker zip') }));
  const chart = parseBMS('#TITLE Worker\n#BPM 120\n#00111:01');
  const chartPath = 'worker.bms';
  const replay: BeMusicReplay = {
    format: 'be-music-replay',
    version: 0,
    clock: { unit: 'us', origin: 'chart-zero' },
    chart: {
      sourceFormat: 'bms',
      laneMode: '7keys',
      lnMode: 1,
      judgeRank: { percent: 75 },
      noteCount: 0,
      notes: [],
      chartFingerprint: computeChartFingerprint(chart, { chartPath }),
      playFingerprint: computePlayFingerprint(chart, { chartPath }),
    },
    inputs: [],
    play: { mode: 'manual', autoScratch: false, gauge: 'GROOVE', judgeRuleset: 'lr2', randomDraws: [] },
  };

  const result = await demo.page.evaluate(
    async ({ url, zip, chart, replay, chartPath }) => {
      const worker = new Worker(url, { type: 'module' });
      let id = 0;
      async function task(name: string, input: unknown): Promise<unknown> {
        const current = ++id;
        return new Promise((resolve, reject) => {
          const receive = (event: MessageEvent<{ id: number; value?: unknown; error?: string }>) => {
            if (event.data.id !== current) return;
            worker.removeEventListener('message', receive);
            if (event.data.error) reject(new Error(event.data.error));
            else resolve(event.data.value);
          };
          worker.addEventListener('message', receive);
          worker.postMessage({ id: current, name, input });
        });
      }
      try {
        const entries = (await task('unzip', {
          bytes: new Uint8Array(zip),
          limit: 1024,
          limitMessage: 'limit',
        })) as Record<string, Uint8Array>;
        const zipped = (await task('gzip-json', { test: 'payload', values: [1, 2, 3] })) as Uint8Array;
        const json = await new Response(
          new Blob([new Uint8Array(zipped)]).stream().pipeThrough(new DecompressionStream('gzip')),
        ).json();
        const prepared = (await task('submission', [replay, chart, chartPath])) as { ok: boolean };
        return { text: new TextDecoder().decode(entries['a.txt']), json, prepared: prepared.ok };
      } finally {
        worker.terminate();
      }
    },
    { url, zip, chart, replay, chartPath },
  );
  expect(result).toEqual({ text: 'worker zip', json: { test: 'payload', values: [1, 2, 3] }, prepared: true });
});
