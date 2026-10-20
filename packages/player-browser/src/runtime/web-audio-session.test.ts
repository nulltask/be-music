import { describe, expect, test, vi } from 'vite-plus/test';
import { createEmptyJSON, type BeMusicEvent } from '../../../chart-source/src/index.ts';
import type { AudioBusHandle } from './audio-bus.ts';
import {
  clampSampleDuration,
  clampSampleOffset,
  createWebAudioSession,
  decodedSampleKey,
  LIVE_TEMPO_RAMP_SECONDS,
} from './web-audio-session.ts';

/**
 * Stubs the Web Audio API surface that {@link createWebAudioSession} touches. The session never reaches
 * `audioContext.destination` directly — only the bus mixers — so we can lean on lightweight mocks without standing
 * up the full `AudioContext` polyfill.
 */
function createMocks(): {
  audioContext: AudioContext;
  audioBus: AudioBusHandle;
  trackedBufferSources: { buffer: AudioBuffer | null; connectedTo: GainNode | null; node: AudioBufferSourceNode }[];
  createdGains: GainNode[];
  keyMixer: GainNode;
  bgmMixer: GainNode;
} {
  const trackedBufferSources: {
    buffer: AudioBuffer | null;
    connectedTo: GainNode | null;
    node: AudioBufferSourceNode;
  }[] = [];
  const createdGains: GainNode[] = [];

  const makeGainNode = (): GainNode => {
    const gain = {
      value: 1,
      setValueAtTime: vi.fn(),
    };
    return {
      connect: vi.fn(),
      disconnect: vi.fn(),
      gain,
    } as unknown as GainNode;
  };

  const keyMixer = makeGainNode();
  const bgmMixer = makeGainNode();
  const outputNode = makeGainNode();

  const audioContext = {
    currentTime: 0,
    createBufferSource: vi.fn(() => {
      const node = {
        buffer: null as AudioBuffer | null,
        playbackRate: {
          value: 1,
          cancelScheduledValues: vi.fn(),
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
        },
        onended: null as null | (() => void),
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(() => {
          // Fire onended synchronously so test assertions can observe the cleanup path.
          if (typeof node.onended === 'function') node.onended();
        }),
      };
      const tracker = {
        get buffer() {
          return node.buffer;
        },
        connectedTo: null as GainNode | null,
        node: node as unknown as AudioBufferSourceNode,
      };
      // Capture the first `connect()` target so the test can assert routing without poking the mock arrays directly.
      const realConnect = node.connect;
      node.connect = vi.fn((target: AudioNode | GainNode) => {
        tracker.connectedTo = target as GainNode;
        return realConnect(target);
      });
      trackedBufferSources.push(tracker);
      return node as unknown as AudioBufferSourceNode;
    }),
    createGain: vi.fn(() => {
      const gain = makeGainNode();
      createdGains.push(gain);
      return gain;
    }),
    suspend: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
  } as unknown as AudioContext;

  const audioBus = {
    keyMixer,
    bgmMixer,
    outputNode,
    mode: 'split',
    setMode: vi.fn(),
    getMode: vi.fn(() => 'split'),
    setStageEnabled: vi.fn(),
    getStageEnabled: vi.fn(() => true),
    setMasterGain: vi.fn(),
    getMasterGain: vi.fn(() => 1),
    fadeOutAudibleTo: vi.fn(),
    resetFadeGain: vi.fn(),
    dispose: vi.fn(),
  } as unknown as AudioBusHandle;

  return { audioContext, audioBus, trackedBufferSources, createdGains, keyMixer, bgmMixer };
}

function makeChartWithSamples(): ReturnType<typeof createEmptyJSON> {
  const json = createEmptyJSON('bms');
  json.metadata.bpm = 120;
  json.resources.wav = { '01': 'kick.wav', '02': 'snare.wav', '03': 'bgm.wav' };
  return json;
}

function makeMockAudioBuffer(durationSeconds = 1): AudioBuffer {
  return { duration: durationSeconds, length: 44100, numberOfChannels: 2, sampleRate: 44100 } as unknown as AudioBuffer;
}

