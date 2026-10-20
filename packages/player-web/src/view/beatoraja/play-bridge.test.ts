/**
 * The beatoraja play bridge, fed as the play session feeds it: the session's moments go through
 * `playViewEventFromMoment` into frame events, judgments also reduce the frame's `PlayState`, and the engine's frames
 * come in as `engine`. Ported from the removed `BeatorajaRuntimeAdapter` tests (`skin/beatoraja/runtime-adapter.test.ts`).
 */

import { createEmptyJSON, type BeMusicJSON } from '@be-music/json';
import type { PlayerUICommand } from '@be-music/player/signals';
import {
  createPlayState,
  reducePlayState,
  type LaneCoverCommand,
  type LaneCoverState,
  type PlayEvent,
  type PlayState,
} from '@be-music/scene-model';
import { describe, expect, it } from 'vite-plus/test';
import {
  BEATORAJA_OP,
  bombTimerId,
  comboTimerId,
  judgeTimerId,
  keyOffTimerId,
  keyOnTimerId,
  lnHoldTimerId,
  SYNTHETIC_NUM_JUDGE_COMBO_1P,
  SYNTHETIC_NUM_JUDGE_COMBO_2P,
  SYNTHETIC_NUM_JUDGE_COMBO_3P,
  TIMER_FADEOUT,
  TIMER_PLAY,
  TIMER_PREVIEW,
  TIMER_READY,
  TIMER_SCENE_START,
  TIMER_STARTINPUT,
} from '@be-music/beatoraja-skin';
import { playViewEventFromMoment } from '../../session/play/play-view-events.ts';
import type { PlayViewEvent } from '../types.ts';
import {
  BeatorajaPlayBridge,
  type BeatorajaPlayBridgeOptions,
  type BeatorajaPlayEngineInput,
  type BeatorajaPlaySummaryInput,
} from './play-bridge.ts';

/** No covers on 1P, as a beatoraja play starts. */
const NO_COVER: LaneCoverState = { side: '1P', sudden: 0, suddenOn: false, hidden: 0, hiddenOn: false, lift: 0 };

/** An engine frame as the tests write it: anything left out is 0. */
interface TestEngineFrame {
  readonly currentSeconds?: number;
  readonly currentBeat?: number;
  readonly totalSeconds?: number;
  readonly reversalSeconds?: number;
  readonly summary?: Partial<BeatorajaPlaySummaryInput>;
}

function engineOf(frame: TestEngineFrame): BeatorajaPlayEngineInput {
  return {
    currentSeconds: frame.currentSeconds ?? 0,
    currentBeat: frame.currentBeat ?? 0,
    totalSeconds: frame.totalSeconds ?? 100,
    ...(frame.reversalSeconds !== undefined ? { reversalSeconds: frame.reversalSeconds } : {}),
    summary: {
      total: 0,
      perfect: 0,
      great: 0,
      good: 0,
      bad: 0,
      poor: 0,
      exScore: 0,
      score: 0,
      fast: 0,
      slow: 0,
      ...frame.summary,
    },
  };
}

/**
 * A bridge driven as the play session drives it, with a play clock the test moves. The first frame is drawn at 0, so
 * the scene starts there.
 */
function createHarness(options: Partial<BeatorajaPlayBridgeOptions> = {}) {
  let now = 0;
  let state: PlayState = createPlayState({ totalSeconds: 100, view: { covers: [NO_COVER] } });
  let engine: BeatorajaPlayEngineInput | undefined;
  const variant = options.chartPlayVariant ?? '7';
  const bridge = new BeatorajaPlayBridge({ chartPlayVariant: variant, baseOps: new Set(), ...options });
  const update = (events: readonly PlayViewEvent[] = []) =>
    bridge.update({ nowMs: now, state, ...(engine !== undefined ? { engine } : {}), events });
  update();
  return {
    bridge,
    advance(ms: number): void {
      now += ms;
    },
    update,
    /** An engine lane command, as the session hands it on (`lane-command` moment). */
    command(command: PlayerUICommand): void {
      const event = playViewEventFromMoment({ kind: 'lane-command', command });
      update(event !== undefined ? [event] : []);
    },
    /** A judgment the engine published: the play state takes it, and the session's judge moment goes to the bridge. */
    judge(judgment: { judge: string; combo: number; channel?: string; deltaMs?: number }): void {
      state = reducePlayState(state, {
        type: 'judge',
        judge: judgment,
        seconds: engine?.currentSeconds ?? 0,
        atMs: now,
      });
      const side = variant !== '9' && judgment.channel?.startsWith('2') === true ? '2P' : '1P';
      const event = playViewEventFromMoment({
        kind: 'judge',
        side,
        at: now,
        judge: judgment.judge,
        ...(judgment.channel !== undefined ? { channel: judgment.channel } : {}),
        ...(judgment.deltaMs !== undefined ? { deltaMs: judgment.deltaMs } : {}),
        combo: judgment.combo,
      });
      update(event !== undefined ? [event] : []);
    },
    /** An engine frame: the bridge reads its clock and summary, the play state its EX score and gauge. */
    frame(frame: TestEngineFrame): void {
      engine = engineOf(frame);
      const gauge = engine.summary.gauge;
      state = reducePlayState(state, {
        type: 'frame',
        frame: {
          totalSeconds: engine.totalSeconds,
          summary: {
            exScore: engine.summary.exScore,
            ...(gauge !== undefined ? { gauge: { ...gauge, cleared: false } } : {}),
          },
        },
      });
      update();
    },
    /** A change of the play state (a cover, the hi-speed). */
    play(event: PlayEvent | LaneCoverCommand): void {
      state = reducePlayState(state, event);
      update();
    },
    state: (): PlayState => state,
  };
}

/** A cover command setting the 1P cover outright. */
function setCover(cover: Partial<LaneCoverState>): LaneCoverCommand {
  return { type: 'cover-set', covers: [{ side: '1P', ...cover }] };
}

describe('BeatorajaPlayBridge — construction', () => {
  it('seeds activeOps with base option ops + scene-start timer + autoplay-off + now-loading', () => {
    const { bridge } = createHarness({ baseOps: new Set([920, 901]) });
    expect(bridge.hasOp(920)).toBe(true);
    expect(bridge.hasOp(901)).toBe(true);
    expect(bridge.hasOp(BEATORAJA_OP.AUTOPLAY_OFF)).toBe(true);
    expect(bridge.hasOp(BEATORAJA_OP.AUTOPLAY_ON)).toBe(false);
    expect(bridge.hasOp(BEATORAJA_OP.NOW_LOADING)).toBe(true);
    expect(bridge.getTimerStart(TIMER_SCENE_START)).toBe(0);
  });

  it('does not seed a speculative play-mode op (1..5 are reserved for per-keys mode)', () => {
    const { bridge } = createHarness();
    for (const op of [1, 2, 3, 4, 5]) {
      expect(bridge.hasOp(op)).toBe(false);
    }
  });

  it('surfaces AUTOPLAY_ON and clears AUTOPLAY_OFF in autoplay mode', () => {
    const { bridge } = createHarness({ autoPlay: true });
    expect(bridge.hasOp(BEATORAJA_OP.AUTOPLAY_ON)).toBe(true);
    expect(bridge.hasOp(BEATORAJA_OP.AUTOPLAY_OFF)).toBe(false);
  });

  it('starts the scene and preview timers on the first frame shown, or at the scene start before it', () => {
    const bridge = new BeatorajaPlayBridge({ chartPlayVariant: '7', baseOps: new Set() });
    const state = createPlayState();
    bridge.update({ nowMs: 300, state, events: [{ kind: 'scene-start', atMs: 250 }] });
    expect(bridge.getTimerStart(TIMER_SCENE_START)).toBe(250);
    expect(bridge.getTimerStart(TIMER_PREVIEW)).toBe(250);
    // Once started, a later scene start does not start them again.
    bridge.update({ nowMs: 900, state, events: [{ kind: 'scene-start', atMs: 900 }] });
    expect(bridge.getTimerStart(TIMER_SCENE_START)).toBe(250);
  });
});

describe('BeatorajaPlayBridge — built-in timers', () => {
  it('stamps `startinput` / `ready` / `play` at load-end, flips the loading gate, and `fadeout` at the exit fade', () => {
    // The adapter stamped them as the engine came up (its input bus, then its start); the play session raises one
    // `load-end` moment when the play has loaded and is about to start, and the three start then.
    const { bridge, advance, update } = createHarness();
    advance(120);
    update([{ kind: 'load-end', atMs: 120 }]);
    expect(bridge.getTimerStart(TIMER_STARTINPUT)).toBe(120);
    expect(bridge.getTimerStart(TIMER_READY)).toBe(120);
    expect(bridge.getTimerStart(TIMER_PLAY)).toBe(120);
    expect(bridge.hasOp(BEATORAJA_OP.NOW_LOADING)).toBe(false);
    expect(bridge.hasOp(BEATORAJA_OP.LOADED)).toBe(true);

    advance(61_300);
    update([{ kind: 'exit-fade-out', atMs: 61_420 }]);
    expect(bridge.getTimerStart(TIMER_FADEOUT)).toBe(61_420);
    // A second fade (the engine's stop after the held outro) does not restart it.
    update([{ kind: 'exit-fade-out', atMs: 62_000 }]);
    expect(bridge.getTimerStart(TIMER_FADEOUT)).toBe(61_420);
  });

  it('starts `TIMER_FAILED` (3), not `fadeout`, as a failed play stops', () => {
    const { bridge, advance, update } = createHarness();
    advance(5000);
    update([{ kind: 'exit-close', atMs: 5000 }]);
    expect(bridge.getTimerStart(3)).toBe(5000);
    expect(bridge.getTimerStart(TIMER_FADEOUT)).toBeUndefined();
    // Started once: a later stop moment does not restart it.
    update([{ kind: 'exit-close', atMs: 6000 }]);
    expect(bridge.getTimerStart(3)).toBe(5000);
  });
});

