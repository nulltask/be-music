import { createEmptyJSON, type BeMusicJSON } from '@be-music/chart-source';
import type { CourseView, PlayResult } from '@be-music/player-scene-model';
import { describe, expect, it } from 'vite-plus/test';
import { LR2_NUM, LR2_OP, LR2_TEXT, LR2_TIMER } from '../ids/index.ts';
import { resolveLR2GraphReveal, resolveLR2ResultState, resolveLR2ResultTimers } from './result.ts';

/** The facts of the skins a result is shown with: the played skin's `#FLIPRESULT` and the result skin's options. */
interface SkinFacts {
  flipResult?: boolean;
  customOps?: number[];
}

function makeSkin(flipResult = false): SkinFacts {
  return { flipResult };
}

/** The result ops of `result` on a skin, for a result of `course` when given. */
function resultOps(result: PlayResult, skin: SkinFacts, course?: CourseView): ReadonlySet<number> {
  return resolveLR2ResultState({
    result,
    ...(skin.flipResult !== undefined ? { flipResult: skin.flipResult } : {}),
    ...(skin.customOps !== undefined ? { customOps: skin.customOps } : {}),
    ...(course !== undefined ? { course } : {}),
  }).ops;
}

interface SongOverrides {
  modeHint?: string;
  player?: number;
  difficulty?: number;
  channels?: string[];
  chartPath?: string;
}

interface ResultOverrides extends SongOverrides {
  cleared?: boolean;
  lamp?: PlayResult['lamp'];
  perfect?: number;
  exScore?: number;
  total?: number;
  bad?: number;
  poor?: number;
  emptyPoor?: number;
}

/**
 * Builds a `PlayResult` with sensible defaults. The fields the result ops read are:
 * `cleared`, score counts, `song.chart.bmson.info.modeHint`, `song.chart.events`, `song.chart.bms.player`,
 * `song.chart.metadata.difficulty`. Other fields are filler so the type checks.
 */
function makeResult(overrides: ResultOverrides = {}): PlayResult {
  const chart: BeMusicJSON = createEmptyJSON();
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
      perfect: overrides.perfect ?? 0,
      great: 0,
      good: 0,
      bad: overrides.bad ?? 0,
      poor: overrides.poor ?? 0,
      emptyPoor: overrides.emptyPoor ?? 0,
      exScore: overrides.exScore ?? 0,
      score: 0,
    },
    maxCombo: 0,
    gauge: 80,
    playSeconds: 60,
    chart: {
      id: 'test:song',
      sourceId: 'test',
      sourceLabel: 'test',
      sourceKind: 'files',
      chartPath: overrides.chartPath ?? 'test/song.bms',
      directoryLabel: 'test',
      fileLabel: 'song.bms',
      title: 'Test',
      totalNotes: total,
      chart,
    },
    gaugeHistory: [],
    scoreHistory: [],
    ...(overrides.lamp !== undefined ? { lamp: overrides.lamp } : {}),
  };
}

