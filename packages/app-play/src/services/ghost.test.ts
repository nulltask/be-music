import { describe, expect, test } from 'vite-plus/test';
import {
  createGhostSource,
  createOwnBestGhostSource,
  createReplayFileGhostSource,
  createReplaySlotGhostSource,
  GHOST_SOURCES,
  ghostModeDrawsOnPlayfield,
  ghostReplaySlotOf,
  ghostSourceHasReplay,
  GhostReplayFile,
  resolveGhostStatus,
  resolveGhostUnavailableReason,
  selectOwnBestReplaySlot,
  toGhostPresentationMode,
  type GhostAvailabilityInput,
  type GhostBarFacts,
} from './ghost.ts';
import { REPLAY_SLOT_COUNT, replaySlotKey, type ReplaySlotRecord, type ReplaySlotTarget } from './replay-slots.ts';

const TARGET: ReplaySlotTarget = { kind: 'chart', id: 'bmfp0:chart' };

function record(slot: number, exScore: number, savedAt = '2026-01-01T00:00:00.000Z'): ReplaySlotRecord {
  return {
    version: 0,
    key: replaySlotKey(TARGET, slot),
    target: TARGET,
    slot,
    savedAt,
    size: 100,
    title: 'Chart',
    exScore,
    exRate: exScore / 200,
    lamp: 'NORMAL',
  };
}

describe('resolveGhostUnavailableReason', () => {
  const able: GhostAvailabilityInput = { mode: 'PLAYFIELD', family: 'built-in', playVariant: '7', hasReplay: true };

  test('lets a built-in single-play 5 / 7 KEY play with a replay show a second playfield', () => {
    expect(resolveGhostUnavailableReason(able)).toBeUndefined();
    expect(resolveGhostUnavailableReason({ ...able, playVariant: '5' })).toBeUndefined();
    // A source only known once read (a Leaderboard run) does not hold it back.
    expect(resolveGhostUnavailableReason({ mode: 'PLAYFIELD', family: 'built-in', playVariant: '7' })).toBeUndefined();
  });

  test('says why every other play cannot', () => {
    expect(resolveGhostUnavailableReason({ ...able, family: 'lr2' })).toBe('family');
    expect(resolveGhostUnavailableReason({ ...able, family: 'beatoraja' })).toBe('family');
    expect(resolveGhostUnavailableReason({ ...able, replay: true })).toBe('replay');
    expect(resolveGhostUnavailableReason({ ...able, course: true })).toBe('course');
    expect(resolveGhostUnavailableReason({ ...able, playVariant: '14' })).toBe('chart');
    expect(resolveGhostUnavailableReason({ ...able, playVariant: '9' })).toBe('chart');
    expect(resolveGhostUnavailableReason({ ...able, playVariant: undefined })).toBe('chart');
    expect(resolveGhostUnavailableReason({ ...able, battle: true })).toBe('chart');
    expect(resolveGhostUnavailableReason({ ...able, hasReplay: false })).toBe('no-replay');
  });

  test('a pacemaker shows on every family and chart; the lane overlay on any chart of the built-in family', () => {
    const pacemaker: GhostAvailabilityInput = { ...able, mode: 'PACEMAKER' };
    expect(resolveGhostUnavailableReason({ ...pacemaker, family: 'lr2', playVariant: '14' })).toBeUndefined();
    expect(resolveGhostUnavailableReason({ ...pacemaker, family: 'beatoraja', battle: true })).toBeUndefined();
    expect(resolveGhostUnavailableReason({ ...pacemaker, playVariant: undefined })).toBe('chart');
    const overlay: GhostAvailabilityInput = { ...able, mode: 'LANE_OVERLAY' };
    expect(resolveGhostUnavailableReason({ ...overlay, playVariant: '14' })).toBeUndefined();
    expect(resolveGhostUnavailableReason({ ...overlay, family: 'lr2' })).toBe('family');
  });
});

describe('ghost settings', () => {
  test('map onto the play session’s modes and the replay slots', () => {
    expect(toGhostPresentationMode('PLAYFIELD')).toBe('side-playfield');
    expect(toGhostPresentationMode('PACEMAKER')).toBe('pacemaker');
    expect(toGhostPresentationMode('LANE_OVERLAY')).toBe('lane-overlay');
    expect(ghostReplaySlotOf('REPLAY_SLOT_1')).toBe(0);
    expect(ghostReplaySlotOf('REPLAY_SLOT_4')).toBe(3);
    expect(ghostReplaySlotOf('OWN_BEST')).toBeUndefined();
    expect(GHOST_SOURCES.filter((source) => ghostReplaySlotOf(source) !== undefined)).toHaveLength(REPLAY_SLOT_COUNT);
    expect(ghostModeDrawsOnPlayfield('PACEMAKER')).toBe(false);
    expect(ghostModeDrawsOnPlayfield('LANE_OVERLAY')).toBe(true);
  });

  test('know which sources hold a replay of the chart before reading it', () => {
    const kept = [false, true, false, false];
    expect(ghostSourceHasReplay('OWN_BEST', kept, false)).toBe(true);
    expect(ghostSourceHasReplay('OWN_BEST', [false, false], false)).toBe(false);
    expect(ghostSourceHasReplay('REPLAY_SLOT_2', kept, false)).toBe(true);
    expect(ghostSourceHasReplay('REPLAY_SLOT_1', kept, false)).toBe(false);
    expect(ghostSourceHasReplay('REPLAY_FILE', kept, true)).toBe(true);
    expect(ghostSourceHasReplay('LEADERBOARD_TOP', kept, false)).toBeUndefined();
  });
});