describe('BeatorajaPlayBridge — lane events', () => {
  it('starts the per-lane key-on timer on press-lane (1P channel 13 → key 3 → timer 103)', () => {
    const harness = createHarness();
    harness.advance(500);
    harness.command({ kind: 'press-lane', channel: '13' });
    expect(harness.bridge.getTimerStart(keyOnTimerId(1, 3)!)).toBe(500);
  });

  it('starts the key-off timer on release-lane (2P channel 22 → key 2 → timer 132)', () => {
    const harness = createHarness({ chartPlayVariant: '14' });
    harness.advance(800);
    harness.command({ kind: 'release-lane', channel: '22' });
    expect(harness.bridge.getTimerStart(keyOffTimerId(2, 2)!)).toBe(800);
  });

  it('flash-lane stamps KEY_ON (not bomb) — autoplay path that bypasses press-lane', () => {
    // `flash-lane` is the engine's "key was pressed / autoplay consumed a note" signal. It fires regardless of judge
    // severity, so it can't drive the bomb explosion (a positive-feedback cue for clean hits), which a PERFECT / GREAT
    // judgment starts.
    const harness = createHarness();
    harness.advance(1200);
    harness.command({ kind: 'flash-lane', channel: '15' });
    expect(harness.bridge.getTimerStart(keyOnTimerId(1, 5)!)).toBe(1200);
    expect(harness.bridge.getTimerStart(bombTimerId(1, 5)!)).toBeUndefined();
  });

  it('ends a flash 60 ms on (key-off on, key-on off), unless a press took the lane meanwhile', () => {
    // AUTO PLAY sends no release: the key beam comes off on its own, at the flash's end, on the next frame past it.
    const harness = createHarness();
    harness.advance(1000);
    harness.command({ kind: 'flash-lane', channel: '15' });
    harness.command({ kind: 'flash-lane', channel: '14' });
    harness.command({ kind: 'press-lane', channel: '14' });
    harness.advance(59);
    harness.update();
    expect(harness.bridge.getTimerStart(keyOnTimerId(1, 5)!)).toBe(1000);
    harness.advance(10);
    harness.update();
    expect(harness.bridge.getTimerStart(keyOnTimerId(1, 5)!)).toBeUndefined();
    expect(harness.bridge.getTimerStart(keyOffTimerId(1, 5)!)).toBe(1060);
    // The pressed lane keeps its key-on timer.
    expect(harness.bridge.getTimerStart(keyOnTimerId(1, 4)!)).toBe(1000);
  });

  it('press-lane deactivates the previously-active KEY_OFF timer (lane laser visibility gate)', () => {
    // Beatoraja's `KeyInputProccessor` does `setTimerOn(KEY_ON); setTimerOff(KEY_OFF)` symmetrically: a destination
    // keyed on KEY_OFF must stop drawing once the player presses the key again.
    const harness = createHarness();
    harness.advance(100);
    harness.command({ kind: 'release-lane', channel: '13' });
    expect(harness.bridge.getTimerStart(keyOffTimerId(1, 3)!)).toBe(100);
    harness.advance(50);
    harness.command({ kind: 'press-lane', channel: '13' });
    expect(harness.bridge.getTimerStart(keyOffTimerId(1, 3)!)).toBeUndefined();
    expect(harness.bridge.getTimerStart(keyOnTimerId(1, 3)!)).toBe(150);
  });

  it('release-lane deactivates the previously-active KEY_ON timer (laser disappears on release)', () => {
    const harness = createHarness();
    harness.advance(100);
    harness.command({ kind: 'press-lane', channel: '13' });
    expect(harness.bridge.getTimerStart(keyOnTimerId(1, 3)!)).toBe(100);
    harness.advance(200);
    harness.command({ kind: 'release-lane', channel: '13' });
    expect(harness.bridge.getTimerStart(keyOnTimerId(1, 3)!)).toBeUndefined();
    expect(harness.bridge.getTimerStart(keyOffTimerId(1, 3)!)).toBe(300);
  });

  it('starts the LN-hold timer on hold-lane-until-beat', () => {
    const harness = createHarness();
    harness.advance(2000);
    harness.command({ kind: 'hold-lane-until-beat', channel: '19', beat: 64 });
    expect(harness.bridge.getTimerStart(lnHoldTimerId(1, 7)!)).toBe(2000);
  });

  it('re-stamps the LN-hold timer on the tail verdict (ModernChic lnbomb fix)', () => {
    // ModernChic's `Play/lua/sp/bomb.lua` keys its LN bomb on `HOLD_1P_KEY*` with a 160 ms cycle: the tail's judgment
    // restarts the hold timer (upstream `JudgeManager` stamps it on every LN tail), so the bomb plays at the tail. The
    // engine sends the release before the tail's judgment.
    const harness = createHarness();
    harness.advance(100);
    harness.command({ kind: 'hold-lane-until-beat', channel: '19', beat: 64 });
    expect(harness.bridge.getTimerStart(lnHoldTimerId(1, 7)!)).toBe(100);
    harness.advance(200);
    harness.command({ kind: 'release-lane', channel: '19' });
    expect(harness.bridge.getTimerStart(lnHoldTimerId(1, 7)!)).toBeUndefined();
    harness.judge({ judge: 'PERFECT', combo: 1, channel: '19' });
    expect(harness.bridge.getTimerStart(lnHoldTimerId(1, 7)!)).toBe(300);
    // The combo timer (446 = 1P) restarts with it, so the combo digits animate at the tail too.
    expect(harness.bridge.getTimerStart(446)).toBe(300);
  });

  it('auto-deactivates the re-stamped LN-hold timer after the bomb-hold window', () => {
    // The re-stamped hold timer must go off so a destination with `loop = 0` (ModernChic's lnbomb) stops after its
    // cycle; the window is 320 ms (`LN_TAIL_BOMB_HOLD_MS`). The bridge ends it on the first frame past the window.
    const harness = createHarness();
    harness.advance(100);
    harness.command({ kind: 'hold-lane-until-beat', channel: '19', beat: 64 });
    harness.advance(200);
    harness.command({ kind: 'release-lane', channel: '19' });
    harness.judge({ judge: 'PERFECT', combo: 1, channel: '19' });
    expect(harness.bridge.getTimerStart(lnHoldTimerId(1, 7)!)).toBe(300);
    harness.advance(319);
    harness.update();
    expect(harness.bridge.getTimerStart(lnHoldTimerId(1, 7)!)).toBe(300);
    harness.advance(1);
    harness.update();
    expect(harness.bridge.getTimerStart(lnHoldTimerId(1, 7)!)).toBeUndefined();
  });

  it('does NOT re-stamp the LN-hold timer for tap-note verdicts (no LN context)', () => {
    const harness = createHarness();
    harness.advance(100);
    harness.judge({ judge: 'PERFECT', combo: 1, channel: '19' });
    expect(harness.bridge.getTimerStart(lnHoldTimerId(1, 7)!)).toBeUndefined();
  });

  it('isLaneLNHeld flips on hold-lane-until-beat and clears on release-lane', () => {
    // Drives the modern-mode `lnBodyHeld` / `lnBodyUnheld` sprites.
    const harness = createHarness();
    expect(harness.bridge.isLaneLNHeld('19')).toBe(false);
    harness.advance(1000);
    harness.command({ kind: 'hold-lane-until-beat', channel: '19', beat: 64 });
    expect(harness.bridge.isLaneLNHeld('19')).toBe(true);
    expect(harness.bridge.getTimerStart(lnHoldTimerId(1, 7)!)).toBe(1000);
    expect(harness.bridge.isLaneLNHeld('11')).toBe(false);
    harness.advance(500);
    harness.command({ kind: 'release-lane', channel: '19' });
    expect(harness.bridge.isLaneLNHeld('19')).toBe(false);
    // The timer goes off on release, as upstream `JudgeManager.java:546-547` switches it off once the sustain ends.
    expect(harness.bridge.getTimerStart(lnHoldTimerId(1, 7)!)).toBeUndefined();
  });

  it('ignores the long-note start / end commands (the LN-hold state stays on hold-lane / release-lane)', () => {
    const harness = createHarness();
    harness.advance(1000);
    harness.command({ kind: 'hold-lane-until-beat', channel: '11', beat: 64 });
    harness.command({ kind: 'long-note-start', channel: '11', beat: 32, mode: 'cn' });
    expect(harness.bridge.isLaneLNHeld('11')).toBe(true);
    harness.command({ kind: 'long-note-end', channel: '11', outcome: 'dropped' });
    expect(harness.bridge.isLaneLNHeld('11')).toBe(true);
    expect(harness.bridge.getTimerStart(lnHoldTimerId(1, 1)!)).toBe(1000);
    harness.command({ kind: 'long-note-start', channel: '12', beat: 32, mode: 'ln' });
    expect(harness.bridge.isLaneLNHeld('12')).toBe(false);
  });

  it('routes scratch (16 / 26) onto lane 0 → timer 100 (1P) / 110 (2P)', () => {
    const harness = createHarness();
    harness.advance(50);
    harness.command({ kind: 'press-lane', channel: '16' });
    expect(harness.bridge.getTimerStart(100)).toBe(50);
    harness.advance(50);
    harness.command({ kind: 'press-lane', channel: '26' });
    expect(harness.bridge.getTimerStart(110)).toBe(100);
  });

  it('5K variant rejects channels 18/19 — no phantom KEY_ON timers stamped', () => {
    const harness = createHarness({ chartPlayVariant: '5' });
    harness.advance(50);
    harness.command({ kind: 'press-lane', channel: '18' });
    harness.command({ kind: 'press-lane', channel: '19' });
    expect(harness.bridge.getTimerStart(keyOnTimerId(1, 6)!)).toBeUndefined();
    expect(harness.bridge.getTimerStart(keyOnTimerId(1, 7)!)).toBeUndefined();
    harness.command({ kind: 'press-lane', channel: '15' });
    expect(harness.bridge.getTimerStart(keyOnTimerId(1, 5)!)).toBe(50);
  });

  it('10K variant rejects channels 18/19/28/29 on both sides', () => {
    const harness = createHarness({ chartPlayVariant: '10' });
    harness.advance(75);
    for (const channel of ['18', '19', '28', '29']) {
      harness.command({ kind: 'press-lane', channel });
    }
    expect(harness.bridge.getTimerStart(keyOnTimerId(1, 6)!)).toBeUndefined();
    expect(harness.bridge.getTimerStart(keyOnTimerId(1, 7)!)).toBeUndefined();
    expect(harness.bridge.getTimerStart(keyOnTimerId(2, 6)!)).toBeUndefined();
    expect(harness.bridge.getTimerStart(keyOnTimerId(2, 7)!)).toBeUndefined();
  });

  it('9K (POPN) variant routes channels 16..19 to lanes 6..9 (timers 106..109)', () => {
    const harness = createHarness({ chartPlayVariant: '9' });
    harness.advance(100);
    for (const channel of ['16', '17', '18', '19']) {
      harness.command({ kind: 'press-lane', channel });
    }
    expect(harness.bridge.getTimerStart(keyOnTimerId(1, 6)!)).toBe(100);
    expect(harness.bridge.getTimerStart(keyOnTimerId(1, 7)!)).toBe(100);
    expect(harness.bridge.getTimerStart(keyOnTimerId(1, 8)!)).toBe(100);
    expect(harness.bridge.getTimerStart(keyOnTimerId(1, 9)!)).toBe(100);
    // POPN_9K has no scratch lane.
    expect(harness.bridge.getTimerStart(keyOnTimerId(1, 0)!)).toBeUndefined();
  });

  it('9K (PMS-STD) collapses channels 22..25 onto the 1P-side timer bank (lanes 6..9)', () => {
    const harness = createHarness({ chartPlayVariant: '9' });
    harness.advance(100);
    for (const channel of ['22', '23', '24', '25']) {
      harness.command({ kind: 'press-lane', channel });
    }
    expect(harness.bridge.getTimerStart(keyOnTimerId(1, 6)!)).toBe(100);
    expect(harness.bridge.getTimerStart(keyOnTimerId(1, 7)!)).toBe(100);
    expect(harness.bridge.getTimerStart(keyOnTimerId(1, 8)!)).toBe(100);
    expect(harness.bridge.getTimerStart(keyOnTimerId(1, 9)!)).toBe(100);
    expect(harness.bridge.getTimerStart(keyOnTimerId(2, 6)!)).toBeUndefined();
    expect(harness.bridge.getTimerStart(keyOnTimerId(2, 7)!)).toBeUndefined();
    expect(harness.bridge.getTimerStart(keyOnTimerId(2, 8)!)).toBeUndefined();
    expect(harness.bridge.getTimerStart(keyOnTimerId(2, 9)!)).toBeUndefined();
  });

  it('9K judgments dispatch per judge plate (PMS-STD lane groups → plate 1/2/3)', () => {
    // Upstream `JudgeManager.notifyJudge`: `judgeindex = lane / (lanes / plates)`; POPN-9's lane bombs stay on 1P.
    const harness = createHarness({ chartPlayVariant: '9' });
    harness.advance(100);
    harness.judge({ judge: 'PERFECT', combo: 1, channel: '11' });
    harness.judge({ judge: 'PERFECT', combo: 4, channel: '14' });
    harness.judge({ judge: 'PERFECT', combo: 6, channel: '22' });
    harness.judge({ judge: 'PERFECT', combo: 7, channel: '23' });
    harness.judge({ judge: 'PERFECT', combo: 9, channel: '25' });
    expect(harness.bridge.getTimerStart(judgeTimerId(1))).toBe(100);
    expect(harness.bridge.getTimerStart(judgeTimerId(2))).toBe(100);
    expect(harness.bridge.getTimerStart(judgeTimerId(3))).toBe(100);
    expect(harness.bridge.getTimerStart(comboTimerId(1))).toBe(100);
    expect(harness.bridge.getTimerStart(comboTimerId(2))).toBe(100);
    expect(harness.bridge.getTimerStart(comboTimerId(3))).toBe(100);
    expect(harness.bridge.hasOp(BEATORAJA_OP.P1_JUDGE_PERFECT)).toBe(true);
    expect(harness.bridge.hasOp(BEATORAJA_OP.P2_JUDGE_PERFECT)).toBe(true);
    expect(harness.bridge.hasOp(BEATORAJA_OP.P3_JUDGE_PERFECT)).toBe(true);
    expect(harness.bridge.getTimerStart(56)).toBe(100);
    expect(harness.bridge.getTimerStart(59)).toBe(100);
    expect(harness.bridge.getTimerStart(66)).toBeUndefined();
    expect(harness.bridge.getTimerStart(69)).toBeUndefined();
  });
});

