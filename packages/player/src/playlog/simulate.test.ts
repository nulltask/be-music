import { describe, expect, test } from 'vitest';
import {
  BE_MUSIC_PLAYLOG_FORMAT,
  BE_MUSIC_PLAYLOG_VERSION,
  type BeMusicPlaylog,
  type PlaylogInputEvent,
  type PlaylogNote,
} from './format.ts';
import {
  resolveBeatorajaDefaultTotal,
  resolveBeatorajaHardRecoverMultiplier,
  resolveIidxGaugeUnit,
  resolveLr2DefaultTotal,
  resolveLr2HardDamageMultiplier,
  simulatePlaylog,
  simulatePlaylogRulesets,
  type PlaylogRulesetId,
} from './simulate.ts';

function note(timeUs: number, overrides: Partial<PlaylogNote> = {}): PlaylogNote {
  return { id: 0, channel: '11', type: 'normal', timeUs, ...overrides };
}

function down(timeUs: number, channels: string[] = ['11']): Omit<PlaylogInputEvent, 'seq'> {
  return { timeUs, action: 'down', channels };
}

function up(timeUs: number, channels: string[] = ['11']): Omit<PlaylogInputEvent, 'seq'> {
  return { timeUs, action: 'up', channels };
}

interface MakePlaylogOverrides {
  notes?: PlaylogNote[];
  inputs?: Array<Omit<PlaylogInputEvent, 'seq'>>;
  chart?: Partial<BeMusicPlaylog['chart']>;
  play?: Partial<BeMusicPlaylog['play']>;
}

function makePlaylog(overrides: MakePlaylogOverrides = {}): BeMusicPlaylog {
  const notes = (overrides.notes ?? []).map((entry, index) => ({ ...entry, id: index }));
  return {
    format: BE_MUSIC_PLAYLOG_FORMAT,
    version: BE_MUSIC_PLAYLOG_VERSION,
    clock: { unit: 'us', origin: 'chart-zero' },
    chart: {
      sourceFormat: 'bms',
      laneMode: '7keys',
      lnMode: 1,
      // LR2 #RANK 2 (NORMAL): internal percent 75; beatoraja reads sourceRank 2 → judgerank 75 %.
      judgeRank: { percent: 75, sourceRank: 2 },
      noteCount: notes.filter((entry) => entry.type === 'normal' || entry.type === 'long').length,
      notes,
      ...overrides.chart,
    },
    inputs: (overrides.inputs ?? []).map((input, seq) => ({ ...input, seq })),
    play: { mode: 'manual', autoScratch: false, gauge: 'GROOVE', ...overrides.play },
  };
}

/** One note at t = 1s, one press at `dmUs` before it (dm = noteTimeUs − inputTimeUs; positive = early). */
function simulateSingleNote(ruleset: PlaylogRulesetId, dmUs: number) {
  return simulatePlaylog(makePlaylog({ notes: [note(1_000_000)], inputs: [down(1_000_000 - dmUs)] }), { ruleset });
}

