import { describe, expect, test } from 'vite-plus/test';
import type { PlayerInputCommand } from '@be-music/player/core/input-signal-bus';
import { LiveTempo } from './live-tempo.ts';

describe('LiveTempo', () => {
  test('pushes a clamped tempo command once the engine is up, holding the last one asked for before', () => {
    const pushed: PlayerInputCommand[] = [];
    const live = new LiveTempo(1);
    expect(live.request(0.9)).toBe(true);
    live.request(3);
    expect(pushed).toEqual([]);
    live.attach({ pushCommand: (command) => pushed.push(command) });
    expect(pushed).toEqual([{ kind: 'tempo', tempo: 1.5 }]);
    live.request(0.8);
    expect(pushed.at(-1)).toEqual({ kind: 'tempo', tempo: 0.8 });
    // The tempo in force is what the engine reports, not what was asked for.
    expect(live.tempo).toBe(1);
  });

  test('holds changes again once the engine is gone', () => {
    const pushed: PlayerInputCommand[] = [];
    const live = new LiveTempo(1);
    live.attach({ pushCommand: (command) => pushed.push(command) });
    live.attach(undefined);
    live.request(1.2);
    expect(pushed).toEqual([]);
  });

  test('takes no change when disabled', () => {
    const pushed: PlayerInputCommand[] = [];
    const live = new LiveTempo(1, false);
    live.attach({ pushCommand: (command) => pushed.push(command) });
    expect(live.request(1.2)).toBe(false);
    expect(pushed).toEqual([]);
  });
});