describe('BeatorajaPlayBridge — judgments', () => {
  it('stamps the side-relative judge timer + adds the prop.lua judge op (PERFECT 1P → 241)', () => {
    const harness = createHarness();
    harness.advance(1500);
    harness.judge({ judge: 'PERFECT', combo: 12, channel: '13' });
    expect(harness.bridge.getTimerStart(judgeTimerId(1))).toBe(1500);
    expect(harness.bridge.hasOp(BEATORAJA_OP.P1_JUDGE_PERFECT)).toBe(true);
  });

  it('clears the previous side-1 judge op when a new one comes in', () => {
    const harness = createHarness();
    harness.judge({ judge: 'PERFECT', combo: 1, channel: '11' });
    expect(harness.bridge.hasOp(BEATORAJA_OP.P1_JUDGE_PERFECT)).toBe(true);
    harness.judge({ judge: 'GREAT', combo: 2, channel: '11' });
    expect(harness.bridge.hasOp(BEATORAJA_OP.P1_JUDGE_PERFECT)).toBe(false);
    expect(harness.bridge.hasOp(BEATORAJA_OP.P1_JUDGE_GREAT)).toBe(true);
  });

  it('keeps the side-2 judge op independent of the side-1 op', () => {
    const harness = createHarness({ chartPlayVariant: '14' });
    harness.judge({ judge: 'PERFECT', combo: 1, channel: '13' });
    harness.judge({ judge: 'BAD', combo: 1, channel: '23' });
    expect(harness.bridge.hasOp(BEATORAJA_OP.P1_JUDGE_PERFECT)).toBe(true);
    expect(harness.bridge.hasOp(BEATORAJA_OP.P2_JUDGE_BAD)).toBe(true);
  });

  it('restarts the side-relative combo timer (446 / 447) on every PERFECT / GREAT / GOOD verdict', () => {
    const harness = createHarness({ chartPlayVariant: '14' });
    harness.advance(100);
    harness.judge({ judge: 'PERFECT', combo: 1, channel: '13' });
    expect(harness.bridge.getTimerStart(comboTimerId(1))).toBe(100);
    expect(harness.bridge.getTimerStart(comboTimerId(2))).toBeUndefined();
    harness.advance(150);
    harness.judge({ judge: 'GREAT', combo: 2, channel: '23' });
    expect(harness.bridge.getTimerStart(comboTimerId(2))).toBe(250);
    expect(harness.bridge.getTimerStart(comboTimerId(1))).toBe(100);
    harness.advance(100);
    harness.judge({ judge: 'GOOD', combo: 3, channel: '13' });
    expect(harness.bridge.getTimerStart(comboTimerId(1))).toBe(350);
  });

  it('fires the lane bomb timer on PERFECT and GREAT (clean hit verdicts)', () => {
    const harness = createHarness();
    harness.advance(100);
    harness.judge({ judge: 'PERFECT', combo: 1, channel: '14' });
    expect(harness.bridge.getTimerStart(bombTimerId(1, 4)!)).toBe(100);
    harness.advance(100);
    harness.judge({ judge: 'GREAT', combo: 2, channel: '15' });
    expect(harness.bridge.getTimerStart(bombTimerId(1, 5)!)).toBe(200);
  });

  it('does NOT fire the bomb timer on GOOD / BAD / POOR (skin only flashes bomb on clean hits)', () => {
    const harness = createHarness();
    harness.advance(100);
    harness.judge({ judge: 'GOOD', combo: 1, channel: '11' });
    expect(harness.bridge.getTimerStart(bombTimerId(1, 1)!)).toBeUndefined();
    harness.advance(100);
    harness.judge({ judge: 'BAD', combo: 0, channel: '12' });
    expect(harness.bridge.getTimerStart(bombTimerId(1, 2)!)).toBeUndefined();
    harness.advance(100);
    harness.judge({ judge: 'POOR', combo: 0, channel: '13' });
    expect(harness.bridge.getTimerStart(bombTimerId(1, 3)!)).toBeUndefined();
  });

  it('does NOT restart the combo timer on combo-break verdicts (BAD / POOR)', () => {
    const harness = createHarness();
    harness.advance(50);
    harness.judge({ judge: 'PERFECT', combo: 1, channel: '11' });
    expect(harness.bridge.getTimerStart(comboTimerId(1))).toBe(50);
    harness.advance(100);
    harness.judge({ judge: 'BAD', combo: 0, channel: '11' });
    expect(harness.bridge.getTimerStart(comboTimerId(1))).toBe(50);
    harness.advance(50);
    harness.judge({ judge: 'POOR', combo: 0, channel: '11' });
    expect(harness.bridge.getTimerStart(comboTimerId(1))).toBe(50);
    harness.advance(100);
    harness.judge({ judge: 'PERFECT', combo: 1, channel: '11' });
    expect(harness.bridge.getTimerStart(comboTimerId(1))).toBe(300);
  });

  it('latches the per-side judge combo into the synthetic JUDGE_COMBO_1P / 2P refs (upstream `getNowCombo`)', () => {
    // `JudgeManager.notifyJudge` records the live combo of each judgment for its plate's popup.
    const harness = createHarness();
    harness.judge({ judge: 'PERFECT', combo: 1, channel: '11' });
    expect(harness.bridge.resolveNumberValue(SYNTHETIC_NUM_JUDGE_COMBO_1P)).toBe(1);
    harness.judge({ judge: 'GREAT', combo: 2, channel: '11' });
    expect(harness.bridge.resolveNumberValue(SYNTHETIC_NUM_JUDGE_COMBO_1P)).toBe(2);
    // A combo break reads 0, not the max combo.
    harness.judge({ judge: 'BAD', combo: 0, channel: '11' });
    expect(harness.bridge.resolveNumberValue(SYNTHETIC_NUM_JUDGE_COMBO_1P)).toBe(0);
    expect(harness.bridge.resolveNumberValue(SYNTHETIC_NUM_JUDGE_COMBO_2P)).toBe(0);
    harness.judge({ judge: 'PERFECT', combo: 5, channel: '21' });
    expect(harness.bridge.resolveNumberValue(SYNTHETIC_NUM_JUDGE_COMBO_2P)).toBe(5);
    expect(harness.bridge.resolveNumberValue(SYNTHETIC_NUM_JUDGE_COMBO_1P)).toBe(0);
  });

  it('latches per-plate combo for POPN-9 (`_1P` / `_2P` / `_3P` synthetic refs)', () => {
    const harness = createHarness({ chartPlayVariant: '9' });
    harness.judge({ judge: 'PERFECT', combo: 7, channel: '11' });
    harness.judge({ judge: 'PERFECT', combo: 8, channel: '14' });
    harness.judge({ judge: 'PERFECT', combo: 9, channel: '25' });
    expect(harness.bridge.resolveNumberValue(SYNTHETIC_NUM_JUDGE_COMBO_1P)).toBe(7);
    expect(harness.bridge.resolveNumberValue(SYNTHETIC_NUM_JUDGE_COMBO_2P)).toBe(8);
    expect(harness.bridge.resolveNumberValue(SYNTHETIC_NUM_JUDGE_COMBO_3P)).toBe(9);
  });

  it('keeps each plate its own combo when two judgments land in one frame', () => {
    // The judge event carries its own combo, so a DP chord judged in one frame shows each side's.
    const bridge = new BeatorajaPlayBridge({ chartPlayVariant: '14', baseOps: new Set() });
    bridge.update({
      nowMs: 10,
      state: createPlayState(),
      events: [
        { kind: 'judge', judge: 'PERFECT', side: '1P', channel: '11', combo: 3, atMs: 10 },
        { kind: 'judge', judge: 'PERFECT', side: '2P', channel: '21', combo: 4, atMs: 10 },
      ],
    });
    expect(bridge.resolveNumberValue(SYNTHETIC_NUM_JUDGE_COMBO_1P)).toBe(3);
    expect(bridge.resolveNumberValue(SYNTHETIC_NUM_JUDGE_COMBO_2P)).toBe(4);
  });

  it('per-lane keybeam ref encodes the latest verdict as judgeIndex+1 within the window', () => {
    // Drives the keybeam and bomb imagesets (`ref = 500 + lane`).
    const harness = createHarness();
    expect(harness.bridge.resolveRefValue(503)).toBe(0);
    harness.advance(100);
    harness.judge({ judge: 'PERFECT', combo: 1, channel: '13' });
    expect(harness.bridge.resolveRefValue(503)).toBe(1);
    harness.advance(50);
    harness.judge({ judge: 'GREAT', combo: 2, channel: '13' });
    expect(harness.bridge.resolveRefValue(503)).toBe(2);
    harness.advance(20);
    harness.judge({ judge: 'GOOD', combo: 3, channel: '13' });
    expect(harness.bridge.resolveRefValue(503)).toBe(3);
    harness.advance(20);
    harness.judge({ judge: 'BAD', combo: 0, channel: '13' });
    expect(harness.bridge.resolveRefValue(503)).toBe(4);
    harness.advance(20);
    harness.judge({ judge: 'POOR', combo: 0, channel: '13' });
    expect(harness.bridge.resolveRefValue(503)).toBe(5);
  });

  it('per-lane keybeam ref decays to 0 once the verdict ages past the 250 ms window', () => {
    const harness = createHarness();
    harness.advance(100);
    harness.judge({ judge: 'PERFECT', combo: 1, channel: '14' });
    expect(harness.bridge.resolveRefValue(504)).toBe(1);
    harness.advance(250);
    harness.update();
    expect(harness.bridge.resolveRefValue(504)).toBe(1);
    harness.advance(1);
    harness.update();
    expect(harness.bridge.resolveRefValue(504)).toBe(0);
  });

  it('per-lane keybeam ref is independent across lanes (one PERFECT does not light the others)', () => {
    const harness = createHarness();
    harness.advance(100);
    harness.judge({ judge: 'PERFECT', combo: 1, channel: '13' });
    expect(harness.bridge.resolveRefValue(503)).toBe(1);
    expect(harness.bridge.resolveRefValue(504)).toBe(0);
    expect(harness.bridge.resolveRefValue(505)).toBe(0);
  });
});