describe('simulatePlaylog', () => {
  test('a single note hit dead-on scores PGREAT on every ruleset', () => {
    const playlog = makePlaylog({ notes: [note(1_000_000)], inputs: [down(1_000_000)] });
    const results = simulatePlaylogRulesets(playlog);
    for (const ruleset of ['lr2', 'beatoraja', 'iidx'] as const) {
      const result = results[ruleset]!;
      expect(result.judge, ruleset).toEqual({ pgreat: 1, great: 0, good: 0, bad: 0, poor: 0, emptyPoor: 0 });
      expect(result.exScore, ruleset).toBe(2);
      expect(result.maxCombo, ruleset).toBe(1);
      expect(result.noteCount, ruleset).toBe(1);
      // A one-note chart's gauge gain saturates every normal gauge.
      expect(result.gauge.final, ruleset).toBe(100);
      expect(result.gauge.cleared, ruleset).toBe(true);
    }
    expect(results.lr2!.ruleset).toBe('lr2/1');
    expect(results.beatoraja!.ruleset).toBe('beatoraja/1');
    expect(results.iidx!.ruleset).toBe('iidx/1');
    expect(results.lr2!.score).toBe(200000); // (4 PG × 50000) / 1 note
    expect(results.lr2!.djLevel).toBe('AAA');
    expect(results.beatoraja!.score).toBeUndefined(); // money score is LR2-only
  });

  test('LR2 RANK 2 windows: PGREAT ±18ms / GREAT ±40ms / GOOD ±100ms / BAD ±200ms, inclusive', () => {
    expect(simulateSingleNote('lr2', 18_000).judge.pgreat).toBe(1);

    const fastGreat = simulateSingleNote('lr2', 19_000);
    expect(fastGreat.judge.great).toBe(1);
    expect(fastGreat.fast).toBe(1); // positive dm = early press = FAST
    expect(fastGreat.slow).toBe(0);

    expect(simulateSingleNote('lr2', 40_000).judge.great).toBe(1);
    expect(simulateSingleNote('lr2', 41_000).judge.good).toBe(1);
    expect(simulateSingleNote('lr2', 100_000).judge.good).toBe(1);

    const bad = simulateSingleNote('lr2', 101_000);
    expect(bad.judge.bad).toBe(1);
    expect(bad.judge.poor).toBe(0); // the BAD consumed the note

    // Late presses mirror the early windows and count as SLOW.
    const slowGreat = simulateSingleNote('lr2', -19_000);
    expect(slowGreat.judge.great).toBe(1);
    expect(slowGreat.slow).toBe(1);
    expect(slowGreat.fast).toBe(0);
  });

  test('LR2: outside BAD but inside the early-only MS window is an empty POOR that leaves the note', () => {
    const result = simulateSingleNote('lr2', 201_000);
    expect(result.judge.emptyPoor).toBe(1);
    expect(result.judge.bad).toBe(0);
    expect(result.judge.poor).toBe(1); // the untouched note eventually misses
    expect(result.maxCombo).toBe(0);
  });

  test('IIDX windows: ±16.67ms PGREAT / ±33.33ms GREAT / ±116.67ms GOOD / ±250ms BAD', () => {
    expect(simulateSingleNote('iidx', 16_667).judge.pgreat).toBe(1);
    expect(simulateSingleNote('iidx', 16_668).judge.great).toBe(1);
    expect(simulateSingleNote('iidx', 33_333).judge.great).toBe(1);
    expect(simulateSingleNote('iidx', 33_334).judge.good).toBe(1);
    expect(simulateSingleNote('iidx', 116_667).judge.good).toBe(1);
    expect(simulateSingleNote('iidx', 116_668).judge.bad).toBe(1);
    expect(simulateSingleNote('iidx', 250_000).judge.bad).toBe(1);

    const beyondBad = simulateSingleNote('iidx', 250_001);
    expect(beyondBad.judge.emptyPoor).toBe(1);
    expect(beyondBad.judge.poor).toBe(1);
  });

  test('beatoraja #RANK 2 scales the SEVENKEYS PGREAT window to ±15ms (20ms × 0.75)', () => {
    expect(simulateSingleNote('beatoraja', 15_000).judge.pgreat).toBe(1);
    expect(simulateSingleNote('beatoraja', 15_001).judge.great).toBe(1);
    expect(simulateSingleNote('beatoraja', -15_000).judge.pgreat).toBe(1);
  });

  test('unplayed notes miss as POOR and drain the gauge', () => {
    const playlog = makePlaylog({ notes: [note(1_000_000), note(2_000_000)] });
    const results = simulatePlaylogRulesets(playlog);
    for (const ruleset of ['lr2', 'beatoraja', 'iidx'] as const) {
      const result = results[ruleset]!;
      expect(result.judge.poor, ruleset).toBe(2);
      expect(result.exScore, ruleset).toBe(0);
      expect(result.maxCombo, ruleset).toBe(0);
      expect(result.gauge.cleared, ruleset).toBe(false);
    }
    expect(results.lr2!.gauge.final).toBeCloseTo(8, 6); // 20 − 6 − 6
  });

  test('a press 900ms early: LR2 empty POOR; beatoraja is outside its MS window and does nothing', () => {
    const playlog = makePlaylog({ notes: [note(2_000_000)], inputs: [down(1_100_000)] });

    const lr2 = simulatePlaylog(playlog, { ruleset: 'lr2' });
    expect(lr2.judge.emptyPoor).toBe(1);
    expect(lr2.judge.poor).toBe(1); // the note itself still misses

    const beatoraja = simulatePlaylog(playlog, { ruleset: 'beatoraja' });
    expect(beatoraja.judge.emptyPoor).toBe(0); // MS window is only 500ms early
    expect(beatoraja.judge.poor).toBe(1);
  });

  test('LR2 multi-BAD: one press BADs every note inside BAD but outside GOOD', () => {
    const playlog = makePlaylog({
      notes: [note(1_000_000), note(1_050_000), note(1_100_000)],
      inputs: [down(850_000)], // dm = +150ms / +200ms / +250ms
    });

    const lr2 = simulatePlaylog(playlog, { ruleset: 'lr2' });
    expect(lr2.judge.bad).toBe(2); // notes 1 & 2; note 3 sits beyond the ±200ms BAD window
    expect(lr2.judge.poor).toBe(1); // note 3 eventually misses
    expect(lr2.judge.emptyPoor).toBe(0);
    expect(lr2.maxCombo).toBe(0);

    // beatoraja has no multi-BAD: the same press consumes exactly one note.
    const beatoraja = simulatePlaylog(playlog, { ruleset: 'beatoraja' });
    expect(beatoraja.judge.bad).toBe(1);
    expect(beatoraja.judge.poor).toBe(2);
  });

  test('beatoraja note selection: combo picks the in-GOOD-reach later note, lowest the earliest', () => {
    // First note is 120ms late (outside GOOD ±112.5ms), second is 40ms early (GREAT).
    const playlog = makePlaylog({
      notes: [note(1_000_000), note(1_160_000)],
      inputs: [down(1_120_000)],
    });

    const combo = simulatePlaylog(playlog, { ruleset: 'beatoraja' }); // beatoraja default algorithm
    expect(combo.judge).toEqual({ pgreat: 0, great: 1, good: 0, bad: 0, poor: 1, emptyPoor: 0 });

    const lowest = simulatePlaylog(playlog, { ruleset: 'beatoraja', judgeAlgorithm: 'lowest' });
    expect(lowest.judge).toEqual({ pgreat: 0, great: 0, good: 0, bad: 1, poor: 1, emptyPoor: 0 });
  });

  test('LN (mode 1): head press held to the tail judges exactly once', () => {
    for (const ruleset of ['lr2', 'beatoraja'] as const) {
      const heldToEnd = simulatePlaylog(
        makePlaylog({
          notes: [note(1_000_000, { type: 'long', endTimeUs: 2_000_000, lnMode: 1 })],
          inputs: [down(1_000_000)], // never released — the hold survives to the tail
        }),
        { ruleset },
      );
      expect(heldToEnd.judge, ruleset).toEqual({ pgreat: 1, great: 0, good: 0, bad: 0, poor: 0, emptyPoor: 0 });
      expect(heldToEnd.exScore, ruleset).toBe(2);
      expect(heldToEnd.noteCount, ruleset).toBe(1);
      expect(heldToEnd.maxCombo, ruleset).toBe(1);

      const releasedAfterEnd = simulatePlaylog(
        makePlaylog({
          notes: [note(1_000_000, { type: 'long', endTimeUs: 2_000_000, lnMode: 1 })],
          inputs: [down(1_000_000), up(2_100_000)],
        }),
        { ruleset },
      );
      expect(releasedAfterEnd.judge.pgreat, ruleset).toBe(1);
      expect(releasedAfterEnd.exScore, ruleset).toBe(2);
    }
  });

  test('LN (mode 1): an early release is a single BAD', () => {
    const result = simulatePlaylog(
      makePlaylog({
        notes: [note(1_000_000, { type: 'long', endTimeUs: 2_000_000, lnMode: 1 })],
        inputs: [down(1_000_000), up(1_200_000)], // released 800ms before the tail
      }),
      { ruleset: 'lr2' },
    );
    expect(result.judge).toEqual({ pgreat: 0, great: 0, good: 0, bad: 1, poor: 0, emptyPoor: 0 });
    expect(result.exScore).toBe(0);
  });

  test('CN (mode 2): beatoraja judges head and tail; noteCount is style-dependent', () => {
    const playlog = makePlaylog({
      notes: [note(1_000_000, { type: 'long', endTimeUs: 2_000_000, lnMode: 2 })],
      inputs: [down(1_000_000), up(2_000_000)],
    });

    const beatoraja = simulatePlaylog(playlog, { ruleset: 'beatoraja' });
    expect(beatoraja.judge.pgreat).toBe(2);
    expect(beatoraja.exScore).toBe(4);
    expect(beatoraja.noteCount).toBe(2); // charge style counts head + tail
    expect(beatoraja.maxCombo).toBe(2);

    // LR2 plays the same chart as an LN: one deferred judgment.
    const lr2 = simulatePlaylog(playlog, { ruleset: 'lr2' });
    expect(lr2.judge.pgreat).toBe(1);
    expect(lr2.exScore).toBe(2);
    expect(lr2.noteCount).toBe(1);
  });

  test('IIDX: a BAD on a charge-note head skips the tail judgment', () => {
    const result = simulatePlaylog(
      makePlaylog({
        notes: [note(1_000_000, { type: 'long', endTimeUs: 2_000_000 })],
        inputs: [down(800_000)], // +200ms: inside BAD, outside GOOD
      }),
      { ruleset: 'iidx' },
    );
    expect(result.judge.bad).toBe(1);
    expect(result.judge.poor).toBe(0); // no tail judgment at all
    expect(result.judge.pgreat).toBe(0);
    expect(result.noteCount).toBe(2); // the denominator still counts head + tail
  });

  test('HARD fails mid-play at 0 and stays failed; GROOVE bottoms out at its 2 % floor', () => {
    const hard = simulatePlaylog(
      makePlaylog({
        notes: [note(1_000_000), note(3_000_000)],
        inputs: [down(850_000), down(2_850_000)], // two +150ms BADs at ×10 damage (tiny note count)
        play: { gauge: 'HARD' },
      }),
      { ruleset: 'lr2' },
    );
    expect(hard.judge.bad).toBe(2);
    expect(hard.gauge.type).toBe('HARD');
    expect(hard.gauge.final).toBe(0);
    expect(hard.gauge.failedMidPlay).toBe(true);
    expect(hard.gauge.cleared).toBe(false);

    const groove = simulatePlaylog(
      makePlaylog({
        notes: [note(1_000_000), note(2_000_000), note(3_000_000), note(4_000_000), note(5_000_000)],
      }),
      { ruleset: 'lr2' },
    );
    expect(groove.judge.poor).toBe(5);
    expect(groove.gauge.final).toBe(2); // GROOVE's soft floor — it never dies
    expect(groove.gauge.failedMidPlay).toBeUndefined();
    expect(groove.gauge.cleared).toBe(false);
  });

  test('auto play scores every note PGREAT and clears', () => {
    const result = simulatePlaylog(makePlaylog({ notes: [note(1_000_000), note(2_000_000)], play: { mode: 'auto' } }), {
      ruleset: 'lr2',
    });
    expect(result.judge).toEqual({ pgreat: 2, great: 0, good: 0, bad: 0, poor: 0, emptyPoor: 0 });
    expect(result.maxCombo).toBe(2);
    expect(result.gauge.final).toBe(100);
    expect(result.gauge.cleared).toBe(true);
  });

  test('autoScratch auto-plays the scratch channel without inputs', () => {
    const notes = [note(1_000_000, { channel: '16' })];

    const auto = simulatePlaylog(makePlaylog({ notes, play: { autoScratch: true } }), { ruleset: 'lr2' });
    expect(auto.judge.pgreat).toBe(1);
    expect(auto.judge.poor).toBe(0);

    const manual = simulatePlaylog(makePlaylog({ notes }), { ruleset: 'lr2' });
    expect(manual.judge.pgreat).toBe(0);
    expect(manual.judge.poor).toBe(1);
  });
});

