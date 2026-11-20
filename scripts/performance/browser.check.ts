import { mkdir, writeFile } from 'node:fs/promises';
import { test, expect, SONGS } from '../../packages/app-play/e2e/support.ts';
const out = process.env.PERF_OUTPUT ?? 'tmp/remaining-work/performance/current';
test('capture real-skin CPU and allocation profiles', async ({ player }) => {
  await mkdir(out, { recursive: true });
  const errors: string[] = [];
  player.page.on('pageerror', (e) => errors.push(e.message));
  // PERF_RENDERER=webgpu measures WebGPU instead of the default WebGL 2; PERF_EFFECTS=reduced|off the skin's lighter effects.
  await player.open(
    { 'be-music.built-in-skin': 'synesthesia', 'be-music.skin-effects': process.env.PERF_EFFECTS ?? 'full' },
    process.env.PERF_RENDERER ? { renderer: process.env.PERF_RENDERER } : {},
  );
  await player.drop('songs', { prefix: SONGS });
  const cdp = await player.page.context().newCDPSession(player.page);
  await cdp.send('Performance.enable');
  await cdp.send('Profiler.enable');
  // A slower machine: PERF_CPU_THROTTLE=4 runs the page at a quarter of this one's CPU speed.
  const throttle = Number(process.env.PERF_CPU_THROTTLE ?? '1');
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  const summaries: Array<{
    name: string;
    elapsedMs: number;
    frames: number;
    p50: number | undefined;
    p95: number | undefined;
    p99: number | undefined;
    over17: number;
    over33: number;
    garbageCollections?: { minor: number; major: number; pauseMs: number };
    before: { metrics: Array<{ name: string; value: number }> };
    after: { metrics: Array<{ name: string; value: number }> };
  }> = [];
  // PERF_FRAMES_ONLY=1 records frame intervals without the CPU and allocation profilers, which add overhead of their own.
  const profile = !process.env.PERF_FRAMES_ONLY;
  async function capture(name: string, action: () => Promise<void>) {
    await cdp.send('HeapProfiler.collectGarbage');
    const before = await cdp.send('Performance.getMetrics');
    type TraceEvent = { pid: number; tid: number; ts: number; name: string; ph: string; dur?: number };
    // Tracing includes other renderer threads and workers. Keep only GC pauses inside the page's own marks.
    const events: TraceEvent[] = [];
    function collectEvents({ value }: { value: object[] }) {
      // CDP leaves trace event payloads untyped.
      for (const event of value as TraceEvent[]) {
        if (event.name === 'MinorGC' || event.name === 'MajorGC' || event.name.startsWith('be-music-perf-'))
          events.push(event);
      }
    }
    if (profile) {
      await cdp.send('HeapProfiler.startSampling', {
        samplingInterval: 16384,
        includeObjectsCollectedByMajorGC: true,
        includeObjectsCollectedByMinorGC: true,
      });
      await cdp.send('Profiler.start');
      cdp.on('Tracing.dataCollected', collectEvents);
      await cdp.send('Tracing.start', {
        categories: 'devtools.timeline,blink.user_timing',
        transferMode: 'ReportEvents',
      });
    }
    const stopFrames = await player.page.evaluateHandle(() => {
      const frames: number[] = [];
      let last: number | undefined;
      let request = requestAnimationFrame(tick);
      function tick(now: number) {
        if (last !== undefined) frames.push(now - last);
        last = now;
        request = requestAnimationFrame(tick);
      }
      performance.mark('be-music-perf-start');
      return () => {
        performance.mark('be-music-perf-end');
        cancelAnimationFrame(request);
        return frames;
      };
    });
    const start = Date.now();
    await action();
    const elapsedMs = Date.now() - start;
    const frames = await stopFrames.evaluate((stop) => stop());
    await stopFrames.dispose();
    if (profile) {
      const complete = new Promise<void>((resolve) => cdp.once('Tracing.tracingComplete', () => resolve()));
      await cdp.send('Tracing.end');
      await complete;
      cdp.off('Tracing.dataCollected', collectEvents);
    }
    const cpu = profile ? await cdp.send('Profiler.stop') : undefined;
    const heap = profile ? await cdp.send('HeapProfiler.stopSampling') : undefined;
    const after = await cdp.send('Performance.getMetrics');
    const garbageCollections = { minor: 0, major: 0, pauseMs: 0 };
    if (profile) {
      const startMark = events.find((event) => event.name === 'be-music-perf-start');
      const endMark = events.find((event) => event.name === 'be-music-perf-end');
      if (!startMark || !endMark) throw new Error('Missing page trace marks');
      for (const event of events) {
        if (
          event.ph !== 'X' ||
          event.pid !== startMark.pid ||
          event.tid !== startMark.tid ||
          event.ts < startMark.ts ||
          event.ts >= endMark.ts
        )
          continue;
        if (event.name === 'MinorGC') garbageCollections.minor++;
        else if (event.name === 'MajorGC') garbageCollections.major++;
        else continue;
        garbageCollections.pauseMs += (event.dur ?? 0) / 1000;
      }
    }
    expect(frames.length).toBeGreaterThan(0);
    const sorted = frames.slice().sort((a, b) => a - b);
    const quantile = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    const summary = {
      name,
      elapsedMs,
      frames: sorted.length,
      p50: quantile(0.5),
      p95: quantile(0.95),
      p99: quantile(0.99),
      over17: sorted.filter((v) => v > 16.7).length,
      over33: sorted.filter((v) => v > 33.4).length,
      ...(profile ? { garbageCollections } : {}),
      before,
      after,
    };
    summaries.push(summary);
    if (cpu) await writeFile(`${out}/${name}.cpuprofile`, JSON.stringify(cpu.profile));
    if (heap) await writeFile(`${out}/${name}.heapprofile`, JSON.stringify(heap.profile));
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
