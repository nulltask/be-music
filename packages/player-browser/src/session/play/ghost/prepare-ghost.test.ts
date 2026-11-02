import { describe, expect, test } from 'vite-plus/test';
import {
  BE_MUSIC_REPLAY_FORMAT,
  BE_MUSIC_REPLAY_VERSION,
  type BeMusicReplay,
  type ReplayNote,
} from '@be-music/player-engine/replay';
import type { BeMusicEvent } from '@be-music/chart-source';
import type { GhostSource } from './ghost.ts';
import { LaneOverlayGhost } from './lane-overlay-ghost.ts';
import { PacemakerGhost } from './pacemaker-ghost.ts';
import { canShowGhost, prepareGhost, resolveGhostMode, type GhostPlayContext } from './prepare-ghost.ts';
import { SidePlayfieldGhost } from './side-playfield-ghost.ts';

const EVENT: BeMusicEvent = { measure: 0, channel: '11', position: [0, 1], value: '01' };
const SEVEN_KEY = ['16', '11', '12', '13', '14', '15', '18', '19'];

function replay(channel = '11'): BeMusicReplay {
  const note: ReplayNote = { id: 0, channel, type: 'normal', timeUs: 1_000_000 };
  return {
    format: BE_MUSIC_REPLAY_FORMAT,
    version: BE_MUSIC_REPLAY_VERSION,
    clock: { unit: 'us', origin: 'chart-zero' },
    chart: {
      sourceFormat: 'bms',
      laneMode: '7keys',
      lnMode: 1,
      judgeRank: { percent: 75 },
      noteCount: 1,
      notes: [note],
    },
    inputs: [{ seq: 0, timeUs: 1_000_000, action: 'down', channels: [channel] }],
    play: { mode: 'manual', autoScratch: false, gauge: 'GROOVE' },
  };
}

function context(options: GhostPlayContext['options'], laneChannels: string[] = SEVEN_KEY): GhostPlayContext {
  return {
    options,
    laneChannels,
    chartPlayVariant: laneChannels === SEVEN_KEY ? '7' : '14',
    disposed: false,
    ghost: undefined,
    notes: [{ event: EVENT, channel: '11', beat: 2, seconds: 1, judged: false }],
    mineNotes: [],
    timingResolver: undefined,
    keyBeamStartedAt: new Map(),
    keyBeamFadeStartedAt: new Map(),
    bombStartedAt: new Map(),
    bombJudge: new Map(),
    lanePressedAt: new Map(),
    laneReleasedAt: new Map(),
    judgeSideState: { '1P': { judge: '', until: 0, combo: 0 }, '2P': { judge: '', until: 0, combo: 0 } },
  };
}

const source = (value: BeMusicReplay | undefined): GhostSource => ({
  kind: 'test',
  load: () => Promise.resolve(value),
});

describe('canShowGhost', () => {
  test('needs a source and a single-play chart, outside a replay, course or NONSTOP run', () => {
    expect(canShowGhost(context({ ghost: source(replay()) }))).toBe(true);
    expect(canShowGhost(context({}))).toBe(false);
    expect(canShowGhost(context({ ghost: source(replay()), replay: replay() }))).toBe(false);
    expect(canShowGhost(context({ ghost: source(replay()), course: { kind: 'grade' } as never }))).toBe(false);
    expect(canShowGhost(context({ ghost: source(replay()), nonstop: {} as never }))).toBe(false);
    expect(canShowGhost(context({ ghost: source(replay()) }, [...SEVEN_KEY, '21']))).toBe(false);
  });

  test('a pacemaker, alone or over the lanes, needs no free side: any chart but a replay, course or NONSTOP run', () => {
    for (const ghostMode of ['pacemaker', 'lane-overlay'] as const) {
      expect(canShowGhost(context({ ghost: source(replay()), ghostMode }, [...SEVEN_KEY, '21']))).toBe(true);
      expect(canShowGhost(context({ ghost: source(replay()), ghostMode, replay: replay() }))).toBe(false);
      expect(canShowGhost(context({ ghostMode }))).toBe(false);
    }
  });

  test('the mode is the second playfield unless the play names another', () => {
    expect(resolveGhostMode({})).toBe('side-playfield');
    expect(resolveGhostMode({ ghostMode: 'pacemaker' })).toBe('pacemaker');
  });
});

describe('prepareGhost', () => {
  test('places the source’s replay as a second playfield', async () => {
    const ctx = context({ ghost: source(replay()) });
    await prepareGhost(ctx);
    expect(ctx.ghost).toBeInstanceOf(SidePlayfieldGhost);
  });

  test('builds the pacemaker or the lane overlay the mode names, on a double-play chart and a 2P replay too', async () => {
    const pacemaker = context({ ghost: { ...source(replay('21')), label: 'SLOT 1' }, ghostMode: 'pacemaker' }, [
      ...SEVEN_KEY,
      '21',
    ]);
    await prepareGhost(pacemaker);
    expect(pacemaker.ghost).toBeInstanceOf(PacemakerGhost);
    expect(pacemaker.ghost?.scoreTarget?.({ perfect: 0, great: 0, good: 0, bad: 0, poor: 0 }).targetLabel).toBe(
      'SLOT 1',
    );
    const overlay = context({ ghost: source(replay()), ghostMode: 'lane-overlay' });
    await prepareGhost(overlay);
    expect(overlay.ghost).toBeInstanceOf(LaneOverlayGhost);
  });

  test('goes on without a ghost when there is no replay, it does not fit, or the source fails', async () => {
    const none = context({ ghost: source(undefined) });
    await prepareGhost(none);
    expect(none.ghost).toBeUndefined();
    const doublePlay = context({ ghost: source(replay('21')) });
    await prepareGhost(doublePlay);
    expect(doublePlay.ghost).toBeUndefined();
    const failing = context({ ghost: { kind: 'test', load: () => Promise.reject(new Error('no storage')) } });
    await expect(prepareGhost(failing)).resolves.toBeUndefined();
    expect(failing.ghost).toBeUndefined();
  });
});