describe('BeatorajaPlayBridge — render context', () => {
  it('returns the same context and activeOps Set instance on every frame (no per-frame allocation)', () => {
    const harness = createHarness({ baseOps: new Set([920]) });
    const a = harness.update();
    const b = harness.update();
    expect(a).toBe(b);
    expect(a.activeOps).toBe(b.activeOps);
  });

  it("threads the frame's play clock into the context", () => {
    const harness = createHarness();
    harness.advance(750);
    expect(harness.update().nowMs).toBe(750);
  });

  it('resolves timer starts through the same map the lane events wrote to', () => {
    const harness = createHarness();
    harness.advance(400);
    harness.command({ kind: 'press-lane', channel: '14' });
    const ctx = harness.update();
    expect(ctx.getTimerStart(keyOnTimerId(1, 4)!)).toBe(400);
    expect(ctx.getTimerStart(99999)).toBeUndefined();
  });

  it('exposes resolveOffset — undefined for unset offsets, value for set ones', () => {
    const harness = createHarness();
    const ctx = harness.update();
    // OFFSET_LIFT (id 3) defaults to undefined — no shift.
    expect(ctx.resolveOffset?.(3)).toBeUndefined();
    harness.bridge.setOffset(3, { y: -120 });
    const updated = harness.update().resolveOffset?.(3);
    expect(updated?.y).toBe(-120);
    // Default fields stay zero, alpha included (an additive delta, 0 = no change).
    expect(updated?.x).toBe(0);
    expect(updated?.a).toBe(0);
  });

  it('merges partial setOffset values with the previously set ones', () => {
    const { bridge } = createHarness();
    bridge.setOffset(4, { x: 10, y: 20 });
    bridge.setOffset(4, { y: 50 });
    const lanecover = bridge.resolveOffset(4);
    expect(lanecover?.x).toBe(10);
    expect(lanecover?.y).toBe(50);
  });

  it("hands the skin's Lua sound calls to the skin sounds", () => {
    const calls: string[] = [];
    const harness = createHarness({
      skinSounds: {
        play: (path) => (calls.push(`play ${path}`), true),
        loop: (path) => (calls.push(`loop ${path}`), true),
        stop: (path) => (calls.push(`stop ${path}`), true),
      },
    });
    const ctx = harness.update();
    ctx.audioPlay?.('a.wav', 1);
    ctx.audioLoop?.('b.wav', 0.5);
    ctx.audioStop?.('b.wav');
    expect(calls).toEqual(['play a.wav', 'loop b.wav', 'stop b.wav']);
    expect(createHarness().update().audioPlay).toBeUndefined();
  });
});

describe('BeatorajaPlayBridge — lane cover (the play state’s 1P cover)', () => {
  it('drives `slider[].type = 4` and `BEATORAJA_NUM.LANECOVER1` from the same SUDDEN+ height', () => {
    const harness = createHarness();
    expect(harness.bridge.resolveSliderValue(4)).toBe(0);
    expect(harness.bridge.resolveNumberValue(14)).toBe(0);
    harness.play(setCover({ sudden: 0.6, suddenOn: true }));
    expect(harness.bridge.resolveSliderValue(4)).toBeCloseTo(0.6, 6);
    expect(harness.bridge.resolveNumberValue(14)).toBe(600);
    // 2P reads the same cover in single-side play (`type = 5` == `type = 4`).
    expect(harness.bridge.resolveSliderValue(5)).toBeCloseTo(0.6, 6);
  });

  it('clamps cover moves to [0, 1]', () => {
    // The play state moves the cover (`reduceLaneCovers`), clamped to the lane.
    const harness = createHarness();
    harness.play({ type: 'cover-adjust', part: 'sudden', delta: 2 });
    expect(harness.bridge.resolveSliderValue(4)).toBe(1);
    harness.play({ type: 'cover-adjust', part: 'sudden', delta: -1.5 });
    expect(harness.bridge.resolveSliderValue(4)).toBe(0);
    harness.play({ type: 'cover-adjust', part: 'sudden', delta: 0.3 });
    harness.play({ type: 'cover-adjust', part: 'sudden', delta: 0.5 });
    expect(harness.bridge.resolveSliderValue(4)).toBeCloseTo(0.8, 6);
    harness.play({ type: 'cover-adjust', part: 'sudden', delta: 0.5 });
    expect(harness.bridge.resolveSliderValue(4)).toBe(1);
  });

  it('ignores non-finite moves', () => {
    const harness = createHarness();
    harness.play({ type: 'cover-adjust', part: 'sudden', delta: 0.4 });
    harness.play({ type: 'cover-adjust', part: 'sudden', delta: Number.NaN });
    expect(harness.bridge.resolveSliderValue(4)).toBeCloseTo(0.4, 6);
    harness.play({ type: 'cover-adjust', part: 'sudden', delta: Number.POSITIVE_INFINITY });
    expect(harness.bridge.resolveSliderValue(4)).toBeCloseTo(0.4, 6);
  });
});

describe('BeatorajaPlayBridge — timing samples', () => {
  it('reads signed deltaMs samples off the play state (oldest-first)', () => {
    const harness = createHarness();
    expect(harness.bridge.resolveTimingSamples()).toEqual([]);
    harness.judge({ judge: 'PERFECT', combo: 1, channel: '11', deltaMs: -8 });
    harness.judge({ judge: 'GREAT', combo: 2, channel: '11', deltaMs: 22 });
    harness.judge({ judge: 'BAD', combo: 0, channel: '12', deltaMs: -110 });
    expect(harness.bridge.resolveTimingSamples()).toEqual([
      { deltaMs: -8, kind: 'PERFECT' },
      { deltaMs: 22, kind: 'GREAT' },
      { deltaMs: -110, kind: 'BAD' },
    ]);
  });

  it('skips publishes without a deltaMs (READY / AUTO PLAY / mine BAD)', () => {
    const harness = createHarness();
    harness.judge({ judge: 'READY', combo: 0 });
    harness.judge({ judge: 'PERFECT', combo: 1, channel: '11' });
    harness.judge({ judge: 'PERFECT', combo: 2, channel: '12', deltaMs: -3 });
    expect(harness.bridge.resolveTimingSamples()).toEqual([{ deltaMs: -3, kind: 'PERFECT' }]);
  });

  it('keeps the latest 50 — drops the oldest past that', () => {
    const harness = createHarness();
    for (let i = 0; i < 60; i += 1) {
      harness.judge({ judge: 'PERFECT', combo: i + 1, channel: '11', deltaMs: i });
    }
    const samples = harness.bridge.resolveTimingSamples();
    expect(samples).toHaveLength(50);
    expect(samples[0]?.deltaMs).toBe(10);
    expect(samples[samples.length - 1]?.deltaMs).toBe(59);
    // The same list until a new judgment comes.
    expect(harness.bridge.resolveTimingSamples()).toBe(samples);
  });
});

