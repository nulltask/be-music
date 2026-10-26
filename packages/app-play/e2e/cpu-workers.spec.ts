import { expect, openWithLibrary, SONGS, test } from './support.ts';

test('uses real workers for chart loading and WSOLA; persists concurrency', async ({ player }) => {
  const workers: string[] = [];
  player.page.on('worker', (worker) => workers.push(worker.url()));
  await player.page.addInitScript(() => {
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
  await openWithLibrary(player, {
    'be-music.worker-count': '2',
    'be-music.play-tempo': JSON.stringify({
      tempoEnabled: true,
      tempoPercent: 20,
      tempoPitchMode: 'keep-pitch',
      tempoStretchAlgorithm: 'wsola',
    }),
  });
  expect(await player.readOption(['Developer'], 'CPU workers')).toBe(2);
  expect(workers.filter((url) => url.includes('compute-worker')).length).toBeGreaterThan(0);
  await player.setOption(['Developer'], 'CPU workers', 1);
  expect(await player.page.evaluate(() => localStorage.getItem('be-music.worker-count'))).toBe('1');
  await player.setOption(['Play options'], 'Auto play', true);
  await player.browseTo(SONGS, 'Fixture A');
  await player.key('Enter');
  await player.waitForResult(0);
  const tasks = await player.page.evaluate(
    () => (window as unknown as { __cpuTasks: { sent: string[]; done: number[]; errors: string[] } }).__cpuTasks,
  );
  expect(tasks.sent).toContain('parse-chart');
  for (const name of ['prepare-playback', 'submission', 'course-submission', 'gzip-json']) {
    expect(tasks.sent).not.toContain(name);
  }
  expect(tasks.sent).toContain('stretch');
  expect(tasks.errors).toEqual([]);
  expect(tasks.done.length).toBe(tasks.sent.length);
});

test('the bundled worker expands ZIPs and rejects discarded prototype tasks', async ({ player }) => {
  const workers: string[] = [];
  player.page.on('worker', (worker) => workers.push(worker.url()));
  await openWithLibrary(player, { 'be-music.worker-count': '1' });
  const url = workers.find((value) => value.includes('compute-worker'));
  if (!url) throw new Error('Compute worker did not start');
  // Exercise ZIP expansion through the deployed bundle and verify that rejected prototype jobs stay unavailable.
  const { zipSync, strToU8 } = await import('fflate');
  const zip = Array.from(zipSync({ 'a.txt': strToU8('worker zip') }));
  const result = await player.page.evaluate(
    async ({ url, zip }) => {
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
        const rejected: string[] = [];
        for (const name of ['prepare-playback', 'submission', 'course-submission', 'gzip-json']) {
          try {
            await task(name, {});
          } catch (error) {
            rejected.push(error instanceof Error ? error.message : String(error));
          }
        }
        return { text: new TextDecoder().decode(entries['a.txt']), rejected };
      } finally {
        worker.terminate();
      }
    },
    { url, zip },
  );
  expect(result.text).toBe('worker zip');
  expect(result.rejected).toEqual(
    ['prepare-playback', 'submission', 'course-submission', 'gzip-json'].map((name) => `Unknown browser task: ${name}`),
  );
});
