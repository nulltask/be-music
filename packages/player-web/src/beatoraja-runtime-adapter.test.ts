import { describe, expect, it, vi } from 'vitest';
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
  TIMER_READY,
  TIMER_SCENE_START,
  TIMER_STARTINPUT,
} from '@be-music/beatoraja-skin';
import { BeatorajaRuntimeAdapter } from './beatoraja-runtime-adapter.ts';

function makeClock(): { now: () => number; advance: (ms: number) => void } {
  let t = 0;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

describe('BeatorajaRuntimeAdapter — construction', () => {
  it('seeds activeOps with base option ops + scene-start timer + autoplay-off + now-loading', () => {
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set([920, 901]),
      getNowMs: clock.now,
    });
    expect(adapter.hasOp(920)).toBe(true);
    expect(adapter.hasOp(901)).toBe(true);
    expect(adapter.hasOp(BEATORAJA_OP.AUTOPLAY_OFF)).toBe(true);
    expect(adapter.hasOp(BEATORAJA_OP.AUTOPLAY_ON)).toBe(false);
    expect(adapter.hasOp(BEATORAJA_OP.NOW_LOADING)).toBe(true);
    expect(adapter.getTimerStart(TIMER_SCENE_START)).toBe(0);
  });

  it('does not seed a speculative play-mode op (1..5 are reserved for per-keys mode)', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
    });
    for (const op of [1, 2, 3, 4, 5]) {
      expect(adapter.hasOp(op)).toBe(false);
    }
  });

  it('surfaces AUTOPLAY_ON and clears AUTOPLAY_OFF in autoplay mode', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
      autoPlay: true,
    });
    expect(adapter.hasOp(BEATORAJA_OP.AUTOPLAY_ON)).toBe(true);
    expect(adapter.hasOp(BEATORAJA_OP.AUTOPLAY_OFF)).toBe(false);
  });
});

describe('BeatorajaRuntimeAdapter — built-in timers', () => {
  it('stamps `startinput` / `ready` / `play` / `fadeout` and flips loading gate on play', () => {
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(120);
    adapter.markStartInput();
    expect(adapter.getTimerStart(TIMER_STARTINPUT)).toBe(120);

    clock.advance(800);
    adapter.markReady();
    expect(adapter.getTimerStart(TIMER_READY)).toBe(920);

    clock.advance(500);
    adapter.markPlay();
    expect(adapter.getTimerStart(TIMER_PLAY)).toBe(1420);
    expect(adapter.hasOp(BEATORAJA_OP.NOW_LOADING)).toBe(false);
    expect(adapter.hasOp(BEATORAJA_OP.LOADED)).toBe(true);

    clock.advance(60_000);
    adapter.markFadeout();
    expect(adapter.getTimerStart(TIMER_FADEOUT)).toBe(61_420);
  });
});