describe('BeatorajaPlayBridge — FAST / SLOW gate ops (1242 / 1243)', () => {
  it('publishes P1_JUDGE_EARLY on a negative deltaMs and clears it on the next late hit', () => {
    const harness = createHarness();
    expect(harness.update().activeOps.has(1242)).toBe(false);
    expect(harness.update().activeOps.has(1243)).toBe(false);
    harness.judge({ judge: 'PERFECT', combo: 1, channel: '11', deltaMs: -8 });
    expect(harness.update().activeOps.has(1242)).toBe(true);
    expect(harness.update().activeOps.has(1243)).toBe(false);
    harness.judge({ judge: 'GREAT', combo: 2, channel: '11', deltaMs: 22 });
    expect(harness.update().activeOps.has(1242)).toBe(false);
    expect(harness.update().activeOps.has(1243)).toBe(true);
  });

  it('clears both EARLY and LATE on a perfect-on-time hit (deltaMs === 0)', () => {
    const harness = createHarness();
    harness.judge({ judge: 'GREAT', combo: 1, channel: '11', deltaMs: 22 });
    expect(harness.update().activeOps.has(1243)).toBe(true);
    harness.judge({ judge: 'PERFECT', combo: 2, channel: '11', deltaMs: 0 });
    expect(harness.update().activeOps.has(1242)).toBe(false);
    expect(harness.update().activeOps.has(1243)).toBe(false);
  });

  it('preserves the prior gate when a publish has no deltaMs (READY / AUTO PLAY / mine BAD)', () => {
    const harness = createHarness();
    harness.judge({ judge: 'PERFECT', combo: 1, channel: '11', deltaMs: -8 });
    expect(harness.update().activeOps.has(1242)).toBe(true);
    harness.judge({ judge: 'BAD', combo: 0, channel: '11' });
    expect(harness.update().activeOps.has(1242)).toBe(true);
  });
});

describe('BeatorajaPlayBridge — early / late counts', () => {
  it("reads the play state's counts, with beatoraja's MISS rows at 0 rather than POOR's", () => {
    // The engine has no MISS judgment; the adapter kept a MISS count of 0, so `EARLY_MISS` / `LATE_MISS` (421 / 422)
    // read 0 instead of falling back to POOR's.
    const harness = createHarness();
    harness.judge({ judge: 'POOR', combo: 0, channel: '11', deltaMs: -150 });
    harness.judge({ judge: 'GREAT', combo: 1, channel: '11', deltaMs: 30 });
    expect(harness.state().earlyLate.POOR).toEqual({ early: 1, late: 0 });
    expect(harness.bridge.resolveNumberValue(421)).toBe(0);
    expect(harness.bridge.resolveNumberValue(422)).toBe(0);
  });
});

describe('BeatorajaPlayBridge — slider type=6 (SLIDER_MUSIC_PROGRESS)', () => {
  it('returns 0 before any frame has been applied', () => {
    const { bridge } = createHarness();
    expect(bridge.resolveSliderValue(6)).toBe(0);
  });

  it('returns currentSeconds / totalSeconds clamped to [0, 1]', () => {
    const harness = createHarness();
    harness.frame({ currentSeconds: 0, totalSeconds: 100 });
    expect(harness.bridge.resolveSliderValue(6)).toBe(0);
    harness.frame({ currentSeconds: 25, totalSeconds: 100 });
    expect(harness.bridge.resolveSliderValue(6)).toBe(0.25);
    // Past the end (the last long note's tail): pinned at 1.
    harness.frame({ currentSeconds: 110, totalSeconds: 100 });
    expect(harness.bridge.resolveSliderValue(6)).toBe(1);
  });

  it('returns 0 for a degenerate chart with totalSeconds <= 0', () => {
    const harness = createHarness();
    harness.frame({ currentSeconds: 5, totalSeconds: 0 });
    expect(harness.bridge.resolveSliderValue(6)).toBe(0);
  });
});

describe('BeatorajaPlayBridge — JUDGE_1P_OFFSET_MS (ref 525)', () => {
  it('returns 0 before any 1P judgement has fired', () => {
    const { bridge } = createHarness();
    expect(bridge.resolveNumberValue(525)).toBe(0);
  });

  it('returns the signed deltaMs of the most recent timing sample', () => {
    const harness = createHarness();
    harness.judge({ judge: 'PERFECT', combo: 1, channel: '11', deltaMs: -8 });
    expect(harness.bridge.resolveNumberValue(525)).toBe(-8);
    harness.judge({ judge: 'GREAT', combo: 2, channel: '11', deltaMs: 22 });
    expect(harness.bridge.resolveNumberValue(525)).toBe(22);
    harness.judge({ judge: 'GOOD', combo: 3, channel: '11', deltaMs: -45 });
    expect(harness.bridge.resolveNumberValue(525)).toBe(-45);
  });

  it('truncates fractional ms toward zero so the digit display picks an integer cleanly', () => {
    const harness = createHarness();
    harness.judge({ judge: 'PERFECT', combo: 1, channel: '11', deltaMs: -3.7 });
    expect(harness.bridge.resolveNumberValue(525)).toBe(-3);
    harness.judge({ judge: 'GREAT', combo: 2, channel: '11', deltaMs: 19.4 });
    expect(harness.bridge.resolveNumberValue(525)).toBe(19);
  });
});

describe('BeatorajaPlayBridge — judgegraph type=2 (early/late histogram)', () => {
  it('returns undefined when no judgements have fired yet', () => {
    const harness = createHarness();
    harness.frame({ currentSeconds: 0, totalSeconds: 100, summary: { total: 100 } });
    expect(harness.bridge.resolveJudgeGraphBars(2)).toBeUndefined();
  });

  it('bins recent timings into 21 cells covering ±100 ms (10 ms each)', () => {
    const harness = createHarness();
    harness.frame({ currentSeconds: 0, totalSeconds: 100, summary: { perfect: 1 } });
    harness.judge({ judge: 'PERFECT', combo: 1, channel: '11', deltaMs: 0 });
    harness.judge({ judge: 'GREAT', combo: 2, channel: '11', deltaMs: -35 });
    harness.judge({ judge: 'GREAT', combo: 3, channel: '11', deltaMs: 45 });
    const bars = harness.bridge.resolveJudgeGraphBars(2);
    expect(bars).toBeDefined();
    expect(bars!.length).toBe(21);
    // Bin index = floor((delta + 100) / 10).
    expect(bars![10]).toBe(1);
    expect(bars![6]).toBe(1);
    expect(bars![14]).toBe(1);
    expect(bars![0]).toBe(0);
    expect(bars![20]).toBe(0);
  });

  it('saturates samples beyond ±100 ms into the edge bins', () => {
    const harness = createHarness();
    harness.frame({ currentSeconds: 0, totalSeconds: 100 });
    harness.judge({ judge: 'BAD', combo: 0, channel: '11', deltaMs: -250 });
    harness.judge({ judge: 'BAD', combo: 0, channel: '11', deltaMs: 200 });
    const bars = harness.bridge.resolveJudgeGraphBars(2);
    expect(bars![0]).toBe(1);
    expect(bars![20]).toBe(1);
  });
});

