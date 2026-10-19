import type { LR2Skin } from '@be-music/lr2-skin';
import { LR2_TIMER } from '@be-music/lr2-skin/ids';
import type { ChartPlayVariant } from '@be-music/chart';
import { afterEach, describe, expect, test, vi } from 'vite-plus/test';
import { KEY_ON_FADE_OUT_MS } from '../../stage/design.ts';
import {
  LR2_BOMB_FALLBACK_MS,
  LR2_GAUGE_RISE_FALLBACK_MS,
  LR2PlayTimers,
  type LR2PlayTimerSource,
} from './play-timers.ts';

/** A running play the timers read: its play clock, intro, beat and key beams are the test's to set. */
function createPlay(overrides: { variant?: ChartPlayVariant } = {}) {
  const state = { now: 0, intro: false, beat: 0, disposed: false };
  const play: LR2PlayTimerSource = {
    song: {},
    chartPlayVariant: overrides.variant ?? '7',
    get disposed() {
      return state.disposed;
    },
    keyBeamStartedAt: new Map<string, number>(),
    keyBeamFadeStartedAt: new Map<string, number>(),
    pressedChannels: new Set<string>(),
    playClock: () => state.now,
    isIntroPlaying: () => state.intro,
    currentSeconds: () => state.now / 1000,
    currentBeat: () => state.beat,
  };
  return { play, state, timers: new LR2PlayTimers(play) };
}