describe('BeatorajaRuntimeAdapter — applyCommand', () => {
  it('starts the per-lane key-on timer on press-lane (1P channel 13 → key 3 → timer 103)', () => {
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(500);
    adapter.applyCommand({ kind: 'press-lane', channel: '13' });
    expect(adapter.getTimerStart(keyOnTimerId(1, 3)!)).toBe(500);
  });

  it('starts the key-off timer on release-lane (2P channel 22 → key 2 → timer 132)', () => {
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '14',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(800);
    adapter.applyCommand({ kind: 'release-lane', channel: '22' });
    expect(adapter.getTimerStart(keyOffTimerId(2, 2)!)).toBe(800);
  });

  it('flash-lane stamps KEY_ON (not bomb) — autoplay path that bypasses press-lane', () => {
    // `flash-lane` is the engine's "key was pressed / autoplay consumed a note" signal. It
    // fires regardless of judge severity, so it can't drive the bomb explosion (which is a
    // positive-feedback cue specifically for clean hits). Bomb is fired separately in
    // `applyJudgeCombo` for PERFECT / GREAT — see those tests.
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(1200);
    adapter.applyCommand({ kind: 'flash-lane', channel: '15' });
    expect(adapter.getTimerStart(keyOnTimerId(1, 5)!)).toBe(1200);
    expect(adapter.getTimerStart(bombTimerId(1, 5)!)).toBeUndefined();
  });

  it('press-lane deactivates the previously-active KEY_OFF timer (lane laser visibility gate)', () => {
    // Beatoraja's `KeyInputProccessor` does `setTimerOn(KEY_ON); setTimerOff(KEY_OFF)`
    // symmetrically — `setTimerOff` clears the timer's "active" state so any element gated
    // on it stops drawing. Without this deactivate, a destination keyed on KEY_OFF would
    // stay visible after the player pressed the key, since its timer's start time is still
    // set from the prior release.
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(100);
    adapter.applyCommand({ kind: 'release-lane', channel: '13' });
    expect(adapter.getTimerStart(keyOffTimerId(1, 3)!)).toBe(100);
    clock.advance(50);
    adapter.applyCommand({ kind: 'press-lane', channel: '13' });
    expect(adapter.getTimerStart(keyOffTimerId(1, 3)!)).toBeUndefined();
    expect(adapter.getTimerStart(keyOnTimerId(1, 3)!)).toBe(150);
  });

  it('release-lane deactivates the previously-active KEY_ON timer (laser disappears on release)', () => {
    // The user-visible bug: pressing a key once leaves the lane laser stuck on because
    // KEY_ON timer's start time is set forever — release-lane MUST deactivate it (delete the
    // entry) so the destination renderer's `getTimerStart` returns undefined and the
    // laser sprite stops drawing.
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(100);
    adapter.applyCommand({ kind: 'press-lane', channel: '13' });
    expect(adapter.getTimerStart(keyOnTimerId(1, 3)!)).toBe(100);
    clock.advance(200);
    adapter.applyCommand({ kind: 'release-lane', channel: '13' });
    expect(adapter.getTimerStart(keyOnTimerId(1, 3)!)).toBeUndefined();
    expect(adapter.getTimerStart(keyOffTimerId(1, 3)!)).toBe(300);
  });

  it('starts the LN-hold timer on hold-lane-until-beat', () => {
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(2000);
    adapter.applyCommand({ kind: 'hold-lane-until-beat', channel: '19', beat: 64 });
    expect(adapter.getTimerStart(lnHoldTimerId(1, 7)!)).toBe(2000);
  });

  it('re-stamps the LN-hold timer on the tail verdict (ModernChic lnbomb fix)', () => {
    // ModernChic's `Play/lua/sp/bomb.lua:82-84` declares its LN bomb sprite with
    // `timer = MAIN.TIMER.HOLD_1P_KEY*` (= 71..79) and `cycle = 160` ms. Without
    // re-stamping the timer at the LN tail, the only stamp would be from the HEAD's
    // `hold-lane-until-beat` — which for an LN longer than 160 ms means the lnbomb
    // sprite advances past its visible frames long before the tail lands, leaving
    // the player with no visual feedback at LN end.
    //
    // Upstream `JudgeManager` stamps the HOLD timer (`hold_*p_keyN`) automatically on
    // every LN tail verdict; this regression test pins that synthesis at the adapter
    // boundary.  User report: the lnbomb sprite disappeared at the LN tail (ModernChic
    // only — the symptom is skin-specific because most skins don't author a per-tail
    // bomb animation).
    //
    // Sequence:
    //   1. hold-lane-until-beat at t=100 → LN-hold timer = 100, latch set
    //   2. (160 ms elapses; the timer would naturally have aged past ModernChic's cycle)
    //   3. release-lane at t=300 → LN-hold timer cleared (engine fires it BEFORE the
    //      tail verdict so adapter sees release-lane → applyJudgeCombo in that order)
    //   4. applyJudgeCombo at t=300 with the LN's channel → LN-hold timer re-stamped
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(100);
    adapter.applyCommand({ kind: 'hold-lane-until-beat', channel: '19', beat: 64 });
    expect(adapter.getTimerStart(lnHoldTimerId(1, 7)!)).toBe(100);
    clock.advance(200); // total t=300
    adapter.applyCommand({ kind: 'release-lane', channel: '19' });
    expect(adapter.getTimerStart(lnHoldTimerId(1, 7)!)).toBeUndefined();
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 1, channel: '19', updatedAtMs: 300 });
    // LN-hold timer re-stamped at the tail moment so ModernChic's lnbomb cycle resyncs.
    expect(adapter.getTimerStart(lnHoldTimerId(1, 7)!)).toBe(300);
    // Combo timer (446 = 1P) also re-stamped — PERFECT advances combo, so ModernChic's
    // combo digit animation resyncs at the tail in tandem. Addresses the user report
    // that the combo-digit animation failed to re-trigger on the LN tail under
    // ModernChic.
    expect(adapter.getTimerStart(446)).toBe(300);
  });

  it('auto-deactivates the re-stamped LN-hold timer after the bomb-hold window', async () => {
    // The re-stamped HOLD timer must auto-deactivate so destinations with `loop = 0` (the
    // beatoraja `Destination.loop` default, which ModernChic's lnbomb declaration inherits
    // by omitting the field) stop animating after their cycle. Without auto-release, a
    // re-stamped HOLD timer stays "on" forever and the lnbomb sprite loops indefinitely.
    // User report: under AUTO PLAY the lnbomb sprite never disappeared after the LN
    // verdict landed — it stayed on screen indefinitely.
    //
    // We use vitest's fake timers to verify the timeout fires; the exact window (320 ms)
    // is documented in the adapter under `LN_TAIL_BOMB_HOLD_MS`.
    vi.useFakeTimers();
    try {
      const clock = makeClock();
      const adapter = new BeatorajaRuntimeAdapter({
        chartPlayVariant: '7',
        baseOps: new Set(),
        getNowMs: clock.now,
      });
      clock.advance(100);
      adapter.applyCommand({ kind: 'hold-lane-until-beat', channel: '19', beat: 64 });
      clock.advance(200);
      adapter.applyCommand({ kind: 'release-lane', channel: '19' });
      adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 1, channel: '19', updatedAtMs: 300 });
      // Re-stamped immediately on the verdict.
      expect(adapter.getTimerStart(lnHoldTimerId(1, 7)!)).toBe(300);
      // Just before the auto-release fires: still active.
      vi.advanceTimersByTime(319);
      expect(adapter.getTimerStart(lnHoldTimerId(1, 7)!)).toBe(300);
      // After the 320 ms window: deactivated. Mirrors upstream's per-frame
      // `switchTimer(holdTimerId, processing != null)` flipping the timer OFF once the
      // tail's `processing` clears.
      vi.advanceTimersByTime(1);
      expect(adapter.getTimerStart(lnHoldTimerId(1, 7)!)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does NOT re-stamp the LN-hold timer for tap-note verdicts (no LN context)', () => {
    // Guards against the latch firing on tap notes that share a channel with a
    // previously-resolved LN. After the LN tail's applyJudgeCombo consumes the latch,
    // a subsequent tap-note PERFECT on the same channel must NOT re-stamp the hold
    // timer (which has already been deactivated). Otherwise tap notes on LN-hosting
    // lanes would spuriously fire the lnbomb sprite.
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(100);
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 1, channel: '19', updatedAtMs: 100 });
    // No `hold-lane-until-beat` preceded this verdict → no latch → LN-hold timer stays unset.
    expect(adapter.getTimerStart(lnHoldTimerId(1, 7)!)).toBeUndefined();
  });

  it('isLaneLnHeld flips on hold-lane-until-beat and clears on release-lane', () => {
    // Drives modern-mode `lnBodyHeld` ↔ `lnBodyUnheld` sprite switching at draw time. The
    // hold flag must:
    //   - start false (no LN in flight)
    //   - flip true on hold-lane-until-beat (player is actively pressing)
    //   - flip false on release-lane (player let go) WITHOUT clearing the lnHold timer
    //     (skins anchor taper-fade chrome on the timer)
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    expect(adapter.isLaneLnHeld('19')).toBe(false);
    clock.advance(1000);
    adapter.applyCommand({ kind: 'hold-lane-until-beat', channel: '19', beat: 64 });
    expect(adapter.isLaneLnHeld('19')).toBe(true);
    expect(adapter.getTimerStart(lnHoldTimerId(1, 7)!)).toBe(1000);
    // Other lanes are unaffected.
    expect(adapter.isLaneLnHeld('11')).toBe(false);
    clock.advance(500);
    adapter.applyCommand({ kind: 'release-lane', channel: '19' });
    expect(adapter.isLaneLnHeld('19')).toBe(false);
    // Timer DEACTIVATES on release — mirrors upstream `JudgeManager.java:546-547`'s
    // `switchTimer(holdTimerId, processing != null || ...)`: when LN sustain ends,
    // `processing` becomes null → timer flips OFF. ModernChic's `bomb.lua` keys its
    // "LN bomb" body-pulse animation on this timer; without the OFF the bomb stays
    // glued visible after the first LN ends in AUTO mode.
    expect(adapter.getTimerStart(lnHoldTimerId(1, 7)!)).toBeUndefined();
  });

  it('routes scratch (16 / 26) onto lane 0 → timer 100 (1P) / 110 (2P)', () => {
    // prop.lua `keyon_1p_scratch = 100`, `keyon_2p_scratch = 110`. Earlier the adapter mapped scratch
    // onto lane 8 → timer 108 (`keyon_1p_key8`), so scratch presses never lit the right beam.
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(50);
    adapter.applyCommand({ kind: 'press-lane', channel: '16' });
    expect(adapter.getTimerStart(100)).toBe(50);
    clock.advance(50);
    adapter.applyCommand({ kind: 'press-lane', channel: '26' });
    expect(adapter.getTimerStart(110)).toBe(100);
  });

  it('5K variant rejects channels 18/19 — no phantom KEY_ON timers stamped', () => {
    // A malformed BMS that authored a 5K chart with stray notes on channels 18/19 (= the
    // 6/7-key columns that don't exist in 5K) must NOT trip the adapter into stamping
    // KEY_ON / KEY_OFF / bomb timers for slots 6/7. Pre-clamp `resolveSideKeySlot('18', '5')`
    // returned 6 and the adapter happily marked timer 106 (`keyOnTimerId(1, 6)`); after the
    // clamp the slot is `-1` → `resolveLane` returns undefined → every per-lane stamper
    // short-circuits, so the timer table stays clean.
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '5',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(50);
    adapter.applyCommand({ kind: 'press-lane', channel: '18' });
    adapter.applyCommand({ kind: 'press-lane', channel: '19' });
    // No KEY_ON timer for slots 6/7 (timers 106/107) on the 1P side. Sanity: a valid 5K
    // channel still stamps as expected so we know the adapter didn't accidentally short-
    // circuit ALL stamping.
    expect(adapter.getTimerStart(keyOnTimerId(1, 6)!)).toBeUndefined();
    expect(adapter.getTimerStart(keyOnTimerId(1, 7)!)).toBeUndefined();
    adapter.applyCommand({ kind: 'press-lane', channel: '15' });
    expect(adapter.getTimerStart(keyOnTimerId(1, 5)!)).toBe(50);
  });

  it('10K variant rejects channels 18/19/28/29 on both sides', () => {
    // Same clamp on the DP side. 10K is 5+5 keys, so the 6/7-key columns don't exist for
    // either 1P or 2P. Phantom timer suppression is symmetric.
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '10',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(75);
    for (const channel of ['18', '19', '28', '29']) {
      adapter.applyCommand({ kind: 'press-lane', channel });
    }
    expect(adapter.getTimerStart(keyOnTimerId(1, 6)!)).toBeUndefined();
    expect(adapter.getTimerStart(keyOnTimerId(1, 7)!)).toBeUndefined();
    expect(adapter.getTimerStart(keyOnTimerId(2, 6)!)).toBeUndefined();
    expect(adapter.getTimerStart(keyOnTimerId(2, 7)!)).toBeUndefined();
  });

  it('9K (POPN) variant routes channels 16..19 to lanes 6..9 (timers 106..109)', () => {
    // POPN_9K maps channel 1N to lane N (1..9). The IIDX-default heuristic would clamp 16 to
    // scratch (lane 0) and reject 17 (free zone), which is what user reports of "9 KEY lane 6+
    // accepts no input, autoplay never paints lane 6+ keybeam / bomb / judge popup" boil down
    // to: the chart was being driven against an IIDX `chartPlayVariant`, so channels 16/17
    // never raised side-relative lane timers, and the engine's autoplay loop dropped the
    // matching scorable notes via `activeFreeZoneChannels`. With variant `'9'` the adapter
    // stamps `keyOnTimerId(1, 6..9) = 106..109` for channels 16..19 directly.
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '9',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(100);
    for (const channel of ['16', '17', '18', '19']) {
      adapter.applyCommand({ kind: 'press-lane', channel });
    }
    // Lane 6..9 (channels 16..19) → timer 106..109. Each must be stamped at clock=100 ms.
    expect(adapter.getTimerStart(keyOnTimerId(1, 6)!)).toBe(100);
    expect(adapter.getTimerStart(keyOnTimerId(1, 7)!)).toBe(100);
    expect(adapter.getTimerStart(keyOnTimerId(1, 8)!)).toBe(100);
    expect(adapter.getTimerStart(keyOnTimerId(1, 9)!)).toBe(100);
    // Sanity: scratch timer (100) stays unstamped — POPN_9K has no scratch lane.
    expect(adapter.getTimerStart(keyOnTimerId(1, 0)!)).toBeUndefined();
  });

  it('9K (PMS-STD) collapses channels 22..25 onto the 1P-side timer bank (lanes 6..9)', () => {
    // PMS-STD authors POPN keys 6..9 on the BMS `2X` channel block (`22..25`), sharing the
    // channel space with genuine IIDX 2P-side play. Without a `chartPlayVariant === '9'`
    // collapse the literal `startsWith('2')` side-detection would route the lane timers to
    // the 2P-side bank (`bomb_2p_keyN`, `keyon_2p_keyN`, etc.) and the skin's 1P-side chrome
    // — which is the only side an LR2 / beatoraja 9-key skin authors — would never light up.
    // User report (visual): coffee-bean theme on a PMS-STD chord chart painted bombs only on
    // lanes 0..4 (the genuine `11..15` 1P keys) and silenced lanes 5..8 (= PMS-STD `22..25`).
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '9',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(100);
    for (const channel of ['22', '23', '24', '25']) {
      adapter.applyCommand({ kind: 'press-lane', channel });
    }
    // Channels 22..25 must land on 1P-side timers 106..109, NOT the 2P-side 116..119.
    expect(adapter.getTimerStart(keyOnTimerId(1, 6)!)).toBe(100);
    expect(adapter.getTimerStart(keyOnTimerId(1, 7)!)).toBe(100);
    expect(adapter.getTimerStart(keyOnTimerId(1, 8)!)).toBe(100);
    expect(adapter.getTimerStart(keyOnTimerId(1, 9)!)).toBe(100);
    expect(adapter.getTimerStart(keyOnTimerId(2, 6)!)).toBeUndefined();
    expect(adapter.getTimerStart(keyOnTimerId(2, 7)!)).toBeUndefined();
    expect(adapter.getTimerStart(keyOnTimerId(2, 8)!)).toBeUndefined();
    expect(adapter.getTimerStart(keyOnTimerId(2, 9)!)).toBeUndefined();
  });

  it('9K applyJudgeCombo dispatches per-judge-plate (PMS-STD lane groups → plate 1/2/3)', () => {
    // Upstream `JudgeManager.notifyJudge:700` dispatches each judgement to a plate via
    // `judgeindex = state.lane / (lanelength / judgenow.length)`. For POPN-9 (9 lanes, 3 plates):
    //   - lanes 0..2 (= ch 11/12/13) → plate 0 → `TIMER_JUDGE_1P = 46`, `TIMER_COMBO_1P = 446`
    //   - lanes 3..5 (= ch 14/15/22) → plate 1 → `TIMER_JUDGE_2P = 47`, `TIMER_COMBO_2P = 447`
    //   - lanes 6..8 (= ch 23/24/25) → plate 2 → `TIMER_JUDGE_3P = 247`, `TIMER_COMBO_3P = 448`
    //
    // Lane-bomb timers (`bomb_1p_keyN`) and the FC timer still collapse onto laneSide 1 under
    // POPN-9 (single-side play), so bomb timers `56..59` are 1P-side regardless of which judge
    // plate the verdict fires on. User-reported symptom prior to per-plate dispatch: the GREAT /
    // PERFECT plate fired on plate 1 only (because every channel resolved to side 1), so the
    // center / right judge plates stayed dark.
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '9',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(100);
    // Channel 11 → lane 1 (slot) → plate 1 (`floor((1-1)/3) = 0` ⇒ side 1).
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 1, channel: '11', updatedAtMs: 100 });
    // Channel 14 → lane 4 → plate 2 (`floor((4-1)/3) = 1` ⇒ side 2).
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 4, channel: '14', updatedAtMs: 100 });
    // Channel 22 → lane 6 → plate 2 (`floor((6-1)/3) = 1` ⇒ side 2).
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 6, channel: '22', updatedAtMs: 100 });
    // Channel 23 → lane 7 → plate 3 (`floor((7-1)/3) = 2` ⇒ side 3).
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 7, channel: '23', updatedAtMs: 100 });
    // Channel 25 → lane 9 → plate 3 (`floor((9-1)/3) = 2` ⇒ side 3).
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 9, channel: '25', updatedAtMs: 100 });
    // All three judge timers must be stamped (one per plate).
    expect(adapter.getTimerStart(judgeTimerId(1))).toBe(100);
    expect(adapter.getTimerStart(judgeTimerId(2))).toBe(100);
    expect(adapter.getTimerStart(judgeTimerId(3))).toBe(100);
    // Same for the per-plate combo timers (`446` / `447` / `448`).
    expect(adapter.getTimerStart(comboTimerId(1))).toBe(100);
    expect(adapter.getTimerStart(comboTimerId(2))).toBe(100);
    expect(adapter.getTimerStart(comboTimerId(3))).toBe(100);
    // Per-plate verdict ops all active simultaneously — distinct from SP / DP where the last
    // publish's plate would be the only PERFECT-active side.
    expect(adapter.hasOp(BEATORAJA_OP.P1_JUDGE_PERFECT)).toBe(true);
    expect(adapter.hasOp(BEATORAJA_OP.P2_JUDGE_PERFECT)).toBe(true);
    expect(adapter.hasOp(BEATORAJA_OP.P3_JUDGE_PERFECT)).toBe(true);
    // Bomb timers — lane-side resolution stays 1P for POPN-9, so channels 22 / 25 (= lanes 6 / 9)
    // stamp `bomb_1p_key6 = 56` and `bomb_1p_key9 = 59`. 2P-side equivalents stay unstamped.
    expect(adapter.getTimerStart(56)).toBe(100);
    expect(adapter.getTimerStart(59)).toBe(100);
    expect(adapter.getTimerStart(66)).toBeUndefined();
    expect(adapter.getTimerStart(69)).toBeUndefined();
  });
});