describe('BeatorajaPlayBridge — lift and HIDDEN+', () => {
  it('drives `OFFSET_LIFT` (id 3) y-shift and `BEATORAJA_NUM.LIFT1` from the LIFT', () => {
    const harness = createHarness();
    expect(harness.bridge.resolveOffset(3)).toBeUndefined();
    expect(harness.bridge.resolveNumberValue(314)).toBe(0);
    // LIFT at 50 %: OFFSET_LIFT.y = 0.5 × -580 (the default lane height).
    harness.play(setCover({ lift: 0.5 }));
    const lift = harness.bridge.resolveOffset(3);
    expect(lift?.y).toBeCloseTo(-290, 6);
    expect(lift?.x).toBe(0);
    expect(lift?.a).toBe(0);
    expect(harness.bridge.resolveNumberValue(314)).toBe(500);
  });

  it('clamps LIFT moves to [0, 1] and ignores NaN', () => {
    const harness = createHarness();
    harness.play({ type: 'cover-adjust', part: 'lift', delta: 2 });
    expect(harness.bridge.resolveNumberValue(314)).toBe(1000);
    harness.play({ type: 'cover-adjust', part: 'lift', delta: -2 });
    expect(harness.bridge.resolveNumberValue(314)).toBe(0);
    harness.play({ type: 'cover-adjust', part: 'lift', delta: 0.6 });
    harness.play({ type: 'cover-adjust', part: 'lift', delta: 0.5 });
    expect(harness.bridge.resolveNumberValue(314)).toBe(1000);
    harness.play({ type: 'cover-adjust', part: 'lift', delta: -0.7 });
    harness.play({ type: 'cover-adjust', part: 'lift', delta: Number.NaN });
    expect(harness.bridge.resolveNumberValue(314)).toBe(300);
  });

  it('drives OFFSET_HIDDEN_COVER (id 5) per LaneRenderer formulas', () => {
    // `LaneRenderer.java:282-296`: off → a = -255 (the cover hides); on → y = (1 - lift) × height × -laneHeight.
    const harness = createHarness({ laneHeight: 580 });
    expect(harness.bridge.resolveOffset(5)).toMatchObject({ a: -255, y: 0 });
    harness.play(setCover({ hidden: 0.5, hiddenOn: true }));
    expect(harness.bridge.resolveOffset(5)).toMatchObject({ a: 0, y: -290 });
    // With the LIFT at 0.4 the cover follows: 0.5 × (1 - 0.4) × -580.
    harness.play(setCover({ lift: 0.4 }));
    expect(harness.bridge.resolveOffset(5)?.y).toBeCloseTo(-174, 6);
    // Off hides it again; its height is kept, so on again it comes back where it was.
    harness.play({ type: 'cover-toggle', part: 'hidden' });
    expect(harness.bridge.resolveOffset(5)).toMatchObject({ a: -255 });
    harness.play({ type: 'cover-toggle', part: 'hidden' });
    expect(harness.bridge.resolveOffset(5)?.y).toBeCloseTo(-174, 6);
    // Moves are clamped to the lane; moved down to nothing, HIDDEN+ goes off (the play state's rule).
    harness.play({ type: 'cover-adjust', part: 'hidden', delta: 2 });
    expect(harness.bridge.resolveOffset(5)?.y).toBeCloseTo(-348, 6);
    harness.play({ type: 'cover-adjust', part: 'hidden', delta: -2 });
    expect(harness.bridge.resolveOffset(5)).toMatchObject({ a: -255 });
  });

  it('judge-word-shift offset (id 20001 / 20002) honors width + space (audit B-1)', () => {
    // `SkinJudge.java:108-109`: the judge word moves left by half the combo digits' width.
    const harness = createHarness({ judgeComboMetrics: { 1: { width: 50, space: 4 }, 2: { width: 60, space: 0 } } });
    // No combo yet: one digit. (50 + 4) × 1 / 2 = 27.
    expect(harness.bridge.resolveOffset(20001)).toMatchObject({ x: -27 });
    // Combo 121: three digits. (50 + 4) × 3 / 2 = 81.
    for (let i = 1; i <= 121; i += 1) {
      harness.judge({ judge: 'PERFECT', combo: i, channel: '11' });
    }
    expect(harness.bridge.resolveOffset(20001)).toMatchObject({ x: -81 });
    // 2P with its own metrics: 60 × 3 / 2 = 90, on the play's one max combo.
    expect(harness.bridge.resolveOffset(20002)).toMatchObject({ x: -90 });
  });

  it('lets a host setOffset(3, ...) win while the LIFT is 0', () => {
    const harness = createHarness();
    harness.bridge.setOffset(3, { y: -100 });
    expect(harness.bridge.resolveOffset(3)?.y).toBe(-100);
    harness.play(setCover({ lift: 0.25 }));
    expect(harness.bridge.resolveOffset(3)?.y).toBeCloseTo(-145, 6);
  });

  it('honors a per-skin `laneHeight` option for the OFFSET_LIFT scale', () => {
    const harness = createHarness({ laneHeight: 720 });
    harness.play(setCover({ lift: 0.5 }));
    expect(harness.bridge.resolveOffset(3)?.y).toBeCloseTo(-360, 6);
  });

  it('toggles `LANECOVER1_ON` / `LIFT1_ON` with the covers, and keeps `LANECOVER1_CHANGING` lit briefly after each move', () => {
    const harness = createHarness();
    let ctx = harness.update();
    expect(ctx.activeOps.has(271)).toBe(false);
    expect(ctx.activeOps.has(272)).toBe(false);
    expect(ctx.activeOps.has(270)).toBe(false);

    harness.play(setCover({ sudden: 0.4, suddenOn: true }));
    ctx = harness.update();
    expect(ctx.activeOps.has(271)).toBe(true);
    expect(ctx.activeOps.has(270)).toBe(true);

    harness.advance(600);
    ctx = harness.update();
    expect(ctx.activeOps.has(271)).toBe(true);
    expect(ctx.activeOps.has(270)).toBe(false);

    harness.play(setCover({ lift: 0.3 }));
    ctx = harness.update();
    expect(ctx.activeOps.has(272)).toBe(true);
    expect(ctx.activeOps.has(270)).toBe(true);

    harness.play(setCover({ sudden: 0, suddenOn: false }));
    harness.play(setCover({ lift: 0 }));
    harness.advance(600);
    ctx = harness.update();
    expect(ctx.activeOps.has(271)).toBe(false);
    expect(ctx.activeOps.has(272)).toBe(false);
    expect(ctx.activeOps.has(270)).toBe(false);
  });

  it('does not light `LANECOVER1_CHANGING` for the covers the play starts with', () => {
    const bridge = new BeatorajaPlayBridge({ chartPlayVariant: '7', baseOps: new Set() });
    const state = createPlayState({ view: { covers: [{ ...NO_COVER, sudden: 0.3, suddenOn: true }] } });
    const ctx = bridge.update({ nowMs: 0, state, events: [] });
    expect(ctx.activeOps.has(271)).toBe(true);
    expect(ctx.activeOps.has(270)).toBe(false);
  });

  it('falls back to the default lane height when the option is missing or non-positive', () => {
    const a = createHarness({ laneHeight: 0 });
    a.play(setCover({ lift: 1 }));
    expect(a.bridge.resolveOffset(3)?.y).toBe(-580);
    const b = createHarness({ laneHeight: Number.NaN });
    b.play(setCover({ lift: 1 }));
    expect(b.bridge.resolveOffset(3)?.y).toBe(-580);
  });
});

describe('BeatorajaPlayBridge — rhythm timer', () => {
  it('stamps the rhythm timer (140) on the very first engine frame and on every beat boundary', () => {
    const harness = createHarness();
    harness.advance(100);
    harness.frame({ currentBeat: 0.0 });
    expect(harness.bridge.getTimerStart(140)).toBe(100);
    harness.advance(50);
    harness.frame({ currentBeat: 0.7 });
    expect(harness.bridge.getTimerStart(140)).toBe(100);
    harness.advance(50);
    harness.frame({ currentBeat: 1.05 });
    expect(harness.bridge.getTimerStart(140)).toBe(200);
    harness.advance(100);
    harness.frame({ currentBeat: 1.8 });
    expect(harness.bridge.getTimerStart(140)).toBe(200);
    harness.advance(50);
    harness.frame({ currentBeat: 2.0 });
    expect(harness.bridge.getTimerStart(140)).toBe(350);
  });

  it('re-stamps when the engine seeks backwards (reverse beat motion is also a boundary)', () => {
    const harness = createHarness();
    harness.advance(100);
    harness.frame({ currentBeat: 5.5 });
    expect(harness.bridge.getTimerStart(140)).toBe(100);
    harness.advance(50);
    harness.frame({ currentBeat: 2.3 });
    expect(harness.bridge.getTimerStart(140)).toBe(150);
  });

  it('ignores non-finite beat values (NaN / Infinity from a degenerate frame)', () => {
    const harness = createHarness();
    harness.advance(100);
    harness.frame({ currentBeat: 0 });
    expect(harness.bridge.getTimerStart(140)).toBe(100);
    harness.advance(50);
    harness.frame({ currentBeat: Number.NaN });
    expect(harness.bridge.getTimerStart(140)).toBe(100);
  });
});

describe('BeatorajaPlayBridge — TIMER_ENDOFNOTE (143 / 144)', () => {
  function makeChartWithEvents(
    events: Array<{ channel: string; measure: number; position?: readonly [number, number] }>,
    measureLength = 1,
  ): BeMusicJSON {
    const chart = createEmptyJSON('bms');
    chart.metadata.bpm = 120;
    chart.measures = events.map((e) => ({ index: e.measure, length: measureLength }));
    chart.events = events.map((e) => ({
      measure: e.measure,
      channel: e.channel,
      position: e.position ?? [0, 1],
      value: '01',
    }));
    return chart;
  }

  it('stamps TIMER_ENDOFNOTE_1P (143) when currentBeat passes the 1P last-note beat', () => {
    const chart = makeChartWithEvents([
      { channel: '11', measure: 0, position: [0, 1] },
      { channel: '13', measure: 2, position: [2, 4] },
    ]);
    const harness = createHarness({ chart });
    harness.advance(100);
    harness.frame({ currentBeat: 5 });
    expect(harness.bridge.getTimerStart(143)).toBeUndefined();
    harness.advance(50);
    harness.frame({ currentBeat: 10 });
    expect(harness.bridge.getTimerStart(143)).toBe(150);
    harness.advance(50);
    harness.frame({ currentBeat: 20 });
    expect(harness.bridge.getTimerStart(144)).toBeUndefined();
  });

  it('stamps TIMER_ENDOFNOTE_2P (144) independently when the chart has 2P notes', () => {
    const chart = makeChartWithEvents([
      { channel: '12', measure: 1, position: [0, 1] },
      { channel: '23', measure: 3, position: [0, 1] },
    ]);
    const harness = createHarness({ chartPlayVariant: '14', chart });
    harness.advance(100);
    harness.frame({ currentBeat: 4.0 });
    expect(harness.bridge.getTimerStart(143)).toBe(100);
    expect(harness.bridge.getTimerStart(144)).toBeUndefined();
    harness.advance(200);
    harness.frame({ currentBeat: 12.0 });
    expect(harness.bridge.getTimerStart(143)).toBe(100);
    expect(harness.bridge.getTimerStart(144)).toBe(300);
  });

  it('also recognizes LN channels (5* for 1P, 6* for 2P) as note events', () => {
    const chart = makeChartWithEvents([
      { channel: '52', measure: 4, position: [0, 1] },
      { channel: '63', measure: 5, position: [0, 1] },
    ]);
    const harness = createHarness({ chartPlayVariant: '14', chart });
    harness.advance(100);
    harness.frame({ currentBeat: 20 });
    expect(harness.bridge.getTimerStart(143)).toBe(100);
    expect(harness.bridge.getTimerStart(144)).toBe(100);
  });

  it('skips BGM (channel 01) so a chart with only background audio never fires endofnote', () => {
    const chart = makeChartWithEvents([{ channel: '01', measure: 8, position: [0, 1] }]);
    const harness = createHarness({ chart });
    harness.advance(100);
    harness.frame({ currentBeat: 50 });
    expect(harness.bridge.getTimerStart(143)).toBeUndefined();
    expect(harness.bridge.getTimerStart(144)).toBeUndefined();
  });

  it('does not re-stamp once latched (subsequent frames preserve the original timestamp)', () => {
    const chart = makeChartWithEvents([{ channel: '11', measure: 0, position: [0, 1] }]);
    const harness = createHarness({ chart });
    harness.advance(100);
    harness.frame({ currentBeat: 0 });
    expect(harness.bridge.getTimerStart(143)).toBe(100);
    harness.advance(500);
    harness.frame({ currentBeat: 20 });
    expect(harness.bridge.getTimerStart(143)).toBe(100);
  });
});

