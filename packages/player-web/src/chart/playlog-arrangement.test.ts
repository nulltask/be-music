import { describe, expect, test } from 'vitest';
import type { PlaylogNote } from '@be-music/player/playlog';
import { applyPlaylogArrangement } from './playlog-arrangement.ts';

function note(channel: string, seconds: number, endSeconds?: number) {
  return endSeconds === undefined ? { channel, seconds } : { channel, seconds, endSeconds };
}

function playlogNote(overrides: Partial<PlaylogNote> & Pick<PlaylogNote, 'channel' | 'timeUs'>): PlaylogNote {
  return { id: 0, type: 'normal', ...overrides };
}

describe('playlog-arrangement', () => {
  test('re-applies a mirrored arrangement onto the original channels', () => {
    // Original chart: lane 11 at 1.0s, lane 13 at 2.0s. Recorded (mirrored): 15 at 1.0s, 13 at 2.0s.
    const target = {
      notes: [note('11', 1), note('13', 2)],
      landmineNotes: [],
      invisibleNotes: [],
      activeFreeZoneChannels: new Set<string>(),
    };
    const result = applyPlaylogArrangement(
      [playlogNote({ channel: '15', timeUs: 1_000_000 }), playlogNote({ channel: '13', timeUs: 2_000_000 })],
      target,
    );
    expect(result).toEqual({ ok: true });
    expect(target.notes.map((entry) => entry.channel)).toEqual(['15', '13']);
  });

  test('matches long notes by tail time and keeps mines / invisibles / freezones separate', () => {
    const target = {
      notes: [note('11', 1, 2), note('12', 1), note('17', 3, 4)],
      landmineNotes: [note('13', 1)],
      invisibleNotes: [note('14', 1)],
      activeFreeZoneChannels: new Set(['17']),
    };
    const result = applyPlaylogArrangement(
      [
        playlogNote({ channel: '15', type: 'long', timeUs: 1_000_000, endTimeUs: 2_000_000, lnMode: 1 }),
        playlogNote({ channel: '11', timeUs: 1_000_000 }),
        playlogNote({ channel: '17', type: 'freezone', timeUs: 3_000_000, endTimeUs: 4_000_000 }),
        playlogNote({ channel: '12', type: 'mine', timeUs: 1_000_000, damage: 4 }),
        playlogNote({ channel: '13', type: 'invisible', timeUs: 1_000_000 }),
      ],
      target,
    );
    expect(result).toEqual({ ok: true });
    // The long note takes the recorded long channel — never the same-time normal note's channel.
    expect(target.notes.map((entry) => entry.channel)).toEqual(['15', '11', '17']);
    expect(target.landmineNotes[0]!.channel).toBe('12');
    expect(target.invisibleNotes[0]!.channel).toBe('13');
  });

  test('fails without mutating when the prepared chart has a note the log does not', () => {
    const target = {
      notes: [note('11', 1), note('12', 1.5)],
      landmineNotes: [],
      invisibleNotes: [],
      activeFreeZoneChannels: new Set<string>(),
    };
    const result = applyPlaylogArrangement([playlogNote({ channel: '11', timeUs: 1_000_000 })], target);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('1500000');
    }
    expect(target.notes.map((entry) => entry.channel)).toEqual(['11', '12']);
  });

  test('fails when the log has extra notes the prepared chart does not', () => {
    const target = {
      notes: [note('11', 1)],
      landmineNotes: [],
      invisibleNotes: [],
      activeFreeZoneChannels: new Set<string>(),
    };
    const result = applyPlaylogArrangement(
      [playlogNote({ channel: '11', timeUs: 1_000_000 }), playlogNote({ channel: '12', timeUs: 2_000_000 })],
      target,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('unmatched');
    }
  });

  test('chords at the same time consume recorded channels without duplication', () => {
    const target = {
      notes: [note('11', 1), note('12', 1), note('13', 1)],
      landmineNotes: [],
      invisibleNotes: [],
      activeFreeZoneChannels: new Set<string>(),
    };
    const result = applyPlaylogArrangement(
      [
        playlogNote({ channel: '13', timeUs: 1_000_000 }),
        playlogNote({ channel: '14', timeUs: 1_000_000 }),
        playlogNote({ channel: '15', timeUs: 1_000_000 }),
      ],
      target,
    );
    expect(result).toEqual({ ok: true });
    expect(target.notes.map((entry) => entry.channel).sort()).toEqual(['13', '14', '15']);
  });
});
