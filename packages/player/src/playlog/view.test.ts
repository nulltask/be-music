import { describe, expect, test } from 'vite-plus/test';
import { PlaylogParseError } from './parse.ts';
import {
  createPlaylogViewCoalescer,
  DEFAULT_PLAYLOG_VIEW_REPLAY,
  diffPlaylogView,
  parsePlaylogTempoChanges,
  parsePlaylogViewChanges,
  parsePlaylogViewState,
  playedAtAnotherTempo,
  resolvePlaylogTempoAt,
  resolvePlaylogViewAt,
  resolveReplayHiSpeed,
  resolveReplayView,
  type PlaylogViewState,
} from './view.ts';

const cover = (side: '1P' | '2P', sudden: number, hidden = 0, lift = 0) => ({ side, sudden, hidden, lift });

describe('resolvePlaylogViewAt', () => {
  const initial: PlaylogViewState = { hiSpeed: 2, hsFix: 'MAIN', covers: [cover('1P', 0.2), cover('2P', 0.1)] };
  const changes = [
    { timeUs: 1_000_000, hiSpeed: 2.5 },
    { timeUs: 2_000_000, covers: [cover('1P', 0.3, 0, 0.1)] },
  ];

  test('applies every change at or before the time, in order', () => {
    expect(resolvePlaylogViewAt(initial, changes, 999_999)).toEqual(initial);
    expect(resolvePlaylogViewAt(initial, changes, 1_000_000).hiSpeed).toBe(2.5);
    // A cover change replaces that side only.
    expect(resolvePlaylogViewAt(initial, changes, 5_000_000)).toEqual({
      hiSpeed: 2.5,
      hsFix: 'MAIN',
      covers: [cover('1P', 0.3, 0, 0.1), cover('2P', 0.1)],
    });
  });

  test('does not touch the recorded state', () => {
    resolvePlaylogViewAt(initial, changes, 5_000_000);
    expect(initial.covers![0]).toEqual(cover('1P', 0.2));
  });
});

describe('tempo', () => {
  const changes = [
    { timeUs: 1_000_000, tempo: 1.25 },
    { timeUs: 3_000_000, tempo: 1 },
  ];

  test('resolves the tempo in force at a time', () => {
    expect(resolvePlaylogTempoAt(undefined, changes, 0)).toBe(1);
    expect(resolvePlaylogTempoAt(0.8, changes, 0)).toBe(0.8);
    expect(resolvePlaylogTempoAt(0.8, changes, 2_000_000)).toBe(1.25);
    expect(resolvePlaylogTempoAt(0.8, changes, 3_000_000)).toBe(1);
  });

  test('a play at another tempo at its start or after any change is one', () => {
    expect(playedAtAnotherTempo({})).toBe(false);
    expect(playedAtAnotherTempo({ tempo: 0.9 })).toBe(true);
    // Back to 1 at the end does not undo the stretch played at 1.25.
    expect(playedAtAnotherTempo({ tempoChanges: changes })).toBe(true);
  });
});

describe('resolveReplayView', () => {
  const recorded: PlaylogViewState = {
    hiSpeed: 3,
    hsFix: 'MAIN',
    visibleMs: 500,
    covers: [cover('1P', 0.3, 0.1, 0.2)],
  };
  const own: PlaylogViewState = { hiSpeed: 1.5, hsFix: 'OFF', covers: [cover('1P', 0.05, 0, 0)] };

  test('shows the recorded view by default', () => {
    expect(resolveReplayView(recorded, own, DEFAULT_PLAYLOG_VIEW_REPLAY)).toEqual(recorded);
  });

  test('keeps the viewer’s own settings for what is not reproduced', () => {
    const view = resolveReplayView(recorded, own, { tempo: true, hiSpeed: false, covers: true, lift: false });
    expect(view).toEqual({ hiSpeed: 1.5, hsFix: 'OFF', covers: [cover('1P', 0.3, 0.1, 0)] });
    expect(resolveReplayView(recorded, own, { tempo: true, hiSpeed: true, covers: false, lift: false })).toEqual({
      hiSpeed: 3,
      hsFix: 'MAIN',
      visibleMs: 500,
      covers: [cover('1P', 0.05, 0, 0)],
    });
  });
});

describe('resolveReplayHiSpeed', () => {
  const fromVisibleMs = (visibleMs: number) => 1000 / visibleMs;

  test('takes the hi-speed on the same scale, or one recorded without a scale', () => {
    expect(
      resolveReplayHiSpeed({ hiSpeed: 3, hiSpeedScale: 'be-music', visibleMs: 400 }, 'be-music', fromVisibleMs),
    ).toBe(3);
    expect(resolveReplayHiSpeed({ hiSpeed: 3, visibleMs: 400 }, 'beatoraja', fromVisibleMs)).toBe(3);
  });

  test('matches the visible time across scales', () => {
    expect(
      resolveReplayHiSpeed({ hiSpeed: 3, hiSpeedScale: 'beatoraja', visibleMs: 400 }, 'be-music', fromVisibleMs),
    ).toBe(2.5);
    // Same scale without a hi-speed: the visible time still converts.
    expect(resolveReplayHiSpeed({ visibleMs: 500 }, 'be-music', fromVisibleMs)).toBe(2);
  });

  test('falls back to the recorded hi-speed when the visible time does not convert', () => {
    expect(resolveReplayHiSpeed({ hiSpeed: 3, hiSpeedScale: 'beatoraja' }, 'be-music', fromVisibleMs)).toBe(3);
    expect(
      resolveReplayHiSpeed({ hiSpeed: 3, hiSpeedScale: 'beatoraja', visibleMs: 400 }, 'be-music', () => undefined),
    ).toBe(3);
    expect(resolveReplayHiSpeed({}, 'be-music', fromVisibleMs)).toBeUndefined();
  });

  test('resolveReplayView carries the recorded scale with the hi-speed only', () => {
    const recorded: PlaylogViewState = { hiSpeed: 3, hiSpeedScale: 'beatoraja' };
    const own: PlaylogViewState = { hiSpeed: 1.5, hiSpeedScale: 'be-music' };
    expect(resolveReplayView(recorded, own, DEFAULT_PLAYLOG_VIEW_REPLAY).hiSpeedScale).toBe('beatoraja');
    expect(resolveReplayView(recorded, own, { ...DEFAULT_PLAYLOG_VIEW_REPLAY, hiSpeed: false }).hiSpeedScale).toBe(
      'be-music',
    );
  });
});