describe('BeatorajaPlayBridge — TIMER_FAILED (3)', () => {
  function gaugeFrame(currentBeat: number, current: number | undefined): TestEngineFrame {
    return {
      currentBeat,
      summary: current !== undefined ? { gauge: { current, max: 100, clearThreshold: 80, effectiveTotal: 200 } } : {},
    };
  }

  it('stamps TIMER_FAILED on the gauge crossing into 0 mid-play', () => {
    const harness = createHarness();
    harness.advance(100);
    harness.frame(gaugeFrame(0, 50));
    expect(harness.bridge.getTimerStart(3)).toBeUndefined();
    harness.advance(50);
    harness.frame(gaugeFrame(0.2, 20));
    expect(harness.bridge.getTimerStart(3)).toBeUndefined();
    harness.advance(50);
    harness.frame(gaugeFrame(0.4, 0));
    expect(harness.bridge.getTimerStart(3)).toBe(200);
  });

  it('does not re-stamp on subsequent zero-gauge frames (latch is sticky)', () => {
    const harness = createHarness();
    harness.advance(100);
    harness.frame(gaugeFrame(0, 10));
    harness.advance(50);
    harness.frame(gaugeFrame(0.2, 0));
    expect(harness.bridge.getTimerStart(3)).toBe(150);
    harness.advance(50);
    harness.frame(gaugeFrame(0.4, 0));
    expect(harness.bridge.getTimerStart(3)).toBe(150);
  });

  it('does not stamp when the very first frame already shows gauge=0 (load-state baseline)', () => {
    const harness = createHarness();
    harness.advance(100);
    harness.frame(gaugeFrame(0, 0));
    expect(harness.bridge.getTimerStart(3)).toBeUndefined();
  });
});

describe('BeatorajaPlayBridge — POOR BGA tracking', () => {
  it("shows the POOR image for beatoraja's 500 ms miss layer from the miss, whatever is judged meanwhile", () => {
    const harness = createHarness();
    expect(harness.bridge.isPoorBGAActive(12)).toBe(false);
    harness.command({ kind: 'trigger-poor-bga', seconds: 12 });
    expect(harness.bridge.isPoorBGAActive(12)).toBe(true);
    // The next judgment's `clear-poor-bga` does not end it.
    harness.command({ kind: 'clear-poor-bga' });
    expect(harness.bridge.isPoorBGAActive(12.2)).toBe(true);
    expect(harness.bridge.isPoorBGAActive(12.5)).toBe(false);
    // A later miss restarts the window.
    harness.command({ kind: 'trigger-poor-bga', seconds: 13 });
    expect(harness.bridge.isPoorBGAActive(13.4)).toBe(true);
  });
});

describe('BeatorajaPlayBridge — resolveTextContent', () => {
  it('resolves prop.lua text refs from the parsed chart metadata', () => {
    const { bridge } = createHarness({
      chart: {
        metadata: { title: 'Demo Title', subtitle: '[ANOTHER]', genre: 'Electro', artist: 'me' },
        bmson: { info: { subartists: ['obj:and you'] } },
      } as unknown as BeMusicJSON,
    });
    expect(bridge.resolveTextContent(10)).toBe('Demo Title');
    expect(bridge.resolveTextContent(11)).toBe('[ANOTHER]');
    expect(bridge.resolveTextContent(12)).toBe('Demo Title [ANOTHER]');
    expect(bridge.resolveTextContent(13)).toBe('Electro');
    expect(bridge.resolveTextContent(14)).toBe('me');
    expect(bridge.resolveTextContent(15)).toBe('obj:and you');
    expect(bridge.resolveTextContent(16)).toBe('me obj:and you');
  });

  it('returns undefined for unknown refs (the text node renders empty)', () => {
    const { bridge } = createHarness({ chart: { metadata: { title: 'X' } } as unknown as BeMusicJSON });
    expect(bridge.resolveTextContent(9999)).toBeUndefined();
  });
});

describe("BeatorajaPlayBridge — the play state's graphs", () => {
  it("reads the score graph and the timings off the play state's judgments", () => {
    const harness = createHarness();
    harness.frame({ currentSeconds: 10, totalSeconds: 100, summary: { total: 2, exScore: 2 } });
    harness.judge({ judge: 'PERFECT', combo: 1, channel: '11', deltaMs: -4 });
    expect(harness.state().scoreHistory).toHaveLength(1);
    expect(harness.bridge.resolveTimingSamples()).toHaveLength(1);
    expect(harness.bridge.resolveGraphPolyline(110)).toBeDefined();
  });

  it('reuses normalized score points until a new judge sample lands', () => {
    const harness = createHarness();
    harness.frame({ currentSeconds: 10, totalSeconds: 100, summary: { total: 2, exScore: 2 } });
    harness.judge({ judge: 'PERFECT', combo: 1, channel: '11' });
    const first = harness.bridge.resolveGraphPolyline(110);
    expect(first).toEqual([{ x: 0.1, y: 0.5 }]);
    expect(harness.bridge.resolveGraphPolyline(110)).toBe(first);

    harness.frame({ currentSeconds: 20, totalSeconds: 100, summary: { total: 2, exScore: 4 } });
    harness.judge({ judge: 'PERFECT', combo: 2, channel: '11' });
    const second = harness.bridge.resolveGraphPolyline(110);
    expect(second).not.toBe(first);
    expect(second).toEqual([
      { x: 0.1, y: 0.5 },
      { x: 0.2, y: 1 },
    ]);
    expect(harness.bridge.resolveGraphPolyline(110)).toBe(second);
  });
});

// judgegraph type 1 (TYPE_JUDGE): upstream `SkinNoteDistributionGraph`'s per-second stacks of each note's judge state,
// moved by the frame's judge events.
describe('BeatorajaPlayBridge — judgegraph type=1 (per-second judge state)', () => {
  function makeJudgeChart(
    events: ReadonlyArray<{ channel: string; pos?: [number, number]; measure?: number }>,
  ): BeMusicJSON {
    const chart = createEmptyJSON('bms');
    chart.metadata.bpm = 120;
    chart.metadata.title = 'judge-state';
    chart.metadata.rank = 2;
    chart.events = events.map((e) => ({
      measure: e.measure ?? 0,
      channel: e.channel,
      position: e.pos ?? [0, 1],
      value: '01',
    }));
    return chart;
  }

  it('returns undefined when no chart is loaded (decide / select scenes)', () => {
    const { bridge } = createHarness();
    expect(bridge.resolveJudgeStateBuckets(1)).toBeUndefined();
  });

  it('returns undefined for type values other than 1', () => {
    const { bridge } = createHarness({ chart: makeJudgeChart([{ channel: '11', pos: [0, 1] }]) });
    expect(bridge.resolveJudgeStateBuckets(0)).toBeUndefined();
    expect(bridge.resolveJudgeStateBuckets(2)).toBeUndefined();
  });

  it('initialises all judgeable notes into the unjudged (state 0) slot per chart-second', () => {
    // 120 BPM: notes at beats 0 / 2 / 4 land in seconds 0 / 1 / 2; mines are left out.
    const chart = makeJudgeChart([
      { channel: '11', pos: [0, 1] },
      { channel: '12', pos: [0, 1] },
      { channel: '11', pos: [2, 4] },
      { channel: '11', pos: [0, 1], measure: 1 },
      { channel: 'D1', pos: [0, 1] },
    ]);
    const { bridge } = createHarness({ chart });
    const data = bridge.resolveJudgeStateBuckets(1);
    expect(data).toBeDefined();
    expect(data!.buckets[0]).toEqual([2, 0, 0, 0, 0, 0]);
    expect(data!.buckets[1]).toEqual([1, 0, 0, 0, 0, 0]);
    expect(data!.buckets[2]).toEqual([1, 0, 0, 0, 0, 0]);
    expect(data!.maxCount).toBe(20);
    expect(data!.totalMs).toBeGreaterThan(0);
  });

  it('moves a note from unjudged into the verdict slot on a judgment', () => {
    const harness = createHarness({ chart: makeJudgeChart([{ channel: '11', pos: [0, 1] }]) });
    // The engine frame's clock places the judgment's note: 50 ms - 5 ms = 45 ms, second 0.
    harness.frame({ currentSeconds: 0.05, totalSeconds: 100 });
    harness.judge({ judge: 'PERFECT', combo: 1, channel: '11', deltaMs: 5 });
    expect(harness.bridge.resolveJudgeStateBuckets(1)!.buckets[0]).toEqual([0, 1, 0, 0, 0, 0]);
  });

  it('routes each verdict kind to its upstream-numbered state slot', () => {
    const chart = makeJudgeChart([
      { channel: '11', pos: [0, 1] },
      { channel: '11', pos: [2, 4] },
      { channel: '11', pos: [0, 1], measure: 1 },
      { channel: '11', pos: [2, 4], measure: 1 },
      { channel: '11', pos: [0, 1], measure: 2 },
    ]);
    const harness = createHarness({ chart });
    const fireAt = (seconds: number, judge: string): void => {
      harness.frame({ currentSeconds: seconds, totalSeconds: 100 });
      harness.judge({ judge, combo: 0, channel: '11', deltaMs: 0 });
    };
    fireAt(0.1, 'PERFECT');
    fireAt(1.1, 'GREAT');
    fireAt(2.1, 'GOOD');
    fireAt(3.1, 'BAD');
    fireAt(4.1, 'POOR');
    const data = harness.bridge.resolveJudgeStateBuckets(1);
    expect(data!.buckets[0]).toEqual([0, 1, 0, 0, 0, 0]);
    expect(data!.buckets[1]).toEqual([0, 0, 1, 0, 0, 0]);
    expect(data!.buckets[2]).toEqual([0, 0, 0, 1, 0, 0]);
    expect(data!.buckets[3]).toEqual([0, 0, 0, 0, 1, 0]);
    expect(data!.buckets[4]).toEqual([0, 0, 0, 0, 0, 1]);
  });

  it('moves a note for a judgment without a timing too (AUTO PLAY), at the frame time', () => {
    const harness = createHarness({ chart: makeJudgeChart([{ channel: '11', pos: [0, 1] }]) });
    harness.frame({ currentSeconds: 0.2, totalSeconds: 100 });
    harness.judge({ judge: 'GREAT', combo: 1, channel: '11' });
    expect(harness.bridge.resolveJudgeStateBuckets(1)!.buckets[0]).toEqual([0, 0, 1, 0, 0, 0]);
  });

  it('skips unjudged kinds (READY / unknown) without mutating buckets', () => {
    const harness = createHarness({ chart: makeJudgeChart([{ channel: '11', pos: [0, 1] }]) });
    harness.frame({ currentSeconds: 0.1, totalSeconds: 100 });
    harness.judge({ judge: 'READY', combo: 0, channel: '11' });
    expect(harness.bridge.resolveJudgeStateBuckets(1)!.buckets[0]).toEqual([1, 0, 0, 0, 0, 0]);
  });
});

