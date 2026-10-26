import { describe, expect, test } from 'vite-plus/test';
import { ReplayParseError } from './parse.ts';
import {
  createReplayViewCoalescer,
  DEFAULT_REPLAY_PLAYBACK_OPTIONS,
  diffReplayView,
  parseReplayTempoChanges,
  parseReplayViewChanges,
  parseReplayViewState,
  playedAtAnotherTempo,
  resolveReplayTempoAt,
  resolveReplayViewAt,
  resolveReplayHiSpeed,
  resolveReplayView,
  roundReplayView,
  type ReplayViewState,
} from './view.ts';

const cover = (side: '1P' | '2P', sudden: number, hidden = 0, lift = 0) => ({ side, sudden, hidden, lift });

describe('resolveReplayViewAt', () => {
  const initial: ReplayViewState = { hiSpeed: 2, hsFix: 'MAIN', covers: [cover('1P', 0.2), cover('2P', 0.1)] };
  const changes = [
    { timeUs: 1_000_000, hiSpeed: 2.5 },
    { timeUs: 2_000_000, covers: [cover('1P', 0.3, 0, 0.1)] },
  ];

  test('applies every change at or before the time, in order', () => {
    expect(resolveReplayViewAt(initial, changes, 999_999)).toEqual(initial);
    expect(resolveReplayViewAt(initial, changes, 1_000_000).hiSpeed).toBe(2.5);
    // A cover change replaces that side only.
    expect(resolveReplayViewAt(initial, changes, 5_000_000)).toEqual({
      hiSpeed: 2.5,
      hsFix: 'MAIN',
      covers: [cover('1P', 0.3, 0, 0.1), cover('2P', 0.1)],
    });
  });

  test('does not touch the recorded state', () => {
    resolveReplayViewAt(initial, changes, 5_000_000);
    expect(initial.covers![0]).toEqual(cover('1P', 0.2));
  });
});

describe('tempo', () => {
  const changes = [
    { timeUs: 1_000_000, tempo: 1.25 },
    { timeUs: 3_000_000, tempo: 1 },
  ];

  test('resolves the tempo in force at a time', () => {
    expect(resolveReplayTempoAt(undefined, changes, 0)).toBe(1);
    expect(resolveReplayTempoAt(0.8, changes, 0)).toBe(0.8);
    expect(resolveReplayTempoAt(0.8, changes, 2_000_000)).toBe(1.25);
    expect(resolveReplayTempoAt(0.8, changes, 3_000_000)).toBe(1);
  });

  test('a play at another tempo at its start or after any change is one', () => {
    expect(playedAtAnotherTempo({})).toBe(false);
    expect(playedAtAnotherTempo({ tempo: 0.9 })).toBe(true);
    // Back to 1 at the end does not undo the stretch played at 1.25.
    expect(playedAtAnotherTempo({ tempoChanges: changes })).toBe(true);
  });
});

describe('resolveReplayView', () => {
  const recorded: ReplayViewState = {
    hiSpeed: 3,
    hsFix: 'MAIN',
    visibleMs: 500,
    covers: [cover('1P', 0.3, 0.1, 0.2)],
  };
  const own: ReplayViewState = { hiSpeed: 1.5, hsFix: 'OFF', covers: [cover('1P', 0.05, 0, 0)] };

  test('shows the recorded view by default', () => {
    expect(resolveReplayView(recorded, own, DEFAULT_REPLAY_PLAYBACK_OPTIONS)).toEqual(recorded);
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
    const recorded: ReplayViewState = { hiSpeed: 3, hiSpeedScale: 'beatoraja' };
    const own: ReplayViewState = { hiSpeed: 1.5, hiSpeedScale: 'be-music' };
    expect(resolveReplayView(recorded, own, DEFAULT_REPLAY_PLAYBACK_OPTIONS).hiSpeedScale).toBe('beatoraja');
    expect(resolveReplayView(recorded, own, { ...DEFAULT_REPLAY_PLAYBACK_OPTIONS, hiSpeed: false }).hiSpeedScale).toBe(
      'be-music',
    );
  });
});

describe('diffReplayView', () => {
  const before: ReplayViewState = {
    hiSpeed: 2,
    hiSpeedScale: 'be-music',
    hsFix: 'OFF',
    visibleMs: 500,
    covers: [cover('1P', 0.2), cover('2P', 0.1)],
  };

  test('lists only the fields that changed, and the full cover of a changed side', () => {
    expect(diffReplayView(before, { ...before, covers: [cover('1P', 0.2), cover('2P', 0.1)] })).toBeUndefined();
    expect(diffReplayView(before, { ...before, hiSpeed: 2.5, visibleMs: 400 })).toEqual({
      hiSpeed: 2.5,
      visibleMs: 400,
    });
    expect(diffReplayView(before, { covers: [cover('1P', 0.2), cover('2P', 0.1, 0.3)] })).toEqual({
      covers: [cover('2P', 0.1, 0.3)],
    });
  });

  test('a field the next view leaves out is not a change', () => {
    expect(diffReplayView(before, { hiSpeed: 2 })).toBeUndefined();
    // A side that was not there before is a change.
    expect(diffReplayView({}, { covers: [cover('1P', 0)] })).toEqual({ covers: [cover('1P', 0)] });
  });

  test('ignores float noise in the covers', () => {
    expect(diffReplayView(before, { covers: [cover('1P', 0.2 + 1e-9), cover('2P', 0.1)] })).toBeUndefined();
  });
});

