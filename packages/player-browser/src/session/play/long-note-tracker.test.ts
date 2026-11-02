import { describe, expect, it } from 'vite-plus/test';
import { LongNoteTracker, resolveBeMusicLongNoteMode } from './long-note-tracker.ts';

describe('resolveBeMusicLongNoteMode', () => {
  it('plays every long note as an LN under LR2', () => {
    expect(resolveBeMusicLongNoteMode('ln', 1)).toBe('ln');
    expect(resolveBeMusicLongNoteMode('ln', 2)).toBe('ln');
    expect(resolveBeMusicLongNoteMode('ln', 3)).toBe('ln');
  });

  it('follows the chart under beatoraja, defaulting to a charge note', () => {
    expect(resolveBeMusicLongNoteMode('per-note', 1)).toBe('ln');
    expect(resolveBeMusicLongNoteMode('per-note', 2)).toBe('cn');
    expect(resolveBeMusicLongNoteMode('per-note', 3)).toBe('hcn');
    expect(resolveBeMusicLongNoteMode('per-note', undefined)).toBe('cn');
  });

  it('plays charge notes under That-Which-Must-Not-Be-Named, hell charge where the chart asks', () => {
    expect(resolveBeMusicLongNoteMode('charge', 1)).toBe('cn');
    expect(resolveBeMusicLongNoteMode('charge', 2)).toBe('cn');
    expect(resolveBeMusicLongNoteMode('charge', 3)).toBe('hcn');
  });
});

describe('LongNoteTracker', () => {
  it('reads unreached long notes as pending and missed ones as dropped', () => {
    const tracker = new LongNoteTracker();
    expect(tracker.stateOf('11', 4, false)).toBe('pending');
    expect(tracker.stateOf('11', 4, true)).toBe('dropped');
    expect(tracker.isHolding('11')).toBe(false);
    expect(tracker.holdStartedAtMs('11')).toBeUndefined();
  });

  it('tracks a hold from start to completion', () => {
    const tracker = new LongNoteTracker();
    tracker.start('11', 4, 'cn', 1200);
    expect(tracker.stateOf('11', 4, true)).toBe('held');
    expect(tracker.isHolding('11')).toBe(true);
    expect(tracker.holdStartedAtMs('11')).toBe(1200);
    expect(tracker.heldMode('11', 4)).toBe('cn');
    expect(tracker.heldMode('11', 8)).toBeUndefined();
    // Other lanes and later notes on the lane are unaffected.
    expect(tracker.isHolding('12')).toBe(false);
    expect(tracker.stateOf('11', 8, false)).toBe('pending');

    tracker.end('11', 'complete', 2000);
    expect(tracker.stateOf('11', 4, true)).toBe('done');
    expect(tracker.releasedAtMs('11', 4)).toBeUndefined();
    expect(tracker.isHolding('11')).toBe(false);
    expect(tracker.holdStartedAtMs('11')).toBeUndefined();
    expect(tracker.heldMode('11', 4)).toBeUndefined();
  });

  it('remembers each finished long note on a lane', () => {
    const tracker = new LongNoteTracker();
    tracker.start('16', 4, 'ln', 0);
    tracker.end('16', 'dropped', 1500);
    tracker.start('16', 12, 'ln', 3000);
    expect(tracker.stateOf('16', 4, true)).toBe('dropped');
    expect(tracker.stateOf('16', 12, true)).toBe('held');
    tracker.end('16', 'complete', 4000);
    expect(tracker.stateOf('16', 4, true)).toBe('dropped');
    expect(tracker.stateOf('16', 12, true)).toBe('done');
    // Only the early release keeps its time, for the centre line's fade-out.
    expect(tracker.releasedAtMs('16', 4)).toBe(1500);
    expect(tracker.releasedAtMs('16', 12)).toBeUndefined();
  });

  it('ignores an end without a hold, and forgets everything on clear', () => {
    const tracker = new LongNoteTracker();
    tracker.end('11', 'complete', 0);
    expect(tracker.stateOf('11', 4, false)).toBe('pending');
    tracker.start('11', 4, 'hcn', 10);
    tracker.clear();
    expect(tracker.isHolding('11')).toBe(false);
    expect(tracker.stateOf('11', 4, false)).toBe('pending');
  });

  it('follows a hell charge note through held, draining and held again, to its outcome at the tail', () => {
    const tracker = new LongNoteTracker();
    tracker.start('11', 4, 'hcn', 1000);
    tracker.hellCharge('11', 4, 'gaining');
    expect(tracker.stateOf('11', 4, true)).toBe('held');
    // Let go early: the tail is judged a miss, but the note drains rather than dropping for good.
    tracker.hellCharge('11', 4, 'draining');
    tracker.end('11', 'dropped', 1300);
    expect(tracker.stateOf('11', 4, true)).toBe('draining');
    expect(tracker.holdStateOf('11', 4, true)).toBe('dropped');
    expect(tracker.isHolding('11')).toBe(false);
    // Pressed back: it gains again.
    tracker.hellCharge('11', 4, 'gaining');
    expect(tracker.stateOf('11', 4, true)).toBe('held');
    // Past the tail it reads as its outcome.
    tracker.hellCharge('11', 4, 'passed');
    expect(tracker.stateOf('11', 4, true)).toBe('dropped');
    expect(tracker.releasedAtMs('11', 4)).toBe(1300);
  });

  it('reads a hell charge note missed at the head as draining until pressed, and a well-released one as held', () => {
    const tracker = new LongNoteTracker();
    tracker.hellCharge('11', 4, 'draining');
    expect(tracker.stateOf('11', 4, true)).toBe('draining');
    tracker.hellCharge('11', 4, 'gaining');
    expect(tracker.stateOf('11', 4, true)).toBe('held');
    tracker.hellCharge('11', 4, 'passed');
    expect(tracker.stateOf('11', 4, true)).toBe('dropped');

    tracker.start('11', 8, 'hcn', 2000);
    tracker.hellCharge('11', 8, 'gaining');
    // Released at GOOD or better just before the tail: it keeps gaining until the tail passes, then is done.
    tracker.end('11', 'complete', 2900);
    expect(tracker.stateOf('11', 8, true)).toBe('held');
    tracker.hellCharge('11', 8, 'passed');
    expect(tracker.stateOf('11', 8, true)).toBe('done');
  });

  it('keeps a hell charge note held past its tail held until it ends, and forgets it on clear', () => {
    const tracker = new LongNoteTracker();
    tracker.start('11', 4, 'hcn', 1000);
    tracker.hellCharge('11', 4, 'gaining');
    tracker.hellCharge('11', 4, 'passed');
    expect(tracker.stateOf('11', 4, true)).toBe('held');
    tracker.hellCharge('12', 4, 'draining');
    tracker.clear();
    expect(tracker.stateOf('12', 4, false)).toBe('pending');
    // A pass for a lane never seen is ignored.
    tracker.hellCharge('13', 4, 'passed');
    expect(tracker.stateOf('13', 4, false)).toBe('pending');
  });
});
