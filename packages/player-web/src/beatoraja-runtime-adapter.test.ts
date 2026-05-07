import { describe, expect, it } from 'vitest';
import {
  BEATORAJA_OP,
  bombTimerId,
  comboTimerId,
  judgeTimerId,
  keyOffTimerId,
  keyOnTimerId,
  lnHoldTimerId,
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

  it('starts the bomb timer on flash-lane', () => {
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(1200);
    adapter.applyCommand({ kind: 'flash-lane', channel: '15' });
    expect(adapter.getTimerStart(bombTimerId(1, 5)!)).toBe(1200);
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
    // Default fields stay zero / 255 alpha (matching ZERO_BEATORAJA_OFFSET semantics).
    expect(updated?.x).toBe(0);
    expect(updated?.a).toBe(255);
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
    expect(lift?.a).toBe(255);
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
