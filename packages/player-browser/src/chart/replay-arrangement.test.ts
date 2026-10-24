import { describe, expect, test } from 'vite-plus/test';
import { parseReplay, serializeReplay, type BeMusicReplay, type ReplayNote } from '@be-music/player-engine/replay';
import { applyReplayArrangement } from './replay-arrangement.ts';

function note(channel: string, seconds: number, endSeconds?: number) {
  return endSeconds === undefined ? { channel, seconds } : { channel, seconds, endSeconds };
}

function replayNote(overrides: Partial<ReplayNote> & Pick<ReplayNote, 'channel' | 'timeUs'>): ReplayNote {
  return { id: 0, type: 'normal', ...overrides };
}

describe('replay-arrangement', () => {
  test('legacy SCATTER metadata retains its recorded LN placement without selecting a new option', () => {
    const replay: BeMusicReplay = {
      format: 'be-music-replay',
      version: 0,
      clock: { unit: 'us', origin: 'chart-zero' },
      chart: {
        sourceFormat: 'bms',
        laneMode: '7keys',
        lnMode: 1,
        judgeRank: { percent: 75, sourceRank: 2 },
        noteCount: 1,
        notes: [replayNote({ channel: '15', timeUs: 1_000_000, endTimeUs: 2_000_000, type: 'long', lnMode: 1 })],
      },
      inputs: [],
      play: { mode: 'manual', autoScratch: false, gauge: 'GROOVE', randomLane: { p1: 'SCATTER' } },
    };
    const parsed = parseReplay(serializeReplay(replay));
    const target = {
      notes: [note('11', 1, 2)],
      landmineNotes: [],
      invisibleNotes: [],
      activeFreeZoneChannels: new Set<string>(),
    };
    expect(parsed.play.randomLane).toEqual({ p1: 'SCATTER' });
    expect(applyReplayArrangement(parsed.chart.notes, target)).toEqual({ ok: true });
    expect(target.notes).toEqual([note('15', 1, 2)]);
  });

  test('re-applies a mirrored arrangement onto the original channels', () => {
    // Original chart: lane 11 at 1.0s, lane 13 at 2.0s. Recorded (mirrored): 15 at 1.0s, 13 at 2.0s.
    const target = {
      notes: [note('11', 1), note('13', 2)],
      landmineNotes: [],
      invisibleNotes: [],
      activeFreeZoneChannels: new Set<string>(),
    };
    const result = applyReplayArrangement(
      [replayNote({ channel: '15', timeUs: 1_000_000 }), replayNote({ channel: '13', timeUs: 2_000_000 })],
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
    const result = applyReplayArrangement(
      [
        replayNote({ channel: '15', type: 'long', timeUs: 1_000_000, endTimeUs: 2_000_000, lnMode: 1 }),
        replayNote({ channel: '11', timeUs: 1_000_000 }),
        replayNote({ channel: '17', type: 'freezone', timeUs: 3_000_000, endTimeUs: 4_000_000 }),
        replayNote({ channel: '12', type: 'mine', timeUs: 1_000_000, damage: 4 }),
        replayNote({ channel: '13', type: 'invisible', timeUs: 1_000_000 }),
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
    const result = applyReplayArrangement([replayNote({ channel: '11', timeUs: 1_000_000 })], target);
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
    const result = applyReplayArrangement(
      [replayNote({ channel: '11', timeUs: 1_000_000 }), replayNote({ channel: '12', timeUs: 2_000_000 })],
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
    const result = applyReplayArrangement(
      [
        replayNote({ channel: '13', timeUs: 1_000_000 }),
        replayNote({ channel: '14', timeUs: 1_000_000 }),
        replayNote({ channel: '15', timeUs: 1_000_000 }),
      ],
      target,
    );
    expect(result).toEqual({ ok: true });
    expect(target.notes.map((entry) => entry.channel).sort()).toEqual(['13', '14', '15']);
  });
});

test('original lanes keep simultaneous keysounds and unequal mine damage attached to their arranged lanes', () => {
  const target = {
    notes: [
      { channel: '11', seconds: 1, event: { channel: '11', value: '01' } },
      { channel: '12', seconds: 1, event: { channel: '12', value: '02' } },
      { channel: '13', seconds: 1, event: { channel: '13', value: '03' } },
    ],
    landmineNotes: [
      { channel: '11', seconds: 2, event: { channel: 'D1', damage: 1 } },
      { channel: '12', seconds: 2, event: { channel: 'D2', damage: 10 } },
    ],
    invisibleNotes: [],
    activeFreeZoneChannels: new Set<string>(),
  };
  const recorded = [
    replayNote({ channel: '11', sourceChannel: '12', timeUs: 1_000_000 }),
    replayNote({ channel: '12', sourceChannel: '11', timeUs: 1_000_000 }),
    replayNote({ channel: '13', timeUs: 1_000_000 }),
    replayNote({ channel: '11', sourceChannel: '12', timeUs: 2_000_000, type: 'mine', damage: 10 }),
    replayNote({ channel: '12', sourceChannel: '11', timeUs: 2_000_000, type: 'mine', damage: 1 }),
  ];
  expect(applyReplayArrangement(recorded, target)).toEqual({ ok: true });
  expect(target.notes.map((note) => [note.channel, note.event.value])).toEqual([
    ['12', '01'],
    ['11', '02'],
    ['13', '03'],
  ]);
  expect(target.landmineNotes.map((mine) => [mine.channel, mine.event.damage])).toEqual([
    ['12', 1],
    ['11', 10],
  ]);
});

test('a mismatched original lane fails atomically instead of assigning a different note', () => {
  const target = {
    notes: [note('11', 1), note('12', 1)],
    landmineNotes: [],
    invisibleNotes: [],
    activeFreeZoneChannels: new Set<string>(),
  };
  const before = structuredClone(target.notes);
  expect(
    applyReplayArrangement(
      [
        replayNote({ channel: '15', sourceChannel: '11', timeUs: 1_000_000 }),
        replayNote({ channel: '14', sourceChannel: '13', timeUs: 1_000_000 }),
      ],
      target,
    ).ok,
  ).toBe(false);
  expect(target.notes).toEqual(before);
});
