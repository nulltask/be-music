import { describe, expect, test } from 'vite-plus/test';
import { playViewEventFromMoment } from './play-view-events.ts';

describe('playViewEventFromMoment', () => {
  test('passes the scene stages and exit phases on with their play-clock time', () => {
    for (const kind of ['scene-start', 'load-end', 'play-start', 'exit-fade-out', 'exit-close'] as const) {
      expect(playViewEventFromMoment({ kind, at: 1200 })).toEqual({ kind, atMs: 1200 });
    }
  });

  test('a judge moment carries the judgment reported with it, and is dropped without one', () => {
    expect(
      playViewEventFromMoment({ kind: 'judge', side: '2P', at: 50 }, { judge: 'GREAT', channel: '21', deltaMs: -8 }),
    ).toEqual({ kind: 'judge', judge: 'GREAT', side: '2P', channel: '21', deltaMs: -8, atMs: 50 });
    expect(playViewEventFromMoment({ kind: 'judge', side: '1P', at: 50 }, { judge: 'POOR' })).toEqual({
      kind: 'judge',
      judge: 'POOR',
      side: '1P',
      atMs: 50,
    });
    expect(playViewEventFromMoment({ kind: 'judge', side: '1P', at: 50 })).toBeUndefined();
  });

  test('passes the full combo, gauge moves and bombs on with their play-clock time', () => {
    expect(playViewEventFromMoment({ kind: 'full-combo', at: 9 })).toEqual({ kind: 'full-combo', atMs: 9 });
    expect(playViewEventFromMoment({ kind: 'gauge', previous: 20, next: 22, at: 11 })).toEqual({
      kind: 'gauge',
      previous: 20,
      next: 22,
      atMs: 11,
    });
    expect(playViewEventFromMoment({ kind: 'bomb', channel: '13', at: 7 })).toEqual({
      kind: 'bomb',
      channel: '13',
      atMs: 7,
    });
  });

  test("maps the engine's lane commands to lane, hold, long-note and POOR-image events", () => {
    const lane = (command: Parameters<typeof playViewEventFromMoment>[0] & { kind: 'lane-command' }) =>
      playViewEventFromMoment(command);
    expect(lane({ kind: 'lane-command', command: { kind: 'flash-lane', channel: '11' } })).toEqual({
      kind: 'lane',
      channel: '11',
      action: 'flash',
    });
    expect(lane({ kind: 'lane-command', command: { kind: 'press-lane', channel: '11' } })).toMatchObject({
      action: 'press',
    });
    expect(lane({ kind: 'lane-command', command: { kind: 'release-lane', channel: '11' } })).toMatchObject({
      action: 'release',
    });
    expect(lane({ kind: 'lane-command', command: { kind: 'hold-lane-until-beat', channel: '16', beat: 8 } })).toEqual({
      kind: 'lane-hold',
      channel: '16',
      untilBeat: 8,
    });
    expect(
      lane({ kind: 'lane-command', command: { kind: 'long-note-start', channel: '12', beat: 4, mode: 'cn' } }),
    ).toEqual({ kind: 'long-note-start', channel: '12', beat: 4, mode: 'cn' });
    expect(
      lane({ kind: 'lane-command', command: { kind: 'long-note-end', channel: '12', outcome: 'dropped' } }),
    ).toEqual({ kind: 'long-note-end', channel: '12', outcome: 'dropped' });
    expect(lane({ kind: 'lane-command', command: { kind: 'trigger-poor-bga', seconds: 3.5 } })).toEqual({
      kind: 'poor-bga',
      shown: true,
      seconds: 3.5,
    });
    expect(lane({ kind: 'lane-command', command: { kind: 'clear-poor-bga' } })).toEqual({
      kind: 'poor-bga',
      shown: false,
    });
  });
});