const mkEvent = (channel: string, value: string, extra: Partial<BeMusicEvent> = {}): BeMusicEvent => ({
  measure: 0,
  channel,
  position: [0, 1],
  value,
  ...extra,
});

describe('createWebAudioSession', () => {
  test('routes player-input lane events to keyMixer and BGM-style channels to bgmMixer', () => {
    const { audioContext, audioBus, trackedBufferSources, keyMixer, bgmMixer } = createMocks();
    const session = createWebAudioSession({
      audioContext,
      audioBus,
      chart: makeChartWithSamples(),
      decodedSamples: new Map([
        ['kick.wav', makeMockAudioBuffer()],
        ['bgm.wav', makeMockAudioBuffer()],
      ]),
      wavCmdVolumeMultipliers: new Map(),
    });

    session.start();
    // Player-input channel (`#xxx11` = 1P key 1).
    session.triggerEvent?.(mkEvent('11', '01'));
    // BGM channel (`#xxx01`).
    session.triggerEvent?.(mkEvent('01', '03'));

    expect(trackedBufferSources).toHaveLength(2);
    expect(trackedBufferSources[0]!.connectedTo).toBe(keyMixer);
    expect(trackedBufferSources[1]!.connectedTo).toBe(bgmMixer);
  });

  test("plays a stitched NONSTOP stage's samples at its rate and its background through its fade", () => {
    const { audioContext, audioBus, trackedBufferSources, keyMixer } = createMocks();
    const stageFade = { connect: vi.fn() } as unknown as GainNode;
    const session = createWebAudioSession({
      audioContext,
      audioBus,
      chart: makeChartWithSamples(),
      decodedSamples: new Map([
        ['kick.wav', makeMockAudioBuffer()],
        ['bgm.wav', makeMockAudioBuffer()],
      ]),
      wavCmdVolumeMultipliers: new Map(),
      stageMixer: {
        stageOf: (key) => (key === '03' || key === '01' ? 1 : undefined),
        rate: () => 1.25,
        bgmInput: () => stageFade,
      },
    });
    session.start();
    session.triggerEvent?.(mkEvent('11', '01'));
    session.triggerEvent?.(mkEvent('01', '03'));
    session.triggerEvent?.(mkEvent('01', '02'));
    const [key, bgm, other] = trackedBufferSources;
    // The player's keysound keeps the key bus but plays at the stage's rate.
    expect(key!.connectedTo).toBe(keyMixer);
    expect(key!.node.playbackRate.value).toBe(1.25);
    expect(bgm!.connectedTo).toBe(stageFade);
    expect(bgm!.node.playbackRate.value).toBe(1.25);
    // A sample of no stage is left alone.
    expect(other?.node.playbackRate.value ?? 1).toBe(1);
  });

  test('plays every sample at the play tempo, multiplied with a NONSTOP stage rate', () => {
    const { audioContext, audioBus, trackedBufferSources } = createMocks();
    const session = createWebAudioSession({
      audioContext,
      audioBus,
      chart: makeChartWithSamples(),
      decodedSamples: new Map([
        ['kick.wav', makeMockAudioBuffer()],
        ['bgm.wav', makeMockAudioBuffer()],
      ]),
      wavCmdVolumeMultipliers: new Map(),
      playbackRate: 0.8,
      stageMixer: {
        stageOf: (key) => (key === '03' ? 1 : undefined),
        rate: () => 1.25,
        bgmInput: () => undefined,
      },
    });
    session.start();
    session.triggerEvent?.(mkEvent('11', '01'));
    session.triggerEvent?.(mkEvent('01', '03'));
    const [key, staged] = trackedBufferSources;
    expect(key!.node.playbackRate.value).toBe(0.8);
    expect(staged!.node.playbackRate.value).toBe(1);
  });

  test('a live tempo change sets the rate of later samples and glides the ones playing, in pitch mode', () => {
    const { audioContext, audioBus, trackedBufferSources } = createMocks();
    const session = createWebAudioSession({
      audioContext,
      audioBus,
      chart: makeChartWithSamples(),
      decodedSamples: new Map([
        ['kick.wav', makeMockAudioBuffer()],
        ['bgm.wav', makeMockAudioBuffer()],
      ]),
      wavCmdVolumeMultipliers: new Map(),
      playbackRate: 0.8,
      playbackRateFollowsTempo: true,
      stageMixer: {
        stageOf: (key) => (key === '03' ? 1 : undefined),
        rate: () => 1.25,
        bgmInput: () => undefined,
      },
    });
    session.start();
    session.triggerEvent?.(mkEvent('01', '03'));
    (audioContext as { currentTime: number }).currentTime = 2;
    session.setTempo?.(1.2);
    const playing = trackedBufferSources[0]!.node.playbackRate;
    // The playing BGM glides from its rate to the new tempo times its stage rate.
    expect(playing.cancelScheduledValues).toHaveBeenCalledWith(2);
    expect(playing.setValueAtTime).toHaveBeenCalledWith(1, 2);
    expect(playing.linearRampToValueAtTime).toHaveBeenCalledWith(1.5, 2 + LIVE_TEMPO_RAMP_SECONDS);
    session.triggerEvent?.(mkEvent('11', '01'));
    expect(trackedBufferSources[1]!.node.playbackRate.value).toBe(1.2);
  });

  test('ignores a live tempo change unless the rate follows the tempo (keep pitch)', () => {
    const { audioContext, audioBus, trackedBufferSources } = createMocks();
    const session = createWebAudioSession({
      audioContext,
      audioBus,
      chart: makeChartWithSamples(),
      decodedSamples: new Map([['kick.wav', makeMockAudioBuffer()]]),
      wavCmdVolumeMultipliers: new Map(),
    });
    session.start();
    session.triggerEvent?.(mkEvent('11', '01'));
    session.setTempo?.(1.2);
    expect(trackedBufferSources[0]!.node.playbackRate.linearRampToValueAtTime).not.toHaveBeenCalled();
    session.triggerEvent?.(mkEvent('11', '01'));
    expect(trackedBufferSources[1]!.node.playbackRate.value).toBe(1);
  });

  test('applies #WAVCMD per-slot gain via an intermediate GainNode', () => {
    const { audioContext, audioBus, trackedBufferSources, keyMixer } = createMocks();
    const session = createWebAudioSession({
      audioContext,
      audioBus,
      chart: makeChartWithSamples(),
      decodedSamples: new Map([['kick.wav', makeMockAudioBuffer()]]),
      wavCmdVolumeMultipliers: new Map([['01', 0.5]]),
    });

    session.triggerEvent?.(mkEvent('11', '01'));

    expect(audioContext.createGain).toHaveBeenCalledTimes(1);
    // The source connects to the gain node first (not directly to keyMixer); the per-slot gain then connects to
    // the mixer.
    expect(trackedBufferSources[0]!.connectedTo).not.toBe(keyMixer);
  });

  test('disconnects the #WAVCMD GainNode when the source ends', () => {
    const { audioContext, audioBus, trackedBufferSources, createdGains } = createMocks();
    const session = createWebAudioSession({
      audioContext,
      audioBus,
      chart: makeChartWithSamples(),
      decodedSamples: new Map([['kick.wav', makeMockAudioBuffer()]]),
      wavCmdVolumeMultipliers: new Map([['01', 0.5]]),
    });

    session.triggerEvent?.(mkEvent('11', '01'));
    trackedBufferSources[0]!.node.onended?.(new Event('ended') as Event);

    expect(trackedBufferSources[0]!.node.disconnect).toHaveBeenCalled();
    expect(createdGains[0]!.disconnect).toHaveBeenCalled();
  });

  test('honours bmson c=true continuation by suppressing retriggers of an in-flight slot', () => {
    const { audioContext, audioBus, trackedBufferSources } = createMocks();
    const session = createWebAudioSession({
      audioContext,
      audioBus,
      chart: makeChartWithSamples(),
      decodedSamples: new Map([['kick.wav', makeMockAudioBuffer()]]),
      wavCmdVolumeMultipliers: new Map(),
    });

    session.triggerEvent?.(mkEvent('11', '01'));
    // Same slot, c=true, sample still in-flight (onended hasn't fired) — must not allocate a fresh source.
    session.triggerEvent?.(mkEvent('11', '01', { bmson: { c: true } }));

    expect(trackedBufferSources).toHaveLength(1);
  });

  test('stops the previous BMS source when the same #WAV slot is retriggered', () => {
    const { audioContext, audioBus, trackedBufferSources } = createMocks();
    const session = createWebAudioSession({
      audioContext,
      audioBus,
      chart: makeChartWithSamples(),
      decodedSamples: new Map([['kick.wav', makeMockAudioBuffer(5)]]),
      wavCmdVolumeMultipliers: new Map(),
    });

    session.triggerEvent?.(mkEvent('11', '01'));
    const firstSource = trackedBufferSources[0]!.node;
    session.triggerEvent?.(mkEvent('12', '01'));

    expect(trackedBufferSources).toHaveLength(2);
    expect(firstSource.stop).toHaveBeenCalledTimes(1);
    expect(firstSource.disconnect).toHaveBeenCalled();
  });

  test('schedules the previous BMS source to stop when a later same-slot BGM cue starts', () => {
    const { audioContext, audioBus, trackedBufferSources } = createMocks();
    const session = createWebAudioSession({
      audioContext,
      audioBus,
      chart: makeChartWithSamples(),
      decodedSamples: new Map([['bgm.wav', makeMockAudioBuffer(5)]]),
      wavCmdVolumeMultipliers: new Map(),
    });

    session.scheduleEvent(mkEvent('01', '03'), 1);
    const firstSource = trackedBufferSources[0]!.node;
    session.scheduleEvent(mkEvent('01', '03'), 2);

    expect(trackedBufferSources).toHaveLength(2);
    expect(firstSource.stop).toHaveBeenCalledWith(2);
  });

  test('stopChannel halts the most recent BufferSource on that channel', () => {
    const { audioContext, audioBus, trackedBufferSources } = createMocks();
    const session = createWebAudioSession({
      audioContext,
      audioBus,
      chart: makeChartWithSamples(),
      decodedSamples: new Map([['kick.wav', makeMockAudioBuffer()]]),
      wavCmdVolumeMultipliers: new Map(),
    });

    session.triggerEvent?.(mkEvent('11', '01'));
    const source = trackedBufferSources[0]!.node;
    session.stopChannel?.('11');
    expect(source.stop).toHaveBeenCalled();
  });

  test('applies #xxx97 / #xxx98 dynamic volume only to voices triggered afterward', () => {
    const { audioContext, audioBus, trackedBufferSources, createdGains, keyMixer, bgmMixer } = createMocks();
    const session = createWebAudioSession({
      audioContext,
      audioBus,
      chart: makeChartWithSamples(),
      decodedSamples: new Map([
        ['kick.wav', makeMockAudioBuffer(5)],
        ['bgm.wav', makeMockAudioBuffer(5)],
      ]),
      wavCmdVolumeMultipliers: new Map(),
    });

    // A BGM voice playing BEFORE the volume change keeps its level: no per-voice gain node, no bus write.
    session.triggerEvent?.(mkEvent('01', '03'));
    expect(trackedBufferSources[0]!.connectedTo).toBe(bgmMixer);

    // `#xxx97 80` — ~half volume for SUBSEQUENT BGM voices (0x80 / 0xff ≈ 0.5019).
    session.triggerEvent?.(mkEvent('97', '80'));
    // Spec: already-playing voices are untouched — the shared bus mixers must not be written.
    expect(
      (bgmMixer.gain as unknown as { setValueAtTime: ReturnType<typeof vi.fn> }).setValueAtTime,
    ).not.toHaveBeenCalled();

    // The next BGM voice picks the new level up as its initial per-voice gain.
    session.triggerEvent?.(mkEvent('01', '03'));
    expect(createdGains).toHaveLength(1);
    expect((createdGains[0]!.gain as unknown as { value: number }).value).toBeCloseTo(0x80 / 0xff, 6);

    // `#xxx98 FF` — unity on the key side: no gain node needed, the source connects straight to the key mixer.
    session.triggerEvent?.(mkEvent('98', 'FF'));
    session.triggerEvent?.(mkEvent('11', '01'));
    expect(
      (keyMixer.gain as unknown as { setValueAtTime: ReturnType<typeof vi.fn> }).setValueAtTime,
    ).not.toHaveBeenCalled();
    expect(trackedBufferSources.at(-1)!.connectedTo).toBe(keyMixer);
  });

  test('dispose hard-stops every still-playing source so they do not survive into the next chart', async () => {
    const { audioContext, audioBus, trackedBufferSources } = createMocks();
    const session = createWebAudioSession({
      audioContext,
      audioBus,
      chart: makeChartWithSamples(),
      decodedSamples: new Map([
        ['kick.wav', makeMockAudioBuffer()],
        ['snare.wav', makeMockAudioBuffer()],
      ]),
      wavCmdVolumeMultipliers: new Map(),
    });

    session.triggerEvent?.(mkEvent('11', '01'));
    session.triggerEvent?.(mkEvent('12', '02'));
    await session.dispose();
    for (const tracked of trackedBufferSources) {
      expect(tracked.node.stop).toHaveBeenCalled();
    }
  });

  test('reports the configured backendLabel + chartStartDelayMs (defaults applied)', () => {
    const { audioContext, audioBus } = createMocks();
    const defaults = createWebAudioSession({
      audioContext,
      audioBus,
      chart: makeChartWithSamples(),
      decodedSamples: new Map(),
      wavCmdVolumeMultipliers: new Map(),
    });
    expect(defaults.backendLabel).toBe('web-audio');
    expect(defaults.chartStartDelayMs).toBe(0);

    const overridden = createWebAudioSession({
      audioContext,
      audioBus,
      chart: makeChartWithSamples(),
      decodedSamples: new Map(),
      wavCmdVolumeMultipliers: new Map(),
      backendLabel: 'web-audio-with-recorder',
      chartStartDelayMs: 25,
    });
    expect(overridden.backendLabel).toBe('web-audio-with-recorder');
    expect(overridden.chartStartDelayMs).toBe(25);
  });
});

