import { createTimingResolver } from '@be-music/audio-renderer/triggers';
import { createEmptyJson } from '@be-music/json';
import { describe, expect, test } from 'vite-plus/test';
import { createUiFramePublisher } from './playback-support.ts';
import { createBeatAtSecondsResolverFromTimingResolver } from './timeline.ts';
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
  test('mirrors the display beat in chart-position space past the LR2 reversal and pins it at the chart head', () => {
    const { uiSignals, frames } = createCapturingUiSignals();
    const publish = createUiFramePublisher({
      uiEnabled: true,
      uiSignals,
      totalSeconds: 10,
      summary: SUMMARY,
      notes: [],
      audioBackend: 'test-audio',
      resolveDebugActiveAudioState: () => ({}),
      // LR2 mirrors the chart POSITION (`display = 2 * pos(R) - pos(now)`), so the publisher needs only the
      // reversal's beat — the forward beat it is handed already follows the post-reversal tempo map.
      reversal: { seconds: 2, beat: 4 },
    });

    // Before the reversal the true clock is the display clock — no mirrored field.
    publish(1, 2);
    // Exactly AT the reversal the mirror has not started yet (strictly past only).
    publish(2, 4);
    // Past it the display recedes by however far the FORWARD beat advanced — here 1.5 beats in a second (the
    // post-reversal tempo), not the 2 beats a second the pre-reversal leg ran at.
    publish(3, 5.5);
    // A post-reversal STOP freezes the forward beat, so the mirrored display pauses with it.
    publish(3.5, 5.5);
    // Once the mirror rewinds past the chart head the display pins at 0 instead of going negative.
    publish(9, 12);

    expect(frames).toHaveLength(5);
    expect(frames[0]).toMatchObject({ currentSeconds: 1, currentBeat: 2, reversalSeconds: 2 });
    expect(frames[0]?.displayBeat).toBeUndefined();
    expect(frames[1]?.displayBeat).toBeUndefined();
    expect(frames[2]).toMatchObject({ currentSeconds: 3, currentBeat: 5.5, displayBeat: 2.5 });
    expect(frames[3]).toMatchObject({ currentSeconds: 3.5, currentBeat: 5.5, displayBeat: 2.5 });
    expect(frames[4]).toMatchObject({ currentSeconds: 9, displayBeat: 0 });
    // The reversal anchor rides on EVERY frame while armed — renderers freeze BGA layers against it.
    for (const frame of frames) {
      expect(frame.reversalSeconds).toBe(2);
      expect(frame).not.toHaveProperty('displaySeconds');
    }
  });

  test('reverse-scrolls at the post-reversal tempo, pauses through a post-reversal STOP, and follows later BPM', () => {
    // BPM 240 with a pre-reversal STOP (1.0 s, 0.25 s), `#BPM02 -60` at R = 2.25 s (beat 8), a post-reversal STOP at
    // beat 10 (4.25 s, 1 s long), and BPM 240 again at beat 12 (7.25 s). LR2 mirrors the chart position, so past R
    // the display recedes 1 beat/s (|-60|), holds through the STOP, then recedes 4 beats/s — it does NOT retrace the
    // pre-reversal 4 beats/s or the pre-reversal STOP.
    const json = createEmptyJson('bms');
    json.metadata.bpm = 240;
    json.resources.bpm['02'] = -60;
    json.resources.stop['01'] = 48;
    json.events = [
      { measure: 1, channel: '09', position: [0, 1], value: '01' },
      { measure: 2, channel: '08', position: [0, 1], value: '02' },
      { measure: 2, channel: '09', position: [1, 2], value: '01' },
      { measure: 3, channel: '03', position: [0, 1], value: 'F0' },
    ];
    const resolver = createTimingResolver(json);
    const beatAtSeconds = createBeatAtSecondsResolverFromTimingResolver(resolver);
    const { uiSignals, frames } = createCapturingUiSignals();
    const publish = createUiFramePublisher({
      uiEnabled: true,
      uiSignals,
      totalSeconds: 20,
      summary: SUMMARY,
      notes: [],
      audioBackend: 'test-audio',
      resolveDebugActiveAudioState: () => ({}),
      reversal: resolver.reversal,
    });
    const times = [2.25, 3.25, 4.25, 4.75, 5.25, 7.25, 7.5];
    for (const seconds of times) {
      publish(seconds, beatAtSeconds(seconds));
    }

    expect(resolver.reversal).toEqual({ beat: 8, seconds: 2.25 });
    const displayBeats = frames.map((frame) => frame.displayBeat ?? frame.currentBeat);
    expect(displayBeats[0]).toBeCloseTo(8, 9); // at R
    expect(displayBeats[1]).toBeCloseTo(7, 9); // 1 s later at 60 BPM: one beat back
    expect(displayBeats[2]).toBeCloseTo(6, 9); // the post-reversal STOP starts
    expect(displayBeats[3]).toBeCloseTo(6, 9); // ...and holds the reverse scroll
    expect(displayBeats[4]).toBeCloseTo(6, 9); // until it ends
    expect(displayBeats[5]).toBeCloseTo(4, 9); // two more beats at 60 BPM
    expect(displayBeats[6]).toBeCloseTo(3, 9); // BPM 240: a beat per quarter second
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
    expect(frames[0]?.displayBeat).toBeUndefined();
    expect(frames[0]?.reversalSeconds).toBeUndefined();
  });
});
