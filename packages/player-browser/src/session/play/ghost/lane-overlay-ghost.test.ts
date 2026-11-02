import { describe, expect, test } from 'vite-plus/test';
import type { PlayfieldRuntime } from '../../../view/shared/playfield/context.ts';
import type { GhostTimeline } from './ghost-timeline.ts';
import { LaneOverlayGhost } from './lane-overlay-ghost.ts';
import { PacemakerGhost } from './pacemaker-ghost.ts';

const SEVEN_KEY = ['16', '11', '12', '13', '14', '15', '18', '19'];

const COUNTS = { perfect: 0, great: 0, good: 0, bad: 0, poor: 0, emptyPoor: 0 };

function timeline(): GhostTimeline {
  return {
    notes: [],
    mines: [],
    judgments: [
      {
        seconds: 1,
        judgment: 'PERFECT',
        emptyPoor: false,
        channel: '11',
        combo: 1,
        maxCombo: 1,
        exScore: 2,
        gauge: 22,
        counts: { ...COUNTS, perfect: 1 },
      },
      {
        seconds: 2,
        judgment: 'GREAT',
        emptyPoor: false,
        channel: '21',
        combo: 2,
        maxCombo: 2,
        exScore: 3,
        gauge: 23,
        counts: { ...COUNTS, perfect: 1, great: 1 },
      },
      {
        seconds: 3,
        judgment: 'BAD',
        emptyPoor: false,
        channel: '13',
        combo: 0,
        maxCombo: 2,
        exScore: 3,
        gauge: 20,
        counts: { ...COUNTS, perfect: 1, great: 1, bad: 1 },
      },
    ],
    inputs: [
      { seconds: 1, channel: '11', pressed: true },
      { seconds: 1.1, channel: '11', pressed: false },
      { seconds: 2, channel: '21', pressed: true },
      { seconds: 3, channel: '13', pressed: true },
    ],
    noteCount: 3,
    gaugeType: 'GROOVE',
    ruleset: 'lr2',
  };
}

const score = (perfect: number, great = 0) => ({ perfect, great, good: 0, bad: 0, poor: 0 });

describe('PacemakerGhost', () => {
  test('runs on any view, presents the play as it is and paces by notes judged', () => {
    const ghost = new PacemakerGhost(timeline(), 'SLOT 2');
    expect(ghost.drawsOnPlayfield).toBe(false);
    const play = {} as PlayfieldRuntime;
    ghost.update(5, 0);
    expect(ghost.present(play)).toBe(play);
    expect(ghost.scoreTarget(score(0))).toEqual({ targetEXScore: 3, targetPaceEXScore: 0, targetLabel: 'SLOT 2' });
    expect(ghost.scoreTarget(score(1)).targetPaceEXScore).toBe(2);
    expect(ghost.scoreTarget(score(1, 1)).targetPaceEXScore).toBe(3);
    expect(new PacemakerGhost(timeline()).scoreTarget(score(0)).targetLabel).toBe('GHOST');
  });
});

describe('LaneOverlayGhost', () => {
  test('marks the ghost’s presses, releases and judgments on the live lanes only', () => {
    const ghost = new LaneOverlayGhost(timeline(), SEVEN_KEY);
    expect(ghost.drawsOnPlayfield).toBe(false);
    ghost.update(1, 100);
    expect(ghost.overlay.pressedAt.get('11')).toBe(100);
    expect(ghost.overlay.flashes.get('11')).toEqual({ judgment: 'PERFECT', atMs: 100 });
    ghost.update(1.1, 200);
    expect(ghost.overlay.releasedAt.get('11')).toBe(200);
    ghost.update(2, 300);
    // 21 is no live lane.
    expect(ghost.overlay.pressedAt.has('21')).toBe(false);
    expect(ghost.overlay.flashes.has('21')).toBe(false);
  });

  test('catches up a jump without marking what it skipped, and rewinds on a seek back', () => {
    const ghost = new LaneOverlayGhost(timeline(), SEVEN_KEY);
    ghost.update(2.9, 100);
    expect(ghost.overlay.pressedAt.size).toBe(0);
    expect(ghost.overlay.flashes.size).toBe(0);
    ghost.update(3, 200);
    expect(ghost.overlay.pressedAt.get('13')).toBe(200);
    expect(ghost.overlay.flashes.get('13')?.judgment).toBe('BAD');
    ghost.update(0.5, 300);
    expect(ghost.overlay.pressedAt.size).toBe(0);
    expect(ghost.overlay.flashes.size).toBe(0);
    ghost.update(1, 400);
    expect(ghost.overlay.pressedAt.get('11')).toBe(400);
  });

  test('presents the play with its marks as `ghostLanes`, one proxy per play, and paces as a pacemaker', () => {
    const ghost = new LaneOverlayGhost(timeline(), SEVEN_KEY, 'TOP');
    const play = { laneChannels: SEVEN_KEY } as unknown as PlayfieldRuntime;
    const presented = ghost.present(play);
    expect(presented.ghostLanes).toBe(ghost.overlay);
    expect(presented.laneChannels).toBe(SEVEN_KEY);
    expect(ghost.present(play)).toBe(presented);
    expect(ghost.scoreTarget(score(1)).targetLabel).toBe('TOP');
  });
});
