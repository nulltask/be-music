import { describe, expect, test, vi } from 'vite-plus/test';
import { resolveChart } from '@be-music/chart-model';
import { createEmptyJSON } from '@be-music/chart-source';
import { createNodeAudioSession, loadNodeAudioSampleDurations } from './index.ts';
import { renderSingleSample } from '@be-music/chart-audio-renderer';
import { createNodeAudioSink } from './audio-sink.ts';
import { mixActiveVoices, resolveVoiceFrameWindow, type ActiveVoice } from './session.ts';

vi.mock('@be-music/chart-audio-renderer', () => ({
  renderSingleSample: vi.fn(async () => ({
    sampleRate: 44_100,
    left: new Float32Array(0),
    right: new Float32Array(0),
    durationSeconds: 2,
    peak: 0,
  })),
}));
vi.mock('./audio-sink.ts', () => ({ createNodeAudioSink: vi.fn(async () => undefined) }));

test.each([0, 50, 100, 127, 200])(
  'Node applies WAVCMD percentage %s with EXWAV and VOLWAV once per slot',
  async (volume) => {
    vi.mocked(renderSingleSample).mockClear();
    const json = createEmptyJSON('bms');
    json.resources.wav = { '01': 'sample.wav', '02': 'plain.wav' };
    json.bms.volWAV = 80;
    json.bms.wavCmds = [`01 01 ${volume}`];
    json.bms.exWAV = { '01': 'pvf 0 -600 44100 sample.wav' };
    json.resources.wavGain = { '01': 0.77 };
    json.events = [0, 1].flatMap((measure) =>
      ['01', '02'].map((value) => ({ measure, channel: '01', position: [0, 1] as const, value })),
    );
    await createNodeAudioSession({
      json,
      resolvedChart: resolveChart(json),
      options: { writeOutput: () => undefined },
      mode: 'auto',
    });
    expect(renderSingleSample).toHaveBeenCalledTimes(2);
    const first = vi.mocked(renderSingleSample).mock.calls.find(([key]) => key === '01');
    expect(first?.[2]?.gain).toBeCloseTo(((0.8 * volume) / 100) * 10 ** (-6 / 20) * 0.77);
    expect(renderSingleSample).toHaveBeenCalledWith('02', 'plain.wav', expect.objectContaining({ gain: 0.8 }));
  },
);

test('duration loading decodes each referenced sample once with its chart radix', async () => {
  vi.mocked(renderSingleSample).mockClear();
  const json = createEmptyJSON('bms');
  json.resources.wav = { '01': 'sample.wav' };
  json.bms.pathWAV = 'audio/';
  json.events = [0, 1].map((measure) => ({ measure, channel: '01', position: [0, 1] as const, value: '01' }));
  const durations = await loadNodeAudioSampleDurations(resolveChart(json), { baseDir: '/charts' });
  expect(durations.get('01')).toBe(2);
  expect(renderSingleSample).toHaveBeenCalledTimes(1);
  expect(renderSingleSample).toHaveBeenCalledWith(
    '01',
    'sample.wav',
    expect.objectContaining({ baseDir: '/charts', base: 36, pathPrefix: 'audio/' }),
  );
});

test('Node runtime and duration diagnostics resolve EXWAV-only filenames identically', async () => {
  vi.mocked(renderSingleSample).mockClear();
  const json = createEmptyJSON('bms');
  json.bms.exWAV = { '01': 'v -600 only.wav' };
  json.events = [{ measure: 0, channel: '11', position: [0, 1], value: '01' }];
  const resolvedChart = resolveChart(json);
  await loadNodeAudioSampleDurations(resolvedChart);
  await createNodeAudioSession({ json, resolvedChart, options: { writeOutput: () => undefined }, mode: 'auto' });
  expect(renderSingleSample).toHaveBeenCalledTimes(2);
  expect(vi.mocked(renderSingleSample).mock.calls.map((call) => call[1])).toEqual(['only.wav', 'only.wav']);
});

