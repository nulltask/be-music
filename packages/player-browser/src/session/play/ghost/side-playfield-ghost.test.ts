import { describe, expect, test } from 'vite-plus/test';
import type { BeMusicEvent } from '@be-music/chart-source';
import type { TimedPlayableNote } from '@be-music/player-engine/display';
import type { PlayfieldRuntime } from '../../../view/shared/playfield/context.ts';
import { resolveGhostSide } from './ghost-side.ts';
import type { GhostTimeline } from './ghost-timeline.ts';
import {
  buildGhostField,
  createSecondsToBeat,
  mergeByBeat,
  SidePlayfieldGhost,
  type SidePlayfieldGhostTarget,
} from './side-playfield-ghost.ts';

const EVENT: BeMusicEvent = { measure: 0, channel: '11', position: [0, 1], value: '01' };

/** A live note at `seconds` on a 120 BPM chart (2 beats a second). */
function liveNote(seconds: number, channel = '11'): TimedPlayableNote {
  return { event: EVENT, channel, beat: seconds * 2, seconds, judged: false };
}

const SEVEN_KEY = ['16', '11', '12', '13', '14', '15', '18', '19'];

function timeline(overrides: Partial<GhostTimeline> = {}): GhostTimeline {
  return {
    notes: [
      { channel: '11', seconds: 1, settledAtSeconds: 1.01 },
      { channel: '13', seconds: 2, settledAtSeconds: 2.2 },
      { channel: '12', seconds: 3 },
    ],
    mines: [{ channel: '14', seconds: 2.5 }],
    judgments: [
      {
        seconds: 1.01,
        judgment: 'PERFECT',
        emptyPoor: false,
        channel: '11',
        combo: 1,
        maxCombo: 1,
        exScore: 2,
        gauge: 22,
        counts: { perfect: 1, great: 0, good: 0, bad: 0, poor: 0, emptyPoor: 0 },
      },
      {
        seconds: 2.2,
        judgment: 'POOR',
        emptyPoor: false,
        channel: '13',
        combo: 0,
        maxCombo: 1,
        exScore: 2,
        gauge: 16,
        counts: { perfect: 1, great: 0, good: 0, bad: 0, poor: 1, emptyPoor: 0 },
      },
    ],
    inputs: [
      { seconds: 1.01, channel: '11', pressed: true },
      { seconds: 1.05, channel: '11', pressed: false },
    ],
    noteCount: 3,
    gaugeType: 'GROOVE',
    ruleset: 'lr2',
    ...overrides,
  };
}

function target(): SidePlayfieldGhostTarget {
  return {
    keyBeamStartedAt: new Map(),
    keyBeamFadeStartedAt: new Map(),
    bombStartedAt: new Map(),
    bombJudge: new Map(),
    lanePressedAt: new Map(),
    laneReleasedAt: new Map(),
    judgeSideState: { '1P': { judge: '', until: 0, combo: 0 }, '2P': { judge: '', until: 0, combo: 0 } },
  };
}

describe('createSecondsToBeat', () => {
  test('takes a known note’s beat, and finds any other second on the chart’s timing', () => {
    const beatAt = createSecondsToBeat([{ seconds: 1, beat: 7 }], { beatToSeconds: (beat) => beat / 2 });
    expect(beatAt(1)).toBe(7);
    expect(beatAt(3)).toBeCloseTo(6);
    expect(beatAt(-1)).toBe(0);
  });

  test('spreads a second between the known notes without a timing', () => {
    const beatAt = createSecondsToBeat([
      { seconds: 1, beat: 2 },
      { seconds: 2, beat: 6 },
    ]);
    expect(beatAt(1.5)).toBeCloseTo(4);
    expect(beatAt(3)).toBeCloseTo(10);
  });
});

describe('mergeByBeat', () => {
  test('merges two beat-ordered arrays, the first first on equal beats', () => {
    const a = [
      { beat: 1, id: 'a1' },
      { beat: 3, id: 'a3' },
    ];
    const b = [
      { beat: 1, id: 'b1' },
      { beat: 2, id: 'b2' },
      { beat: 4, id: 'b4' },
    ];
    expect(mergeByBeat(a, b).map((entry) => entry.id)).toEqual(['a1', 'b1', 'b2', 'a3', 'b4']);
  });
});