describe('resolveLR2ResultState ops', () => {
  it('keeps REPLAY PLAYING (op 84) on for the result of a replay, REPLAY OFF (op 82) otherwise', () => {
    const live = resultOps(makeResult({ cleared: true }), {});
    expect(live.has(LR2_OP.REPLAY_OFF)).toBe(true);
    expect(live.has(LR2_OP.REPLAY_PLAYING)).toBe(false);
    const replay = resultOps({ ...makeResult({ cleared: true }), fromReplay: true }, {});
    expect(replay.has(LR2_OP.REPLAY_PLAYING)).toBe(true);
    expect(replay.has(LR2_OP.REPLAY_OFF)).toBe(false);
  });

  // -- CUSTOMOPTION defaults --------------------------------------- LITONE4 (and many 1920×1080 LR2 themes) gates a
  // large fraction of its result chrome on `#IF,<customOptionDefault>` blocks. The runtime op set MUST include the
  // skin's CUSTOMOPTION default values or those elements get filtered out at render time. Mirrors how
  // `resolveLR2SelectState` / `resolveLR2PlayState` feed the same defaults into their op sets.
  describe('skin CUSTOMOPTION defaults', () => {
    it('adds every custom option to the op set', () => {
      const ops = resultOps(makeResult({ cleared: true }), { customOps: [984, 990, 996] });
      expect(ops.has(984)).toBe(true);
      expect(ops.has(990)).toBe(true);
      expect(ops.has(996)).toBe(true);
    });
  });

  // -- Cleared / failed gating (op 90 / 91) ------------------------- The default LR2 result skin gates the chrome
  // atlas (parts.tga vs parts_fail.tga) and the big "CLEARED" / "FAILED" graphic on these. Exactly one must be set per
  // result.
  describe('cleared / failed', () => {
    it('sets op 90 (cleared) when data.cleared is true', () => {
      const ops = resultOps(makeResult({ cleared: true }), makeSkin());
      expect(ops.has(LR2_OP.RESULT_CLEAR)).toBe(true);
      expect(ops.has(LR2_OP.RESULT_FAIL)).toBe(false);
    });

    it('sets op 91 (failed) when data.cleared is false', () => {
      const ops = resultOps(makeResult({ cleared: false }), makeSkin());
      expect(ops.has(LR2_OP.RESULT_FAIL)).toBe(true);
      expect(ops.has(LR2_OP.RESULT_CLEAR)).toBe(false);
    });
  });

  // -- Clear lamp (op 101..105) ------------------------------------- The lamp determines which "STAGE CLEARED" /
  // "FAILED" / "FULL COMBO" graphic shows: the play's lamp on LR2's lamps, else the clear-lamp rule over the result.
  describe('clear lamp', () => {
    it('lights the play’s lamp on LR2’s lamps', () => {
      const lampOp = (lamp: NonNullable<PlayResult['lamp']>) =>
        [...resultOps(makeResult({ cleared: lamp !== 'FAILED', bad: 1, lamp }), makeSkin())].filter(
          (op) => op >= LR2_OP.LAMP_FAILED && op <= LR2_OP.LAMP_FULL_COMBO,
        );
      expect(lampOp('FAILED')).toEqual([LR2_OP.LAMP_FAILED]);
      expect(lampOp('ASSIST_EASY')).toEqual([LR2_OP.LAMP_EASY]);
      expect(lampOp('EASY')).toEqual([LR2_OP.LAMP_EASY]);
      expect(lampOp('NORMAL')).toEqual([LR2_OP.LAMP_NORMAL]);
      expect(lampOp('HARD')).toEqual([LR2_OP.LAMP_HARD]);
      expect(lampOp('EX_HARD')).toEqual([LR2_OP.LAMP_HARD]);
      expect(lampOp('FULL_COMBO')).toEqual([LR2_OP.LAMP_FULL_COMBO]);
      expect(lampOp('MAX')).toEqual([LR2_OP.LAMP_FULL_COMBO]);
    });

    it('selects FAILED lamp when not cleared', () => {
      const ops = resultOps(makeResult({ cleared: false }), makeSkin());
      expect(ops.has(LR2_OP.LAMP_FAILED)).toBe(true);
      expect(ops.has(LR2_OP.LAMP_FULL_COMBO)).toBe(false);
    });

    it('selects FULL COMBO lamp when cleared with zero BAD/POOR', () => {
      const ops = resultOps(makeResult({ cleared: true, bad: 0, poor: 0, perfect: 50, total: 50 }), makeSkin());
      expect(ops.has(LR2_OP.LAMP_FULL_COMBO)).toBe(true);
      expect(ops.has(LR2_OP.LAMP_NORMAL)).toBe(false);
    });

    it('selects NORMAL CLEARED lamp when cleared but combo broke', () => {
      const ops = resultOps(makeResult({ cleared: true, bad: 1 }), makeSkin());
      expect(ops.has(LR2_OP.LAMP_NORMAL)).toBe(true);
      expect(ops.has(LR2_OP.LAMP_FULL_COMBO)).toBe(false);
    });

    it('treats POOR-only plays as combo-broken (not full combo)', () => {
      const ops = resultOps(makeResult({ cleared: true, bad: 0, poor: 1 }), makeSkin());
      expect(ops.has(LR2_OP.LAMP_NORMAL)).toBe(true);
      expect(ops.has(LR2_OP.LAMP_FULL_COMBO)).toBe(false);
    });
  });

  // -- Result rank (op 300..308 NOW + 340..347 NEXT + 320..328 PREV) The result skin gates rank graphics on the **300 /
  // 340** ranges (current / after-update), NOT the 200..207 select-screen range. An earlier revision of the renderer
  // set 200..207 and every rank panel stayed hidden. These tests lock in the correct mapping.
  describe('result rank', () => {
    it('maps EX rate >= 8/9 to AAA on both NOW (300) and NEXT (340)', () => {
      // total=100 → ex max 200; exScore 178 = 89% > 8/9 ≈ 88.9%.
      const ops = resultOps(makeResult({ total: 100, exScore: 178 }), makeSkin());
      expect(ops.has(LR2_OP.RESULT_RANK_AAA)).toBe(true);
      expect(ops.has(LR2_OP.UPDATED_RANK_AAA)).toBe(true);
    });

    it('maps EX rate < 1/9 (and > 0) to F (NOW=307, NEXT=347)', () => {
      // exScore 10 / 200 = 5% — below all thresholds.
      const ops = resultOps(makeResult({ total: 100, exScore: 10 }), makeSkin());
      expect(ops.has(LR2_OP.RESULT_RANK_F)).toBe(true);
      expect(ops.has(LR2_OP.UPDATED_RANK_AAA + 7)).toBe(true);
    });

    it('always sets PREV rank slot to 0 (no history yet)', () => {
      // Until score persistence lands, every play is "first time" so the previous rank reads as rank-0 / "0 tier".
      const ops = resultOps(makeResult({ total: 100, exScore: 200 }), makeSkin());
      expect(ops.has(LR2_OP.PREVIOUS_RANK_0)).toBe(true);
    });

    it('falls back to AAA when total <= 0 (empty chart)', () => {
      // With total=0 the rate divisor is undefined; the implementation returns AAA so the rank panel still renders with
      // something.
      const ops = resultOps(makeResult({ total: 0, exScore: 0 }), makeSkin());
      expect(ops.has(LR2_OP.RESULT_RANK_AAA)).toBe(true);
    });
  });

  // -- Updated flags (op 330..335) --------------------------------- Without persisted score history every play is
  // treated as an update — keeps the LR2 default skin's congratulatory artwork visible. When persistence lands these
  // tests will need updating.
  describe('updated flags', () => {
    it('sets SCORE_UPDATED and RANK_UPDATED on every result', () => {
      const ops = resultOps(makeResult(), makeSkin());
      expect(ops.has(LR2_OP.SCORE_UPDATED)).toBe(true);
      expect(ops.has(LR2_OP.RANK_UPDATED)).toBe(true);
    });
  });

  // -- Result flip (op 350 / 351) ----------------------------------- 350 = `#FLIPRESULT` not declared (default), 351 =
  // declared. Skins gate side-specific panels on these; setting BOTH would double-render. Mutual exclusivity is the
  // contract.
  describe('result flip', () => {
    it('sets RESULT_FLIP_DISABLED when the skin does not declare #FLIPRESULT', () => {
      const ops = resultOps(makeResult(), makeSkin(false));
      expect(ops.has(LR2_OP.RESULT_FLIP_OFF)).toBe(true);
      expect(ops.has(LR2_OP.RESULT_FLIP_ON)).toBe(false);
    });

    it('flips to RESULT_FLIP_ENABLED when the skin declares #FLIPRESULT', () => {
      const ops = resultOps(makeResult(), makeSkin(true));
      expect(ops.has(LR2_OP.RESULT_FLIP_ON)).toBe(true);
      expect(ops.has(LR2_OP.RESULT_FLIP_OFF)).toBe(false);
    });
  });

  // -- Key mode (dual range: SELECT 160..164 + KEYCONFIG 400..402) Different skin authors gate either way. Both ranges
  // have to be set so a skin that uses op 160 (7K) AND a skin that uses op 400 (7+14K) both render their per-keymode
  // panels.
  describe('key mode', () => {
    it('sets 160 (7K) and 400 (7+14K) for an SP-7K chart', () => {
      // 7K means the chart uses key 6/7 (channels 18 / 19).
      const ops = resultOps(makeResult({ channels: ['11', '12', '13', '14', '15', '18', '19'] }), makeSkin());
      expect(ops.has(LR2_OP.KEYS_7)).toBe(true);
      expect(ops.has(LR2_OP.KEY_CONFIG_7_14)).toBe(true);
      expect(ops.has(LR2_OP.KEYS_5)).toBe(false);
    });

    it('sets 161 (5K) and 402 (5+10K) for an SP-5K chart (no channel 18/19)', () => {
      const ops = resultOps(makeResult({ channels: ['11', '12', '13', '14', '15'] }), makeSkin());
      expect(ops.has(LR2_OP.KEYS_5)).toBe(true);
      expect(ops.has(LR2_OP.KEY_CONFIG_5_10)).toBe(true);
    });

    it('sets 162 (14K) and 400 for a DP-14K chart (#PLAYER 3 + 6/7 keys)', () => {
      const ops = resultOps(makeResult({ player: 3, channels: ['11', '18', '21', '28'] }), makeSkin());
      expect(ops.has(LR2_OP.KEYS_14)).toBe(true);
      expect(ops.has(LR2_OP.KEY_CONFIG_7_14)).toBe(true);
    });

    it('sets 163 (10K) and 402 for a DP-10K chart (#PLAYER 3, no 6/7)', () => {
      const ops = resultOps(makeResult({ player: 3, channels: ['11', '21'] }), makeSkin());
      expect(ops.has(LR2_OP.KEYS_10)).toBe(true);
      expect(ops.has(LR2_OP.KEY_CONFIG_5_10)).toBe(true);
    });

    it('sets 164 (9K) and 401 for a .pms chart, whose 2x lanes are 9 KEY buttons', () => {
      const ops = resultOps(
        makeResult({ chartPath: 'test/song.pms', channels: ['11', '12', '13', '14', '15', '22', '23', '24', '25'] }),
        makeSkin(),
      );
      expect(ops.has(LR2_OP.KEYS_9)).toBe(true);
      expect(ops.has(LR2_OP.KEY_CONFIG_9)).toBe(true);
      expect(ops.has(LR2_OP.KEYS_10)).toBe(false);
    });

    it('reads the key mode from the lanes, not from mines or invisible notes', () => {
      const ops = resultOps(makeResult({ channels: ['11', '12', '13', '14', '15', '16', 'D8', '39'] }), makeSkin());
      expect(ops.has(LR2_OP.KEYS_5)).toBe(true);
      expect(ops.has(LR2_OP.KEYS_7)).toBe(false);
    });

    it('counts #LNTYPE long-note lanes toward the key mode', () => {
      const ops = resultOps(makeResult({ channels: ['11', '12', '13', '14', '15', '58'] }), makeSkin());
      expect(ops.has(LR2_OP.KEYS_7)).toBe(true);
    });

    it('honors bmson modeHint over channel detection', () => {
      const ops = resultOps(makeResult({ modeHint: 'beat-9k' }), makeSkin());
      expect(ops.has(LR2_OP.KEYS_9)).toBe(true);
      expect(ops.has(LR2_OP.KEY_CONFIG_9)).toBe(true);
    });
  });

  // -- Difficulty (op 150..155) ------------------------------------ The default skin's `#IF,400,152` (7+14K NORMAL)
  // per-difficulty panel relies on this. Verify each chart difficulty maps to the matching slot, and that "no
  // difficulty declared" doesn't leave every panel blank (it falls back to NORMAL).
  describe('difficulty echo', () => {
    it('sets DIFFICULTY_HYPER (153) for difficulty=3', () => {
      const ops = resultOps(makeResult({ difficulty: 3 }), makeSkin());
      expect(ops.has(LR2_OP.DIFFICULTY_HYPER)).toBe(true);
    });

    it('falls back to DIFFICULTY_NORMAL when difficulty is undefined', () => {
      const ops = resultOps(makeResult({ difficulty: undefined }), makeSkin());
      expect(ops.has(LR2_OP.DIFFICULTY_NORMAL)).toBe(true);
    });
  });

  describe('course', () => {
    const course = { kind: 'grade' as const, title: 'Dan', stages: [{ title: 'A' }, { title: 'B' }] };

    it('lights the course and kind ops on the course result', () => {
      const ops = resultOps(makeResult(), makeSkin(), course);
      expect([290, 293].every((op) => ops.has(op))).toBe(true);
      expect(ops.has(280) || ops.has(289)).toBe(false);
    });

    it("adds the stage op on a course stage's result", () => {
      expect(resultOps(makeResult(), makeSkin(), { ...course, stageIndex: 0 }).has(280)).toBe(true);
      expect(resultOps(makeResult(), makeSkin(), { ...course, stageIndex: 1 }).has(289)).toBe(true);
    });

    it('lights no course op outside a course', () => {
      expect(resultOps(makeResult(), makeSkin()).has(290)).toBe(false);
    });
  });
});

