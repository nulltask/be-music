import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { createEmptyJson } from '../../../json/src/index.ts';
import { describe, expect, test, vi } from 'vitest';
import { formatMusicSelectAudioBackendLabel, resolvePreviewContinueKeyFromChart } from './chart-preview.ts';

interface PhraseNote {
  measure: number;
  position: readonly [number, number];
  value: string;
}

function createComplexFallbackChart(
  playableChannels: readonly string[],
  options: { perturbIndex?: number; perturbPosition?: readonly [number, number]; reverseEventOrder?: boolean } = {},
) {
  const phraseNotes: PhraseNote[] = [
    { measure: 0, position: [0, 1], value: '01' },
    { measure: 0, position: [0, 1], value: '02' },
    { measure: 0, position: [1, 8], value: '03' },
    { measure: 0, position: [1, 2], value: '04' },
    { measure: 1, position: [0, 1], value: '05' },
    { measure: 1, position: [3, 4], value: '06' },
  ];
  const chart = createEmptyJson('bms');
  chart.metadata.bpm = 150;
  chart.resources.wav['01'] = 'kick.ogg';
  chart.resources.wav['02'] = 'snare.ogg';
  chart.resources.wav['03'] = 'hat.ogg';
  chart.resources.wav['04'] = 'fx.ogg';
  chart.resources.wav['05'] = 'bass.ogg';
  chart.resources.wav['06'] = 'pad.ogg';
  chart.resources.wav['07'] = 'bgm.ogg';
  chart.resources.bpm['01'] = 180;
  chart.resources.stop['01'] = 96;
  const playableEvents = phraseNotes.map((note, index) => {
    const position: readonly [number, number] =
      options.perturbIndex === index && options.perturbPosition
        ? [options.perturbPosition[0], options.perturbPosition[1]]
        : [note.position[0], note.position[1]];
    return {
      measure: note.measure,
      channel: playableChannels[index] ?? '11',
      position,
      value: note.value,
    };
  });
  const controlEvents = [
    { measure: 0, channel: '08', position: [0, 1] as const, value: '01' },
    { measure: 0, channel: '09', position: [1, 2] as const, value: '01' },
    { measure: 1, channel: '08', position: [1, 4] as const, value: '01' },
    { measure: 0, channel: '01', position: [3, 4] as const, value: '07' },
  ];
  const orderedPlayableEvents = options.reverseEventOrder ? [...playableEvents].reverse() : playableEvents;
  const orderedControlEvents = options.reverseEventOrder ? [...controlEvents].reverse() : controlEvents;
  chart.events = [...orderedPlayableEvents, ...orderedControlEvents];
  return chart;
}