describe('diffPlaylogView', () => {
  const before: PlaylogViewState = {
    hiSpeed: 2,
    hiSpeedScale: 'be-music',
    hsFix: 'OFF',
    visibleMs: 500,
    covers: [cover('1P', 0.2), cover('2P', 0.1)],
  };

  test('lists only the fields that changed, and the full cover of a changed side', () => {
    expect(diffPlaylogView(before, { ...before, covers: [cover('1P', 0.2), cover('2P', 0.1)] })).toBeUndefined();
    expect(diffPlaylogView(before, { ...before, hiSpeed: 2.5, visibleMs: 400 })).toEqual({
      hiSpeed: 2.5,
      visibleMs: 400,
    });
    expect(diffPlaylogView(before, { covers: [cover('1P', 0.2), cover('2P', 0.1, 0.3)] })).toEqual({
      covers: [cover('2P', 0.1, 0.3)],
    });
  });

  test('a field the next view leaves out is not a change', () => {
    expect(diffPlaylogView(before, { hiSpeed: 2 })).toBeUndefined();
    // A side that was not there before is a change.
    expect(diffPlaylogView({}, { covers: [cover('1P', 0)] })).toEqual({ covers: [cover('1P', 0)] });
  });

  test('ignores float noise in the covers', () => {
    expect(diffPlaylogView(before, { covers: [cover('1P', 0.2 + 1e-9), cover('2P', 0.1)] })).toBeUndefined();
  });
});

describe('createPlaylogViewCoalescer', () => {
  test('returns the first change at once and holds the next ones to one per interval', () => {
    const coalescer = createPlaylogViewCoalescer({ hiSpeed: 2 }, { minIntervalMs: 100 });
    expect(coalescer.observe({ hiSpeed: 2 }, 0)).toBeUndefined();
    expect(coalescer.observe({ hiSpeed: 2.1 }, 16)).toEqual({ hiSpeed: 2.1 });
    // A wheel spin: every frame changes, but within the interval nothing is returned...
    expect(coalescer.observe({ hiSpeed: 2.2, covers: [cover('1P', 0.1)] }, 32)).toBeUndefined();
    expect(coalescer.observe({ hiSpeed: 2.3, covers: [cover('1P', 0.15)] }, 64)).toBeUndefined();
    // ...and once it has passed, what changed meanwhile comes as one change.
    expect(coalescer.observe({ hiSpeed: 2.3, covers: [cover('1P', 0.15)] }, 116)).toEqual({
      hiSpeed: 2.3,
      covers: [cover('1P', 0.15)],
    });
    expect(coalescer.observe({ hiSpeed: 2.3, covers: [cover('1P', 0.15)] }, 300)).toBeUndefined();
  });

  test('a change back to the recorded view within the interval records nothing', () => {
    const coalescer = createPlaylogViewCoalescer({ hiSpeed: 2 });
    expect(coalescer.observe({ hiSpeed: 2.5 }, 0)).toEqual({ hiSpeed: 2.5 });
    expect(coalescer.observe({ hiSpeed: 2 }, 50)).toBeUndefined();
    expect(coalescer.observe({ hiSpeed: 2.5 }, 150)).toBeUndefined();
  });
});

describe('parsing', () => {
  test('reads a view state and rejects covers outside 0 to 1', () => {
    expect(parsePlaylogViewState({ hiSpeed: 2, covers: [cover('2P', 0.5)] }, 'play.view')).toEqual({
      hiSpeed: 2,
      covers: [cover('2P', 0.5)],
    });
    expect(() => parsePlaylogViewState({ covers: [cover('1P', 1.5)] }, 'play.view')).toThrow(/covers\[0\]\.sudden/);
    expect(() => parsePlaylogViewState({ covers: [{ ...cover('1P', 0), side: '3P' }] }, 'play.view')).toThrow(
      PlaylogParseError,
    );
    expect(() => parsePlaylogViewState({ hiSpeed: 0 }, 'play.view')).toThrow(/hiSpeed/);
    expect(parsePlaylogViewState({ hiSpeed: 2, hiSpeedScale: 'beatoraja' }, 'play.view')).toEqual({
      hiSpeed: 2,
      hiSpeedScale: 'beatoraja',
    });
    expect(() => parsePlaylogViewState({ hiSpeedScale: 1 }, 'play.view')).toThrow(/hiSpeedScale/);
  });

  test('reads changes in time order only', () => {
    expect(parsePlaylogViewChanges([{ timeUs: 1, hiSpeed: 2 }], 'play.viewChanges')).toEqual([
      { timeUs: 1, hiSpeed: 2 },
    ]);
    expect(() =>
      parsePlaylogTempoChanges(
        [
          { timeUs: 2, tempo: 1.1 },
          { timeUs: 1, tempo: 1.2 },
        ],
        'play.tempoChanges',
      ),
    ).toThrow(/time order/);
    expect(() => parsePlaylogTempoChanges([{ timeUs: 1, tempo: 0 }], 'play.tempoChanges')).toThrow(/tempo/);
  });
});
