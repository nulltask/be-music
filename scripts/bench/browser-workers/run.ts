import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { cpus, totalmem, platform, arch } from 'node:os';
import { chromium, type Page } from '@playwright/test';

type Measurement = {
  wallMs: number;
  maxHeartbeatGapMs: number;
  longTaskMs: number;
  longTasks: number;
  maxLongTaskMs: number;
  workerCompletions: number;
  workerErrors: number;
  result: unknown;
};
interface API {
  setup(): Promise<unknown>;
  createPool(count: number): void;
  measure(name: string, variant: string): Promise<Measurement>;
  dispose(): void;
}
interface BenchWindow extends Window {
  benchmark: API;
}
const repository = resolve(import.meta.dirname, '../../..');
const manifestPath = process.env.BENCH_MANIFEST || '/tmp/be-music-browser-manifest.json';
const output = process.env.BENCH_OUTPUT || resolve(repository, 'tmp/bench/browser-workers-real.json');
const repetitions = Number(process.env.BENCH_REPETITIONS || 5);
if (!Number.isSafeInteger(repetitions) || repetitions < 1) throw Error('BENCH_REPETITIONS must be a positive integer');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
  root: string;
  charts: unknown[];
  audio: unknown[];
  prepareChart: unknown;
};
const root = resolve(manifest.root);
const dist = resolve(repository, 'tmp/bench/browser-workers-dist');
const server = createServer((request, response) => {
  void (async () => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    if (pathname === '/manifest.json') {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({ charts: manifest.charts, audio: manifest.audio, prepareChart: manifest.prepareChart }),
      );
      return;
    }
    const fixture = pathname.startsWith('/fixture/');
    const base = fixture ? root : dist;
    const file = resolve(
      base,
      fixture
        ? decodeURIComponent(pathname.slice('/fixture/'.length))
        : pathname === '/'
          ? 'index.html'
          : pathname.slice(1),
    );
    if (!file.startsWith(base + sep)) throw Error('Invalid path');
    const data = await readFile(file);
    response.setHeader(
      'Content-Type',
      (
        {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.json': 'application/json',
          '.wasm': 'application/wasm',
        } as Record<string, string>
      )[extname(file)] || 'application/octet-stream',
    );
    response.end(data);
  })().catch(() => {
    response.statusCode = 404;
    response.end();
  });
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw Error('No address');
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const startupOnly = process.env.BENCH_STARTUP_ONLY === '1';
const cases = startupOnly ? ['startup'] : ['charts', 'zip', 'wsola', 'prepare', 'submission'];
const pages = new Map<string, Page>();
const rows: Array<{ case: string; mode: string; phase: string; round: number; measurement: Measurement }> = [];
let metadata: unknown;
async function persist(): Promise<void> {
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
        browser: browser.version(),
        cpu: cpus()[0]?.model,
        platform: platform(),
        architecture: arch(),
        memoryBytes: totalmem(),
        baselineRevision: execFileSync('git', ['rev-parse', process.env.BENCH_BASE_REF || '7a4b7a13^'], {
          cwd: repository,
          encoding: 'utf8',
        }).trim(),
        repetitions,
        metadata,
        rows,
      },
      null,
      2,
    ) + '\n',
  );
}
try {
  const probe = await browser.newPage();
  await probe.goto(`http://127.0.0.1:${address.port}/`);
  await probe.waitForFunction(() => Boolean((window as unknown as BenchWindow).benchmark));
  const cores = await probe.evaluate(() => navigator.hardwareConcurrency);
  await probe.close();
  const counts = [...new Set([1, 2, 4, Math.max(1, Math.floor(cores / 2))])];
  const modes = [...(startupOnly ? [] : ['baseline']), ...counts.map((n) => `workers-${n}`)];
  for (const mode of modes) {
    const page = await browser.newPage();
    page.setDefaultTimeout(180000);
    page.on('pageerror', (error) => process.stderr.write(`${mode}: ${error.message}\n`));
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.waitForFunction(() => Boolean((window as unknown as BenchWindow).benchmark));
    const info = startupOnly
      ? { hardwareConcurrency: cores }
      : await page.evaluate(() => (window as unknown as BenchWindow).benchmark.setup());
    metadata ??= info;
    if (mode !== 'baseline')
      await page.evaluate(
        (count) => (window as unknown as BenchWindow).benchmark.createPool(count),
        Number(mode.split('-')[1]),
      );
    pages.set(mode, page);
    process.stdout.write(`ready ${mode}: ${JSON.stringify(info)}\n`);
  }
  for (const name of cases) {
    // One discarded warm-up per case/variant. For charts it also measures the first worker startup.
    for (const mode of startupOnly ? [] : modes) {
      const page = pages.get(mode)!;
      await page.bringToFront();
      const measurement = await page.evaluate(
        ({ name, variant }) => (window as unknown as BenchWindow).benchmark.measure(name, variant),
        { name, variant: mode === 'baseline' ? 'baseline' : 'workers' },
      );
      rows.push({ case: name, mode, phase: 'warmup', round: -1, measurement });
      await persist();
      process.stdout.write(`warmup ${name} ${mode}: ${measurement.wallMs.toFixed(1)} ms\n`);
    }
    for (let round = 0; round < repetitions; round++) {
      const order = modes.map((_, i) => modes[(i + round) % modes.length]!);
      for (const mode of order) {
        const page = pages.get(mode)!;
        await page.bringToFront();
        if (startupOnly)
          await page.evaluate(
            (count) => (window as unknown as BenchWindow).benchmark.createPool(count),
            Number(mode.split('-')[1]),
          );
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('HeapProfiler.collectGarbage');
        await cdp.detach();
        const measurement = await page.evaluate(
          ({ name, variant }) => (window as unknown as BenchWindow).benchmark.measure(name, variant),
          { name, variant: mode === 'baseline' ? 'baseline' : 'workers' },
        );
        if (measurement.workerErrors) throw Error(`${mode}/${name}: worker errors`);
        if (mode !== 'baseline' && measurement.workerCompletions === 0)
          throw Error(`${mode}/${name}: no real worker completion`);
        if (!startupOnly) {
          const baseline = rows.find((row) => row.case === name && row.mode === 'baseline')!.measurement.result;
          if (JSON.stringify(baseline) !== JSON.stringify(measurement.result))
            throw Error(`${mode}/${name}: output differs from baseline`);
        }
        rows.push({ case: name, mode, phase: 'sample', round, measurement });
        await persist();
        process.stdout.write(
          `sample ${round + 1}/${repetitions} ${name} ${mode}: ${measurement.wallMs.toFixed(1)} ms, heartbeat gap ${measurement.maxHeartbeatGapMs.toFixed(1)} ms\n`,
        );
      }
    }
  }
} finally {
  await persist();
  await browser.close();
  server.close();
}