describe('BeatorajaRuntimeAdapter — applyJudgeCombo', () => {
  it('stamps the side-relative judge timer + adds the prop.lua judge op (PERFECT 1P → 241)', () => {
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(1500);
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 12, channel: '13', updatedAtMs: 0 });
    expect(adapter.getTimerStart(judgeTimerId(1))).toBe(1500);
    expect(adapter.hasOp(BEATORAJA_OP.P1_JUDGE_PERFECT)).toBe(true);
  });

  it('clears the previous side-1 judge op when a new one comes in', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
    });
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 1, channel: '11', updatedAtMs: 0 });
    expect(adapter.hasOp(BEATORAJA_OP.P1_JUDGE_PERFECT)).toBe(true);
    adapter.applyJudgeCombo({ judge: 'GREAT', combo: 2, channel: '11', updatedAtMs: 0 });
    expect(adapter.hasOp(BEATORAJA_OP.P1_JUDGE_PERFECT)).toBe(false);
    expect(adapter.hasOp(BEATORAJA_OP.P1_JUDGE_GREAT)).toBe(true);
  });

  it('keeps the side-2 judge op independent of the side-1 op', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '14',
      baseOps: new Set(),
      getNowMs: () => 0,
    });
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 1, channel: '13', updatedAtMs: 0 });
    adapter.applyJudgeCombo({ judge: 'BAD', combo: 1, channel: '23', updatedAtMs: 0 });
    expect(adapter.hasOp(BEATORAJA_OP.P1_JUDGE_PERFECT)).toBe(true);
    expect(adapter.hasOp(BEATORAJA_OP.P2_JUDGE_BAD)).toBe(true);
  });

  it('restarts the side-relative combo timer (446 / 447) on every PERFECT / GREAT / GOOD verdict', () => {
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '14',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    // PERFECT on side 1 stamps combo_1p (446) at t=100.
    clock.advance(100);
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 1, channel: '13', updatedAtMs: 0 });
    expect(adapter.getTimerStart(comboTimerId(1))).toBe(100);
    // Side 2's combo timer is independent — still unset.
    expect(adapter.getTimerStart(comboTimerId(2))).toBeUndefined();
    // GREAT on side 2 stamps combo_2p (447) at t=250. Side 1's stays at 100.
    clock.advance(150);
    adapter.applyJudgeCombo({ judge: 'GREAT', combo: 2, channel: '23', updatedAtMs: 0 });
    expect(adapter.getTimerStart(comboTimerId(2))).toBe(250);
    expect(adapter.getTimerStart(comboTimerId(1))).toBe(100);
    // Subsequent side-1 GOOD re-stamps combo_1p — every combo-keeping verdict replays the
    // combo-pop animation from t=0.
    clock.advance(100);
    adapter.applyJudgeCombo({ judge: 'GOOD', combo: 3, channel: '13', updatedAtMs: 0 });
    expect(adapter.getTimerStart(comboTimerId(1))).toBe(350);
  });

  it('fires the lane bomb timer on PERFECT and GREAT (clean hit verdicts)', () => {
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(100);
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 1, channel: '14', updatedAtMs: 0 });
    expect(adapter.getTimerStart(bombTimerId(1, 4)!)).toBe(100);
    clock.advance(100);
    adapter.applyJudgeCombo({ judge: 'GREAT', combo: 2, channel: '15', updatedAtMs: 0 });
    expect(adapter.getTimerStart(bombTimerId(1, 5)!)).toBe(200);
  });

  it('does NOT fire the bomb timer on GOOD / BAD / POOR / MISS (skin only flashes bomb on clean hits)', () => {
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(100);
    adapter.applyJudgeCombo({ judge: 'GOOD', combo: 1, channel: '11', updatedAtMs: 0 });
    expect(adapter.getTimerStart(bombTimerId(1, 1)!)).toBeUndefined();
    clock.advance(100);
    adapter.applyJudgeCombo({ judge: 'BAD', combo: 0, channel: '12', updatedAtMs: 0 });
    expect(adapter.getTimerStart(bombTimerId(1, 2)!)).toBeUndefined();
    clock.advance(100);
    adapter.applyJudgeCombo({ judge: 'POOR', combo: 0, channel: '13', updatedAtMs: 0 });
    expect(adapter.getTimerStart(bombTimerId(1, 3)!)).toBeUndefined();
    clock.advance(100);
    adapter.applyJudgeCombo({ judge: 'MISS', combo: 0, channel: '14', updatedAtMs: 0 });
    expect(adapter.getTimerStart(bombTimerId(1, 4)!)).toBeUndefined();
  });

  it('does NOT restart the combo timer on combo-break verdicts (BAD / POOR / MISS)', () => {
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(50);
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 1, channel: '11', updatedAtMs: 0 });
    expect(adapter.getTimerStart(comboTimerId(1))).toBe(50);
    // BAD breaks combo — timer stays at 50, doesn't re-stamp.
    clock.advance(100);
    adapter.applyJudgeCombo({ judge: 'BAD', combo: 0, channel: '11', updatedAtMs: 0 });
    expect(adapter.getTimerStart(comboTimerId(1))).toBe(50);
    // POOR also doesn't restart.
    clock.advance(50);
    adapter.applyJudgeCombo({ judge: 'POOR', combo: 0, channel: '11', updatedAtMs: 0 });
    expect(adapter.getTimerStart(comboTimerId(1))).toBe(50);
    // The next successful hit re-stamps it.
    clock.advance(100);
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 1, channel: '11', updatedAtMs: 0 });
    expect(adapter.getTimerStart(comboTimerId(1))).toBe(300);
  });

  it('latches the per-side judge combo into the synthetic JUDGE_COMBO_1P / 2P refs (upstream `getNowCombo`)', () => {
    // Mirrors `JudgeManager.notifyJudge` (`JudgeManager.java:710`) where
    // `judgecombo[judgeindex] = getCourseCombo()` records the LIVE combo at the time of the
    // judge. SkinJudge.draw later passes that value via `nowCount.prepare(time, state, value,
    // ox, oy)` to override whatever ref the JSON authored. Our adapter latches the same value
    // into `judgeState[side].lastJudgeCombo`, exposed via `resolveNumberValue` for the
    // synthetic refs that `expandBeatorajaJudgeDestinations` swaps into every `judgen-*`
    // declaration.
    const adapter = new BeatorajaRuntimeAdapter({ chartPlayVariant: '7', baseOps: new Set(), getNowMs: () => 0 });
    // Publish a few judges and assert the synthetic ref tracks the latest combo per side.
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 1, channel: '11', updatedAtMs: 0 });
    expect(adapter.resolveNumberValue(SYNTHETIC_NUM_JUDGE_COMBO_1P)).toBe(1);
    adapter.applyJudgeCombo({ judge: 'GREAT', combo: 2, channel: '11', updatedAtMs: 0 });
    expect(adapter.resolveNumberValue(SYNTHETIC_NUM_JUDGE_COMBO_1P)).toBe(2);
    // Combo break (BAD) — the engine emits combo=0; our latch follows so the popup reads "0",
    // matching upstream where the running max combo branch (ref:75) is intentionally NOT
    // consulted by SkinJudge.
    adapter.applyJudgeCombo({ judge: 'BAD', combo: 0, channel: '11', updatedAtMs: 0 });
    expect(adapter.resolveNumberValue(SYNTHETIC_NUM_JUDGE_COMBO_1P)).toBe(0);
    // Side-2 stays independent — a 1P judge doesn't touch 2P's latch.
    expect(adapter.resolveNumberValue(SYNTHETIC_NUM_JUDGE_COMBO_2P)).toBe(0);
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 5, channel: '21', updatedAtMs: 0 });
    expect(adapter.resolveNumberValue(SYNTHETIC_NUM_JUDGE_COMBO_2P)).toBe(5);
    expect(adapter.resolveNumberValue(SYNTHETIC_NUM_JUDGE_COMBO_1P)).toBe(0);
  });

  it('latches per-plate combo for POPN-9 (`_1P` / `_2P` / `_3P` synthetic refs)', () => {
    // POPN-9 dispatches each chord publish to one of three plates by lane group; each plate's
    // `judgen-*` combo digit reads `SYNTHETIC_NUM_JUDGE_COMBO_{1,2,3}P`, latched here from the
    // most recent verdict on that plate. User-reported symptom prior to the per-plate
    // synthetic ref: plate 3's combo digit fell through to `MAIN.NUM.MAXCOMBO` (= 75) and
    // displayed the running max combo instead of the live latched combo.
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '9',
      baseOps: new Set(),
      getNowMs: () => 0,
    });
    // Chord with one judgement per plate — channels 11 / 14 / 25 land on plates 1 / 2 / 3.
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 7, channel: '11', updatedAtMs: 0 });
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 8, channel: '14', updatedAtMs: 0 });
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 9, channel: '25', updatedAtMs: 0 });
    expect(adapter.resolveNumberValue(SYNTHETIC_NUM_JUDGE_COMBO_1P)).toBe(7);
    expect(adapter.resolveNumberValue(SYNTHETIC_NUM_JUDGE_COMBO_2P)).toBe(8);
    expect(adapter.resolveNumberValue(SYNTHETIC_NUM_JUDGE_COMBO_3P)).toBe(9);
  });

  it('per-lane keybeam ref encodes the latest verdict as judgeIndex+1 within the window', () => {
    // Drives the keybeam imageset (`ref = 500 + lane`) AND the bomb imageset, both of which
    // pick a frame based on this value. 7K's 2-frame imageset clamps anything ≥1 to frame 1
    // ("you scored a hit"); 9K's 4-frame imageset distinguishes PG (1) and GR (2) with frame
    // 3 reserved for GD/BD/PR/MS via clamp.
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    // No verdict yet → ref returns 0 (= "no recent judge").
    expect(adapter.resolveRefValue(503)).toBe(0); // 1P key 3
    // PERFECT on key 3 → judgeIndex 0 → ref returns 1.
    clock.advance(100);
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 1, channel: '13', updatedAtMs: 0 });
    expect(adapter.resolveRefValue(503)).toBe(1);
    // GREAT on the same lane → judgeIndex 1 → ref returns 2 (was previously 1 in the
    // PERFECT-only resolver — the 9K skin's 4-frame imageset specifically expects this).
    clock.advance(50);
    adapter.applyJudgeCombo({ judge: 'GREAT', combo: 2, channel: '13', updatedAtMs: 0 });
    expect(adapter.resolveRefValue(503)).toBe(2);
    // GOOD → 3, BAD → 4, POOR → 5, MISS → 6.
    clock.advance(20);
    adapter.applyJudgeCombo({ judge: 'GOOD', combo: 3, channel: '13', updatedAtMs: 0 });
    expect(adapter.resolveRefValue(503)).toBe(3);
    clock.advance(20);
    adapter.applyJudgeCombo({ judge: 'BAD', combo: 0, channel: '13', updatedAtMs: 0 });
    expect(adapter.resolveRefValue(503)).toBe(4);
    clock.advance(20);
    adapter.applyJudgeCombo({ judge: 'POOR', combo: 0, channel: '13', updatedAtMs: 0 });
    expect(adapter.resolveRefValue(503)).toBe(5);
    clock.advance(20);
    adapter.applyJudgeCombo({ judge: 'MISS', combo: 0, channel: '13', updatedAtMs: 0 });
    expect(adapter.resolveRefValue(503)).toBe(6);
  });

  it('per-lane keybeam ref decays to 0 once the verdict ages past KEYBEAM_PERFECT_WINDOW_MS', () => {
    // Window is 250 ms (file-local constant). Past the boundary the resolver returns 0
    // even though the kind is still latched, so the keybeam reverts to its neutral frame
    // even if the player is still holding the key.
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(100);
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 1, channel: '14', updatedAtMs: 0 });
    expect(adapter.resolveRefValue(504)).toBe(1); // within window
    clock.advance(250); // exactly at the boundary — still inside (=)
    expect(adapter.resolveRefValue(504)).toBe(1);
    clock.advance(1); // 1 ms past the window → decays to 0
    expect(adapter.resolveRefValue(504)).toBe(0);
  });

  it('per-lane keybeam ref is independent across lanes (one PERFECT does not light the others)', () => {
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(100);
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 1, channel: '13', updatedAtMs: 0 });
    expect(adapter.resolveRefValue(503)).toBe(1); // key 3 = PG
    expect(adapter.resolveRefValue(504)).toBe(0); // key 4 = no judge
    expect(adapter.resolveRefValue(505)).toBe(0); // key 5 = no judge
  });
});

