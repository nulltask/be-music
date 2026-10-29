import { describe, expect, test } from 'vite-plus/test';
import { createPlayerUISignalBus } from './ui-signal-bus.ts';

describe('player ui signal bus', () => {
  test('publishes latest frame and drains commands in order', () => {
    const uiBus = createPlayerUISignalBus({
      currentBeat: 0,
      currentSeconds: 0,
      totalSeconds: 10,
      summary: {
        total: 1,
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
      },
      notes: [],
    });

    expect(uiBus.frameTick()).toBe(0);
    uiBus.publishFrame({
      currentBeat: 2,
      currentSeconds: 1,
      totalSeconds: 10,
      summary: {
        total: 1,
        perfect: 1,
        fast: 0,
        slow: 0,
        great: 0,
        good: 0,
        bad: 0,
        poor: 0,
        emptyPoor: 0,
        exScore: 2,
        score: 200000,
      },
      notes: [],
    });
    expect(uiBus.frameTick()).toBe(1);
    expect(uiBus.getFrame().currentBeat).toBe(2);

    uiBus.pushCommand({ kind: 'flash-lane', channel: '11' });
    uiBus.pushCommand({ kind: 'clear-poor-bga' });
    expect(uiBus.commandTick()).toBe(2);
    expect(uiBus.drainCommands()).toEqual([{ kind: 'flash-lane', channel: '11' }, { kind: 'clear-poor-bga' }]);
    expect(uiBus.drainCommands()).toEqual([]);
  });

  test('publishFrame copies the mirrored display clock fields', () => {
    const summary = {
      total: 1,
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
    const uiBus = createPlayerUISignalBus({ currentBeat: 0, currentSeconds: 0, totalSeconds: 10, summary, notes: [] });

    uiBus.publishFrame({
      currentBeat: 12,
      currentSeconds: 6,
      displayBeat: 4,
      reversalSeconds: 4,
      hcnLanes: [{ channel: '11', gaining: false }],
      keyBoundBGA: {
        definitionId: '61',
        channel: '11',
        bmpKey: '00',
        startedSeconds: 6,
        frameStartSeconds: 6,
        argb: { a: 255, r: 255, g: 255, b: 255 },
      },
      bmsonBGA: { plane: 'poor', key: 'sequence.png', startedSeconds: 5.9, frameStartSeconds: 6 },
      judgedNoteCount: 3,
      totalSeconds: 10,
      summary,
      notes: [],
    });
    expect(uiBus.getFrame().displayBeat).toBe(4);
    expect(uiBus.getFrame().hcnLanes).toEqual([{ channel: '11', gaining: false }]);
    expect(uiBus.getFrame().keyBoundBGA).toMatchObject({ definitionId: '61', bmpKey: '00' });
    expect(uiBus.getFrame().bmsonBGA).toMatchObject({ plane: 'poor', key: 'sequence.png' });
    expect(uiBus.getFrame().judgedNoteCount).toBe(3);
    expect(uiBus.getFrame().reversalSeconds).toBe(4);

    // The fields are per-frame: a frame published without them clears the previous ones.
    uiBus.publishFrame({ currentBeat: 13, currentSeconds: 6.5, totalSeconds: 10, summary, notes: [] });
    expect(uiBus.getFrame().displayBeat).toBeUndefined();
    expect(uiBus.getFrame().hcnLanes).toBeUndefined();
    expect(uiBus.getFrame().keyBoundBGA).toBeUndefined();
    expect(uiBus.getFrame().bmsonBGA).toBeUndefined();
    expect(uiBus.getFrame().judgedNoteCount).toBeUndefined();
    expect(uiBus.getFrame().reversalSeconds).toBeUndefined();
  });

  test('publishFrame copies the seek generation and the clock, per frame', () => {
    const summary = {
      total: 1,
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
    const uiBus = createPlayerUISignalBus({ currentBeat: 0, currentSeconds: 0, totalSeconds: 10, summary, notes: [] });
    const clock = { outputSeconds: 1.25, tempo: 1.5, paused: true };
    uiBus.publishFrame({
      currentBeat: 4,
      currentSeconds: 2,
      totalSeconds: 10,
      summary,
      notes: [],
      generation: 2,
      clock,
    });
    expect(uiBus.getFrame().generation).toBe(2);
    expect(uiBus.getFrame().clock).toEqual(clock);
    uiBus.publishFrame({ currentBeat: 5, currentSeconds: 2.5, totalSeconds: 10, summary, notes: [] });
    expect(uiBus.getFrame().generation).toBeUndefined();
    expect(uiBus.getFrame().clock).toBeUndefined();
  });
});