/** A skin with one element on each of `timers`, whose keyframes end at `spanMs`. */
function skinWithSpans(timers: readonly number[], spanMs: number): LR2Skin {
  return {
    images: timers.map((timer) => ({
      destination: { timer },
      keyframes: [
        { time: 0, timer },
        { time: spanMs, timer },
      ],
    })),
    numbers: [],
    texts: [],
    sliders: [],
    bargraphs: [],
    judgeLines: [],
    grooveGauges: [],
    nowCombos: [],
    judges: {},
    judges2P: {},
  } as unknown as LR2Skin;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('LR2PlayTimers', () => {
  test('the scene start starts timer 0, and timer 1 at once without #STARTINPUT', () => {
    const { timers } = createPlay();
    timers.handle({ kind: 'scene-start', atMs: 100 }, undefined);
    expect(timers.startedAt(LR2_TIMER.SCENE_START)).toBe(100);
    expect(timers.startedAt(LR2_TIMER.START_INPUT)).toBe(100);
    expect(timers.isActive(LR2_TIMER.READY)).toBe(false);
  });

  test('timer 1 starts #STARTINPUT after the scene start, counted from the moment', () => {
    vi.useFakeTimers();
    const { timers, state } = createPlay();
    // The view hears of the scene start a frame late: the wait counts from the moment, not from the frame.
    state.now = 116;
    timers.handle({ kind: 'scene-start', atMs: 100 }, 500);
    expect(timers.isActive(LR2_TIMER.START_INPUT)).toBe(false);
    vi.advanceTimersByTime(483);
    expect(timers.isActive(LR2_TIMER.START_INPUT)).toBe(false);
    state.now = 600;
    vi.advanceTimersByTime(1);
    expect(timers.startedAt(LR2_TIMER.START_INPUT)).toBe(600);
  });

  test('READY, play start, the exit and the full combo start their timers at their moments', () => {
    const { timers } = createPlay();
    timers.handle({ kind: 'load-end', atMs: 10 }, undefined);
    timers.handle({ kind: 'play-start', atMs: 20 }, undefined);
    timers.handle({ kind: 'exit-fade-out', atMs: 30 }, undefined);
    timers.handle({ kind: 'exit-close', atMs: 40 }, undefined);
    timers.handle({ kind: 'full-combo', atMs: 50 }, undefined);
    expect(timers.startedAt(LR2_TIMER.READY)).toBe(10);
    expect(timers.startedAt(LR2_TIMER.PLAY)).toBe(20);
    expect(timers.startedAt(LR2_TIMER.FADE_OUT)).toBe(30);
    expect(timers.startedAt(LR2_TIMER.FAILED)).toBe(40);
    expect(timers.startedAt(LR2_TIMER.FULL_COMBO_1P)).toBe(50);
    expect(timers.startedAt(LR2_TIMER.FULL_COMBO_2P)).toBe(50);
  });

  test('a judge timer counts from the scene start until its side judges, then restarts on each judgment', () => {
    const { timers, state } = createPlay();
    timers.handle({ kind: 'scene-start', atMs: 100 }, undefined);
    state.now = 400;
    expect(timers.isActive(LR2_TIMER.JUDGE_1P)).toBe(true);
    expect(timers.elapsed(LR2_TIMER.JUDGE_1P)).toBe(300);
    timers.handle({ kind: 'judge', judge: 'GREAT', side: '2P', atMs: 350 }, undefined);
    expect(timers.elapsed(LR2_TIMER.JUDGE_2P)).toBe(50);
    expect(timers.elapsed(LR2_TIMER.JUDGE_1P)).toBe(300);
  });

  test('a bomb starts its lane bomb timer until the playfield retires it', () => {
    const { timers } = createPlay();
    timers.handle({ kind: 'bomb', channel: '13', atMs: 5 }, undefined);
    timers.handle({ kind: 'bomb', channel: '26', atMs: 6 }, undefined);
    expect(timers.startedAt(LR2_TIMER.BOMB_1P + 3)).toBe(5);
    expect(timers.startedAt(LR2_TIMER.BOMB_2P)).toBe(6);
    timers.bombRetired('13');
    expect(timers.isActive(LR2_TIMER.BOMB_1P + 3)).toBe(false);
    expect(timers.isActive(LR2_TIMER.BOMB_2P)).toBe(true);
  });

  test("a bomb lasts the skin's span on its timer, else LR2's 150 ms", () => {
    const { timers } = createPlay();
    expect(timers.bombDurationMs('11')).toBe(LR2_BOMB_FALLBACK_MS);
    timers.setSpans(skinWithSpans([LR2_TIMER.BOMB_1P + 1], 240));
    expect(timers.bombDurationMs('11')).toBe(240);
    expect(timers.bombDurationMs('12')).toBe(LR2_BOMB_FALLBACK_MS);
  });

  test("a key beam fades over the skin's span on its key-on timer, else the default fade", () => {
    const { timers } = createPlay();
    expect(timers.keyOnFadeMs('11')).toBe(KEY_ON_FADE_OUT_MS);
    timers.setSpans(skinWithSpans([LR2_TIMER.KEY_ON_1P + 1], 90));
    expect(timers.keyOnFadeMs('11')).toBe(90);
    expect(timers.keyOnFadeMsOfTimer(LR2_TIMER.KEY_ON_1P + 1)).toBe(90);
  });

  test('a gauge rise starts timer 42 until the rise flash has played out; reaching 100 % starts 44', () => {
    vi.useFakeTimers();
    const { timers } = createPlay();
    timers.handle({ kind: 'gauge', previous: 98, next: 100, atMs: 0 }, undefined);
    expect(timers.isActive(LR2_TIMER.GAUGE_UP_1P)).toBe(true);
    expect(timers.isActive(LR2_TIMER.GAUGE_MAX_1P)).toBe(true);
    vi.advanceTimersByTime(LR2_GAUGE_RISE_FALLBACK_MS);
    expect(timers.isActive(LR2_TIMER.GAUGE_UP_1P)).toBe(false);
    timers.handle({ kind: 'gauge', previous: 100, next: 96, atMs: 400 }, undefined);
    expect(timers.isActive(LR2_TIMER.GAUGE_MAX_1P)).toBe(false);
  });

  test('a long-note hold runs its timer, and fades it out after the release', () => {
    vi.useFakeTimers();
    const { timers, state } = createPlay();
    const hold = LR2_TIMER.LN_HOLD_1P + 2;
    state.now = 1000;
    timers.handle({ kind: 'lane-hold', channel: '12', untilBeat: 8 }, undefined);
    expect(timers.startedAt(hold)).toBe(1000);
    expect(timers.releaseFadeAlpha(hold)).toBeUndefined();
    state.now = 2000;
    timers.handle({ kind: 'lane', channel: '12', action: 'release' }, undefined);
    state.now = 2000 + KEY_ON_FADE_OUT_MS / 2;
    expect(timers.releaseFadeAlpha(hold)).toBeCloseTo(0.5);
    vi.advanceTimersByTime(KEY_ON_FADE_OUT_MS);
    expect(timers.isActive(hold)).toBe(false);
  });

  test("reads the play's key beams on the key-on bank, and retires a faded beam unless its key is still down", () => {
    const { timers, play, state } = createPlay();
    const keyOn = LR2_TIMER.KEY_ON_1P + 1;
    play.keyBeamStartedAt.set('11', 10);
    play.keyBeamFadeStartedAt.set('11', 20);
    state.now = 20 + KEY_ON_FADE_OUT_MS / 4;
    expect(timers.isActive(keyOn)).toBe(true);
    expect(timers.startedAt(keyOn)).toBe(10);
    expect(timers.releaseFadeAlpha(keyOn)).toBeCloseTo(0.75);
    state.now = 20 + KEY_ON_FADE_OUT_MS;
    expect(timers.releaseFadeAlpha(keyOn)).toBe(0);
    expect(play.keyBeamFadeStartedAt.has('11')).toBe(false);
    expect(play.keyBeamStartedAt.has('11')).toBe(false);
    expect(timers.isActive(keyOn)).toBe(false);
    // A key held again keeps its beam through the cleanup.
    play.keyBeamStartedAt.set('11', 30);
    play.keyBeamFadeStartedAt.set('11', 30);
    (play.pressedChannels as Set<string>).add('11');
    state.now = 30 + KEY_ON_FADE_OUT_MS;
    expect(timers.releaseFadeAlpha(keyOn)).toBe(0);
    expect(timers.isActive(keyOn)).toBe(true);
    expect(play.keyBeamStartedAt.get('11')).toBe(30);
  });

  test("puts each lane's key beam on its own key-on timer: 100 + lane on 1P, 110 + lane on 2P", () => {
    const { timers, play } = createPlay({ variant: '14' });
    play.keyBeamStartedAt.set('16', 1);
    play.keyBeamStartedAt.set('18', 2);
    play.keyBeamStartedAt.set('19', 3);
    play.keyBeamStartedAt.set('23', 4);
    play.keyBeamStartedAt.set('26', 5);
    expect(timers.startedAt(LR2_TIMER.KEY_ON_1P)).toBe(1);
    expect(timers.startedAt(LR2_TIMER.KEY_ON_1P + 6)).toBe(2);
    expect(timers.startedAt(LR2_TIMER.KEY_ON_1P + 7)).toBe(3);
    expect(timers.startedAt(LR2_TIMER.KEY_ON_2P + 3)).toBe(4);
    expect(timers.startedAt(LR2_TIMER.KEY_ON_2P)).toBe(5);
    expect(timers.isActive(LR2_TIMER.KEY_ON_1P + 1)).toBe(false);
    expect(timers.isActive(LR2_TIMER.KEY_ON_2P + 7)).toBe(false);
  });

  test('runs every 9 KEY lane through the 1P key-on bank, the PMS-STD keys 6-9 on 2P channels included', () => {
    const { timers, play, state } = createPlay({ variant: '9' });
    play.keyBeamStartedAt.set('13', 1);
    play.keyBeamStartedAt.set('22', 2);
    play.keyBeamStartedAt.set('25', 3);
    expect(timers.startedAt(LR2_TIMER.KEY_ON_1P + 3)).toBe(1);
    expect(timers.startedAt(LR2_TIMER.KEY_ON_1P + 6)).toBe(2);
    expect(timers.startedAt(LR2_TIMER.KEY_ON_1P + 9)).toBe(3);
    expect(timers.isActive(LR2_TIMER.KEY_ON_2P + 2)).toBe(false);
    // The fade retires the 2P channel's own beam.
    play.keyBeamFadeStartedAt.set('22', 10);
    state.now = 10 + KEY_ON_FADE_OUT_MS;
    expect(timers.releaseFadeAlpha(LR2_TIMER.KEY_ON_1P + 6)).toBe(0);
    expect(play.keyBeamStartedAt.has('22')).toBe(false);
    expect(play.keyBeamStartedAt.has('25')).toBe(true);
  });

  test("leaves a key beam's fade to its own timer, and other timers to the view", () => {
    const { timers, play, state } = createPlay();
    play.keyBeamStartedAt.set('12', 0);
    play.keyBeamFadeStartedAt.set('12', 0);
    state.now = KEY_ON_FADE_OUT_MS / 2;
    expect(timers.releaseFadeAlpha(LR2_TIMER.KEY_ON_1P + 3)).toBeUndefined();
    expect(timers.releaseFadeAlpha(LR2_TIMER.BOMB_1P + 2)).toBeUndefined();
    expect(timers.releaseFadeAlpha(LR2_TIMER.KEY_ON_1P + 2)).toBeCloseTo(0.5);
  });

  test("retires the full-combo timers once the skin's animation has played out", () => {
    const { timers, state } = createPlay();
    timers.setSpans(skinWithSpans([LR2_TIMER.FULL_COMBO_1P], 1200));
    timers.handle({ kind: 'full-combo', atMs: 0 }, undefined);
    state.now = 1199;
    timers.retireFullCombo();
    expect(timers.isActive(LR2_TIMER.FULL_COMBO_1P)).toBe(true);
    state.now = 1200;
    timers.retireFullCombo();
    expect(timers.isActive(LR2_TIMER.FULL_COMBO_1P)).toBe(false);
    expect(timers.isActive(LR2_TIMER.FULL_COMBO_2P)).toBe(false);
  });

  test('the rhythm timer runs once the chart plays, one beat being 1000 ms', () => {
    const { timers, state } = createPlay();
    state.intro = true;
    expect(timers.isActive(LR2_TIMER.RHYTHM)).toBe(false);
    state.intro = false;
    state.beat = 12.25;
    expect(timers.isActive(LR2_TIMER.RHYTHM)).toBe(true);
    expect(timers.elapsed(LR2_TIMER.RHYTHM)).toBe(250);
  });

  test('a disposed set of timers runs none of its deferred work', () => {
    vi.useFakeTimers();
    const { timers } = createPlay();
    timers.handle({ kind: 'scene-start', atMs: 0 }, 300);
    timers.dispose();
    vi.advanceTimersByTime(300);
    expect(timers.isActive(LR2_TIMER.START_INPUT)).toBe(false);
  });
});