test('Node runtime and duration diagnostics pass the same authored sample effects to decoding', async () => {
  vi.mocked(renderSingleSample).mockClear();
  const json = createEmptyJSON('bms');
  json.bms.exWAV = { '01': 'pf -600 22050 only.wav' };
  json.bms.wavCmds = ['00 01 72', '02 01 500'];
  json.events = [{ measure: 0, channel: '11', position: [0, 1], value: '01' }];
  const resolvedChart = resolveChart(json);
  await loadNodeAudioSampleDurations(resolvedChart);
  await createNodeAudioSession({ json, resolvedChart, options: { writeOutput: () => undefined }, mode: 'auto' });
  expect(vi.mocked(renderSingleSample).mock.calls.map((call) => call[2]?.playbackModifiers)).toEqual([
    { semitones: 12, durationSeconds: 0.25, pan: -600, frequencyHz: 22050 },
    { semitones: 12, durationSeconds: 0.25, pan: -600, frequencyHz: 22050 },
  ]);
});

test('disabled audio does not open Node output', async () => {
  vi.mocked(createNodeAudioSink).mockClear();
  const json = createEmptyJSON('bms');
  await expect(
    createNodeAudioSession({ json, resolvedChart: resolveChart(json), options: { audio: false }, mode: 'auto' }),
  ).resolves.toBeUndefined();
  expect(createNodeAudioSink).not.toHaveBeenCalled();
});

test('unavailable Node output returns no session', async () => {
  const json = createEmptyJSON('bms');
  await expect(
    createNodeAudioSession({
      json,
      resolvedChart: resolveChart(json),
      options: { writeOutput: () => undefined },
      mode: 'manual',
    }),
  ).resolves.toBeUndefined();
  expect(createNodeAudioSink).toHaveBeenCalled();
});

test('duration loading propagates cancellation before decoding', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    loadNodeAudioSampleDurations(resolveChart(createEmptyJSON('bms')), { signal: controller.signal }),
  ).rejects.toMatchObject({ name: 'AbortError' });
});

test('bmson continuations play independently while simultaneous uses of one slice share a voice', async () => {
  vi.mocked(renderSingleSample).mockClear();
  const json = createEmptyJSON('bmson');
  json.bms.pathWAV = 'audio/';
  json.metadata.bpm = 120;
  json.resources.wav = { '01': 'stem.wav' };
  json.events = [
    { measure: 0, channel: '11', position: [0, 1], value: '01', bmson: { c: false } },
    { measure: 0, channel: '12', position: [1, 4], value: '01', bmson: { c: true } },
    { measure: 0, channel: '13', position: [1, 4], value: '01', bmson: { c: true } },
  ];
  vi.mocked(renderSingleSample).mockResolvedValueOnce({
    sampleRate: 44_100,
    left: new Float32Array(88_200),
    right: new Float32Array(88_200),
    durationSeconds: 2,
    peak: 0,
  });
  let seconds = 0;
  vi.mocked(createNodeAudioSink).mockResolvedValueOnce({
    runtime: 'node',
    engine: 'webaudio',
    label: 'test',
    write: () => true,
    waitWritable: async () => undefined,
    end: async () => undefined,
    destroy: () => undefined,
    onError: () => undefined,
    getClockState: () => ({ outputSeconds: seconds, scheduledSeconds: seconds }),
    suspend: async () => undefined,
    resume: async () => undefined,
  });
  const session = await createNodeAudioSession({
    json,
    resolvedChart: resolveChart(json),
    options: {},
    mode: 'manual',
  });
  expect(session).toBeDefined();
  expect(renderSingleSample).toHaveBeenCalledWith('01', 'stem.wav', expect.objectContaining({ pathPrefix: 'audio/' }));
  session!.triggerEvent?.(json.events[0]!);
  session!.triggerEvent?.(json.events[1]!);
  session!.triggerEvent?.(json.events[2]!);
  expect(session!.getActiveAudioVoiceCount?.()).toBe(2);
  seconds = 0.05;
  session!.triggerEvent?.(json.events[2]!);
  expect(session!.getActiveAudioVoiceCount?.()).toBe(2);
  session!.stopChannel?.('13');
  expect(session!.getActiveAudioVoiceCount?.()).toBe(1);
  session!.stopChannel?.('11');
  expect(session!.getActiveAudioVoiceCount?.()).toBe(0);
  await session!.dispose();
});