describe('BeatorajaRuntimeAdapter — getRenderContext', () => {
  it('returns the same activeOps Set instance across calls (no per-frame allocation)', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set([920]),
      getNowMs: () => 0,
    });
    const a = adapter.getRenderContext();
    const b = adapter.getRenderContext();
    expect(a.activeOps).toBe(b.activeOps);
  });

  it('threads getNowMs into the context', () => {
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(750);
    expect(adapter.getRenderContext().nowMs).toBe(750);
  });

  it('resolves timer starts through the same map applyCommand wrote to', () => {
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(400);
    adapter.applyCommand({ kind: 'press-lane', channel: '14' });
    const ctx = adapter.getRenderContext();
    expect(ctx.getTimerStart(keyOnTimerId(1, 4)!)).toBe(400);
    expect(ctx.getTimerStart(99999)).toBeUndefined();
  });

  it('exposes resolveOffset — undefined for unset offsets, value for set ones', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
    });
    const ctx = adapter.getRenderContext();
    // OFFSET_LIFT (id 3) defaults to undefined — no shift, hidden-cover stays tucked.
    expect(ctx.resolveOffset?.(3)).toBeUndefined();
    // After the host sets the lift slider, the resolver returns the merged value.
    adapter.setOffset(3, { y: -120 });
    const updated = adapter.getRenderContext().resolveOffset?.(3);
    expect(updated?.y).toBe(-120);
    // Default fields stay zero — including alpha (additive delta, 0 = no change).
    expect(updated?.x).toBe(0);
    expect(updated?.a).toBe(0);
  });

  it('merges partial setOffset values with the previously set ones', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
    });
    adapter.setOffset(4, { x: 10, y: 20 });
    adapter.setOffset(4, { y: 50 }); // x stays at 10 from the previous push
    const lanecover = adapter.resolveOffset(4);
    expect(lanecover?.x).toBe(10);
    expect(lanecover?.y).toBe(50);
  });
});

describe('BeatorajaRuntimeAdapter — lanecover slider', () => {
  it('drives `slider[].type = 4` and `BEATORAJA_NUM.LANECOVER1` from the same `lanecoverRatio` field', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
    });
    // Default state: slider at home, percent readout at 0.
    expect(adapter.resolveSliderValue(4)).toBe(0);
    expect(adapter.resolveNumberValue(14)).toBe(0);
    // Player drags the slider to 60% — both surfaces update.
    adapter.setLanecover(0.6);
    expect(adapter.resolveSliderValue(4)).toBeCloseTo(0.6, 6);
    expect(adapter.resolveNumberValue(14)).toBe(60);
    // 2P share the same ratio in single-side play (`type = 5` == `type = 4`).
    expect(adapter.resolveSliderValue(5)).toBeCloseTo(0.6, 6);
  });

  it('clamps setLanecover and adjustLanecover to [0, 1]', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
    });
    adapter.setLanecover(2); // overshoot
    expect(adapter.getLanecover()).toBe(1);
    adapter.setLanecover(-0.5); // undershoot
    expect(adapter.getLanecover()).toBe(0);
    adapter.adjustLanecover(0.3);
    adapter.adjustLanecover(0.5); // 0.3 + 0.5 = 0.8, in range
    expect(adapter.getLanecover()).toBeCloseTo(0.8, 6);
    adapter.adjustLanecover(0.5); // 0.8 + 0.5 = 1.3 → clamped to 1
    expect(adapter.getLanecover()).toBe(1);
  });

  it('ignores non-finite inputs', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
    });
    adapter.setLanecover(0.4);
    adapter.setLanecover(Number.NaN);
    expect(adapter.getLanecover()).toBeCloseTo(0.4, 6);
    adapter.adjustLanecover(Number.POSITIVE_INFINITY);
    expect(adapter.getLanecover()).toBeCloseTo(0.4, 6);
  });
});

describe('BeatorajaRuntimeAdapter — timing samples', () => {
  it('appends signed deltaMs samples on each judge publish (oldest-first)', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
    });
    expect(adapter.resolveTimingSamples()).toEqual([]);

    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 1, channel: '11', deltaMs: -8, updatedAtMs: 100 });
    adapter.applyJudgeCombo({ judge: 'GREAT', combo: 2, channel: '11', deltaMs: 22, updatedAtMs: 200 });
    adapter.applyJudgeCombo({ judge: 'BAD', combo: 0, channel: '12', deltaMs: -110, updatedAtMs: 300 });

    expect(adapter.resolveTimingSamples()).toEqual([
      { deltaMs: -8, kind: 'PERFECT' },
      { deltaMs: 22, kind: 'GREAT' },
      { deltaMs: -110, kind: 'BAD' },
    ]);
  });

  it('skips publishes without a deltaMs (READY / AUTO PLAY / mine BAD)', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
    });
    adapter.applyJudgeCombo({ judge: 'READY', combo: 0, updatedAtMs: 0 });
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 1, channel: '11', updatedAtMs: 50 });
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 2, channel: '12', deltaMs: -3, updatedAtMs: 60 });
    expect(adapter.resolveTimingSamples()).toEqual([{ deltaMs: -3, kind: 'PERFECT' }]);
  });

  it('caps the buffer to RECENT_TIMINGS_CAPACITY (50) — drops oldest at overflow', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
    });
    for (let i = 0; i < 60; i += 1) {
      adapter.applyJudgeCombo({ judge: 'PERFECT', combo: i + 1, channel: '11', deltaMs: i, updatedAtMs: i });
    }
    const samples = adapter.resolveTimingSamples();
    expect(samples).toHaveLength(50);
    // Oldest 10 dropped — the surviving ring starts at deltaMs=10.
    expect(samples[0]?.deltaMs).toBe(10);
    expect(samples[samples.length - 1]?.deltaMs).toBe(59);
  });
});

describe('BeatorajaRuntimeAdapter — FAST / SLOW gate ops (1242 / 1243)', () => {
  it('publishes P1_JUDGE_EARLY on a negative deltaMs and clears it on the next late hit', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
    });
    expect(adapter.getRenderContext().activeOps.has(1242)).toBe(false);
    expect(adapter.getRenderContext().activeOps.has(1243)).toBe(false);
    // Early hit → EARLY (1242) on, LATE off.
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 1, channel: '11', deltaMs: -8, updatedAtMs: 100 });
    expect(adapter.getRenderContext().activeOps.has(1242)).toBe(true);
    expect(adapter.getRenderContext().activeOps.has(1243)).toBe(false);
    // Late hit → swap: LATE on, EARLY cleared.
    adapter.applyJudgeCombo({ judge: 'GREAT', combo: 2, channel: '11', deltaMs: 22, updatedAtMs: 200 });
    expect(adapter.getRenderContext().activeOps.has(1242)).toBe(false);
    expect(adapter.getRenderContext().activeOps.has(1243)).toBe(true);
  });

  it('clears both EARLY and LATE on a perfect-on-time hit (deltaMs === 0)', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
    });
    adapter.applyJudgeCombo({ judge: 'GREAT', combo: 1, channel: '11', deltaMs: 22, updatedAtMs: 100 });
    expect(adapter.getRenderContext().activeOps.has(1243)).toBe(true);
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 2, channel: '11', deltaMs: 0, updatedAtMs: 200 });
    expect(adapter.getRenderContext().activeOps.has(1242)).toBe(false);
    expect(adapter.getRenderContext().activeOps.has(1243)).toBe(false);
  });

  it('preserves the prior gate when a publish has no deltaMs (READY / AUTO PLAY / mine BAD)', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
    });
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 1, channel: '11', deltaMs: -8, updatedAtMs: 100 });
    expect(adapter.getRenderContext().activeOps.has(1242)).toBe(true);
    // Mine BAD has no deltaMs — beatoraja keeps the previous EARLY badge displayed until the
    // next timed judgement.
    adapter.applyJudgeCombo({ judge: 'BAD', combo: 0, channel: '11', updatedAtMs: 200 });
    expect(adapter.getRenderContext().activeOps.has(1242)).toBe(true);
  });
});

describe('BeatorajaRuntimeAdapter — slider type=6 (SLIDER_MUSIC_PROGRESS)', () => {
  it('returns 0 before any frame has been applied', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
    });
    expect(adapter.resolveSliderValue(6)).toBe(0);
  });

  it('returns currentSeconds / totalSeconds clamped to [0, 1]', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
    });
    adapter.applyFrame({
      currentSeconds: 0,
      totalSeconds: 100,
      summary: { fast: 0, slow: 0 } as unknown as import('@be-music/player/core/engine').PlayerSummary,
      notes: [],
    } as unknown as import('@be-music/player/core/ui-signal-bus').PlayerUiFramePayload);
    expect(adapter.resolveSliderValue(6)).toBe(0);
    adapter.applyFrame({
      currentSeconds: 25,
      totalSeconds: 100,
      summary: { fast: 0, slow: 0 } as unknown as import('@be-music/player/core/engine').PlayerSummary,
      notes: [],
    } as unknown as import('@be-music/player/core/ui-signal-bus').PlayerUiFramePayload);
    expect(adapter.resolveSliderValue(6)).toBe(0.25);
    // Late-finish overrun: engine sometimes reports `currentSeconds > totalSeconds` while the
    // last LN tail completes — saturate at 1 so the bar stays pinned at the end.
    adapter.applyFrame({
      currentSeconds: 110,
      totalSeconds: 100,
      summary: { fast: 0, slow: 0 } as unknown as import('@be-music/player/core/engine').PlayerSummary,
      notes: [],
    } as unknown as import('@be-music/player/core/ui-signal-bus').PlayerUiFramePayload);
    expect(adapter.resolveSliderValue(6)).toBe(1);
  });

  it('returns 0 for a degenerate chart with totalSeconds <= 0', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
    });
    adapter.applyFrame({
      currentSeconds: 5,
      totalSeconds: 0,
      summary: { fast: 0, slow: 0 } as unknown as import('@be-music/player/core/engine').PlayerSummary,
      notes: [],
    } as unknown as import('@be-music/player/core/ui-signal-bus').PlayerUiFramePayload);
    expect(adapter.resolveSliderValue(6)).toBe(0);
  });
});

