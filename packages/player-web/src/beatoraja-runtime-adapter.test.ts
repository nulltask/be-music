import { describe, expect, it } from 'vitest';
import {
  BEATORAJA_OP,
  bombTimerId,
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