test('Node preloads and resolves a paired up source slice without treating it as a judged tap', async () => {
  const json = createEmptyJSON('bmson');
  json.metadata.bpm = 120;
  json.bmson.info.resolution = 240;
  json.resources.wav = { '01': 'head.wav', '02': 'end.wav' };
  json.events = [
    { measure: 0, channel: '11', position: [0, 1], value: '01', bmson: { l: 240 } },
    { measure: 0, channel: '11', position: [1, 4], value: '02', bmson: { up: true } },
  ];
  vi.mocked(renderSingleSample).mockClear();
  vi.mocked(renderSingleSample).mockResolvedValue({
    sampleRate: 8000,
    left: new Float32Array(8000).fill(0.25),
    right: new Float32Array(8000).fill(0.25),
    durationSeconds: 1,
    peak: 0.25,
  });
  vi.mocked(createNodeAudioSink).mockResolvedValueOnce({
    runtime: 'node',
    engine: 'webaudio',
    label: 'test',
    write: () => true,
    waitWritable: async () => undefined,
    end: async () => undefined,
    destroy() {},
    onError() {},
    getClockState: () => ({ outputSeconds: 0.5, scheduledSeconds: 0.5 }),
    suspend: async () => undefined,
    resume: async () => undefined,
  });
  const resolved = resolveChart(json);
  const session = await createNodeAudioSession({ json, resolvedChart: resolved, options: {}, mode: 'manual' });
  expect(resolved.notes).toHaveLength(1);
  expect(renderSingleSample).toHaveBeenCalledWith('02', 'end.wav', expect.anything());
  session!.triggerEvent?.(resolved.notes[0]!.endSoundEvent!);
  session!.triggerEvent?.(resolved.notes[0]!.endSoundEvent!);
  expect(session!.getActiveAudioVoiceCount?.()).toBe(1);
  await session!.dispose();
});

describe('bmson slice fades', () => {
  // 1 ms at 8 kHz: the slice-boundary ramp is 8 frames long.
  const sampleRate = 8000;
  const constant = new Float32Array(8000).fill(0.5);
  const sample = { sampleRate, left: constant, right: constant, durationSeconds: 1, peak: 0.5 };
  const voice = (playback?: { offsetSeconds: number; durationSeconds?: number }): ActiveVoice => ({
    sample,
    gain: 1,
    ...resolveVoiceFrameWindow(constant.length, sampleRate, playback)!,
  });
  const mix = (voices: ActiveVoice[], frames: number): Float32Array => {
    const left = new Float32Array(frames);
    mixActiveVoices(left, new Float32Array(frames), voices, frames);
    return left;
  };

  test('a whole-file voice and a first slice at the top of the file start without a ramp', () => {
    expect(resolveVoiceFrameWindow(8000, sampleRate, undefined)).toEqual({
      startPosition: 0,
      position: 0,
      endPosition: 8000,
    });
    expect(mix([voice({ offsetSeconds: 0 })], 4)[0]).toBe(0.5);
  });

  test('a slice inside the file fades in and rings on past its cut end while it fades out', () => {
    const sliced = voice({ offsetSeconds: 0.25, durationSeconds: 0.25 });
    expect(sliced).toMatchObject({ startPosition: 2000, position: 2000, endPosition: 4008 });
    expect(sliced.slice).toEqual({ lengthFrames: 2000, envelope: { fadeIn: 8, fadeOut: 8 } });
    const fadeIn = mix([sliced], 9);
    expect(fadeIn[0]).toBe(0);
    expect(fadeIn[4]).toBeCloseTo(0.25, 6);
    expect(fadeIn[8]).toBe(0.5);
    sliced.position = 2000 + 2000 + 4;
    expect(mix([sliced], 4)[0]).toBeCloseTo(0.25, 6);
  });

  test('a continuation crossfades with the slice before it to the uncut level', () => {
    const previous = voice({ offsetSeconds: 0, durationSeconds: 0.25 });
    const next = voice({ offsetSeconds: 0.25, durationSeconds: 0.25 });
    previous.position = 2000;
    const mixed = mix([previous, next], 8);
    for (const value of mixed) expect(value).toBeCloseTo(0.5, 6);
  });
});
