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

  it('plays charge notes under IIDX, hell charge where the chart asks', () => {
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

    tracker.end('11', 'complete');
    expect(tracker.stateOf('11', 4, true)).toBe('done');
    expect(tracker.isHolding('11')).toBe(false);
    expect(tracker.holdStartedAtMs('11')).toBeUndefined();
    expect(tracker.heldMode('11', 4)).toBeUndefined();
  });

  it('remembers each finished long note on a lane', () => {
    const tracker = new LongNoteTracker();
    tracker.start('16', 4, 'ln', 0);
    tracker.end('16', 'dropped');
    tracker.start('16', 12, 'ln', 3000);
    expect(tracker.stateOf('16', 4, true)).toBe('dropped');
    expect(tracker.stateOf('16', 12, true)).toBe('held');
    tracker.end('16', 'complete');
    expect(tracker.stateOf('16', 4, true)).toBe('dropped');
    expect(tracker.stateOf('16', 12, true)).toBe('done');
  });

  it('ignores an end without a hold, and forgets everything on clear', () => {
    const tracker = new LongNoteTracker();
    tracker.end('11', 'complete');
    expect(tracker.stateOf('11', 4, false)).toBe('pending');
    tracker.start('11', 4, 'hcn', 10);
    tracker.clear();
    expect(tracker.isHolding('11')).toBe(false);
    expect(tracker.stateOf('11', 4, false)).toBe('pending');
  });
});
