import { createEmptyJson, type BeMusicJson } from '@be-music/json';
import { describe, expect, it } from 'vitest';
import { computeResultOps, RESULT_DYNAMIC_OPS } from './result.ts';
import type { Lr2Skin } from '@be-music/lr2-skin';
import type { PixiGameplayResultData } from './gameplay.ts';

/**
 * Minimal LR2 skin shape that `computeResultOps` reads from. Only `scratchFlip.flipResult` is consulted, but the
 * function still accepts the full `Lr2Skin` type — so we narrow via a cast and keep the test fixture small.
 */
function makeSkin(flipResult = false): Lr2Skin {
  return { scratchFlip: { flipResult, flipSide: false, disableFlip: false, reloadBanner: false } } as Lr2Skin;
}

interface SongOverrides {
  modeHint?: string;
  player?: number;
  difficulty?: number;
  channels?: string[];
}

interface ResultOverrides extends SongOverrides {
  cleared?: boolean;
  exScore?: number;
  total?: number;
  bad?: number;
  poor?: number;
}

/**
 * Builds a `PixiGameplayResultData` with sensible defaults. The fields `computeResultOps` actually reads are:
 * `cleared`, score counts, `song.chart.bmson.info.modeHint`, `song.chart.events`, `song.chart.bms.player`,
 * `song.chart.metadata.difficulty`. Other fields are filler so the type checks.
 */
function makeResult(overrides: ResultOverrides = {}): PixiGameplayResultData {
  const chart: BeMusicJson = createEmptyJson();
  if (overrides.modeHint !== undefined) {
    chart.bmson.info ??= {};
    chart.bmson.info.modeHint = overrides.modeHint;
  }
  if (overrides.player !== undefined) {
    chart.bms.player = overrides.player;
  }
  if (overrides.difficulty !== undefined) {
    chart.metadata.difficulty = overrides.difficulty;
  }
  if (overrides.channels) {
    // BeMusicPosition is a `[numerator, denominator]` tuple; `[0, 1]` pins the event at measure-start which is fine for
    // tests that only care about which channels exist.
    chart.events = overrides.channels.map((channel) => ({ measure: 0, position: [0, 1], channel, value: '01' }));
  }
  const total = overrides.total ?? 100;
  return {
    cleared: overrides.cleared ?? true,
    score: {
      total,
      perfect: 0,
      great: 0,
      good: 0,
      bad: overrides.bad ?? 0,
      poor: overrides.poor ?? 0,
      exScore: overrides.exScore ?? 0,
      score: 0,
    },
    maxCombo: 0,
    gauge: 80,
    playSeconds: 60,
    song: {
      id: 'test:song',
      sourceId: 'test',
      sourceLabel: 'test',
      sourceKind: 'files',
      chartPath: 'test/song.bms',
      directoryLabel: 'test',
      fileLabel: 'song.bms',
      title: 'Test',
      totalNotes: total,
      chart,
    },
    gaugeHistory: [],
    scoreHistory: [],
  };
}

