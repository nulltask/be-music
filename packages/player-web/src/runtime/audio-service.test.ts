import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { createEmptyJson } from '@be-music/json';
import type { ChartPreviewEngineOptions, ChartPreviewTarget } from '../chart/preview.ts';
import { SILENT_AUDIO } from './audio-analysis.ts';
import type { AudioBusHandle } from './audio-bus.ts';
import { createAudioService, type AudioServiceOptions, type ChartPreviewPlayer } from './audio-service.ts';

interface FakeNode {
  readonly kind: string;
  readonly gain: { value: number };
  readonly connections: FakeNode[];
  connect: (target: FakeNode) => FakeNode;
  disconnect: () => void;
}

interface FakeSource extends FakeNode {
  buffer: AudioBuffer | null;
  loop: boolean;
  onended: (() => void) | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

function fakeNode(kind: string): FakeNode {
  const node: FakeNode = {
    kind,
    gain: { value: 1 },
    connections: [],
    connect: (target) => {
      node.connections.push(target);
      return target;
    },
    disconnect: vi.fn(() => {
      node.connections.length = 0;
    }),
  };
  return node;
}

/** A stand-in `AudioContext` that records the sources it starts and decodes through `decode`. */
function createFakeContext(decode: (bytes: ArrayBuffer) => Promise<AudioBuffer> = async () => fakeBuffer()) {
  const sources: FakeSource[] = [];
  const context = {
    state: 'running',
    sampleRate: 48_000,
    currentTime: 0,
    destination: fakeNode('destination'),
    addEventListener: vi.fn(),
    createGain: () => fakeNode('gain'),
    createAnalyser: () => ({
      ...fakeNode('analyser'),
      fftSize: 2048,
      frequencyBinCount: 1024,
      getByteFrequencyData: vi.fn(),
      getFloatTimeDomainData: vi.fn(),
    }),
    createBufferSource: () => {
      const source: FakeSource = {
        ...fakeNode('source'),
        buffer: null,
        loop: false,
        onended: null,
        start: vi.fn(),
        // A browser fires `onended` after `stop()`; firing it at once also checks that the cleanup is idempotent.
        stop: vi.fn(() => source.onended?.()),
      };
      sources.push(source);
      return source;
    },
    decodeAudioData: vi.fn(decode),
    resume: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
  return { context: context as unknown as AudioContext, raw: context, sources };
}

function fakeBuffer(): AudioBuffer {
  return { duration: 1 } as AudioBuffer;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** The bus a started voice plays into: source → its own gain → the bus. */
function busOf(source: FakeSource): FakeNode {
  const voiceGain = source.connections[0]!;
  return voiceGain.connections[0]!;
}

function createService(
  fake = createFakeContext(),
  options: Omit<AudioServiceOptions, 'createContext'> = {},
): { service: ReturnType<typeof createAudioService>; fake: ReturnType<typeof createFakeContext> } {
  return { service: createAudioService({ ...options, createContext: () => fake.context }), fake };
}

const scene = { name: 'scene' };
const other = { name: 'other' };

describe('createAudioService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates the system context on first use and keeps it', async () => {
    const fake = createFakeContext();
    const createContext = vi.fn(() => fake.context);
    const service = createAudioService({ createContext });
    // A slot the theme does not fill plays nothing and does not create a context.
    await expect(service.playCue('cursor')).resolves.toBe(false);
    expect(createContext).not.toHaveBeenCalled();
    expect(service.getContext()).toBe(fake.context);
    service.resume();
    expect(service.getContext()).toBe(fake.context);
    expect(createContext).toHaveBeenCalledTimes(1);
    expect(fake.raw.resume).toHaveBeenCalled();
  });

  it('plays nothing where Web Audio is missing', async () => {
    const service = createAudioService({ createContext: () => undefined });
    service.setTheme({ sounds: { cursor: { bytes: new Uint8Array([1]) } } });
    await expect(service.playCue('cursor')).resolves.toBe(false);
    await expect(service.playBgm({ bytes: new Uint8Array([2]) })).resolves.toBe(false);
    await expect(service.decode(new Uint8Array([3]))).resolves.toBeUndefined();
    expect(service.skinSounds.play('missing.wav', 1)).toBe(false);
    expect(service.getContext()).toBeUndefined();
    expect(service.analyzer.sample(0)).toBe(SILENT_AUDIO);
    service.preview.focus({} as ChartPreviewTarget, scene);
    expect(service.preview.playing).toBe(false);
  });

  it('decodes each bytes once, a failed decode included', async () => {
    const good = new Uint8Array([1, 2, 3]);
    const bad = new Uint8Array([9]);
    const fake = createFakeContext(async (buffer) => {
      if (new Uint8Array(buffer)[0] === 9) throw new Error('unsupported');
      return fakeBuffer();
    });
    const { service } = createService(fake);
    service.setTheme({ sounds: { cursor: { bytes: good }, decide: { bytes: bad } } });
    await expect(service.playCue('cursor')).resolves.toBe(true);
    await expect(service.playCue('cursor')).resolves.toBe(true);
    await expect(service.decode(good)).resolves.toEqual(fakeBuffer());
    expect(fake.raw.decodeAudioData).toHaveBeenCalledTimes(1);
    // The decode gets a copy, so the theme's bytes stay usable.
    expect(fake.raw.decodeAudioData.mock.calls[0]![0]).not.toBe(good.buffer);
    await expect(service.playCue('decide')).resolves.toBe(false);
    await expect(service.playCue('decide')).resolves.toBe(false);
    expect(fake.raw.decodeAudioData).toHaveBeenCalledTimes(2);
    // Equal contents in other bytes decode again: the cache is keyed by the bytes, not their contents.
    await service.decode(new Uint8Array([1, 2, 3]));
    expect(fake.raw.decodeAudioData).toHaveBeenCalledTimes(3);
  });

  it('plays cues once on the cue bus and clamps their level', async () => {
    const { service, fake } = createService();
    service.setTheme({ sounds: { cursor: { bytes: new Uint8Array([1]) } } });
    await service.playCue('cursor', { volume: 2 });
    await service.playCue('cursor', { volume: 0.25 });
    await service.playCue('cursor', { volume: Number.NaN });
    expect(fake.sources.map((source) => source.loop)).toEqual([false, false, false]);
    expect(fake.sources.map((source) => source.connections[0]!.gain.value)).toEqual([1, 0.25, 1]);
    expect(fake.sources.every((source) => source.start.mock.calls.length === 1)).toBe(true);
    expect(new Set(fake.sources.map(busOf)).size).toBe(1);
  });

  it('plays a resolved sound as a cue, without a theme, on the cue bus', async () => {
    const { service, fake } = createService();
    await expect(service.playCue({ bytes: new Uint8Array([1]) })).resolves.toBe(true);
    await expect(service.playCue(undefined)).resolves.toBe(false);
    service.setTheme({ sounds: { cursor: { bytes: new Uint8Array([2]) } } });
    await service.playCue('cursor');
    expect(fake.sources).toHaveLength(2);
    expect(new Set(fake.sources.map(busOf)).size).toBe(1);
  });

  it('reads a path-only sound from the theme files, case-insensitively', async () => {
    const bytes = new Uint8Array([4, 5]);
    const { service, fake } = createService();
    service.setTheme({
      sounds: { cursor: { path: 'Sound/Cursor.WAV' }, cancel: { path: 'sound/none.wav' } },
      files: new Map([['sound/cursor.wav', bytes]]),
    });
    await expect(service.playCue('cursor')).resolves.toBe(true);
    await expect(service.playCue('cancel')).resolves.toBe(false);
    expect(fake.sources).toHaveLength(1);
    expect(new Uint8Array(fake.raw.decodeAudioData.mock.calls[0]![0])).toEqual(bytes);
    // Without files a path-only sound plays nothing.
    service.setTheme({ sounds: { cursor: { path: 'Sound/Cursor.WAV' } } });
    await expect(service.playCue('cursor')).resolves.toBe(false);
  });

  it('keeps one BGM: a new one replaces it, the same one keeps playing', async () => {
    const first = { bytes: new Uint8Array([1]) };
    const second = { bytes: new Uint8Array([2]) };
    const { service, fake } = createService();
    await expect(service.playBgm(first, { owner: scene, volume: 0.5 })).resolves.toBe(true);
    expect(fake.sources[0]!.loop).toBe(true);
    expect(fake.sources[0]!.connections[0]!.gain.value).toBe(0.5);
    // The same sound again (a scene entering twice) changes its owner and level only.
    await expect(service.playBgm(first, { owner: other, volume: 0.7 })).resolves.toBe(true);
    expect(fake.sources).toHaveLength(1);
    expect(fake.sources[0]!.connections[0]!.gain.value).toBe(0.7);
    service.stopOwned(scene);
    expect(fake.sources[0]!.stop).not.toHaveBeenCalled();
    await service.playBgm(second, { owner: other, loop: false });
    expect(fake.sources[0]!.stop).toHaveBeenCalled();
    expect(fake.sources[1]!.loop).toBe(false);
    service.stopBgm(scene);
    expect(fake.sources[1]!.stop).not.toHaveBeenCalled();
    service.stopBgm(other);
    expect(fake.sources[1]!.stop).toHaveBeenCalled();
  });

  it('plays a slot of the theme as the BGM or a jingle', async () => {
    const { service, fake } = createService();
    service.setTheme({ sounds: { selectBgm: { bytes: new Uint8Array([1]) }, clear: { bytes: new Uint8Array([2]) } } });
    await expect(service.playBgm('selectBgm')).resolves.toBe(true);
    await expect(service.playJingle('clear')).resolves.toBe(true);
    await expect(service.playJingle('fail')).resolves.toBe(false);
    await expect(service.playJingle(undefined)).resolves.toBe(false);
    expect(fake.sources.map((source) => source.loop)).toEqual([true, false]);
    service.stopBgm();
    expect(fake.sources[0]!.stop).toHaveBeenCalled();
  });

  it('stops what an owner started, decodes in flight included, and leaves the rest', async () => {
    const decoding = deferred<AudioBuffer>();
    const fake = createFakeContext(() => decoding.promise);
    const { service } = createService(fake);
    const jingle = service.playJingle({ bytes: new Uint8Array([1]) }, { owner: scene });
    service.stopOwned(scene);
    decoding.resolve(fakeBuffer());
    await expect(jingle).resolves.toBe(false);
    expect(fake.sources).toHaveLength(0);

    const owned = service.playJingle({ bytes: new Uint8Array([1]) }, { owner: scene });
    const unowned = service.playJingle({ bytes: new Uint8Array([1]) });
    const others = service.playCue('cursor', { owner: other });
    await Promise.all([owned, unowned, others]);
    expect(fake.sources).toHaveLength(2);
    service.stopOwned(scene);
    expect(fake.sources[0]!.stop).toHaveBeenCalled();
    expect(fake.sources[1]!.stop).not.toHaveBeenCalled();
  });

  it('plays the skin sounds through the theme files, and stops loops by path', async () => {
    const { service, fake } = createService();
    service.setTheme({ files: new Map([['Root/sounds/click.ogg', new Uint8Array([1])]]) });
    expect(service.skinSounds.play('root/SOUNDS/click.ogg', 0.5)).toBe(true);
    expect(service.skinSounds.play('missing.ogg', 1)).toBe(false);
    expect(service.skinSounds.loop('Root/sounds/click.ogg', 1)).toBe(true);
    const owned = service.skinSounds.owned(scene);
    expect(owned.loop('Root/sounds/click.ogg', 3)).toBe(true);
    await vi.waitFor(() => expect(fake.sources).toHaveLength(3));
    expect(fake.sources.map((source) => [source.loop, source.connections[0]!.gain.value])).toEqual([
      [false, 0.5],
      [true, 1],
      [true, 1],
    ]);
    service.stopOwned(scene);
    expect(fake.sources[2]!.stop).toHaveBeenCalled();
    expect(fake.sources[1]!.stop).not.toHaveBeenCalled();
    expect(service.skinSounds.stop('ROOT/sounds/click.ogg')).toBe(true);
    expect(fake.sources[1]!.stop).toHaveBeenCalled();
    expect(fake.sources[0]!.stop).not.toHaveBeenCalled();
    expect(service.skinSounds.stop('Root/sounds/click.ogg')).toBe(false);
    expect(service.skinSounds.stop('missing.ogg')).toBe(false);
  });

  it('ducks the BGM under an audible preview unless asked not to', async () => {
    let engineOptions: ChartPreviewEngineOptions | undefined;
    const engine: ChartPreviewPlayer = { focus: vi.fn(), stop: vi.fn(), dispose: vi.fn() };
    const createPreviewEngine = vi.fn((_context: AudioContext, _output: AudioNode, opts: ChartPreviewEngineOptions) => {
      engineOptions = opts;
      return engine;
    });
    const { service, fake } = createService(undefined, { createPreviewEngine, preview: { focusDelayMs: 5 } });
    const target = { song: { id: 'a' }, source: { id: 's' } } as unknown as ChartPreviewTarget;
    await service.playBgm({ bytes: new Uint8Array([1]) }, { owner: scene });
    const duck = busOf(fake.sources[0]!);
    service.preview.focus(target, scene);
    service.preview.focus(target, scene);
    expect(createPreviewEngine).toHaveBeenCalledTimes(1);
    expect(engineOptions?.focusDelayMs).toBe(5);
    expect(engine.focus).toHaveBeenLastCalledWith(target);

    engineOptions!.onPlaybackStart!(target);
    expect(service.preview.playing).toBe(true);
    expect(duck.gain.value).toBe(0);
    engineOptions!.onPlaybackStop!();
    expect(service.preview.playing).toBe(false);
    expect(duck.gain.value).toBe(1);

    await service.playBgm({ bytes: new Uint8Array([2]) }, { duckUnderPreview: false });
    engineOptions!.onPlaybackStart!(target);
    expect(duck.gain.value).toBe(1);
    engineOptions!.onPlaybackStop!();

    // The owner's exit forgets the focus, so focusing the same chart on re-entry starts it again.
    service.stopOwned(other);
    expect(engine.focus).not.toHaveBeenCalledWith(undefined);
    service.stopOwned(scene);
    expect(engine.focus).toHaveBeenLastCalledWith(undefined);
    service.dispose();
    expect(engine.dispose).toHaveBeenCalled();
  });

  it('analyses the music bus once the context exists', async () => {
    const { service } = createService();
    expect(service.analyzer.sample(0)).toBe(SILENT_AUDIO);
    await service.playJingle({ bytes: new Uint8Array([1]) });
    const features = service.analyzer.sample(16);
    expect(features).not.toBe(SILENT_AUDIO);
    expect(features.bands).toHaveLength(SILENT_AUDIO.bands.length);
  });

  it('opens a play graph per play and closes it after its tail', async () => {
    vi.useFakeTimers();
    const opened: { context: ReturnType<typeof createFakeContext>; bus: AudioBusHandle }[] = [];
    const createPlayGraph = vi.fn(() => {
      const context = createFakeContext();
      const bus = { outputNode: fakeNode('tap'), dispose: vi.fn() } as unknown as AudioBusHandle;
      opened.push({ context, bus });
      return { audioContext: context.context, audioBus: bus };
    });
    const { service } = createService(undefined, { createPlayGraph });
    const chart = createEmptyJson('bms');

    const first = service.openPlayGraph(chart, 'split', undefined, { owner: scene });
    expect(createPlayGraph).toHaveBeenCalledWith(chart, 'split', undefined);
    expect(first.audioContext).toBe(opened[0]!.context.context);
    expect((first.audioBus.outputNode as unknown as FakeNode).connections).toContain(first.analyzer.input);
    const beforeClose = vi.fn();
    first.close({ delayMs: 500, beforeClose });
    first.close();
    // Closing hands the graph over: the owner's exit no longer cuts its tail.
    service.stopOwned(scene);
    expect(opened[0]!.context.raw.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(beforeClose).toHaveBeenCalledTimes(1);
    expect(opened[0]!.bus.dispose).toHaveBeenCalledTimes(1);
    expect(opened[0]!.context.raw.close).toHaveBeenCalledTimes(1);

    service.openPlayGraph(chart, 'off', undefined, { owner: scene });
    service.openPlayGraph(chart, 'off', undefined, { owner: other });
    service.stopOwned(scene);
    expect(opened[1]!.context.raw.close).toHaveBeenCalledTimes(1);
    expect(opened[2]!.context.raw.close).not.toHaveBeenCalled();
    service.dispose();
    expect(opened[2]!.context.raw.close).toHaveBeenCalledTimes(1);
  });

  it('stops everything and plays nothing after dispose', async () => {
    vi.useFakeTimers();
    const { service, fake } = createService(undefined, {
      createPlayGraph: () => ({
        audioContext: createFakeContext().context,
        audioBus: { outputNode: fakeNode('tap'), dispose: vi.fn() } as unknown as AudioBusHandle,
      }),
    });
    await service.playBgm({ bytes: new Uint8Array([1]) });
    const graph = service.openPlayGraph(createEmptyJson('bms'), 'split');
    graph.close({ delayMs: 1_000 });
    service.dispose();
    service.dispose();
    expect(fake.sources[0]!.stop).toHaveBeenCalled();
    expect(fake.raw.close).toHaveBeenCalledTimes(1);
    expect((graph.audioContext as unknown as { close: ReturnType<typeof vi.fn> }).close).toHaveBeenCalledTimes(1);
    expect(service.getContext()).toBeUndefined();
    await expect(service.playJingle({ bytes: new Uint8Array([1]) })).resolves.toBe(false);
    expect(service.skinSounds.play('x', 1)).toBe(false);
  });
});
