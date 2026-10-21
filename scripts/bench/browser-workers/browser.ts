import { loadChartCollectionFromFiles as loadBaseline } from 'virtual:baseline-collection';
import { loadChartCollectionFromFiles } from '../../../packages/player-browser/src/collection/collection.ts';
import {
  configureBrowserWorkers,
  setBrowserWorkerCount,
  runBrowserTask,
  disposeBrowserWorkers,
} from '@be-music/player-browser/compute';
import { preparePlaybackTask, unzipTask } from '../../../packages/player-browser/src/compute/tasks.ts';
import { timeStretchChannels, stretchAudioBuffers } from '../../../packages/player-browser/src/runtime/time-stretch.ts';
import {
  parseBMS,
  decodeBMSText,
  parseBmson,
  decodeUTF8Text,
  resolveBMSControlFlowWithDraws,
} from '@be-music/chart-parser';
import {
  computeChartFingerprint,
  computePlayFingerprint,
  resolveChart,
  drawRandomOutcomes,
  resolveChartPlayVariant,
} from '@be-music/chart-model';
import type { BeMusicReplay } from '@be-music/player-engine/replay';
import { prepareLeaderboardSubmission } from '../../../packages/app-play/src/leaderboard.ts';
import { zipSync } from 'fflate';

interface Manifest {
  prepareChart: { path: string; notes: number; bytes: number };
  charts: Array<{ path: string; bytes: number }>;
  audio: Array<{ path: string; bytes: number }>;
}
type Variant = 'baseline' | 'workers';
type Case = 'charts' | 'zip' | 'wsola' | 'prepare' | 'submission' | 'startup';
let chartFiles: File[] = [];
let zipFiles: File[] = [];
let audioBuffers: AudioBuffer[] = [];
let context: OfflineAudioContext;
let chart: ReturnType<typeof parseBMS>;
let replay: BeMusicReplay;
let chartPath = '';
let completed = 0;
let created = 0;
let workerErrors = 0;
let targetCount = 1;
async function loadFile(path: string): Promise<Uint8Array> {
  const response = await fetch('/fixture/' + encodeURIComponent(path));
  if (!response.ok) throw Error('Fixture unavailable');
  return new Uint8Array(await response.arrayBuffer());
}
function createPool(count: number): void {
  targetCount = count;
  setBrowserWorkerCount(count);
  created = 0;
  completed = 0;
  workerErrors = 0;
  configureBrowserWorkers(() => {
    created++;
    const worker = new Worker(new URL('../../../packages/app-play/src/compute-worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.addEventListener('message', (event) => {
      if (event.data.error) workerErrors++;
      else completed++;
    });
    worker.addEventListener('error', () => workerErrors++);
    return worker;
  });
}
async function setup(): Promise<unknown> {
  const manifest = (await (await fetch('/manifest.json')).json()) as Manifest;
  chartFiles = await Promise.all(
    manifest.charts.map(async (entry) => new File([new Uint8Array(await loadFile(entry.path))], entry.path)),
  );
  const batches: Record<string, Uint8Array>[] = [{}, {}, {}, {}];
  for (let i = 0; i < chartFiles.length; i++)
    batches[i % 4]![chartFiles[i]!.name] = new Uint8Array(await chartFiles[i]!.arrayBuffer());
  zipFiles = batches.map((files, i) => new File([new Uint8Array(zipSync(files, { level: 6 }))], `charts-${i}.zip`));
  const dense = manifest.prepareChart;
  chartPath = dense.path;
  const bytes = await loadFile(chartPath);
  chart = chartPath.endsWith('.bmson') ? parseBmson(decodeUTF8Text(bytes)) : parseBMS(decodeBMSText(bytes).text);
  context = new OfflineAudioContext(2, 44100, 44100);
  audioBuffers = await Promise.all(
    manifest.audio.map(async (entry) => context.decodeAudioData(new Uint8Array(await loadFile(entry.path)).buffer)),
  );
  const draws = [...drawRandomOutcomes(chart, () => 0.5)];
  const played = resolveBMSControlFlowWithDraws(chart, draws);
  const notes = resolveChart(played).notes.map((note, id) => ({
    id,
    channel: note.channel,
    type: note.kind === 'ln' ? ('long' as const) : ('normal' as const),
    timeUs: Math.round(note.seconds * 1e6),
    ...(note.kind === 'ln' ? { endTimeUs: Math.round(note.endSeconds! * 1e6) } : {}),
  }));
  const inputs = notes
    .flatMap((note) => [
      { seq: 0, timeUs: note.timeUs, action: 'down' as const, channels: [note.channel] },
      { seq: 0, timeUs: note.endTimeUs ?? note.timeUs + 1000, action: 'up' as const, channels: [note.channel] },
    ])
    .sort((a, b) => a.timeUs - b.timeUs);
  inputs.forEach((input, i) => (input.seq = i));
  replay = {
    format: 'be-music-replay',
    version: 0,
    clock: { unit: 'us', origin: 'chart-zero' },
    chart: {
      sourceFormat: 'bms',
      laneMode: '7keys',
      lnMode: 1,
      judgeRank: { percent: 75 },
      noteCount: notes.length,
      notes,
      chartFingerprint: computeChartFingerprint(chart, { chartPath }),
      playFingerprint: computePlayFingerprint(played, { chartPath }),
    },
    inputs,
    play: { mode: 'manual', autoScratch: false, gauge: 'GROOVE', judgeRuleset: 'lr2', randomDraws: draws },
  };

  return {
    charts: chartFiles.length,
    chartBytes: manifest.charts.reduce((sum, e) => sum + e.bytes, 0),
    zipBytes: zipFiles.reduce((sum, f) => sum + f.size, 0),
    denseChart: chartPath,
    denseEvents: chart.events.length,
    audio: audioBuffers.length,
    audioSeconds: audioBuffers.reduce((sum, a) => sum + a.duration, 0),
    hardwareConcurrency: navigator.hardwareConcurrency,
  };
}
async function work(name: Case, variant: Variant): Promise<unknown> {
  if (name === 'startup') {
    await Promise.all(
      Array.from({ length: targetCount }, () =>
        runBrowserTask('stretch', { channels: [new Float32Array(1)], sampleRate: 44100, rate: 1 }, () => [
          new Float32Array(1),
        ]),
      ),
    );
    return { workers: created };
  }
  if (name === 'charts') {
    const loader = variant === 'baseline' ? loadBaseline : loadChartCollectionFromFiles;
    const result = await loader(chartFiles);
    return {
      charts: result.charts.length,
      errors: result.errors.length,
      notes: result.charts.reduce((sum: number, c: { totalNotes: number }) => sum + c.totalNotes, 0),
    };
  }
  if (name === 'zip') {
    const results = await Promise.all(
      zipFiles.map(async (file) => {
        const input = {
          bytes: new Uint8Array(await file.arrayBuffer()),
          limit: 1024 * 1024 * 1024,
          limitMessage: 'ZIP limit',
        };
        return variant === 'baseline' ? unzipTask(input) : await runBrowserTask('unzip', input, () => unzipTask(input));
      }),
    );
    const entries = results.flatMap((value) => Object.values(value));
    return {
      entries: entries.length,
      bytes: entries.reduce((sum, value) => sum + value.length, 0),
      check: entries.reduce((sum, value) => sum + (value[0] ?? 0) + (value.at(-1) ?? 0), 0),
    };
  }
  if (name === 'wsola') {
    const rate = 0.8;
    const buffers =
      variant === 'baseline'
        ? audioBuffers.map((buffer) => {
            const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
            const output = timeStretchChannels(channels, buffer.sampleRate, rate);
            const result = context.createBuffer(output.length, output[0]!.length, buffer.sampleRate);
            output.forEach((channel, i) => result.copyToChannel(channel, i));
            return result;
          })
        : await stretchAudioBuffers(context, audioBuffers, rate, 'wsola');
    return {
      samples: buffers.length,
      frames: buffers.reduce((sum, b) => sum + b.length, 0),
      check: buffers.reduce((sum, b) => sum + b.getChannelData(0)[Math.floor(b.length / 2)]!, 0),
    };
  }
  if (name === 'prepare') {
    const input = {
      chart: resolveBMSControlFlowWithDraws(chart, replay.play.randomDraws ?? []),
      randomDraws: replay.play.randomDraws ?? [],
      playVariant: resolveChartPlayVariant(chart),
      extension: '.bms',
    };
    const result =
      variant === 'baseline'
        ? preparePlaybackTask(input)
        : await runBrowserTask('prepare-playback', input, () => preparePlaybackTask(input));
    return { notes: result.notes.length, mines: result.landmineNotes.length, seconds: result.totalSeconds };
  }
  const input: Parameters<typeof prepareLeaderboardSubmission> = [replay, chart, chartPath];
  const prepared =
    variant === 'baseline'
      ? prepareLeaderboardSubmission(...input)
      : await runBrowserTask('submission', input, () => prepareLeaderboardSubmission(...input));
  if (!prepared.ok) throw Error(`Submission failed: ${prepared.reason}`);
  const payload = prepared.submission;
  const gzip = async () =>
    new Uint8Array(
      await new Response(
        new Blob([JSON.stringify(payload)]).stream().pipeThrough(new CompressionStream('gzip')),
      ).arrayBuffer(),
    );
  const bytes = variant === 'baseline' ? await gzip() : await runBrowserTask('gzip-json', payload, gzip);
  return { compressedBytes: bytes.length };
}
async function measure(name: Case, variant: Variant): Promise<unknown> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const entries: PerformanceEntry[] = [];
  const observer = new PerformanceObserver((list) => entries.push(...list.getEntries()));
  observer.observe({ type: 'longtask' });
  const start = performance.now();
  let last = start;
  let gap = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    gap = Math.max(gap, now - last);
    last = now;
  }, 10);
  const before = completed;
  const result = await work(name, variant);
  const end = performance.now();
  gap = Math.max(gap, end - last);
  clearInterval(timer);
  await new Promise((resolve) => setTimeout(resolve, 60));
  entries.push(...observer.takeRecords());
  observer.disconnect();
  const tasks = entries.filter((e) => e.startTime < end && e.startTime + e.duration > start);
  return {
    wallMs: end - start,
    maxHeartbeatGapMs: gap,
    longTaskMs: tasks.reduce((sum, e) => sum + e.duration, 0),
    longTasks: tasks.length,
    maxLongTaskMs: Math.max(0, ...tasks.map((e) => e.duration)),
    workerCompletions: completed - before,
    workerErrors,
    result,
  };
}
Object.assign(window, { benchmark: { setup, createPool, measure, dispose: () => disposeBrowserWorkers() } });