describe('computeResultOps', () => {
  // -- CUSTOMOPTION defaults --------------------------------------- LITONE4 (and many 1920×1080 LR2 themes) gates a
  // large fraction of its result chrome on `#IF,<customOptionDefault>` blocks. The runtime op set MUST include the
  // skin's CUSTOMOPTION default values or those elements get filtered out at render time. Mirrors how
  // `computeSelectOps` / `PixiGameplayView.initializeRuntimeOps` already feed the same defaults into their op sets.
  describe('skin CUSTOMOPTION defaults', () => {
    it('adds every customOptions[*].defaultOp to the runtime op set', () => {
      const skin = {
        scratchFlip: { flipResult: false, flipSide: false, disableFlip: false, reloadBanner: false },
        customOptions: [
          { name: 'graph BG', defaultOp: 984, numChoices: 4 },
          { name: 'lane BG', defaultOp: 990, numChoices: 3 },
          { name: 'BG', defaultOp: 996, numChoices: 3 },
        ],
      } as unknown as Lr2Skin;
      const ops = computeResultOps(makeResult({ cleared: true }), skin);
      expect(ops.has(984)).toBe(true);
      expect(ops.has(990)).toBe(true);
      expect(ops.has(996)).toBe(true);
    });

    it('treats a missing customOptions field as empty (legacy stub-skin safety net)', () => {
      // Pre-existing call sites and tests build minimal `Lr2Skin` stubs that omit `customOptions`. The new
      // iteration must tolerate that without crashing — same defensive shape as the runtime select-scene path.
      const skin = {
        scratchFlip: { flipResult: false, flipSide: false, disableFlip: false, reloadBanner: false },
      } as Lr2Skin;
      expect(() => computeResultOps(makeResult({ cleared: true }), skin)).not.toThrow();
    });
  });

  // -- Cleared / failed gating (op 90 / 91) ------------------------- The default LR2 result skin gates the chrome
  // atlas (parts.tga vs parts_fail.tga) and the big "CLEARED" / "FAILED" graphic on these. Exactly one must be set per
  // result.
  describe('cleared / failed', () => {
    it('sets op 90 (cleared) when data.cleared is true', () => {
      const ops = computeResultOps(makeResult({ cleared: true }), makeSkin());
      expect(ops.has(RESULT_DYNAMIC_OPS.RESULT_CLEARED)).toBe(true);
      expect(ops.has(RESULT_DYNAMIC_OPS.RESULT_FAILED)).toBe(false);
    });

    it('sets op 91 (failed) when data.cleared is false', () => {
      const ops = computeResultOps(makeResult({ cleared: false }), makeSkin());
      expect(ops.has(RESULT_DYNAMIC_OPS.RESULT_FAILED)).toBe(true);
      expect(ops.has(RESULT_DYNAMIC_OPS.RESULT_CLEARED)).toBe(false);
    });
  });

  // -- Clear lamp (op 101..105) ------------------------------------- The lamp determines which "STAGE CLEARED" /
  // "FAILED" / "FULL COMBO" graphic shows. The branching priority is: 1. failed (gauge < 80) 2. full combo (cleared AND
  // zero BAD/POOR) 3. normal (otherwise)
  describe('clear lamp', () => {
    it('selects FAILED lamp when not cleared', () => {
      const ops = computeResultOps(makeResult({ cleared: false }), makeSkin());
      expect(ops.has(RESULT_DYNAMIC_OPS.LAMP_FAILED)).toBe(true);
      expect(ops.has(RESULT_DYNAMIC_OPS.LAMP_FULL_COMBO)).toBe(false);
    });

    it('selects FULL COMBO lamp when cleared with zero BAD/POOR', () => {
      const ops = computeResultOps(makeResult({ cleared: true, bad: 0, poor: 0, total: 50 }), makeSkin());
      expect(ops.has(RESULT_DYNAMIC_OPS.LAMP_FULL_COMBO)).toBe(true);
      expect(ops.has(RESULT_DYNAMIC_OPS.LAMP_NORMAL)).toBe(false);
    });

    it('selects NORMAL CLEARED lamp when cleared but combo broke', () => {
      const ops = computeResultOps(makeResult({ cleared: true, bad: 1 }), makeSkin());
      expect(ops.has(RESULT_DYNAMIC_OPS.LAMP_NORMAL)).toBe(true);
      expect(ops.has(RESULT_DYNAMIC_OPS.LAMP_FULL_COMBO)).toBe(false);
    });

    it('treats POOR-only plays as combo-broken (not full combo)', () => {
      const ops = computeResultOps(makeResult({ cleared: true, bad: 0, poor: 1 }), makeSkin());
      expect(ops.has(RESULT_DYNAMIC_OPS.LAMP_NORMAL)).toBe(true);
      expect(ops.has(RESULT_DYNAMIC_OPS.LAMP_FULL_COMBO)).toBe(false);
    });
  });

  // -- Result rank (op 300..308 NOW + 340..347 NEXT + 320..328 PREV) The result skin gates rank graphics on the **300 /
  // 340** ranges (current / after-update), NOT the 200..207 select-screen range. An earlier revision of the renderer
  // set 200..207 and every rank panel stayed hidden. These tests lock in the correct mapping.
  describe('result rank', () => {
    it('maps EX rate >= 8/9 to AAA on both NOW (300) and NEXT (340)', () => {
      // total=100 → ex max 200; exScore 178 = 89% > 8/9 ≈ 88.9%.
      const ops = computeResultOps(makeResult({ total: 100, exScore: 178 }), makeSkin());
      expect(ops.has(RESULT_DYNAMIC_OPS.RANK_NOW_AAA)).toBe(true);
      expect(ops.has(RESULT_DYNAMIC_OPS.RANK_NEXT_AAA)).toBe(true);
    });

    it('maps EX rate < 1/9 (and > 0) to F (NOW=307, NEXT=347)', () => {
      // exScore 10 / 200 = 5% — below all thresholds.
      const ops = computeResultOps(makeResult({ total: 100, exScore: 10 }), makeSkin());
      expect(ops.has(RESULT_DYNAMIC_OPS.RANK_NOW_F)).toBe(true);
      expect(ops.has(RESULT_DYNAMIC_OPS.RANK_NEXT_AAA + 7)).toBe(true);
    });

    it('always sets PREV rank slot to 0 (no history yet)', () => {
      // Until score persistence lands, every play is "first time" so the previous rank reads as rank-0 / "0 tier".
      const ops = computeResultOps(makeResult({ total: 100, exScore: 200 }), makeSkin());
      expect(ops.has(RESULT_DYNAMIC_OPS.RANK_PREV_0)).toBe(true);
    });

    it('falls back to AAA when total <= 0 (empty chart)', () => {
      // With total=0 the rate divisor is undefined; the implementation returns AAA so the rank panel still renders with
      // something.
      const ops = computeResultOps(makeResult({ total: 0, exScore: 0 }), makeSkin());
      expect(ops.has(RESULT_DYNAMIC_OPS.RANK_NOW_AAA)).toBe(true);
    });
  });

  // -- Updated flags (op 330..335) --------------------------------- Without persisted score history every play is
  // treated as an update — keeps the LR2 default skin's congratulatory artwork visible. When persistence lands these
  // tests will need updating.
  describe('updated flags', () => {
    it('sets SCORE_UPDATED and RANK_UPDATED on every result', () => {
      const ops = computeResultOps(makeResult(), makeSkin());
      expect(ops.has(RESULT_DYNAMIC_OPS.SCORE_UPDATED)).toBe(true);
      expect(ops.has(RESULT_DYNAMIC_OPS.RANK_UPDATED)).toBe(true);
    });
  });

  // -- Result flip (op 350 / 351) ----------------------------------- 350 = `#FLIPRESULT` not declared (default), 351 =
  // declared. Skins gate side-specific panels on these; setting BOTH would double-render. Mutual exclusivity is the
  // contract.
  describe('result flip', () => {
    it('sets RESULT_FLIP_DISABLED when the skin does not declare #FLIPRESULT', () => {
      const ops = computeResultOps(makeResult(), makeSkin(false));
      expect(ops.has(RESULT_DYNAMIC_OPS.RESULT_FLIP_DISABLED)).toBe(true);
      expect(ops.has(RESULT_DYNAMIC_OPS.RESULT_FLIP_ENABLED)).toBe(false);
    });

    it('flips to RESULT_FLIP_ENABLED when the skin declares #FLIPRESULT', () => {
      const ops = computeResultOps(makeResult(), makeSkin(true));
      expect(ops.has(RESULT_DYNAMIC_OPS.RESULT_FLIP_ENABLED)).toBe(true);
      expect(ops.has(RESULT_DYNAMIC_OPS.RESULT_FLIP_DISABLED)).toBe(false);
    });
  });

  // -- Key mode (dual range: SELECT 160..164 + KEYCONFIG 400..402) Different skin authors gate either way. Both ranges
  // have to be set so a skin that uses op 160 (7K) AND a skin that uses op 400 (7+14K) both render their per-keymode
  // panels.
  describe('key mode', () => {
    it('sets 160 (7K) and 400 (7+14K) for an SP-7K chart', () => {
      // 7K means the chart uses key 6/7 (channels 18 / 19).
      const ops = computeResultOps(makeResult({ channels: ['11', '12', '13', '14', '15', '18', '19'] }), makeSkin());
      expect(ops.has(RESULT_DYNAMIC_OPS.KEYS_7)).toBe(true);
      expect(ops.has(RESULT_DYNAMIC_OPS.KEYCONFIG_7_14)).toBe(true);
      expect(ops.has(RESULT_DYNAMIC_OPS.KEYS_5)).toBe(false);
    });

    it('sets 161 (5K) and 402 (5+10K) for an SP-5K chart (no channel 18/19)', () => {
      const ops = computeResultOps(makeResult({ channels: ['11', '12', '13', '14', '15'] }), makeSkin());
      expect(ops.has(RESULT_DYNAMIC_OPS.KEYS_5)).toBe(true);
      expect(ops.has(RESULT_DYNAMIC_OPS.KEYCONFIG_5_10)).toBe(true);
    });

    it('sets 162 (14K) and 400 for a DP-14K chart (#PLAYER 3 + 6/7 keys)', () => {
      const ops = computeResultOps(makeResult({ player: 3, channels: ['11', '18', '21', '28'] }), makeSkin());
      expect(ops.has(RESULT_DYNAMIC_OPS.KEYS_14)).toBe(true);
      expect(ops.has(RESULT_DYNAMIC_OPS.KEYCONFIG_7_14)).toBe(true);
    });

    it('sets 163 (10K) and 402 for a DP-10K chart (#PLAYER 3, no 6/7)', () => {
      const ops = computeResultOps(makeResult({ player: 3, channels: ['11', '21'] }), makeSkin());
      expect(ops.has(RESULT_DYNAMIC_OPS.KEYS_10)).toBe(true);
      expect(ops.has(RESULT_DYNAMIC_OPS.KEYCONFIG_5_10)).toBe(true);
    });

    it('honors bmson modeHint over channel detection', () => {
      const ops = computeResultOps(makeResult({ modeHint: 'beat-9k' }), makeSkin());
      expect(ops.has(RESULT_DYNAMIC_OPS.KEYS_9)).toBe(true);
      expect(ops.has(RESULT_DYNAMIC_OPS.KEYCONFIG_9)).toBe(true);
    });
  });

  // -- Difficulty (op 150..155) ------------------------------------ The default skin's `#IF,400,152` (7+14K NORMAL)
  // per-difficulty panel relies on this. Verify each chart difficulty maps to the matching slot, and that "no
  // difficulty declared" doesn't leave every panel blank (it falls back to NORMAL).
  describe('difficulty echo', () => {
    it('sets DIFFICULTY_HYPER (153) for difficulty=3', () => {
      const ops = computeResultOps(makeResult({ difficulty: 3 }), makeSkin());
      expect(ops.has(RESULT_DYNAMIC_OPS.DIFFICULTY_HYPER)).toBe(true);
    });

    it('falls back to DIFFICULTY_NORMAL when difficulty is undefined', () => {
      const ops = computeResultOps(makeResult({ difficulty: undefined }), makeSkin());
      expect(ops.has(RESULT_DYNAMIC_OPS.DIFFICULTY_NORMAL)).toBe(true);
    });
  });
});