describe('BeatorajaRuntimeAdapter — JUDGE_1P_OFFSET_MS (ref 525)', () => {
  it('returns 0 before any 1P judgement has fired', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
    });
    // ref 525 — JUDGE_1P_OFFSET_MS (signed offset of most recent hit, not a fade timer).
    expect(adapter.resolveNumberValue(525)).toBe(0);
  });

  it('returns the signed deltaMs of the most recent timing sample', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
    });
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 1, channel: '11', deltaMs: -8, updatedAtMs: 100 });
    expect(adapter.resolveNumberValue(525)).toBe(-8);
    adapter.applyJudgeCombo({ judge: 'GREAT', combo: 2, channel: '11', deltaMs: 22, updatedAtMs: 200 });
    expect(adapter.resolveNumberValue(525)).toBe(22);
    // Latest sample wins — earlier offsets stay in the buffer but don't drive the readout.
    adapter.applyJudgeCombo({ judge: 'GOOD', combo: 3, channel: '11', deltaMs: -45, updatedAtMs: 300 });
    expect(adapter.resolveNumberValue(525)).toBe(-45);
  });

  it('truncates fractional ms toward zero so the digit display picks an integer cleanly', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
    });
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 1, channel: '11', deltaMs: -3.7, updatedAtMs: 100 });
    expect(adapter.resolveNumberValue(525)).toBe(-3);
    adapter.applyJudgeCombo({ judge: 'GREAT', combo: 2, channel: '11', deltaMs: 19.4, updatedAtMs: 200 });
    expect(adapter.resolveNumberValue(525)).toBe(19);
  });
});

describe('BeatorajaRuntimeAdapter — judgegraph type=2 (early/late histogram)', () => {
  it('returns undefined when no judgements have fired yet', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
    });
    adapter.applyFrame({
      currentSeconds: 0,
      totalSeconds: 100,
      summary: {
        score: 0, exScore: 0, perfect: 0, great: 0, good: 0, bad: 0, poor: 0, fast: 0, slow: 0,
        combo: 0, maxCombo: 0, total: 100, gauge: undefined,
      } as unknown as import('@be-music/player/core/engine').PlayerSummary,
      notes: [],
    } as unknown as import('@be-music/player/core/ui-signal-bus').PlayerUiFramePayload);
    expect(adapter.resolveJudgeGraphBars(2)).toBeUndefined();
  });

  it('bins recent timings into 21 cells covering ±100 ms (10 ms each)', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
    });
    adapter.applyFrame({
      currentSeconds: 0,
      totalSeconds: 100,
      summary: { fast: 0, slow: 0, perfect: 1 } as unknown as import('@be-music/player/core/engine').PlayerSummary,
      notes: [],
    } as unknown as import('@be-music/player/core/ui-signal-bus').PlayerUiFramePayload);
    // Three samples at distinct ms offsets — one in the perfect bin, one early, one late.
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 1, channel: '11', deltaMs: 0, updatedAtMs: 100 });
    adapter.applyJudgeCombo({ judge: 'GREAT', combo: 2, channel: '11', deltaMs: -35, updatedAtMs: 200 });
    adapter.applyJudgeCombo({ judge: 'GREAT', combo: 3, channel: '11', deltaMs: 45, updatedAtMs: 300 });
    const bars = adapter.resolveJudgeGraphBars(2);
    expect(bars).toBeDefined();
    expect(bars!.length).toBe(21);
    // Bin index = floor((delta + 100) / 10):
    //   delta=0   → idx 10 (centre)
    //   delta=-35 → idx 6  ((-35+100)/10 = 6.5 → 6)
    //   delta=45  → idx 14 ((45+100)/10 = 14.5 → 14)
    expect(bars![10]).toBe(1);
    expect(bars![6]).toBe(1);
    expect(bars![14]).toBe(1);
    // Empty bins stay 0.
    expect(bars![0]).toBe(0);
    expect(bars![20]).toBe(0);
  });

  it('saturates samples beyond ±100 ms into the edge bins', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
    });
    adapter.applyFrame({
      currentSeconds: 0,
      totalSeconds: 100,
      summary: { fast: 0, slow: 0, perfect: 0 } as unknown as import('@be-music/player/core/engine').PlayerSummary,
      notes: [],
    } as unknown as import('@be-music/player/core/ui-signal-bus').PlayerUiFramePayload);
    adapter.applyJudgeCombo({ judge: 'BAD', combo: 0, channel: '11', deltaMs: -250, updatedAtMs: 100 });
    adapter.applyJudgeCombo({ judge: 'BAD', combo: 0, channel: '11', deltaMs: 200, updatedAtMs: 200 });
    const bars = adapter.resolveJudgeGraphBars(2);
    expect(bars![0]).toBe(1);
    expect(bars![20]).toBe(1);
  });
});

describe('BeatorajaRuntimeAdapter — lift slider', () => {
  it('drives `OFFSET_LIFT` (id 3) y-shift and `BEATORAJA_NUM.LIFT1` from `liftRatio`', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
    });
    // Default state: lift at home → OFFSET_LIFT undefined (= no shift), readout 0.
    expect(adapter.resolveOffset(3)).toBeUndefined();
    expect(adapter.resolveNumberValue(314)).toBe(0);
    // Player drags to 50% — OFFSET_LIFT.y = -290 (= 0.5 * -580 lane-height hint), readout = 50.
    adapter.setLift(0.5);
    const lift = adapter.resolveOffset(3);
    expect(lift?.y).toBeCloseTo(-290, 6);
    expect(lift?.x).toBe(0);
    // Lift offset emits no alpha delta — additive default 0 leaves the keyframe alpha alone.
    expect(lift?.a).toBe(0);
    expect(adapter.resolveNumberValue(314)).toBe(50);
  });

  it('clamps setLift / adjustLift to [0, 1] and ignores NaN', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
    });
    adapter.setLift(2);
    expect(adapter.getLift()).toBe(1);
    adapter.setLift(-1);
    expect(adapter.getLift()).toBe(0);
    adapter.adjustLift(0.6);
    adapter.adjustLift(0.5); // 0.6 + 0.5 = 1.1 → clamped to 1
    expect(adapter.getLift()).toBe(1);
    adapter.setLift(0.3);
    adapter.adjustLift(Number.NaN);
    expect(adapter.getLift()).toBeCloseTo(0.3, 6);
  });

  it('drives OFFSET_HIDDEN_COVER (id 5) per LaneRenderer formulas', () => {
    // Mirrors `LaneRenderer.java:282-296`:
    //   disabled → a = -255 (additive, drops keyframe alpha to 0 → invisible)
    //   enabled  → a = 0, y = (1 - lift) * ratio * laneHeight (Y-UP, negative shifts up)
    //
    // Default state: hidden DISABLED, ratio 0 → `a = -255` so the cover sprite stays
    // invisible until the player toggles hidden on.
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
      laneHeight: 580,
    });
    expect(adapter.resolveOffset(5)).toMatchObject({ a: -255, y: 0 });
    expect(adapter.isHiddenCoverEnabled()).toBe(false);

    // Enable with ratio = 0.5 and no lift active → y = 0.5 × 1 × -580 = -290.
    adapter.setHiddenCover(0.5, true);
    expect(adapter.resolveOffset(5)).toMatchObject({ a: 0, y: -290 });
    expect(adapter.getHiddenCover()).toBe(0.5);

    // With lift active at 0.4, the cover follows: y = 0.5 × (1 - 0.4) × -580 = -174.
    adapter.setLift(0.4);
    expect(adapter.resolveOffset(5)?.y).toBeCloseTo(-174, 6);

    // Disabling re-applies the -255 alpha. Ratio is preserved (re-enable resumes the y).
    adapter.setHiddenCover(0.5, false);
    expect(adapter.resolveOffset(5)).toMatchObject({ a: -255 });
    adapter.setHiddenCover(0.5, true);
    expect(adapter.resolveOffset(5)?.y).toBeCloseTo(-174, 6);

    // Clamping: ratio out of [0, 1] is clamped.
    adapter.setHiddenCover(2, true);
    expect(adapter.getHiddenCover()).toBe(1);
    adapter.setHiddenCover(-1, true);
    expect(adapter.getHiddenCover()).toBe(0);
  });

  it('judge-word-shift offset (id 20001 / 20002) honors width + space (audit B-1)', () => {
    // Mirrors upstream `SkinJudge.java:108-109`:
    //
    //   nowJudge.region.x += -nowCount.getLength() / 2;
    //
    // where `nowCount.getLength() = (region.width + space) * (currentImages.length - shiftbase)`.
    // Tests the synthetic offset id 20001/20002 the expansion path appends to judgef-* destinations
    // when `judge[].shift = true`. Default metrics `(width=40, space=0)` apply when host omits
    // `judgeComboMetrics`.
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
      // Custom metrics: 50 px digits with a 4 px inter-digit gap. shift = (50+4) * digitCount / 2.
      judgeComboMetrics: { 1: { width: 50, space: 4 }, 2: { width: 60, space: 0 } },
    });
    // No combo yet → digitCount falls back to 1. shift = (50+4) * 1 / 2 = 27.
    expect(adapter.resolveOffset(20001)).toMatchObject({ x: -27 });
    // Drive the combo up to 121 via the standard judge path → digitCount = 3,
    // shift = (50+4) * 3 / 2 = 81.
    for (let i = 1; i <= 121; i += 1) {
      adapter.applyJudgeCombo({ judge: 'PERFECT', combo: i, channel: '11', updatedAtMs: 0 });
    }
    expect(adapter.resolveOffset(20001)).toMatchObject({ x: -81 });
    // 2P uses its own metrics: width=60, space=0. shift = 60 * 3 / 2 = 90.
    // Same maxCombo applies (the adapter tracks a single max-combo regardless of side
    // since we don't surface separate per-side judge events yet).
    expect(adapter.resolveOffset(20002)).toMatchObject({ x: -90 });
  });

  it('lets manual setOffset(3, ...) win when liftRatio is 0', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
    });
    adapter.setOffset(3, { y: -100 });
    expect(adapter.resolveOffset(3)?.y).toBe(-100);
    // Once a live ratio is in play, the derived value takes priority.
    adapter.setLift(0.25);
    expect(adapter.resolveOffset(3)?.y).toBeCloseTo(-145, 6);
  });

  it('honors a per-skin `laneHeight` option for the OFFSET_LIFT scale', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
      laneHeight: 720,
    });
    adapter.setLift(0.5);
    // 0.5 * -720 = -360 (vs the default -580 → -290).
    expect(adapter.resolveOffset(3)?.y).toBeCloseTo(-360, 6);
  });

  it('toggles `LANECOVER1_ON` / `LIFT1_ON` based on the ratio, and keeps `LANECOVER1_CHANGING` lit briefly after each adjustment', () => {
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
    });

    // Idle state — no cover ops.
    let ctx = adapter.getRenderContext();
    expect(ctx.activeOps.has(271)).toBe(false); // LANECOVER1_ON
    expect(ctx.activeOps.has(272)).toBe(false); // LIFT1_ON
    expect(ctx.activeOps.has(270)).toBe(false); // LANECOVER1_CHANGING

    // Player nudges lanecover — *_ON and *_CHANGING both light up.
    adapter.setLanecover(0.4);
    ctx = adapter.getRenderContext();
    expect(ctx.activeOps.has(271)).toBe(true);
    expect(ctx.activeOps.has(270)).toBe(true);

    // Wait past the 500ms window — *_CHANGING decays, *_ON persists.
    clock.advance(600);
    ctx = adapter.getRenderContext();
    expect(ctx.activeOps.has(271)).toBe(true);
    expect(ctx.activeOps.has(270)).toBe(false);

    // Adjust lift — separate ratio, so LIFT1_ON joins (lanecover stays on too).
    adapter.setLift(0.3);
    ctx = adapter.getRenderContext();
    expect(ctx.activeOps.has(272)).toBe(true);
    expect(ctx.activeOps.has(270)).toBe(true); // changing window relit

    // Reset both — *_ON drops.
    adapter.setLanecover(0);
    adapter.setLift(0);
    clock.advance(600);
    ctx = adapter.getRenderContext();
    expect(ctx.activeOps.has(271)).toBe(false);
    expect(ctx.activeOps.has(272)).toBe(false);
    expect(ctx.activeOps.has(270)).toBe(false);
  });

  it('falls back to the default lane height when the option is missing or non-positive', () => {
    const a = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
      laneHeight: 0, // ignored
    });
    a.setLift(1);
    expect(a.resolveOffset(3)?.y).toBe(-580);
    const b = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
      laneHeight: Number.NaN, // ignored
    });
    b.setLift(1);
    expect(b.resolveOffset(3)?.y).toBe(-580);
  });
});

