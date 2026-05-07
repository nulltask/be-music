import { describe, expect, it } from 'vitest';
import {
  BEATORAJA_OP,
  bombTimerId,
  judgeTimerId,
  keyOffTimerId,
  keyOnTimerId,
  lnHoldTimerId,
  TIMER_LOAD_END,
  TIMER_LOAD_START,
  TIMER_PLAY_START,
  TIMER_SCENE_START,
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
  it('seeds activeOps with base option ops + the play-mode op + scene-start timer', () => {
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set([920, 901]),
      getNowMs: clock.now,
    });
    expect(adapter.hasOp(920)).toBe(true);
    expect(adapter.hasOp(901)).toBe(true);
    expect(adapter.hasOp(BEATORAJA_OP.PLAY_MODE_SINGLE)).toBe(true);
    expect(adapter.hasOp(BEATORAJA_OP.PLAY_MODE_DOUBLE)).toBe(false);
    expect(adapter.getTimerStart(TIMER_SCENE_START)).toBe(0);
  });

  it('uses PLAY_MODE_DOUBLE for the double-play variants', () => {
    for (const variant of ['10', '14'] as const) {
      const adapter = new BeatorajaRuntimeAdapter({
        chartPlayVariant: variant,
        baseOps: new Set(),
        getNowMs: () => 0,
      });
      expect(adapter.hasOp(BEATORAJA_OP.PLAY_MODE_DOUBLE)).toBe(true);
      expect(adapter.hasOp(BEATORAJA_OP.PLAY_MODE_SINGLE)).toBe(false);
    }
  });

  it('surfaces the AUTO_PLAY_ON op when constructed in autoplay mode', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
      autoPlay: true,
    });
    expect(adapter.hasOp(BEATORAJA_OP.AUTO_PLAY_ON)).toBe(true);
  });
});

describe('BeatorajaRuntimeAdapter — built-in timers', () => {
  it('stamps the loading start / end timers and toggles the LOADING_IN_PROGRESS op', () => {
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(120);
    adapter.markLoadingStart();
    expect(adapter.getTimerStart(TIMER_LOAD_START)).toBe(120);
    expect(adapter.hasOp(BEATORAJA_OP.LOADING_IN_PROGRESS)).toBe(true);

    clock.advance(2400);
    adapter.markLoadingEnd();
    expect(adapter.getTimerStart(TIMER_LOAD_END)).toBe(2520);
    expect(adapter.hasOp(BEATORAJA_OP.LOADING_IN_PROGRESS)).toBe(false);

    clock.advance(800);
    adapter.markPlayStart();
    expect(adapter.getTimerStart(TIMER_PLAY_START)).toBe(3320);
  });
});

describe('BeatorajaRuntimeAdapter — applyCommand', () => {
  it('starts the per-lane key-on timer on press-lane (1P channel 13 → key 3)', () => {
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

  it('starts the key-off timer on release-lane (2P channel 22 → key 2)', () => {
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
    // Channel `19` is BMS-side key 7 — `resolveSideKeySlot` collapses `9` onto slot 7. (Channels `17` /
    // `27` are the Free-Zone empty-press lanes the engine handles separately; they don't hit a key slot.)
    adapter.applyCommand({ kind: 'hold-lane-until-beat', channel: '19', beat: 64 });
    expect(adapter.getTimerStart(lnHoldTimerId(1, 7)!)).toBe(2000);
  });

  it('routes scratch (16 / 26) onto the LR2 lane-8 slot', () => {
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(50);
    adapter.applyCommand({ kind: 'press-lane', channel: '16' });
    expect(adapter.getTimerStart(keyOnTimerId(1, 8)!)).toBe(50);
    clock.advance(50);
    adapter.applyCommand({ kind: 'press-lane', channel: '26' });
    expect(adapter.getTimerStart(keyOnTimerId(2, 8)!)).toBe(100);
  });
});

describe('BeatorajaRuntimeAdapter — applyJudgeCombo', () => {
  it('stamps the side-relative judge timer and adds the matching judge-kind op', () => {
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: clock.now,
    });
    clock.advance(1500);
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 12, channel: '13', updatedAtMs: 0 });
    expect(adapter.getTimerStart(judgeTimerId(1))).toBe(1500);
    expect(adapter.hasOp(BEATORAJA_OP.P1_JUDGE_PG)).toBe(true);
  });

  it('clears the previous side-1 judge op when a new one comes in', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set(),
      getNowMs: () => 0,
    });
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 1, channel: '11', updatedAtMs: 0 });
    expect(adapter.hasOp(BEATORAJA_OP.P1_JUDGE_PG)).toBe(true);
    adapter.applyJudgeCombo({ judge: 'GREAT', combo: 2, channel: '11', updatedAtMs: 0 });
    expect(adapter.hasOp(BEATORAJA_OP.P1_JUDGE_PG)).toBe(false);
    expect(adapter.hasOp(BEATORAJA_OP.P1_JUDGE_GR)).toBe(true);
  });

  it('keeps the side-2 judge op independent of the side-1 op', () => {
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '14',
      baseOps: new Set(),
      getNowMs: () => 0,
    });
    adapter.applyJudgeCombo({ judge: 'PERFECT', combo: 1, channel: '13', updatedAtMs: 0 });
    adapter.applyJudgeCombo({ judge: 'BAD', combo: 1, channel: '23', updatedAtMs: 0 });
    expect(adapter.hasOp(BEATORAJA_OP.P1_JUDGE_PG)).toBe(true);
    expect(adapter.hasOp(BEATORAJA_OP.P2_JUDGE_BD)).toBe(true);
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
});

describe('BeatorajaRuntimeAdapter — reset', () => {
  it('clears runtime ops and timers but keeps the base option ops', () => {
    const clock = makeClock();
    const adapter = new BeatorajaRuntimeAdapter({
      chartPlayVariant: '7',
      baseOps: new Set([920]),
      getNowMs: clock.now,
    });
    clock.advance(1000);
    adapter.applyCommand({ kind: 'press-lane', channel: '11' });
    adapter.applyJudgeCombo({ judge: 'GREAT', combo: 1, channel: '11', updatedAtMs: 0 });
    expect(adapter.hasOp(BEATORAJA_OP.P1_JUDGE_GR)).toBe(true);
    expect(adapter.getTimerStart(keyOnTimerId(1, 1)!)).toBe(1000);

    adapter.reset();

    expect(adapter.hasOp(920)).toBe(true);
    expect(adapter.hasOp(BEATORAJA_OP.PLAY_MODE_SINGLE)).toBe(true);
    expect(adapter.hasOp(BEATORAJA_OP.P1_JUDGE_GR)).toBe(false);
    expect(adapter.getTimerStart(keyOnTimerId(1, 1)!)).toBeUndefined();
    expect(adapter.getTimerStart(TIMER_SCENE_START)).toBe(0);
  });
});