// HISPEED (10 / 310 / 311), as upstream `IntegerPropertyFactory`: the integer part, × 100, and the two decimals.
describe('BeatorajaPlayBridge — resolveNumberValue HISPEED', () => {
  it("returns the integer part for HISPEED (310) and × 100 for HISPEED_LR2 (10), from the play state's hi-speed", () => {
    const harness = createHarness();
    harness.play({ type: 'hi-speed-set', value: 3.42 });
    expect(harness.bridge.resolveNumberValue(310)).toBe(3);
    expect(harness.bridge.resolveNumberValue(10)).toBe(342);
    expect(harness.bridge.resolveNumberValue(311)).toBe(42);
  });

  it('handles fractional hispeed values like 1.555 with `(int)` truncation semantics', () => {
    const harness = createHarness();
    harness.play({ type: 'hi-speed-set', value: 1.555 });
    expect(harness.bridge.resolveNumberValue(310)).toBe(1);
    expect(harness.bridge.resolveNumberValue(10)).toBe(155);
    expect(harness.bridge.resolveNumberValue(311)).toBe(55);
  });
});

// DURATION (312), upstream `LaneRenderer`: `240000 / bpm / hispeed × (1 - lanecover)`.
describe('BeatorajaPlayBridge — resolveNumberValue DURATION', () => {
  it('matches upstream `LaneRenderer.getCurrentDuration()` for the no-cover case', () => {
    // BPM 140, hi-speed 3.42: 240000 / 140 / 3.42 = 501.05 → 501.
    const harness = createHarness({ chart: { metadata: { bpm: 140 } } as unknown as BeMusicJSON });
    harness.play({ type: 'hi-speed-set', value: 3.42 });
    expect(harness.bridge.resolveNumberValue(312)).toBe(501);
  });

  it('shrinks proportionally to lanecover for the LANECOVER_ON variant', () => {
    const harness = createHarness({ chart: { metadata: { bpm: 130 } } as unknown as BeMusicJSON });
    harness.play({ type: 'hi-speed-set', value: 1.0 });
    harness.play(setCover({ sudden: 0.5, suddenOn: true }));
    expect(harness.bridge.resolveNumberValue(312)).toBe(923);
    expect(harness.bridge.resolveNumberValue(1314)).toBe(1846);
  });

  it('does NOT factor lift into the DURATION readout (mirrors upstream)', () => {
    const harness = createHarness({ chart: { metadata: { bpm: 130 } } as unknown as BeMusicJSON });
    harness.play({ type: 'hi-speed-set', value: 1.0 });
    const before = harness.bridge.resolveNumberValue(312);
    harness.play(setCover({ lift: 0.5 }));
    expect(harness.bridge.resolveNumberValue(312)).toBe(before);
  });

  it('returns 60% of the white duration for DURATION_GREEN (313)', () => {
    const harness = createHarness({ chart: { metadata: { bpm: 130 } } as unknown as BeMusicJSON });
    harness.play({ type: 'hi-speed-set', value: 1.0 });
    const white = harness.bridge.resolveNumberValue(312);
    const green = harness.bridge.resolveNumberValue(313);
    expect(white).toBe(1846);
    expect(green).toBe(Math.round((1846 * 3) / 5));
  });

  it("returns 0 when the chart's BPM is 0 / missing (defensive guard)", () => {
    const { bridge } = createHarness({ chart: { metadata: { bpm: 0 } } as unknown as BeMusicJSON });
    expect(bridge.resolveNumberValue(312)).toBe(0);
  });
});

// BPM (90 / 91 / 92 / 160), upstream `IntegerPropertyFactory` `maxbpm` / `minbpm` / `mainbpm` / `nowbpm`.
describe('BeatorajaPlayBridge — resolveNumberValue BPM', () => {
  function makeBPMChart(opts: {
    bpm: number;
    bpmTable?: Record<string, number>;
    events?: ReadonlyArray<{ measure?: number; channel: string; value?: string; pos?: [number, number] }>;
  }): BeMusicJSON {
    const chart = createEmptyJSON();
    chart.metadata.bpm = opts.bpm;
    chart.metadata.title = 'bpm-test';
    chart.events = (opts.events ?? []).map((e) => ({
      measure: e.measure ?? 0,
      channel: e.channel,
      position: (e.pos ?? [0, 1]) as unknown as BeMusicJSON['events'][0]['position'],
      value: e.value ?? '01',
    }));
    chart.resources.bpm = opts.bpmTable ?? {};
    return chart;
  }

  it("returns the chart's BPM for all variants on a constant-tempo chart", () => {
    const { bridge } = createHarness({ chart: makeBPMChart({ bpm: 140 }) });
    expect(bridge.resolveNumberValue(90)).toBe(140);
    expect(bridge.resolveNumberValue(91)).toBe(140);
    expect(bridge.resolveNumberValue(92)).toBe(140);
    expect(bridge.resolveNumberValue(160)).toBe(140);
  });

  it('reports the chart-wide max / min on a SOFLAN chart with channel-03 BPM events', () => {
    const { bridge } = createHarness({
      chart: makeBPMChart({
        bpm: 140,
        events: [
          { channel: '03', value: 'F0', pos: [0, 1] },
          { channel: '03', value: 'A0', pos: [2, 4] },
          { channel: '11', pos: [0, 1] },
        ],
      }),
    });
    expect(bridge.resolveNumberValue(90)).toBe(240);
    expect(bridge.resolveNumberValue(91)).toBe(140);
  });

  it('tracks live BPM at the playhead via NOWBPM (160) — SOFLAN-aware', () => {
    // 140 BPM, then 240 at beat 4 (1714 ms in).
    const harness = createHarness({
      chart: makeBPMChart({
        bpm: 140,
        events: [
          { channel: '11', pos: [0, 1] },
          { channel: '03', value: 'F0', pos: [0, 1], measure: 1 },
          { channel: '11', pos: [0, 1], measure: 1 },
        ],
      }),
    });
    expect(harness.bridge.resolveNumberValue(160)).toBe(140);
    harness.frame({ currentSeconds: 0.5, totalSeconds: 100 });
    expect(harness.bridge.resolveNumberValue(160)).toBe(140);
    harness.frame({ currentSeconds: 2.0, totalSeconds: 100 });
    expect(harness.bridge.resolveNumberValue(160)).toBe(240);
  });

  it('holds NOWBPM (160) at the reversal value past an LR2 negative-BPM reversal', () => {
    const harness = createHarness({
      chart: makeBPMChart({
        bpm: 140,
        events: [
          { channel: '11', pos: [0, 1] },
          { channel: '03', value: 'F0', pos: [0, 1], measure: 1 },
          { channel: '11', pos: [0, 1], measure: 1 },
        ],
      }),
    });
    harness.frame({ currentSeconds: 2.0, reversalSeconds: 1.0, totalSeconds: 100 });
    expect(harness.bridge.resolveNumberValue(160)).toBe(140);
  });

  it('uses the most-frequent (note-weighted) BPM for MAINBPM (92)', () => {
    const { bridge } = createHarness({
      chart: makeBPMChart({
        bpm: 140,
        events: [
          { channel: '11', pos: [0, 1] },
          { channel: '11', pos: [2, 4] },
          { channel: '11', pos: [0, 1], measure: 1 },
          { channel: '03', value: '46', pos: [2, 4], measure: 1 },
          { channel: '11', pos: [3, 4], measure: 1 },
        ],
      }),
    });
    expect(bridge.resolveNumberValue(92)).toBe(140);
  });
});

describe('BeatorajaPlayBridge — timing visualizer windows', () => {
  /** beatoraja's 7 KEY NORMAL windows (ms): BAD reaches 220 early and 280 late, unlike LR2's ±200. */
  const window = (earlyMs: number, lateMs: number) => ({ earlyMs, lateMs });
  const BEATORAJA_7K_NORMAL = {
    perfect: window(20, 20),
    great: window(60, 60),
    good: window(150, 150),
    bad: window(220, 280),
  };
  const SCRATCH = { perfect: window(30, 30), great: window(70, 70), good: window(160, 160), bad: window(230, 290) };

  it("shows the play's own key-lane windows, which the frames carry, and none before the engine reports them", () => {
    const { bridge } = createHarness({ chart: createEmptyJSON('bms') });
    expect(bridge.resolveTimingJudgeWindows()).toBeUndefined();
    const judgeWindows = { note: BEATORAJA_7K_NORMAL, scratch: SCRATCH, longNoteEnd: BEATORAJA_7K_NORMAL };
    bridge.update({ nowMs: 0, state: createPlayState(), events: [], judgeWindows });
    expect(bridge.resolveTimingJudgeWindows()).toEqual(BEATORAJA_7K_NORMAL);
    // A play started again has none until its engine reports them.
    bridge.update({ nowMs: 16, state: createPlayState(), events: [] });
    expect(bridge.resolveTimingJudgeWindows()).toBeUndefined();
  });
});

describe('BeatorajaPlayBridge — chart TOTAL (368)', () => {
  it('reports the effective TOTAL the gauge runs on once a frame arrives', () => {
    // beatoraja's ref 368 reads the TOTAL after `BMSPlayerRule.validate`: a bmson `total: 100` shows the resolved one.
    const harness = createHarness({ chart: { metadata: { total: 100 } } as unknown as BeMusicJSON });
    harness.frame({
      summary: { gauge: { current: 20, max: 100, clearThreshold: 80, effectiveTotal: 260.5 } },
    });
    expect(harness.bridge.resolveNumberValue(368)).toBe(260);
  });

  it('falls back to the chart header before the first frame', () => {
    const { bridge } = createHarness({ chart: { metadata: { total: 320 } } as unknown as BeMusicJSON });
    expect(bridge.resolveNumberValue(368)).toBe(320);
  });
});