describe('resolveLR2ResultState values', () => {
  it('reads this play’s score, counts, rates, combo and time; nothing before it', () => {
    const result = { ...makeResult({ total: 100, exScore: 150, perfect: 60, bad: 2, poor: 3 }), maxCombo: 77 };
    const state = resolveLR2ResultState({ result });
    expect(state.number(LR2_NUM.EXSCORE)).toBe(150);
    expect(state.number(LR2_NUM.BEST_EXSCORE)).toBe(150);
    expect(state.number(LR2_NUM.EXSCORE_MAX)).toBe(200);
    expect(state.number(LR2_NUM.TOTAL_RATE)).toBe(75);
    expect(state.number(LR2_NUM.PERFECT)).toBe(60);
    expect(state.number(LR2_NUM.BEST_PERFECT_RATE)).toBe(60);
    expect(state.number(LR2_NUM.MAX_COMBO)).toBe(77);
    expect(state.number(LR2_NUM.COMBO)).toBe(77);
    expect(state.number(LR2_NUM.RESULT_MIN_BP)).toBe(5);
    expect(state.number(LR2_NUM.RESULT_MIN_BP_BEFORE)).toBe(100);
    expect(state.number(LR2_NUM.RESULT_MIN_BP_DIFF)).toBe(95);
    expect(state.number(LR2_NUM.RESULT_EXSCORE_BEFORE)).toBe(0);
    expect(state.number(LR2_NUM.GAUGE)).toBe(80);
    expect(state.number(LR2_NUM.PLAY_MINUTE)).toBe(1);
    expect(state.number(LR2_NUM.PLAY_SECOND)).toBe(0);
    expect(state.number(LR2_NUM.IR_RANK)).toBeUndefined();
  });

  it('truncates the best record’s rates (73, 85-89) as LR2 draws them', () => {
    // 179 of 200 points is 89.5 %; 2 of 3 notes PGREAT is 66.6… %, 1 of 3 GREAT 33.3… %.
    const rated = resolveLR2ResultState({ result: makeResult({ total: 100, exScore: 179 }) });
    expect(rated.number(LR2_NUM.BEST_RATE)).toBe(89);
    const thirds = makeResult({ total: 3, exScore: 5, perfect: 2 });
    const state = resolveLR2ResultState({ result: { ...thirds, score: { ...thirds.score, great: 1 } } });
    expect(state.number(LR2_NUM.BEST_PERFECT_RATE)).toBe(66);
    expect(state.number(LR2_NUM.BEST_GREAT_RATE)).toBe(33);
    expect(state.number(LR2_NUM.BEST_POOR_RATE)).toBe(0);
    expect(resolveLR2ResultState({ result: makeResult({ total: 0, exScore: 0 }) }).number(LR2_NUM.BEST_RATE)).toBe(0);
  });

  it('draws the rate over the notes judged on 102 / 103 and over every note on 115 / 116', () => {
    // A play that failed after 95 of 100 notes: 150 of the 190 points judged (78.94 %), of the 200 of the chart (75 %).
    const result = makeResult({ cleared: false, total: 100, exScore: 150, perfect: 60, bad: 2, poor: 3 });
    const state = resolveLR2ResultState({ result: { ...result, score: { ...result.score, great: 30 } } });
    expect(state.number(LR2_NUM.SCORE_RATE)).toBe(78);
    expect(state.number(LR2_NUM.SCORE_RATE_AFTERDOT)).toBe(94);
    expect(state.number(LR2_NUM.TOTAL_RATE)).toBe(75);
    expect(state.number(LR2_NUM.TOTAL_RATE_AFTERDOT)).toBe(0);
  });

  it('reads the course’s stage levels and texts before the chart’s', () => {
    const course = { kind: 'grade' as const, title: 'Dan', stages: [{ title: 'A', level: 12 }] };
    const state = resolveLR2ResultState({ result: makeResult(), course });
    expect(state.number(LR2_NUM.COURSE_STAGE1_LEVEL)).toBe(12);
    expect(state.text(LR2_TEXT.COURSE_TITLE)).toBe('Dan');
    expect(state.text(LR2_TEXT.TITLE)).toBe('Test');
  });

  it('draws the chart’s texts, the INSANE level among them', () => {
    const state = resolveLR2ResultState({ result: makeResult({ difficulty: 5 }) });
    expect(state.text(LR2_TEXT.RIVAL)).toBe('TARGET');
    expect(state.text(LR2_TEXT.TITLE)).toBe('Test');
    // Text 20 is the internet ranking's message on the result screen: none without one.
    expect(state.text(LR2_TEXT.TITLE_ALT)).toBe('');
    expect(state.text(LR2_TEXT.ARTIST_ALT)).toBe(state.text(LR2_TEXT.ARTIST));
    expect(state.text(LR2_TEXT.DIFFICULTY)).toBe('5');
    expect(state.text(LR2_TEXT.INSANE_LEVEL)).toBe(state.text(LR2_TEXT.PLAY_LEVEL));
    expect(state.text(LR2_TEXT.TAG)).toBe('');
  });

  it('fills the bar graphs and sliders', () => {
    const result = { ...makeResult({ total: 100, exScore: 50 }), maxCombo: 25 };
    const state = resolveLR2ResultState({ result });
    expect(state.bargraph(2)).toBe(0.25);
    expect(state.bargraph(6)).toBe(0.8);
    expect(state.bargraph(7)).toBe(0.25);
    expect(state.slider(9)).toBe(0.25);
    expect(state.bargraph(3)).toBeUndefined();
  });
});