describe('clampSampleOffset / clampSampleDuration', () => {
  test('clampSampleOffset collapses non-finite / negative inputs to zero and saturates near EOF', () => {
    expect(clampSampleOffset(undefined, 1)).toBe(0);
    expect(clampSampleOffset(-1, 1)).toBe(0);
    expect(clampSampleOffset(Number.NaN, 1)).toBe(0);
    expect(clampSampleOffset(0.5, 1)).toBe(0.5);
    // Equal-or-past EOF clamps to just before the tail so Web Audio still emits something.
    expect(clampSampleOffset(2, 1)).toBeCloseTo(1 - 1e-3, 6);
  });

  test('clampSampleDuration returns undefined for missing / nonpositive input and caps at remaining tail', () => {
    expect(clampSampleDuration(undefined, 1, 0)).toBeUndefined();
    expect(clampSampleDuration(0, 1, 0)).toBeUndefined();
    expect(clampSampleDuration(-1, 1, 0)).toBeUndefined();
    expect(clampSampleDuration(0.3, 1, 0.5)).toBeCloseTo(0.3, 6);
    expect(clampSampleDuration(2, 1, 0.5)).toBeCloseTo(0.5, 6);
  });
});

describe('decodedSampleKey', () => {
  test('resolves dot segments, doubled and back slashes, and case', () => {
    expect(decodedSampleKey('./Sound/Kick.WAV')).toBe('sound/kick.wav');
    expect(decodedSampleKey('bms\\..\\common//Snare.ogg')).toBe('common/snare.ogg');
    expect(decodedSampleKey('kick.wav')).toBe(decodedSampleKey('KICK.wav'));
  });
});