describe('resolveGhostStatus', () => {
  const facts: GhostBarFacts = { family: 'built-in', playVariant: '7', target: TARGET, slotsKept: [true] };
  const noFile = new GhostReplayFile();

  test('says OFF, nothing without a bar, READY, or why not', () => {
    expect(resolveGhostStatus('OFF', 'PLAYFIELD', facts, noFile)).toBe('OFF');
    expect(resolveGhostStatus('OWN_BEST', 'PLAYFIELD', undefined, noFile)).toBe('-');
    expect(resolveGhostStatus('OWN_BEST', 'PLAYFIELD', facts, noFile)).toBe('READY');
    expect(resolveGhostStatus('REPLAY_SLOT_2', 'PLAYFIELD', facts, noFile)).toBe('No replay kept');
    expect(resolveGhostStatus('LEADERBOARD_TOP', 'PACEMAKER', facts, noFile)).toBe('READY');
    expect(resolveGhostStatus('OWN_BEST', 'PLAYFIELD', { ...facts, family: 'lr2' }, noFile)).toBe(
      'Built-in skins only',
    );
    expect(resolveGhostStatus('REPLAY_FILE', 'PACEMAKER', facts, noFile)).toBe('No replay kept');
  });
});

describe('GhostReplayFile', () => {
  test('is the ghost of the chart it was recorded on only', async () => {
    const file = new GhostReplayFile();
    const replay = { chart: { chartFingerprint: TARGET.id }, play: {} } as never;
    expect(file.replayFor(TARGET)).toBeUndefined();
    file.set(replay, 'best.bmplay.json');
    expect(file.name).toBe('best.bmplay.json');
    expect(file.replayFor(TARGET)).toBe(replay);
    expect(file.replayFor({ kind: 'chart', id: 'bmfp0:other' })).toBeUndefined();
    expect(file.replayFor(undefined)).toBeUndefined();
    const source = createReplayFileGhostSource(file, TARGET);
    expect(source.label).toBe('FILE');
    await expect(source.load()).resolves.toBe(replay);
    expect(
      resolveGhostStatus(
        'REPLAY_FILE',
        'PACEMAKER',
        { family: 'lr2', playVariant: '14', target: TARGET, slotsKept: [] },
        file,
      ),
    ).toBe('READY');
    file.clear();
    expect(file.name).toBeUndefined();
  });
});

describe('createGhostSource', () => {
  const store = {
    slots: () => [record(0, 100)],
    read: () => Promise.resolve({ kind: 'chart' as const, replay: {} as never }),
  };

  test('makes the source a setting names, when its reader is given', async () => {
    expect(createGhostSource('OFF', TARGET, { replays: store })).toBeUndefined();
    expect(createGhostSource('OWN_BEST', TARGET, {})).toBeUndefined();
    expect(createGhostSource('OWN_BEST', TARGET, { replays: store })?.kind).toBe('own-best');
    const slot = createGhostSource('REPLAY_SLOT_3', TARGET, { replays: store });
    expect([slot?.kind, slot?.label]).toEqual(['replay-slot', 'SLOT 3']);
    expect(createGhostSource('REPLAY_FILE', TARGET, { replayFile: new GhostReplayFile() })?.kind).toBe('replay-file');
    const fetched: string[] = [];
    const top = createGhostSource('LEADERBOARD_TOP', TARGET, {
      fetchLeaderboardTopReplay: (fingerprint) => {
        fetched.push(fingerprint);
        return Promise.resolve(undefined);
      },
    });
    expect([top?.kind, top?.label]).toEqual(['leaderboard', 'TOP']);
    await top?.load();
    expect(fetched).toEqual([TARGET.id]);
    // A chart named only by its file hash is not on the Leaderboard.
    expect(
      createGhostSource(
        'LEADERBOARD_TOP',
        { kind: 'chart', id: 'sha256:abc' },
        { fetchLeaderboardTopReplay: () => Promise.resolve(undefined) },
      ),
    ).toBeUndefined();
  });

  test('reads one replay slot', async () => {
    const reads: number[] = [];
    const source = createReplaySlotGhostSource(
      {
        read: (_target, slot) => {
          reads.push(slot);
          return Promise.resolve(undefined);
        },
      },
      TARGET,
      2,
    );
    await expect(source.load()).resolves.toBeUndefined();
    expect(reads).toEqual([2]);
  });
});

describe('selectOwnBestReplaySlot', () => {
  test('picks the highest EX score, the latest among equals', () => {
    expect(selectOwnBestReplaySlot([record(0, 100), record(1, 150), undefined, record(3, 120)])?.slot).toBe(1);
    expect(
      selectOwnBestReplaySlot([record(0, 150, '2026-01-01T00:00:00.000Z'), record(2, 150, '2026-02-01T00:00:00.000Z')])
        ?.slot,
    ).toBe(2);
    expect(selectOwnBestReplaySlot([undefined, undefined, undefined, undefined])).toBeUndefined();
  });
});

describe('createOwnBestGhostSource', () => {
  test('reads the best slot’s replay when the play loads', async () => {
    const replay = { chart: {}, play: {} } as never;
    const reads: number[] = [];
    const source = createOwnBestGhostSource(
      {
        slots: () => [record(0, 100), record(1, 150), undefined, undefined],
        read: (_target, slot) => {
          reads.push(slot);
          return Promise.resolve({ kind: 'chart', replay });
        },
      },
      TARGET,
    );
    expect(source.kind).toBe('own-best');
    await expect(source.load()).resolves.toBe(replay);
    expect(reads).toEqual([1]);
  });

  test('has no replay for a chart without a kept one', async () => {
    const source = createOwnBestGhostSource({ slots: () => [], read: () => Promise.resolve(undefined) }, TARGET);
    await expect(source.load()).resolves.toBeUndefined();
  });
});
