import { describe, expect, test } from 'vite-plus/test';
import type { JudgeWindowSetUs } from '../ruleset/definitions.ts';
import type { TimedPlayableNote } from '../playable-notes.ts';
import {
  combineLongNoteJudges,
  insertPendingAutoLongNote,
  isLongPlayableNote,
  longNoteScoresTail,
  resolveLoggedLongNoteMode,
  resolveLongNoteEndSeconds,
  resolveManualJudgeKind,
  resolveManualTimedJudge,
  resolvePlayableLongNoteMode,
  resolveRulesetLongNoteMode,
  toUILongNoteMode,
  type PendingAutoLongNoteState,
} from './judge-rules.ts';

/** Asymmetric windows (µs, `noteTime - inputTime`): every judge reaches 10 ms further late than early. */
const WINDOWS: JudgeWindowSetUs = {
  judges: [
    [-30_000, 20_000],
    [-60_000, 50_000],
    [-110_000, 100_000],
    [-210_000, 200_000],
  ],
};

function note(seconds: number, extra: Partial<TimedPlayableNote> = {}): TimedPlayableNote {
  return {
    channel: '11',
    seconds,
    beat: seconds * 2,
    judged: false,
    event: { measure: 0, channel: '11', position: [0, 1], value: '01' },
    ...extra,
  } as TimedPlayableNote;
}

describe('judge rules', () => {
  test('resolveManualJudgeKind classifies the engine sign convention against both window legs', () => {
    // Positive deltas are LATE presses, which read the windows' negative (late) leg.
    expect(resolveManualJudgeKind(25, WINDOWS)).toBe('PERFECT');
    expect(resolveManualJudgeKind(-25, WINDOWS)).toBe('GREAT');
    expect(resolveManualJudgeKind(205, WINDOWS)).toBe('BAD');
    expect(resolveManualJudgeKind(-205, WINDOWS)).toBeUndefined();
  });

  test('resolveManualTimedJudge turns an out-of-reach delta into a POOR', () => {
    expect(resolveManualTimedJudge(-205, WINDOWS)).toEqual({ kind: 'POOR', signedDeltaMs: -205 });
    expect(resolveManualTimedJudge(0, WINDOWS)).toEqual({ kind: 'PERFECT', signedDeltaMs: 0 });
  });

  test('combineLongNoteJudges keeps the worse judge, then the larger timing error', () => {
    const great = { kind: 'GREAT' as const, signedDeltaMs: 5 };
    const good = { kind: 'GOOD' as const, signedDeltaMs: 1 };
    expect(combineLongNoteJudges(great, good)).toBe(good);
    expect(combineLongNoteJudges(good, great)).toBe(good);
    const lateGreat = { kind: 'GREAT' as const, signedDeltaMs: -8 };
    expect(combineLongNoteJudges(great, lateGreat)).toBe(lateGreat);
    expect(combineLongNoteJudges(lateGreat, { kind: 'GREAT', signedDeltaMs: 8 })).toBe(lateGreat);
  });

  test('long-note helpers read the tail and the chart mode', () => {
    const tap = note(1);
    const longNote = note(1, { endSeconds: 2, longNoteMode: 3 });
    const defaultMode = note(1, { endSeconds: 2 });
    expect(isLongPlayableNote(tap)).toBe(false);
    expect(isLongPlayableNote(note(1, { endSeconds: 1 }))).toBe(false);
    expect(isLongPlayableNote(longNote)).toBe(true);
    expect(resolveLongNoteEndSeconds(tap)).toBeUndefined();
    expect(resolveLongNoteEndSeconds(longNote)).toBe(2);
    expect(resolvePlayableLongNoteMode(tap)).toBeUndefined();
    expect(resolvePlayableLongNoteMode(defaultMode)).toBe(2);
    expect(resolveLoggedLongNoteMode(tap)).toBe(1);
    expect(resolveLoggedLongNoteMode(longNote)).toBe(3);
  });

  test('the ruleset style decides the played mode and whether the tail scores', () => {
    const hcn = note(1, { endSeconds: 2, longNoteMode: 3 });
    const ln = note(1, { endSeconds: 2, longNoteMode: 1 });
    expect(resolveRulesetLongNoteMode('ln', hcn)).toBe(1);
    expect(resolveRulesetLongNoteMode('per-note', hcn)).toBe(3);
    expect(resolveRulesetLongNoteMode('charge', ln)).toBe(2);
    expect(resolveRulesetLongNoteMode('charge', note(1))).toBeUndefined();
    expect(longNoteScoresTail('ln', hcn)).toBe(false);
    expect(longNoteScoresTail('per-note', hcn)).toBe(true);
    expect(longNoteScoresTail('per-note', ln)).toBe(false);
    expect(longNoteScoresTail('charge', note(1))).toBe(false);
  });

  test('toUILongNoteMode spells the modes for the UI commands', () => {
    expect([1, 2, 3].map((mode) => toUILongNoteMode(mode as 1 | 2 | 3))).toEqual(['ln', 'cn', 'hcn']);
  });

  test('insertPendingAutoLongNote keeps the queue ordered by tail, stable for equal tails', () => {
    const queue: PendingAutoLongNoteState[] = [];
    const first = note(0);
    const second = note(1);
    const third = note(2);
    insertPendingAutoLongNote(queue, first, 3);
    insertPendingAutoLongNote(queue, second, 1);
    insertPendingAutoLongNote(queue, third, 3);
    expect(queue.map((entry) => entry.note)).toEqual([second, first, third]);
  });
});