describe('resolveLR2ResultTimers', () => {
  const frame = (nowMs: number, steps: { graphShownAtMs?: number; updateShownAtMs?: number } = {}) => ({
    clock: { nowMs, enteredAtMs: 1000 },
    inputOpenAtMs: 1300,
    ...steps,
  });

  it('runs timer 0 from the entry, and timers 1 and 150 once input has opened', () => {
    expect([...resolveLR2ResultTimers(frame(1299))]).toEqual([[LR2_TIMER.SCENE_START, 1000]]);
    expect([...resolveLR2ResultTimers(frame(1300))]).toEqual([
      [LR2_TIMER.SCENE_START, 1000],
      [LR2_TIMER.START_INPUT, 1300],
      [LR2_TIMER.RESULT_GRAPH_START, 1300],
    ]);
  });

  it('runs timer 151 from when the graphs showed and timer 152 from when the record update did', () => {
    const timers = resolveLR2ResultTimers(frame(5000, { graphShownAtMs: 2000, updateShownAtMs: 4000 }));
    expect(timers.get(LR2_TIMER.RESULT_GRAPH_END)).toBe(2000);
    expect(timers.get(LR2_TIMER.RESULT_UPDATE)).toBe(4000);
    expect(resolveLR2ResultTimers(frame(1500)).has(LR2_TIMER.RESULT_GRAPH_END)).toBe(false);
  });
});

describe('resolveLR2GraphReveal', () => {
  it('shows nothing before its timer or its start, then sweeps to all of it at its end', () => {
    expect(resolveLR2GraphReveal(undefined, 500, 2000)).toBe(0);
    expect(resolveLR2GraphReveal(499, 500, 2000)).toBe(0);
    expect(resolveLR2GraphReveal(1250, 500, 2000)).toBe(0.5);
    expect(resolveLR2GraphReveal(2000, 500, 2000)).toBe(1);
    expect(resolveLR2GraphReveal(9000, 500, 2000)).toBe(1);
  });

  it('shows all of a graph whose end is not after its start, once started', () => {
    expect(resolveLR2GraphReveal(0, 0, 0)).toBe(1);
    expect(resolveLR2GraphReveal(100, 200, 200)).toBe(0);
  });
});