describe('roundReplayView', () => {
  test('rounds away float noise: hi-speed to 1/1000, visible time to ms, covers to 4 decimals', () => {
    const view: ReplayViewState = {
      hiSpeed: 2.0670000000000006,
      hiSpeedScale: 'be-music',
      hsFix: 'MAX',
      visibleMs: 812.4999,
      covers: [{ side: '1P', sudden: 0.30000000000000004, hidden: 0.09999999999999999, lift: 0.123456 }],
    };
    expect(roundReplayView(view)).toEqual({
      hiSpeed: 2.067,
      hiSpeedScale: 'be-music',
      hsFix: 'MAX',
      visibleMs: 812,
      covers: [{ side: '1P', sudden: 0.3, hidden: 0.1, lift: 0.1235 }],
    });
    // The input is left as it was.
    expect(view.covers?.[0]?.hidden).toBe(0.09999999999999999);
  });

  test('leaves out what the view leaves out', () => {
    expect(roundReplayView({ hiSpeedScale: 'beatoraja' })).toEqual({ hiSpeedScale: 'beatoraja' });
  });
});

describe('createReplayViewCoalescer', () => {
  test('returns the first change at once and holds the next ones to one per interval', () => {
    const coalescer = createReplayViewCoalescer({ hiSpeed: 2 }, { minIntervalMs: 100 });
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

  test('flushes a change still held back as the play ends, whatever the interval', () => {
    const coalescer = createReplayViewCoalescer({ hiSpeed: 2 }, { minIntervalMs: 100 });
    expect(coalescer.observe({ hiSpeed: 2.1 }, 0)).toEqual({ hiSpeed: 2.1 });
    expect(coalescer.observe({ hiSpeed: 2.2 }, 20)).toBeUndefined();
    expect(coalescer.flush({ hiSpeed: 2.2 })).toEqual({ hiSpeed: 2.2 });
    expect(coalescer.flush({ hiSpeed: 2.2 })).toBeUndefined();
  });

  test('a change back to the recorded view within the interval records nothing', () => {
    const coalescer = createReplayViewCoalescer({ hiSpeed: 2 });
    expect(coalescer.observe({ hiSpeed: 2.5 }, 0)).toEqual({ hiSpeed: 2.5 });
    expect(coalescer.observe({ hiSpeed: 2 }, 50)).toBeUndefined();
    expect(coalescer.observe({ hiSpeed: 2.5 }, 150)).toBeUndefined();
  });
});

describe('parsing', () => {
  test('reads a view state and rejects covers outside 0 to 1', () => {
    expect(parseReplayViewState({ hiSpeed: 2, covers: [cover('2P', 0.5)] }, 'play.view')).toEqual({
      hiSpeed: 2,
      covers: [cover('2P', 0.5)],
    });
    expect(() => parseReplayViewState({ covers: [cover('1P', 1.5)] }, 'play.view')).toThrow(/covers\[0\]\.sudden/);
    expect(() => parseReplayViewState({ covers: [{ ...cover('1P', 0), side: '3P' }] }, 'play.view')).toThrow(
      ReplayParseError,
    );
    expect(() => parseReplayViewState({ hiSpeed: 0 }, 'play.view')).toThrow(/hiSpeed/);
    expect(parseReplayViewState({ hiSpeed: 2, hiSpeedScale: 'beatoraja' }, 'play.view')).toEqual({
      hiSpeed: 2,
      hiSpeedScale: 'beatoraja',
    });
    expect(() => parseReplayViewState({ hiSpeedScale: 1 }, 'play.view')).toThrow(/hiSpeedScale/);
  });

  test('reads changes in time order only', () => {
    expect(parseReplayViewChanges([{ timeUs: 1, hiSpeed: 2 }], 'play.viewChanges')).toEqual([
      { timeUs: 1, hiSpeed: 2 },
    ]);
    expect(() =>
      parseReplayTempoChanges(
        [
          { timeUs: 2, tempo: 1.1 },
          { timeUs: 1, tempo: 1.2 },
        ],
        'play.tempoChanges',
      ),
    ).toThrow(/time order/);
    expect(() => parseReplayTempoChanges([{ timeUs: 1, tempo: 0 }], 'play.tempoChanges')).toThrow(/tempo/);
  });
});

test('START BPM and its effective drawn hi-speed survive replay view parsing and selection', () => {
  const view = { hiSpeed: 1.5, hsFix: 'STARTBPM' };
  const parsed = parseReplayViewState(JSON.parse(JSON.stringify(view)), 'play.view');
  expect(resolveReplayViewAt(parsed, [], 0)).toEqual(view);
});
