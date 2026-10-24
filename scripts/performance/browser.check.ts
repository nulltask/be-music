import { mkdir, writeFile } from 'node:fs/promises';
import { test, expect, SONGS } from '../../packages/app-play/e2e/support.ts';
const out = process.env.PERF_OUTPUT ?? 'tmp/remaining-work/performance/current';
test('capture real-skin CPU and allocation profiles', async ({ player }) => {
  await mkdir(out, { recursive: true });
  const errors: string[] = [];
  player.page.on('pageerror', (e) => errors.push(e.message));
  await player.open({ 'be-music.built-in-skin': 'synesthesia', 'be-music.skin-effects': 'full' });
  await player.drop('songs', { prefix: SONGS });
  const cdp = await player.page.context().newCDPSession(player.page);
  await cdp.send('Performance.enable');
  await cdp.send('Profiler.enable');
  const summaries: Array<{
    name: string;
    elapsedMs: number;
    frames: number;
    p50: number | undefined;
    p95: number | undefined;
    p99: number | undefined;
    over33: number;
    before: { metrics: Array<{ name: string; value: number }> };
    after: { metrics: Array<{ name: string; value: number }> };
  }> = [];
  async function capture(name: string, action: () => Promise<void>) {
    await cdp.send('HeapProfiler.collectGarbage');
    const before = await cdp.send('Performance.getMetrics');
    await player.page.evaluate(() => {
      const g = globalThis as typeof globalThis & { __perfTimes: number[]; __perfRun: boolean };
      g.__perfTimes = [];
      g.__perfRun = true;
      let last = performance.now();
      function tick(now: number) {
        if (!g.__perfRun) return;
        g.__perfTimes.push(now - last);
        last = now;
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
    await cdp.send('HeapProfiler.startSampling', {
      samplingInterval: 16384,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true,
    });
    await cdp.send('Profiler.start');
    const start = Date.now();
    await action();
    const elapsedMs = Date.now() - start;
    const cpu = await cdp.send('Profiler.stop');
    const heap = await cdp.send('HeapProfiler.stopSampling');
    const after = await cdp.send('Performance.getMetrics');
    const frames = await player.page.evaluate(() => {
      const g = globalThis as typeof globalThis & { __perfTimes: number[]; __perfRun: boolean };
      g.__perfRun = false;
      return g.__perfTimes as number[];
    });
    const sorted = frames.slice(1).sort((a, b) => a - b);
    const quantile = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    const summary = {
      name,
      elapsedMs,
      frames: sorted.length,
      p50: quantile(0.5),
      p95: quantile(0.95),
      p99: quantile(0.99),
      over33: sorted.filter((v) => v > 33.4).length,
      before,
      after,
    };
    summaries.push(summary);
    await writeFile(`${out}/${name}.cpuprofile`, JSON.stringify(cpu.profile));
    await writeFile(`${out}/${name}.heapprofile`, JSON.stringify(heap.profile));
    await writeFile(`${out}/${name}.json`, JSON.stringify({ summary, frames }, null, 2));
    await player.page.screenshot({ path: `${out}/${name}.png` });
  }
  for (const family of process.env.PERF_FAMILIES?.split(',') ?? ['built-in', 'native', 'lr2', 'beatoraja']) {
    if (family === 'native') await player.setOption(['Skin & display'], 'Built-in skin', 'Native (DOM + Canvas)');
    else if (family !== 'built-in') await player.drop(`real/${family}`);
    await player.waitFor(
      (s) => s.scene.kind === 'select' && s.scene.family === (family === 'native' ? 'built-in' : family),
      'family select',
      300000,
    );
    await player.setOption(['Play options'], 'Auto play', true);
    await player.browseTo(SONGS, 'Performance chart');
    await player.key('Enter');
    await player.waitFor((s) => s.scene.kind === 'play' && (s.play?.seconds ?? 0) > 5, 'warm gameplay', 120000);
    for (let trial = 1; trial <= 3; trial++)
      await capture(`${family}-play-${trial}`, () => player.page.waitForTimeout(15000));
    await player.key('Escape');
    const stopped = await player.waitFor(
      (s) => s.scene.kind === 'select' || s.scene.kind === 'result',
      'stopped play',
      30000,
    );
    if (stopped.scene.kind === 'result') await player.leaveResult();
    await player.waitFor((s) => s.scene.kind === 'select', 'select');
  }
  if (!process.env.PERF_FAMILIES) {
    await capture('bulk-drop', async () => {
      await player.drop('bulk', { prefix: 'Bulk' });
    });
    await player.openFolder('Bulk');
    await capture('select-scroll', async () => {
      for (let i = 0; i < 150; i++) {
        await player.key('ArrowDown');
        await player.page.waitForTimeout(50);
      }
    });
  }
  expect(errors).toEqual([]);
  await writeFile(`${out}/summary.json`, JSON.stringify({ summaries, errors }, null, 2));
});
