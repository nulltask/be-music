import { describe, expect, test } from 'vitest';
import { findBestCandidate, findClosestCandidateInWindow, findLaneSoundCandidate } from './judging.ts';

describe('judging helpers', () => {
  test('findClosestCandidateInWindow picks the nearest unconsumed candidate on the requested lane', () => {
    const notes = [
      { channel: '11', seconds: 0.9, hit: false },
      { channel: '12', seconds: 1.0, hit: false },
      { channel: '11', seconds: 1.03, hit: true },
      { channel: '11', seconds: 1.04, hit: false },
      { channel: '11', seconds: 1.2, hit: false },
    ];

    expect(
      findClosestCandidateInWindow(notes, {
        channel: '11',
        nowSec: 1,
        judgeWindowSec: 0.08,
        sortedBySeconds: true,
        isConsumed: (note) => note.hit,
      }),
    ).toBe(notes[3]);
  });

  test('findClosestCandidateInWindow can start at a lower-bound index for sorted scans', () => {
    const notes = [
      { channel: '11', seconds: 0.5 },
      { channel: '11', seconds: 0.9 },
      { channel: '11', seconds: 1.02 },
      { channel: '11', seconds: 1.2 },
    ];

    expect(
      findClosestCandidateInWindow(notes, {
        channel: '11',
        nowSec: 1,
        judgeWindowSec: 0.05,
        startIndex: 2,
        sortedBySeconds: true,
      }),
    ).toBe(notes[2]);
  });

  test('findBestCandidate delegates to the shared closest-candidate rules', () => {
    const channels = new Set(['11']);
    const notes = [
      { channel: '11', seconds: 0.95, judged: true },
      { channel: '11', seconds: 1.03, judged: false },
      { channel: '12', seconds: 1.0, judged: false },
    ];

    expect(findBestCandidate(notes, channels, 1, 0.05)).toBe(notes[1]);
  });

  test('findLaneSoundCandidate keeps the previous lane sound until the next note window opens', () => {
    const channels = new Set(['11']);
    const notes = [
      { channel: '11', seconds: 1.0, judged: true },
      { channel: '12', seconds: 1.2, judged: false },
      { channel: '11', seconds: 1.5, judged: false },
    ];

    expect(findLaneSoundCandidate(notes, channels, 1.3, 0.05)).toBe(notes[0]);
    expect(findLaneSoundCandidate(notes, channels, 1.45, 0.05)).toBe(notes[2]);
  });

  test('findLaneSoundCandidate does not look ahead before the first note window', () => {
    const channels = new Set(['11']);
    const notes = [{ channel: '11', seconds: 1.0, judged: false }];

    expect(findLaneSoundCandidate(notes, channels, 0.94, 0.05)).toBeUndefined();
  });
});