describe('BeatorajaRuntimeAdapter — applyFrame rhythm timer', () => {
  function makeFrame(currentBeat: number): import('@be-music/player/core/ui-signal-bus').PlayerUiFramePayload {
    return {
      currentBeat,
      currentSeconds: 0,
      totalSeconds: 100,
      summary: {
        score: 0,
        total: 0,
        perfect: 0,
        great: 0,
        good: 0,
        bad: 0,
        poor: 0,
        fast: 0,
        slow: 0,
        exScore: 0,
      } as unknown as import('@be-music/player/core/ui-signal-bus').PlayerUiFramePayload['summary'],
      notes: [],
    };
  }

  it('stamps the rhythm timer (140) on the very first applyFrame and on every beat boundary', () => {
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    // First frame at t=100 — baseline. Stamps the timer because we haven't seen a beat yet.
    clock.advance(100);
    adapter.applyFrame(makeFrame(0.0));
    expect(adapter.getTimerStart(140)).toBe(100);
    // Same beat (still on beat 0, fractional 0.7) — no re-stamp.
    clock.advance(50);
    adapter.applyFrame(makeFrame(0.7));
    expect(adapter.getTimerStart(140)).toBe(100);
    // Crossing into beat 1 at t=200 — timer re-stamps.
    clock.advance(50);
    adapter.applyFrame(makeFrame(1.05));
    expect(adapter.getTimerStart(140)).toBe(200);
    // Mid-beat-1 — no change.
    clock.advance(100);
    adapter.applyFrame(makeFrame(1.8));
    expect(adapter.getTimerStart(140)).toBe(200);
    // Crossing into beat 2.
    clock.advance(50);
    adapter.applyFrame(makeFrame(2.0));
    expect(adapter.getTimerStart(140)).toBe(350);
  });

  it('re-stamps when the engine seeks backwards (reverse beat motion is also a boundary)', () => {
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(100);
    adapter.applyFrame(makeFrame(5.5));
    expect(adapter.getTimerStart(140)).toBe(100);
    clock.advance(50);
    adapter.applyFrame(makeFrame(2.3));
    expect(adapter.getTimerStart(140)).toBe(150);
  });

  it('ignores non-finite beat values (NaN / Infinity from a degenerate frame)', () => {
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(100);
    adapter.applyFrame(makeFrame(0));
    expect(adapter.getTimerStart(140)).toBe(100);
    clock.advance(50);
    adapter.applyFrame(makeFrame(Number.NaN));
    expect(adapter.getTimerStart(140)).toBe(100);
  });
});

describe('BeatorajaRuntimeAdapter — TIMER_ENDOFNOTE (143 / 144)', () => {
  function makeChartWithEvents(
    events: Array<{ channel: string; measure: number; position?: readonly [number, number] }>,
    measureLength = 1,
  ): import('@be-music/json').BeMusicJson {
    return {
      metadata: { title: '', subtitle: '', artist: '', subartists: [], genre: '', bpm: 120 },
      resources: { wav: {}, bmp: {}, bpm: {}, stop: {}, exrank: {} },
      measures: events.map((e) => ({ index: e.measure, length: measureLength })),
      events: events.map((e) => ({
        measure: e.measure,
        channel: e.channel,
        position: e.position ?? [0, 1],
        value: '01',
      })),
    } as unknown as import('@be-music/json').BeMusicJson;
  }

  function makeFrame(currentBeat: number): import('@be-music/player/core/ui-signal-bus').PlayerUiFramePayload {
    return {
      currentBeat,
      currentSeconds: 0,
      totalSeconds: 100,
      summary: {
        score: 0,
        total: 0,
        perfect: 0,
        great: 0,
        good: 0,
        bad: 0,
        poor: 0,
        fast: 0,
        slow: 0,
        exScore: 0,
      } as unknown as import('@be-music/player/core/ui-signal-bus').PlayerUiFramePayload['summary'],
      notes: [],
    };
  }

  it('stamps TIMER_ENDOFNOTE_1P (143) when currentBeat passes the 1P last-note beat', () => {
    const clock = makeClock();
    // Two 1P notes — one at measure 0 beat 0, one at measure 2 beat 2 (since 4 beats per
    // standard measure: measure 2 base is 8, position 2/4 lands at beat 8 + 2 = 10).
    const chart = makeChartWithEvents([
      { channel: '11', measure: 0, position: [0, 1] },
      { channel: '13', measure: 2, position: [2, 4] },
    ]);
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
      chart,
    });
    // Before reaching the last note — timer not yet stamped.
    clock.advance(100);
    adapter.applyFrame(makeFrame(5));
    expect(adapter.getTimerStart(143)).toBeUndefined();
    // Crossing into the last-note beat — stamps.
    clock.advance(50);
    adapter.applyFrame(makeFrame(10));
    expect(adapter.getTimerStart(143)).toBe(150);
    // No 2P notes in this chart — its endofnote stays unset forever.
    clock.advance(50);
    adapter.applyFrame(makeFrame(20));
    expect(adapter.getTimerStart(144)).toBeUndefined();
  });

  it('stamps TIMER_ENDOFNOTE_2P (144) independently when the chart has 2P notes', () => {
    const clock = makeClock();
    // 1P last note at beat 4 (measure 1, position 0/1), 2P last note at beat 12 (measure 3,
    // position 0/1). Endofnote_1p should stamp first; endofnote_2p later.
    const chart = makeChartWithEvents([
      { channel: '12', measure: 1, position: [0, 1] },
      { channel: '23', measure: 3, position: [0, 1] },
    ]);
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '14',
      baseOps: new Set(),
      getNowMs: clock.now,
      chart,
    });
    clock.advance(100);
    adapter.applyFrame(makeFrame(4.0));
    expect(adapter.getTimerStart(143)).toBe(100);
    expect(adapter.getTimerStart(144)).toBeUndefined();
    clock.advance(200);
    adapter.applyFrame(makeFrame(12.0));
    expect(adapter.getTimerStart(143)).toBe(100);
    expect(adapter.getTimerStart(144)).toBe(300);
  });

  it('also recognizes LN channels (5* for 1P, 6* for 2P) as note events', () => {
    const clock = makeClock();
    // LN 1P at beat 16 (measure 4 position 0/1), LN 2P at beat 20 (measure 5).
    const chart = makeChartWithEvents([
      { channel: '52', measure: 4, position: [0, 1] },
      { channel: '63', measure: 5, position: [0, 1] },
    ]);
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '14',
      baseOps: new Set(),
      getNowMs: clock.now,
      chart,
    });
    clock.advance(100);
    adapter.applyFrame(makeFrame(20));
    expect(adapter.getTimerStart(143)).toBe(100);
    expect(adapter.getTimerStart(144)).toBe(100);
  });

  it('skips BGM (channel 01) so a chart with only background audio never fires endofnote', () => {
    const clock = makeClock();
    const chart = makeChartWithEvents([{ channel: '01', measure: 8, position: [0, 1] }]);
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
      chart,
    });
    clock.advance(100);
    adapter.applyFrame(makeFrame(50));
    expect(adapter.getTimerStart(143)).toBeUndefined();
    expect(adapter.getTimerStart(144)).toBeUndefined();
  });

  it('does not re-stamp once latched (subsequent frames preserve the original timestamp)', () => {
    const clock = makeClock();
    const chart = makeChartWithEvents([{ channel: '11', measure: 0, position: [0, 1] }]);
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
      chart,
    });
    clock.advance(100);
    adapter.applyFrame(makeFrame(0));
    expect(adapter.getTimerStart(143)).toBe(100);
    clock.advance(500);
    adapter.applyFrame(makeFrame(20));
    expect(adapter.getTimerStart(143)).toBe(100);
  });
});

describe('BeatorajaRuntimeAdapter — TIMER_FAILED (3)', () => {
  function makeFrameWithGauge(currentBeat: number, gaugeCurrent: number | undefined) {
    return {
      currentBeat,
      currentSeconds: 0,
      totalSeconds: 100,
      summary: {
        score: 0,
        total: 0,
        perfect: 0,
        great: 0,
        good: 0,
        bad: 0,
        poor: 0,
        fast: 0,
        slow: 0,
        exScore: 0,
        gauge:
          gaugeCurrent !== undefined
            ? { current: gaugeCurrent, max: 100, clearThreshold: 80, initial: 20, effectiveTotal: 200, cleared: false }
            : undefined,
      } as unknown as import('@be-music/player/core/ui-signal-bus').PlayerUiFramePayload['summary'],
      notes: [],
    } as import('@be-music/player/core/ui-signal-bus').PlayerUiFramePayload;
  }

  it('stamps TIMER_FAILED on the gauge crossing into 0 mid-play', () => {
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(100);
    adapter.applyFrame(makeFrameWithGauge(0, 50));
    expect(adapter.getTimerStart(3)).toBeUndefined();
    clock.advance(50);
    adapter.applyFrame(makeFrameWithGauge(0.2, 20));
    expect(adapter.getTimerStart(3)).toBeUndefined();
    // 20 → 0 — instant fail moment.
    clock.advance(50);
    adapter.applyFrame(makeFrameWithGauge(0.4, 0));
    expect(adapter.getTimerStart(3)).toBe(200);
  });

  it('does not re-stamp on subsequent zero-gauge frames (latch is sticky)', () => {
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(100);
    adapter.applyFrame(makeFrameWithGauge(0, 10));
    clock.advance(50);
    adapter.applyFrame(makeFrameWithGauge(0.2, 0));
    expect(adapter.getTimerStart(3)).toBe(150);
    clock.advance(50);
    adapter.applyFrame(makeFrameWithGauge(0.4, 0));
    expect(adapter.getTimerStart(3)).toBe(150);
  });

  it('does not stamp when the very first frame already shows gauge=0 (load-state baseline)', () => {
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(100);
    adapter.applyFrame(makeFrameWithGauge(0, 0));
    expect(adapter.getTimerStart(3)).toBeUndefined();
  });

  it('markFailed stamps TIMER_FAILED when invoked (end-of-chart fail path)', () => {
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(2500);
    adapter.markFailed();
    expect(adapter.getTimerStart(3)).toBe(2500);
  });

  it('markFailed is idempotent — leaves the earlier in-frame stamp in place', () => {
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(100);
    adapter.applyFrame(makeFrameWithGauge(0, 10));
    clock.advance(50);
    adapter.applyFrame(makeFrameWithGauge(0.2, 0));
    expect(adapter.getTimerStart(3)).toBe(150);
    clock.advance(2000);
    adapter.markFailed();
    expect(adapter.getTimerStart(3)).toBe(150);
  });
});

describe('BeatorajaRuntimeAdapter — POOR BGA tracking', () => {
  it('flips between trigger-poor-bga and clear-poor-bga commands', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
    });
    expect(adapter.isPoorBgaActive()).toBe(false);
    adapter.applyCommand({ kind: 'trigger-poor-bga', seconds: 12 });
    expect(adapter.isPoorBgaActive()).toBe(true);
    adapter.applyCommand({ kind: 'clear-poor-bga' });
    expect(adapter.isPoorBgaActive()).toBe(false);
  });
});

