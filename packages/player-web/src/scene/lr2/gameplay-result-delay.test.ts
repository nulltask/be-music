import type { TimingResolver, TimedSampleTrigger } from '@be-music/audio-renderer/triggers';
import { createEmptyJson, type BeMusicEvent } from '@be-music/json';
import type { TimedPlayableNote } from '@be-music/player/playable-notes';
import { describe, expect, it } from 'vitest';
import { resolveGameplayAudioTailCleanupDelayMs, resolvePostChartResultDelayMs } from './gameplay-result-delay.ts';

const resolver = {
  beatToSeconds: (beat) => beat * 0.5,
} satisfies Pick<TimingResolver, 'beatToSeconds'>;

function note(overrides: Partial<TimedPlayableNote>): TimedPlayableNote {
  return {
    event: mkEvent('11', '01'),
    channel: '11',
    beat: 0,
    seconds: 0,
    judged: false,
    ...overrides,
  };
}

function mkEvent(channel: string, value: string): BeMusicEvent {
  return { measure: 0, position: [0, 1], channel, value };
}

function mockBuffer(duration: number): AudioBuffer {
  return { duration } as AudioBuffer;
}

describe('resolvePostChartResultDelayMs', () => {
  it('waits about two 4/4 measures after the last note before result transition', () => {
    const delay = resolvePostChartResultDelayMs(
      [
        note({ beat: 4, seconds: 2 }),
        note({ beat: 12, seconds: 6 }),
      ],
      resolver,
      6,
    );

    expect(delay).toBe(4000);
  });

  it('uses the long-note tail as the delay anchor', () => {
    const delay = resolvePostChartResultDelayMs(
      [note({ beat: 4, seconds: 2, endBeat: 8, endSeconds: 4 })],
      resolver,
      4,
    );

    expect(delay).toBe(4000);
  });

  it('keeps a one-frame delay when the target time has already passed', () => {
    expect(resolvePostChartResultDelayMs([note({ beat: 4, seconds: 2 })], resolver, 20)).toBe(50);
  });
});

describe('resolveGameplayAudioTailCleanupDelayMs', () => {
  it('keeps the gameplay audio graph alive until the longest known sample tail ends', () => {
    const chart = createEmptyJson('bms');
    chart.resources.wav = { '01': 'short.wav', '02': 'tail.wav' };
    const autoEvent = mkEvent('01', '02');

    const delay = resolveGameplayAudioTailCleanupDelayMs({
      chart,
      notes: [note({ event: mkEvent('11', '01'), seconds: 3 })],
      autoSampleTriggers: [
        { event: autoEvent, seconds: 5 } satisfies Pick<TimedSampleTrigger, 'event' | 'seconds'>,
      ],
      decodedSamples: new Map([
        ['short.wav', mockBuffer(1)],
        ['tail.wav', mockBuffer(4)],
      ]),
      currentSeconds: 6,
    });

    expect(delay).toBe(3500);
  });

  it('honors bmson slice duration when estimating the remaining audio tail', () => {
    const chart = createEmptyJson('bmson');
    chart.resources.wav = { '01': 'voice.wav' };
    const event = mkEvent('11', '01');

    const delay = resolveGameplayAudioTailCleanupDelayMs({
      chart,
      notes: [note({ event, seconds: 10 })],
      autoSampleTriggers: [],
      decodedSamples: new Map([['voice.wav', mockBuffer(8)]]),
      bmsonSlicePlayback: new Map([[event, { offsetSeconds: 2, durationSeconds: 1.25 }]]),
      currentSeconds: 10.5,
    });

    expect(delay).toBe(1250);
  });
});