describe('ruleset helpers', () => {
  test('resolveLr2DefaultTotal follows the OpenLR2 piecewise formula (×0.8)', () => {
    expect(resolveLr2DefaultTotal(0)).toBeCloseTo(160, 9);
    expect(resolveLr2DefaultTotal(500)).toBeCloseTo(256, 9); // ((500 − 400) / 2.5 + 280) × 0.8
    expect(resolveLr2DefaultTotal(1000)).toBeCloseTo(352, 9); // ((1000 − 600) / 5 + 360) × 0.8
  });

  test('resolveBeatorajaDefaultTotal floors at 260', () => {
    expect(resolveBeatorajaDefaultTotal(10)).toBe(260);
    expect(resolveBeatorajaDefaultTotal(2000)).toBeCloseTo((7.605 * 2000) / (0.01 * 2000 + 6.5), 9); // ≈ 573.96
  });

  test('resolveIidxGaugeUnit rounds to the nearest 0.02 %', () => {
    expect(resolveIidxGaugeUnit(100)).toBeCloseTo(2.6, 9); // 260 / 100
    expect(resolveIidxGaugeUnit(338)).toBeCloseTo(0.76, 9); // 260 / 338 ≈ 0.769 → 0.76
    expect(resolveIidxGaugeUnit(1000)).toBeCloseTo(0.46, 9); // 760.5 / 1650 ≈ 0.461 → 0.46
  });

  test('LR2 hard damage / beatoraja hard recovery multipliers', () => {
    expect(resolveLr2HardDamageMultiplier(240, 1000)).toBe(1); // fix1 = 1, fix2 = 1
    expect(resolveLr2HardDamageMultiplier(160, 2)).toBe(10); // tiny charts hit the fix2 = 10 cap
    expect(resolveBeatorajaHardRecoverMultiplier(300, 2000)).toBeCloseTo(0.14 / 0.15, 9);
    expect(resolveBeatorajaHardRecoverMultiplier(160, 100)).toBe(0); // 2 × TOTAL − 320 = 0
  });
});