describe('buildGhostField', () => {
  test('places the replay’s notes on the ghost’s lanes at the live chart’s beats', () => {
    const field = buildGhostField(timeline(), {
      notes: [liveNote(1), liveNote(2), liveNote(3)],
      mineNotes: [],
      timingResolver: { beatToSeconds: (beat) => beat / 2 },
    });
    expect(field.notes.map((note) => [note.channel, note.beat, note.judged])).toEqual([
      ['21', 2, false],
      ['23', 4, false],
      ['22', 6, false],
    ]);
    expect(field.mines.map((mine) => [mine.channel, mine.beat])).toEqual([['24', 5]]);
    // The third note was never settled.
    expect(field.settleOrder).toEqual([0, 1]);
  });
});

describe('SidePlayfieldGhost', () => {
  function makeGhost() {
    const side = resolveGhostSide(SEVEN_KEY, '7')!;
    const live = { notes: [liveNote(1), liveNote(2), liveNote(3)], mineNotes: [], timingResolver: undefined };
    const field = buildGhostField(timeline(), live);
    const effects = target();
    return { ghost: new SidePlayfieldGhost(timeline(), side, field, effects), field, effects, live };
  }

  test('settles the notes, lights the lanes and shows the plate as the play reaches them', () => {
    const { ghost, field, effects } = makeGhost();
    ghost.update(1.02, 500);
    expect(field.notes.map((note) => note.judged)).toEqual([true, false, false]);
    expect(effects.keyBeamStartedAt.get('21')).toBe(500);
    expect(effects.bombStartedAt.get('21')).toBe(500);
    expect(effects.bombJudge.get('21')).toBe('PERFECT');
    expect(effects.judgeSideState['2P']).toEqual({ judge: 'PERFECT', until: 1.01 + 0.6, combo: 1 });
    // The live side is left alone.
    expect(effects.judgeSideState['1P']).toEqual({ judge: '', until: 0, combo: 0 });
    ghost.update(1.06, 540);
    expect(effects.keyBeamFadeStartedAt.get('21')).toBe(540);
    ghost.update(2.21, 1700);
    expect(field.notes.map((note) => note.judged)).toEqual([true, true, false]);
    // A POOR sets off no bomb.
    expect(effects.bombStartedAt.has('23')).toBe(false);
    expect(effects.judgeSideState['2P'].judge).toBe('POOR');
  });

  test('catches up a jump ahead without the effects on the way, and rewinds a jump back', () => {
    const { ghost, field, effects } = makeGhost();
    ghost.update(5, 100);
    expect(field.notes.map((note) => note.judged)).toEqual([true, true, false]);
    expect(effects.bombStartedAt.size).toBe(0);
    expect(effects.keyBeamStartedAt.size).toBe(0);
    ghost.update(0, 200);
    expect(field.notes.every((note) => !note.judged)).toBe(true);
    expect(effects.judgeSideState['2P'].judge).toBe('');
  });

  test('presents the live play with the ghost’s lanes, notes and HUD in place', () => {
    const { ghost, live } = makeGhost();
    const laneX = new Map();
    const play = {
      ...live,
      laneChannels: SEVEN_KEY,
      chartPlayVariant: '7',
      laneX,
      secondPlayer: undefined,
      currentSeconds() {
        return this === play ? 42 : -1;
      },
    } as unknown as PlayfieldRuntime;
    const presented = ghost.present(play);
    expect(presented.chartPlayVariant).toBe('14');
    expect(presented.laneChannels).toHaveLength(16);
    expect(presented.notes.map((note) => note.channel)).toEqual(['11', '21', '11', '23', '11', '22']);
    expect(presented.laneX).toBe(laneX);
    // Methods run on the live play itself.
    expect(presented.currentSeconds()).toBe(42);
    expect(presented.secondPlayer?.score).toMatchObject({ total: 3, exScore: 0 });
    ghost.update(2.21, 0);
    const later = ghost.present(play);
    expect(later).toBe(presented);
    expect(later.secondPlayer?.score).toMatchObject({ perfect: 1, poor: 1, exScore: 2 });
    expect(later.secondPlayer?.playState).toMatchObject({ combo: 0, maxCombo: 1, gauge: 16, gaugeType: 'GROOVE' });
    // The live play's own arrays are untouched.
    expect(play.notes).toHaveLength(3);
  });
});