describe('player chart preview', () => {
  test('formats music-select audio backend label conservatively before preview starts', () => {
    expect(formatMusicSelectAudioBackendLabel(false, undefined)).toBe('disabled');
    expect(formatMusicSelectAudioBackendLabel(true, undefined)).toBe('-');
    expect(formatMusicSelectAudioBackendLabel(true, 'CoreAudio')).toBe('CoreAudio');
  });

  test('returns shared fallback continue key when #PREVIEW is missing and phrase is identical', async () => {
    const chartA = createEmptyJson('bms');
    chartA.metadata.bpm = 130;
    chartA.resources.wav['01'] = 'same.ogg';
    chartA.events = [{ measure: 0, channel: '11', position: [0, 1], value: '01' }];

    const chartB = createEmptyJson('bms');
    chartB.metadata.bpm = 130;
    chartB.resources.wav['01'] = 'same.ogg';
    chartB.events = [{ measure: 0, channel: '11', position: [0, 1], value: '01' }];

    const continueKeyA = await resolvePreviewContinueKeyFromChart(chartA, '/songs/example/a.bms');
    const continueKeyB = await resolvePreviewContinueKeyFromChart(chartB, '/songs/example/b.bms');
    expect(continueKeyA).toBeDefined();
    expect(continueKeyA).toBe(continueKeyB);
  });

  test('returns different fallback continue key when tempo-related specs differ', async () => {
    const chart = createEmptyJson('bms');
    chart.metadata.bpm = 130;
    chart.resources.wav['01'] = 'same.ogg';
    chart.events = [{ measure: 0, channel: '11', position: [0, 1], value: '01' }];

    const changedTempo = createEmptyJson('bms');
    changedTempo.metadata.bpm = 150;
    changedTempo.resources.wav['01'] = 'same.ogg';
    changedTempo.events = [{ measure: 0, channel: '11', position: [0, 1], value: '01' }];

    const continueKey = await resolvePreviewContinueKeyFromChart(chart, '/songs/example/base.bms');
    const changedKey = await resolvePreviewContinueKeyFromChart(changedTempo, '/songs/example/tempo.bms');
    expect(continueKey).toBeDefined();
    expect(changedKey).toBeDefined();
    expect(continueKey).not.toBe(changedKey);
  });

  test('returns shared fallback continue key when playable channel layout differs', async () => {
    const chart = createEmptyJson('bms');
    chart.metadata.bpm = 130;
    chart.resources.wav['01'] = 'same.ogg';
    chart.events = [{ measure: 0, channel: '11', position: [0, 1], value: '01' }];

    const changedChannel = createEmptyJson('bms');
    changedChannel.metadata.bpm = 130;
    changedChannel.resources.wav['01'] = 'same.ogg';
    changedChannel.events = [{ measure: 0, channel: '12', position: [0, 1], value: '01' }];

    const continueKey = await resolvePreviewContinueKeyFromChart(chart, '/songs/example/base.bms');
    const changedKey = await resolvePreviewContinueKeyFromChart(changedChannel, '/songs/example/channel.bms');
    expect(continueKey).toBeDefined();
    expect(changedKey).toBeDefined();
    expect(continueKey).toBe(changedKey);
  });

  test('returns different fallback continue key when sounding sample content differs', async () => {
    const chart = createEmptyJson('bms');
    chart.metadata.bpm = 130;
    chart.resources.wav['01'] = 'same.ogg';
    chart.events = [{ measure: 0, channel: '11', position: [0, 1], value: '01' }];

    const changedSample = createEmptyJson('bms');
    changedSample.metadata.bpm = 130;
    changedSample.resources.wav['01'] = 'different.ogg';
    changedSample.events = [{ measure: 0, channel: '12', position: [0, 1], value: '01' }];

    const continueKey = await resolvePreviewContinueKeyFromChart(chart, '/songs/example/base.bms');
    const changedKey = await resolvePreviewContinueKeyFromChart(changedSample, '/songs/example/sample.bms');
    expect(continueKey).toBeDefined();
    expect(changedKey).toBeDefined();
    expect(continueKey).not.toBe(changedKey);
  });

  test('returns shared fallback continue key when simultaneous sample order differs only by channel layout', async () => {
    const chartA = createEmptyJson('bms');
    chartA.metadata.bpm = 130;
    chartA.resources.wav['01'] = 'a.ogg';
    chartA.resources.wav['02'] = 'b.ogg';
    chartA.events = [
      { measure: 0, channel: '11', position: [0, 1], value: '01' },
      { measure: 0, channel: '12', position: [0, 1], value: '02' },
    ];

    const chartB = createEmptyJson('bms');
    chartB.metadata.bpm = 130;
    chartB.resources.wav['01'] = 'a.ogg';
    chartB.resources.wav['02'] = 'b.ogg';
    chartB.events = [
      { measure: 0, channel: '11', position: [0, 1], value: '02' },
      { measure: 0, channel: '12', position: [0, 1], value: '01' },
    ];

    const continueKeyA = await resolvePreviewContinueKeyFromChart(chartA, '/songs/example/a.bms');
    const continueKeyB = await resolvePreviewContinueKeyFromChart(chartB, '/songs/example/b.bms');
    expect(continueKeyA).toBeDefined();
    expect(continueKeyB).toBeDefined();
    expect(continueKeyA).toBe(continueKeyB);
  });

  test('returns shared fallback continue key on complex timeline when playable layout and event order differ', async () => {
    const chartA = createComplexFallbackChart(['11', '12', '13', '14', '15', '16'], { reverseEventOrder: false });
    const chartB = createComplexFallbackChart(['18', '19', '16', '15', '14', '13'], { reverseEventOrder: true });

    const continueKeyA = await resolvePreviewContinueKeyFromChart(chartA, '/songs/example/complex-a.bms');
    const continueKeyB = await resolvePreviewContinueKeyFromChart(chartB, '/songs/example/complex-b.bms');
    expect(continueKeyA).toBeDefined();
    expect(continueKeyB).toBeDefined();
    expect(continueKeyA).toBe(continueKeyB);
  });

  test('returns different fallback continue key on complex timeline when one trigger timing differs', async () => {
    const chartA = createComplexFallbackChart(['11', '12', '13', '14', '15', '16'], { reverseEventOrder: true });
    const chartB = createComplexFallbackChart(['18', '19', '16', '15', '14', '13'], {
      reverseEventOrder: false,
      perturbIndex: 4,
      perturbPosition: [1, 16],
    });

    const continueKeyA = await resolvePreviewContinueKeyFromChart(chartA, '/songs/example/complex-base.bms');
    const continueKeyB = await resolvePreviewContinueKeyFromChart(chartB, '/songs/example/complex-shifted.bms');
    expect(continueKeyA).toBeDefined();
    expect(continueKeyB).toBeDefined();
    expect(continueKeyA).not.toBe(continueKeyB);
  });

  test('returns preview file path key when #PREVIEW resolves to an existing file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'be-music-preview-key-'));
    const previewPath = join(dir, 'preview.ogg');
    await writeFile(previewPath, Buffer.from([0x00]));

    const chart = createEmptyJson('bms');
    chart.bms.preview = 'preview.ogg';

    const continueKey = await resolvePreviewContinueKeyFromChart(chart, join(dir, 'chart.bms'));
    expect(continueKey).toBe(previewPath.replaceAll('\\', '/'));
  });

  test('uses fallback signature key when #PREVIEW is specified but unresolved', async () => {
    const chartA = createEmptyJson('bms');
    chartA.bms.preview = 'missing-preview.ogg';
    chartA.metadata.bpm = 130;
    chartA.resources.wav['01'] = 'same.ogg';
    chartA.events = [{ measure: 0, channel: '11', position: [0, 1], value: '01' }];

    const chartB = createEmptyJson('bms');
    chartB.bms.preview = 'missing-preview.ogg';
    chartB.metadata.bpm = 130;
    chartB.resources.wav['01'] = 'same.ogg';
    chartB.events = [{ measure: 0, channel: '11', position: [0, 1], value: '01' }];

    const continueKeyA = await resolvePreviewContinueKeyFromChart(chartA, '/songs/example/a.bms');
    const continueKeyB = await resolvePreviewContinueKeyFromChart(chartB, '/songs/example/b.bms');
    expect(continueKeyA).toBeDefined();
    expect(continueKeyA).toBe(continueKeyB);
  });

  test('applies global and BGM preview volumes to #PREVIEW sample rendering', async () => {
    vi.resetModules();
    const chart = createEmptyJson('bms');
    chart.metadata.bpm = 120;
    chart.bms.preview = 'preview.ogg';

    const renderJson = vi.fn(async () => ({
      sampleRate: 44_100,
      left: new Float32Array([0.25, 0.25]),
      right: new Float32Array([0.25, 0.25]),
      durationSeconds: 2 / 44_100,
      peak: 0.25,
    }));

    vi.doMock('@be-music/parser', async () => {
      const actual = await vi.importActual<typeof import('@be-music/parser')>('@be-music/parser');
      return {
        ...actual,
        parseChartFile: vi.fn(async () => chart),
        resolveBmsControlFlow: vi.fn(() => chart),
      };
    });
    vi.doMock('@be-music/audio-renderer', async () => {
      const actual =
        await vi.importActual<typeof import('@be-music/audio-renderer')>('@be-music/audio-renderer');
      return {
        ...actual,
        renderJson,
      };
    });
    vi.doMock('../audio-sink.ts', () => ({
      createNodeAudioSink: vi.fn(async () => undefined),
    }));

    const { createChartPreviewController } = await import('./chart-preview.ts');
    const controller = createChartPreviewController({
      volume: 0.5,
      bgmVolume: 0.4,
      playVolume: 0.2,
      settleDelayMs: 0,
    });
    controller.focus({ filePath: '/charts/preview-sample.bms' });
    await waitForMockCall(renderJson);

    const renderCalls = renderJson.mock.calls as unknown as Array<[unknown, { gain?: number }]>;
    expect(renderCalls[0]?.[1]).toMatchObject({
      gain: 0.2,
    });

    await controller.dispose();
    vi.doUnmock('@be-music/parser');
    vi.doUnmock('@be-music/audio-renderer');
    vi.doUnmock('../audio-sink.ts');
  });

  test('applies global, BGM, and key preview volumes to fallback chart rendering', async () => {
    vi.resetModules();
    const chart = createEmptyJson('bms');
    chart.metadata.bpm = 120;
    chart.resources.wav['01'] = 'bgm.ogg';
    chart.resources.wav['02'] = 'key.ogg';
    chart.events = [
      { measure: 0, channel: '01', position: [0, 1], value: '01' },
      { measure: 0, channel: '11', position: [0, 1], value: '02' },
    ];

    const renderJson = vi.fn(async () => ({
      sampleRate: 44_100,
      left: new Float32Array([0.25, 0.25]),
      right: new Float32Array([0.25, 0.25]),
      durationSeconds: 2 / 44_100,
      peak: 0.25,
    }));

    vi.doMock('@be-music/parser', async () => {
      const actual = await vi.importActual<typeof import('@be-music/parser')>('@be-music/parser');
      return {
        ...actual,
        parseChartFile: vi.fn(async () => chart),
        resolveBmsControlFlow: vi.fn(() => chart),
      };
    });
    vi.doMock('@be-music/audio-renderer', async () => {
      const actual =
        await vi.importActual<typeof import('@be-music/audio-renderer')>('@be-music/audio-renderer');
      return {
        ...actual,
        renderJson,
      };
    });
    vi.doMock('../audio-sink.ts', () => ({
      createNodeAudioSink: vi.fn(async () => undefined),
    }));

    const { createChartPreviewController } = await import('./chart-preview.ts');
    const controller = createChartPreviewController({
      volume: 0.5,
      bgmVolume: 0.4,
      playVolume: 0.2,
      settleDelayMs: 0,
    });
    controller.focus({ filePath: '/charts/fallback-preview.bms' });
    await waitForMockCall(renderJson);

    const renderCalls = renderJson.mock.calls as unknown as Array<
      [unknown, { gain?: number; resolveTriggerGain?: (trigger: { channel: string }) => number }]
    >;
    const renderOptions = renderCalls[0]?.[1] as
      | { gain?: number; resolveTriggerGain?: (trigger: { channel: string }) => number }
      | undefined;
    expect(renderOptions?.gain).toBe(0.5);
    expect(renderOptions?.resolveTriggerGain?.({ channel: '01' })).toBe(0.4);
    expect(renderOptions?.resolveTriggerGain?.({ channel: '11' })).toBe(0.2);

    await controller.dispose();
    vi.doUnmock('@be-music/parser');
    vi.doUnmock('@be-music/audio-renderer');
    vi.doUnmock('../audio-sink.ts');
  });

  test('waits briefly before rendering the focused chart preview', async () => {
    vi.resetModules();
    const chart = createEmptyJson('bms');
    chart.metadata.bpm = 120;
    chart.bms.preview = 'preview.ogg';

    const parseChartFile = vi.fn(async () => chart);
    const renderJson = vi.fn(async () => ({
      sampleRate: 44_100,
      left: new Float32Array([0.25, 0.25]),
      right: new Float32Array([0.25, 0.25]),
      durationSeconds: 2 / 44_100,
      peak: 0.25,
    }));

    vi.doMock('@be-music/parser', async () => {
      const actual = await vi.importActual<typeof import('@be-music/parser')>('@be-music/parser');
      return {
        ...actual,
        parseChartFile,
        resolveBmsControlFlow: vi.fn(() => chart),
      };
    });
    vi.doMock('@be-music/audio-renderer', async () => {
      const actual =
        await vi.importActual<typeof import('@be-music/audio-renderer')>('@be-music/audio-renderer');
      return {
        ...actual,
        renderJson,
      };
    });
    vi.doMock('../audio-sink.ts', () => ({
      createNodeAudioSink: vi.fn(async () => undefined),
    }));

    const { createChartPreviewController } = await import('./chart-preview.ts');
    const controller = createChartPreviewController({
      settleDelayMs: 60,
    });

    controller.focus({ filePath: '/charts/delayed-preview.bms' });
    await delay(20);
    expect(renderJson).not.toHaveBeenCalled();

    await waitForMockCall(renderJson, { timeoutMs: 500 });
    expect(parseChartFile).toHaveBeenCalledTimes(1);
    expect(renderJson).toHaveBeenCalledTimes(1);

    await controller.dispose();
    vi.doUnmock('@be-music/parser');
    vi.doUnmock('@be-music/audio-renderer');
    vi.doUnmock('../audio-sink.ts');
  });

  test('skips preview rendering for entries that lose focus before the settle delay elapses', async () => {
    vi.resetModules();
    const firstChart = createEmptyJson('bms');
    firstChart.metadata.bpm = 120;
    firstChart.bms.preview = 'first-preview.ogg';
    const secondChart = createEmptyJson('bms');
    secondChart.metadata.bpm = 120;
    secondChart.bms.preview = 'second-preview.ogg';

    const parseChartFile = vi.fn(async (filePath: string) =>
      filePath.endsWith('first.bms') ? firstChart : secondChart,
    );
    const renderJson = vi.fn(async () => ({
      sampleRate: 44_100,
      left: new Float32Array([0.25, 0.25]),
      right: new Float32Array([0.25, 0.25]),
      durationSeconds: 2 / 44_100,
      peak: 0.25,
    }));

    vi.doMock('@be-music/parser', async () => {
      const actual = await vi.importActual<typeof import('@be-music/parser')>('@be-music/parser');
      return {
        ...actual,
        parseChartFile,
        resolveBmsControlFlow: vi.fn((value) => value),
      };
    });
    vi.doMock('@be-music/audio-renderer', async () => {
      const actual =
        await vi.importActual<typeof import('@be-music/audio-renderer')>('@be-music/audio-renderer');
      return {
        ...actual,
        renderJson,
      };
    });
    vi.doMock('../audio-sink.ts', () => ({
      createNodeAudioSink: vi.fn(async () => undefined),
    }));

    const { createChartPreviewController } = await import('./chart-preview.ts');
    const controller = createChartPreviewController({
      settleDelayMs: 60,
    });

    controller.focus({ filePath: '/charts/first.bms' });
    await delay(20);
    controller.focus({ filePath: '/charts/second.bms' });

    await waitForMockCall(renderJson, { timeoutMs: 500 });
    await delay(80);

    expect(parseChartFile).toHaveBeenCalledTimes(1);
    expect(parseChartFile.mock.calls[0]?.[0]).toBe('/charts/second.bms');
    expect(renderJson).toHaveBeenCalledTimes(1);

    await controller.dispose();
    vi.doUnmock('@be-music/parser');
    vi.doUnmock('@be-music/audio-renderer');
    vi.doUnmock('../audio-sink.ts');
  });
});

async function waitForMockCall(
  mock: { mock: { calls: unknown[][] } },
  options: {
    timeoutMs?: number;
    intervalMs?: number;
  } = {},
): Promise<void> {
  const timeoutMs = Math.max(10, Math.floor(options.timeoutMs ?? 1_000));
  const intervalMs = Math.max(1, Math.floor(options.intervalMs ?? 10));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (mock.mock.calls.length > 0) {
      return;
    }
    await delay(intervalMs);
  }
  throw new Error(`mock was not called within ${timeoutMs}ms`);
}
