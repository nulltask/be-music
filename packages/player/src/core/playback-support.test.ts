import { describe, expect, test } from 'vitest';
import { createUiFramePublisher } from './playback-support.ts';
import type { PlayerUiFramePayload, PlayerUiSignalBus } from './ui-signal-bus.ts';

function createCapturingUiSignals(): { uiSignals: PlayerUiSignalBus; frames: PlayerUiFramePayload[] } {
  const frames: PlayerUiFramePayload[] = [];
  const noopTick: PlayerUiSignalBus['frameTick'] = (value?: number): number => value ?? 0;
  const uiSignals: PlayerUiSignalBus = {
    frameTick: noopTick,
    commandTick: noopTick,
    getFrame: () => {
      throw new Error('not used by createUiFramePublisher');
    },
    publishFrame: (frame) => {
      frames.push(frame);
    },
    pushCommand: () => undefined,
    drainCommands: () => [],
  };
  return { uiSignals, frames };
}

const SUMMARY: PlayerUiFramePayload['summary'] = {
  total: 0,
  perfect: 0,
  fast: 0,
  slow: 0,
  great: 0,
  good: 0,
  bad: 0,
  poor: 0,
  emptyPoor: 0,
  exScore: 0,
  score: 0,
};

describe('createUiFramePublisher', () => {
  test('mirrors the display clock past the LR2 reversal and pins it at the chart head', () => {
    const { uiSignals, frames } = createCapturingUiSignals();
    const publish = createUiFramePublisher({
      uiEnabled: true,
      uiSignals,
      totalSeconds: 10,
      summary: SUMMARY,
      notes: [],
      audioBackend: 'test-audio',
      resolveDebugActiveAudioState: () => ({}),
      // BPM constant on the mirrored leg: 1 second = 2 beats.
      reversal: { seconds: 2, beatAtSeconds: (seconds) => seconds * 2 },
    });

    // Before the reversal the true clock is the display clock — no mirrored fields.
    publish(1, 2);
    // Exactly AT the reversal the mirror has not started yet (strictly past only).
    publish(2, 4);
    // Past it the display clock recedes: displaySeconds = 2 * reversal - now.
    publish(3, 6);
    // Once the mirror rewinds past the chart head the display pins at 0 instead of going negative.
    publish(5, 10);

    expect(frames).toHaveLength(4);
    expect(frames[0]).toMatchObject({ currentSeconds: 1, currentBeat: 2, reversalSeconds: 2 });
    expect(frames[0]?.displaySeconds).toBeUndefined();
    expect(frames[0]?.displayBeat).toBeUndefined();
    expect(frames[1]?.displaySeconds).toBeUndefined();
    expect(frames[1]?.displayBeat).toBeUndefined();
    expect(frames[2]).toMatchObject({ currentSeconds: 3, displaySeconds: 1, displayBeat: 2 });
    expect(frames[3]).toMatchObject({ currentSeconds: 5, displaySeconds: 0, displayBeat: 0 });
    // The reversal anchor rides on EVERY frame while armed — renderers freeze BGA layers against it.
    for (const frame of frames) {
      expect(frame.reversalSeconds).toBe(2);
    }
  });

  test('publishes no display fields and no reversal anchor when the chart has no reversal', () => {
    const { uiSignals, frames } = createCapturingUiSignals();
    const publish = createUiFramePublisher({
      uiEnabled: true,
      uiSignals,
      totalSeconds: 10,
      summary: SUMMARY,
      notes: [],
      audioBackend: 'test-audio',
      resolveDebugActiveAudioState: () => ({}),
    });

    publish(3, 6);

    expect(frames).toHaveLength(1);
    expect(frames[0]?.displaySeconds).toBeUndefined();
    expect(frames[0]?.displayBeat).toBeUndefined();
    expect(frames[0]?.reversalSeconds).toBeUndefined();
  });
});