describe('BeatorajaRuntimeAdapter — resolveTextContent', () => {
  it('resolves prop.lua text refs from the parsed chart metadata', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
      // Minimal chart shape — only the metadata fields the resolver reads.
      chart: {
        metadata: { title: 'Demo Title', subtitle: '[ANOTHER]', genre: 'Electro', artist: 'me' },
        bmson: { info: { subartists: ['obj:and you'] } },
      } as unknown as import('@be-music/json').BeMusicJson,
    });
    expect(adapter.resolveTextContent(10)).toBe('Demo Title');
    expect(adapter.resolveTextContent(11)).toBe('[ANOTHER]');
    expect(adapter.resolveTextContent(12)).toBe('Demo Title [ANOTHER]');
    expect(adapter.resolveTextContent(13)).toBe('Electro');
    expect(adapter.resolveTextContent(14)).toBe('me');
    expect(adapter.resolveTextContent(15)).toBe('obj:and you');
    expect(adapter.resolveTextContent(16)).toBe('me obj:and you');
  });

  it('returns undefined for unknown refs (the text node renders empty)', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
      chart: { metadata: { title: 'X' } } as unknown as import('@be-music/json').BeMusicJson,
    });
    expect(adapter.resolveTextContent(9999)).toBeUndefined();
  });
});

describe('BeatorajaRuntimeAdapter — reset', () => {
  it('clears runtime ops and timers but keeps the base option ops + autoplay state', () => {
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set([920]),
      getNowMs: clock.now,
      autoPlay: true,
    });
    clock.advance(1000);
    adapter.applyCommand({ kind: 'press-lane', channel: '11' });
    adapter.applyJudgeCombo({ judge: 'GREAT', combo: 1, channel: '11', updatedAtMs: 0 });
    expect(adapter.hasOp(BEATORAJA_OP.P1_JUDGE_GREAT)).toBe(true);
    expect(adapter.getTimerStart(keyOnTimerId(1, 1)!)).toBe(1000);

    adapter.reset();

    expect(adapter.hasOp(920)).toBe(true);
    expect(adapter.hasOp(BEATORAJA_OP.AUTOPLAY_ON)).toBe(true);
    expect(adapter.hasOp(BEATORAJA_OP.NOW_LOADING)).toBe(true);
    expect(adapter.hasOp(BEATORAJA_OP.P1_JUDGE_GREAT)).toBe(false);
    expect(adapter.getTimerStart(keyOnTimerId(1, 1)!)).toBeUndefined();
    expect(adapter.getTimerStart(TIMER_SCENE_START)).toBe(0);
  });
});

// ─── judgegraph type=1 (TYPE_JUDGE) — per-second × per-state stacked histogram ────────
// Mirrors upstream `SkinNoteDistributionGraph` `TYPE_JUDGE` semantics: chart-time-axis
// columns whose stacks track each note's live judge state. We approximate the per-note
// state by aggregating bucket counts from `applyJudgeCombo` events (upstream walks all
// notes every 750 ms instead — same end result for the histogram).
describe('BeatorajaRuntimeAdapter — judgegraph type=1 (per-second judge state)', () => {
  function makeJudgeChart(events: ReadonlyArray<{ channel: string; pos?: [number, number]; measure?: number }>): import('@be-music/json').BeMusicJson {
    return {
      metadata: { bpm: 120, title: 'judge-state', rank: 2 } as unknown as import('@be-music/json').BeMusicJson['metadata'],
      events: events.map((e) => ({
        measure: e.measure ?? 0,
        channel: e.channel,
        position: (e.pos ?? [0, 1]) as unknown as import('@be-music/json').BeMusicJson['events'][0]['position'],
        value: '01',
      })),
      measures: [],
      bms: { lnObjs: [] } as unknown as import('@be-music/json').BeMusicJson['bms'],
      resources: { bpm: {}, stop: {} } as unknown as import('@be-music/json').BeMusicJson['resources'],
    } as unknown as import('@be-music/json').BeMusicJson;
  }

  it('returns undefined when no chart is loaded (decide / select scenes)', () => {
    const adapter = new BeatorajaRuntimeAdapter({ chartPlayVariant: '7', baseOps: new Set(), getNowMs: () => 0 });
    expect(adapter.resolveJudgeStateBuckets(1)).toBeUndefined();
  });

  it('returns undefined for type values other than 1', () => {
    // type=0 is note-distribution (handled via resolveNoteDistribution at the host
    // level); type=2 is early/late (kept on the legacy fixed-bin histogram path).
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
      chart: makeJudgeChart([{ channel: '11', pos: [0, 1] }]),
    });
    expect(adapter.resolveJudgeStateBuckets(0)).toBeUndefined();
    expect(adapter.resolveJudgeStateBuckets(2)).toBeUndefined();
  });

  it('initialises all judgeable notes into the unjudged (state 0) slot per chart-second', () => {
    // 120 BPM → 0.5 sec/beat. Notes at beat 0 / 2 / 4 land in seconds 0 / 1 / 2.
    // Mines (channels D1..D9 / E1..E9) are excluded per upstream `case TYPE_JUDGE`'s
    // `n instanceof MineNote` early-return.
    const chart = makeJudgeChart([
      { channel: '11', pos: [0, 1] }, // beat 0 → bucket 0
      { channel: '12', pos: [0, 1] }, // beat 0 → bucket 0
      { channel: '11', pos: [2, 4] }, // beat 2 → bucket 1
      { channel: '11', pos: [0, 1], measure: 1 }, // beat 4 → bucket 2
      { channel: 'D1', pos: [0, 1] }, // 1P lane-1 mine → excluded
    ]);
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
      chart,
    });
    const data = adapter.resolveJudgeStateBuckets(1);
    expect(data).toBeDefined();
    // Each authored bucket starts with `[unjudged, 0, 0, 0, 0, 0]`.
    expect(data!.buckets[0]).toEqual([2, 0, 0, 0, 0, 0]);
    expect(data!.buckets[1]).toEqual([1, 0, 0, 0, 0, 0]);
    expect(data!.buckets[2]).toEqual([1, 0, 0, 0, 0, 0]);
    // maxCount floored at 20 so a 1-note bucket doesn't stretch to the rect's full
    // height (matches upstream's `max = 20` initial value).
    expect(data!.maxCount).toBe(20);
    expect(data!.totalMs).toBeGreaterThan(0);
  });

  it('moves a note from unjudged into the verdict slot on applyJudgeCombo', () => {
    const chart = makeJudgeChart([{ channel: '11', pos: [0, 1] }]); // bucket 0, 1 note
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
      chart,
    });
    // applyFrame stamps the engine clock so applyJudgeCombo's chart-time approximation
    // (currentSeconds * 1000 - deltaMs) places the note in the right bucket.
    adapter.applyFrame({
      currentSeconds: 0.05,
      totalSeconds: 100,
      summary: { fast: 0, slow: 0, perfect: 0 } as unknown as import('@be-music/player/core/engine').PlayerSummary,
      notes: [],
    } as unknown as import('@be-music/player/core/ui-signal-bus').PlayerUiFramePayload);
    // PERFECT verdict at deltaMs = 5 (chart time ≈ 50 - 5 = 45 ms → bucket 0).
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 1, channel: '11', deltaMs: 5, updatedAtMs: 50 });
    const data = adapter.resolveJudgeStateBuckets(1);
    // Slot index map (mirrors upstream `Note.STATE_*`): 0 = unjudged, 1 = PG, 2 = GR,
    // 3 = GD, 4 = BD, 5 = PR/MISS. PG goes to slot 1.
    expect(data!.buckets[0]).toEqual([0, 1, 0, 0, 0, 0]);
  });

  it('routes each verdict kind to its upstream-numbered state slot', () => {
    // Five buckets, one judgeable note each. Drive one verdict per bucket and verify
    // the state slot map: PG=1, GR=2, GD=3, BD=4, POOR=5 / MISS=5.
    const chart = makeJudgeChart([
      { channel: '11', pos: [0, 1] }, // bucket 0
      { channel: '11', pos: [2, 4] }, // bucket 1
      { channel: '11', pos: [0, 1], measure: 1 }, // bucket 2
      { channel: '11', pos: [2, 4], measure: 1 }, // bucket 3
      { channel: '11', pos: [0, 1], measure: 2 }, // bucket 4
    ]);
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
      chart,
    });
    // Frame at sec 0 — pin currentSeconds for each judge to its own bucket via applyFrame.
    const fireAt = (sec: number, judge: string): void => {
      adapter.applyFrame({
        currentSeconds: sec,
        totalSeconds: 100,
        summary: { fast: 0, slow: 0 } as unknown as import('@be-music/player/core/engine').PlayerSummary,
        notes: [],
      } as unknown as import('@be-music/player/core/ui-signal-bus').PlayerUiFramePayload);
      adapter.applyJudgeCombo({ judge, combo: 0, channel: '11', deltaMs: 0, updatedAtMs: sec * 1000 });
    };
    fireAt(0.1, 'PERFECT');
    fireAt(1.1, 'GREAT');
    fireAt(2.1, 'GOOD');
    fireAt(3.1, 'BAD');
    fireAt(4.1, 'POOR');
    const data = adapter.resolveJudgeStateBuckets(1);
    // Each bucket's authored note moved from slot 0 into the matching verdict slot.
    expect(data!.buckets[0]).toEqual([0, 1, 0, 0, 0, 0]); // PG
    expect(data!.buckets[1]).toEqual([0, 0, 1, 0, 0, 0]); // GR
    expect(data!.buckets[2]).toEqual([0, 0, 0, 1, 0, 0]); // GD
    expect(data!.buckets[3]).toEqual([0, 0, 0, 0, 1, 0]); // BD
    expect(data!.buckets[4]).toEqual([0, 0, 0, 0, 0, 1]); // POOR → slot 5
  });

  it('skips unjudged kinds (READY / unknown) without mutating buckets', () => {
    const chart = makeJudgeChart([{ channel: '11', pos: [0, 1] }]);
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
      chart,
    });
    adapter.applyFrame({
      currentSeconds: 0.1,
      totalSeconds: 100,
      summary: {} as unknown as import('@be-music/player/core/engine').PlayerSummary,
      notes: [],
    } as unknown as import('@be-music/player/core/ui-signal-bus').PlayerUiFramePayload);
    // READY publish — judge='READY' has state index 0; should not move the count.
    adapter.applyJudgeCombo({ judge: 'READY', combo: 0, channel: '11', updatedAtMs: 100 });
    const data = adapter.resolveJudgeStateBuckets(1);
    expect(data!.buckets[0]).toEqual([1, 0, 0, 0, 0, 0]);
  });
});

// ─── HISPEED resolvers (10 / 310 / 311) ──────────────────────────────────────────────
// Mirrors upstream `IntegerPropertyFactory`:
//   NUMBER_HISPEED       (310) = (int) hispeed                — integer part only
//   NUMBER_HISPEED_LR2   (10)  = (int)(hispeed * 100)         — × 100 single int
//   NUMBER_HISPEED_AFTERDOT (311) = (int)(hispeed * 100) % 100 — 2-digit decimal
describe('BeatorajaRuntimeAdapter — resolveNumberValue HISPEED', () => {
  it('returns the integer part for HISPEED (310) and × 100 for HISPEED_LR2 (10)', () => {
    const adapter = new BeatorajaRuntimeAdapter({ chartPlayVariant: '7', baseOps: new Set(), getNowMs: () => 0 });
    adapter.setHiSpeed(3.42);
    // The default skin authors `id="hispeed", ref=310` + `id="hispeed-d", ref=311` as
    // separate sprites that paint side-by-side as "3" + "." + "42". Conflating 310 with
    // 10 would have collapsed the integer half to "342" → digit=2 right-truncate → "42",
    // erasing the integer "3". Restoring the upstream split keeps both halves visible.
    expect(adapter.resolveNumberValue(310)).toBe(3);
    expect(adapter.resolveNumberValue(10)).toBe(342);
    expect(adapter.resolveNumberValue(311)).toBe(42);
  });

  it('handles fractional hispeed values like 1.555 with `(int)` truncation semantics', () => {
    // Java's `(int)(1.555 * 100)` = 155 (truncation), not 156 (round). Our adapter must
    // match — the AFTERDOT slot is then `155 % 100 = 55`, which the player reads as
    // "1.55x" matching what beatoraja shows.
    const adapter = new BeatorajaRuntimeAdapter({ chartPlayVariant: '7', baseOps: new Set(), getNowMs: () => 0 });
    adapter.setHiSpeed(1.555);
    expect(adapter.resolveNumberValue(310)).toBe(1);
    expect(adapter.resolveNumberValue(10)).toBe(155);
    expect(adapter.resolveNumberValue(311)).toBe(55);
  });
});

// ─── DURATION (312) — upstream LaneRenderer formula ──────────────────────────────────
describe('BeatorajaRuntimeAdapter — resolveNumberValue DURATION', () => {
  it('matches upstream `LaneRenderer.getCurrentDuration()` for the no-cover case', () => {
    // Upstream: `region = 240000 / bpm / hispeed / nscroll` (we hold nscroll = 1).
    // BPM 140, hispeed 3.42 → 240000 / 140 / 3.42 = 501.05 → round 501. Matches what
    // beatoraja's reference skin shows on the bottom panel for this exact configuration
    // (the original screenshot the user posted: "DURATION 500" off by 1 from rounding).
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
      chart: { metadata: { bpm: 140 } } as unknown as import('@be-music/json').BeMusicJson,
    });
    adapter.setHiSpeed(3.42);
    expect(adapter.resolveNumberValue(312)).toBe(501);
  });

  it('shrinks proportionally to lanecover for the LANECOVER_ON variant', () => {
    // 240000 / 130 / 1.0 = 1846.15 → round 1846; with lanecover 0.5 → 923.
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
      chart: { metadata: { bpm: 130 } } as unknown as import('@be-music/json').BeMusicJson,
    });
    adapter.setHiSpeed(1.0);
    adapter.setLanecover(0.5);
    expect(adapter.resolveNumberValue(312)).toBe(923);
    // _LANECOVER_OFF reports the raw region — unaffected by the slider.
    expect(adapter.resolveNumberValue(1314)).toBe(1846);
  });

  it('does NOT factor lift into the DURATION readout (mirrors upstream)', () => {
    // Upstream `LaneRenderer.java:333` uses `(1 - lanecover)` only — `lift` is a
    // separate `OFFSET_LIFT` pixel-shift with no influence on scroll time. Engaging
    // lift must NOT change the white-number value.
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
      chart: { metadata: { bpm: 130 } } as unknown as import('@be-music/json').BeMusicJson,
    });
    adapter.setHiSpeed(1.0);
    const before = adapter.resolveNumberValue(312);
    adapter.setLift(0.5);
    expect(adapter.resolveNumberValue(312)).toBe(before);
  });

  it('returns 60% of the white duration for DURATION_GREEN (313)', () => {
    // Upstream `IntegerPropertyFactory.duration_green` = `getCurrentDuration() * 3 / 5`.
    // Plain integer division of the white value — NOT a separate BPM-invariant formula.
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
      chart: { metadata: { bpm: 130 } } as unknown as import('@be-music/json').BeMusicJson,
    });
    adapter.setHiSpeed(1.0);
    const white = adapter.resolveNumberValue(312);
    const green = adapter.resolveNumberValue(313);
    expect(white).toBe(1846);
    expect(green).toBe(Math.round((1846 * 3) / 5)); // 1108
  });

  it('returns 0 when the chart\'s BPM is 0 / missing (defensive guard)', () => {
    // `whiteDurationMs(... 0, hispeed)` short-circuits to 0 — same defensive behaviour as
    // `setHiSpeed(0)` does at the input gate. Mirrors upstream's `nbpm <= 0` early-return
    // shape (the formula divides by bpm and would NaN otherwise).
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
      chart: { metadata: { bpm: 0 } } as unknown as import('@be-music/json').BeMusicJson,
    });
    expect(adapter.resolveNumberValue(312)).toBe(0);
  });
});

// ─── BPM resolvers (90 / 91 / 92 / 160) ──────────────────────────────────────────────
// Mirrors upstream `IntegerPropertyFactory` `maxbpm` / `minbpm` / `mainbpm` / `nowbpm`.
describe('BeatorajaRuntimeAdapter — resolveNumberValue BPM', () => {
  function makeBpmChart(opts: {
    bpm: number;
    bpmTable?: Record<string, number>;
    events?: ReadonlyArray<{ measure?: number; channel: string; value?: string; pos?: [number, number] }>;
  }): import('@be-music/json').BeMusicJson {
    return {
      metadata: { bpm: opts.bpm, title: 'bpm-test' } as unknown as import('@be-music/json').BeMusicJson['metadata'],
      events: (opts.events ?? []).map((e) => ({
        measure: e.measure ?? 0,
        channel: e.channel,
        position: (e.pos ?? [0, 1]) as unknown as import('@be-music/json').BeMusicJson['events'][0]['position'],
        value: e.value ?? '01',
      })),
      measures: [],
      bms: { lnObjs: [] } as unknown as import('@be-music/json').BeMusicJson['bms'],
      resources: {
        bpm: opts.bpmTable ?? {},
        stop: {},
      } as unknown as import('@be-music/json').BeMusicJson['resources'],
    } as unknown as import('@be-music/json').BeMusicJson;
  }

  it('returns the chart\'s BPM for all variants on a constant-tempo chart', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
      chart: makeBpmChart({ bpm: 140 }),
    });
    expect(adapter.resolveNumberValue(90)).toBe(140); // MAXBPM
    expect(adapter.resolveNumberValue(91)).toBe(140); // MINBPM
    expect(adapter.resolveNumberValue(92)).toBe(140); // MAINBPM
    expect(adapter.resolveNumberValue(160)).toBe(140); // NOWBPM (no frame yet)
  });

  it('reports the chart-wide max / min on a SOFLAN chart with channel-03 BPM events', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
      chart: makeBpmChart({
        bpm: 140,
        events: [
          // Channel 03 = inline hex BPM. 'F0' = 240, 'A0' = 160.
          { channel: '03', value: 'F0', pos: [0, 1] }, // jumps to 240 at start
          { channel: '03', value: 'A0', pos: [2, 4] }, // back to 160 at beat 2
          { channel: '11', pos: [0, 1] }, // a note so the chart isn't degenerate
        ],
      }),
    });
    expect(adapter.resolveNumberValue(90)).toBe(240); // max = F0
    expect(adapter.resolveNumberValue(91)).toBe(140); // min = initial 140
  });

  it('tracks live BPM at the playhead via NOWBPM (160) — SOFLAN-aware', () => {
    // 140 BPM start, jumps to 240 at beat 4 (= 1 measure later, 1714 ms at 140 BPM).
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
      chart: makeBpmChart({
        bpm: 140,
        events: [
          { channel: '11', pos: [0, 1] },
          { channel: '03', value: 'F0', pos: [0, 1], measure: 1 }, // BPM 240 at measure 1 start (= beat 4)
          { channel: '11', pos: [0, 1], measure: 1 },
        ],
      }),
    });
    // Before any frame lands, NOWBPM falls back to metadata.bpm.
    expect(adapter.resolveNumberValue(160)).toBe(140);
    // Frame at 0.5 sec — well before the BPM jump (which happens at 1714 ms).
    adapter.applyFrame({
      currentSeconds: 0.5,
      totalSeconds: 100,
      summary: {} as unknown as import('@be-music/player/core/engine').PlayerSummary,
      notes: [],
    } as unknown as import('@be-music/player/core/ui-signal-bus').PlayerUiFramePayload);
    expect(adapter.resolveNumberValue(160)).toBe(140);
    // Frame at 2 sec — past the 1714 ms BPM jump.
    adapter.applyFrame({
      currentSeconds: 2.0,
      totalSeconds: 100,
      summary: {} as unknown as import('@be-music/player/core/engine').PlayerSummary,
      notes: [],
    } as unknown as import('@be-music/player/core/ui-signal-bus').PlayerUiFramePayload);
    expect(adapter.resolveNumberValue(160)).toBe(240);
  });

  it('uses the most-frequent (note-weighted) BPM for MAINBPM (92)', () => {
    // Two BPM regions: 140 (3 notes worth of run-time) → 280 (1 note's worth). The
    // most-frequent BPM (= mainBpm) is 140 because it covers more notes. Upstream's
    // `SongInformation.getMainbpm()` does exactly this weighted selection.
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
      chart: makeBpmChart({
        bpm: 140,
        events: [
          { channel: '11', pos: [0, 1] }, // beat 0 @ 140
          { channel: '11', pos: [2, 4] }, // beat 2 @ 140
          { channel: '11', pos: [0, 1], measure: 1 }, // beat 4 @ 140
          { channel: '03', value: '46', pos: [2, 4], measure: 1 }, // BPM 70 at beat 6 (low BPM)
          { channel: '11', pos: [3, 4], measure: 1 }, // beat 7 @ 70 (just one note at the slow BPM)
        ],
      }),
    });
    // Most notes (3) are at 140; just 1 note at 70. Main BPM should be 140.
    expect(adapter.resolveNumberValue(92)).toBe(140);
  });
});

// ─── timingvisualizer judge windows resolver ─────────────────────────────────────────
describe('BeatorajaRuntimeAdapter — resolveJudgeWindowsMs', () => {
  it('returns undefined when no chart is loaded', () => {
    const adapter = new BeatorajaRuntimeAdapter({ chartPlayVariant: '7', baseOps: new Set(), getNowMs: () => 0 });
    expect(adapter.resolveJudgeWindowsMs()).toBeUndefined();
  });

  it('resolves IIDX windows from the chart\'s judge rank', () => {
    // RANK 2 (NORMAL) gives the IIDX baseline windows: PG ±16.67, GR ±33.33, GD ±116.67,
    // BAD ±250 ms. Resolution path lives in `@be-music/player/core/judge-window` —
    // tested there directly. Here we just verify the adapter forwards the call.
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
      chart: {
        metadata: { bpm: 120, title: 't', rank: 2 } as unknown as import('@be-music/json').BeMusicJson['metadata'],
        events: [],
        measures: [],
        bms: {} as unknown as import('@be-music/json').BeMusicJson['bms'],
        resources: { bpm: {}, stop: {} } as unknown as import('@be-music/json').BeMusicJson['resources'],
      } as unknown as import('@be-music/json').BeMusicJson,
    });
    const windows = adapter.resolveJudgeWindowsMs();
    expect(windows).toBeDefined();
    expect(windows!.pgreat).toBeCloseTo(16.67, 1);
    expect(windows!.great).toBeCloseTo(33.33, 1);
    expect(windows!.good).toBeCloseTo(116.67, 1);
    expect(windows!.bad).toBeCloseTo(250, 1);
  });
});
