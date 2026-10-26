import type { BeMusicReplay } from '@be-music/player-engine/replay';
import { DEFAULT_PLAY_OPTIONS, type PlayOptions } from '@be-music/player-scene-model';
import { describe, expect, test } from 'vite-plus/test';
import { copyPlayOptionsToGUI, playOptionsFromGUI, PlayOptionsService, type GUIPlayOptions } from './play-options.ts';

const gui: GUIPlayOptions = {
  autoPlay: true,
  gauge: 'HARD',
  random1P: 'MIRROR',
  hRandomThresholdBPM: 120,
  randomSeed1P: '-1',
  randomSeed2P: '-1',
  randomFixedLane1P: 0,
  randomFixedLane2P: 0,
  random2P: 'RANDOM',
  dpFlip: true,
  bpmGuide: true,
  judgeTimingMs: 0,
  judgeTimingAutoAdjust: false,
  visualConstant: false,
  noteDurationMs: 500,
  lift1P: 0.1,
  lift2P: 0.1,
  liftOn1P: false,
  liftOn2P: false,

  constantFadeMs: 100,
  normalHiSpeedLevel: 0,
  classicHiSpeed: true,
  floatingHiSpeed: false,
  fixedDisplayArea: false,
  judgeAlgorithm: 'duration',
  longNoteModifier: 'REMOVE',
  longNoteRate: 1,
  extraNoteDepth: 0,
  extraNoteScratch: false,
  sevenToNinePattern: 0,
  sevenToNineType: 0,
  battleMode: 'OFF',
  dBattleScratch: false,
  gauge2P: 'GROOVE',
  mRan1P: false,
  mRan2P: false,
  longNoteMode: 'LN',
  customJudge: false,
  practice: false,
  practiceStartMs: 0,
  practiceEndMs: 0,
  practiceGauge: 'NORMAL',
  practiceGaugeCategory: 'MODE',
  practiceStartGauge: 20,
  practiceJudgeRank: 0,
  practiceTotal: 0,
  customJudgeKeyPerfectGreat: 400,
  customJudgeKeyGreat: 400,
  customJudgeKeyGood: 100,
  customJudgeScratchPerfectGreat: 400,
  customJudgeScratchGreat: 400,
  customJudgeScratchGood: 100,
  customJudgeLongNoteMargin: 100,
  lr2ExtraMode: false,
  lr2ExtraLevel: 0,
  mineModifier: 'OFF',
  scrollModifier: 'OFF',
  scrollSection: 4,
  scrollRate: 0.5,
  gaugeAutoShift: 'NONE',
  bottomShiftableGauge: 'ASSIST-EASY',
  autoScratch1P: true,
  autoScratch2P: false,
  sort: 'LEVEL',
  keysFilter: 'KEYS_7',
  difficultyFilter: 'HYPER',
  hiSpeed: 3.5,
  hsFix: 'STARTBPM',
  displayAreaInfo: 'ON',
  hiddenSudden1P: 'SUDDEN',
  hiddenSudden2P: 'HID+SUD',
  laneCover: true,
  shutter: 0.4,
};

describe('playOptionsFromGUI', () => {
  test("names the Debug Menu's play options as PlayOptions fields", () => {
    expect(playOptionsFromGUI(gui)).toEqual({
      autoPlay: true,
      gauge1P: 'HARD',
      random1P: 'MIRROR',
      hRandomThresholdBPM: 120,
      randomSeed1P: '-1',
      randomSeed2P: '-1',
      randomFixedLane1P: 0,
      randomFixedLane2P: 0,
      random2P: 'RANDOM',
      dpFlip: true,
      bpmGuide: true,
      judgeTimingMs: 0,
      judgeTimingAutoAdjust: false,
      visualConstant: false,
      noteDurationMs: 500,
      lift1P: 0.1,
      lift2P: 0.1,
      liftOn1P: false,
      liftOn2P: false,

      constantFadeMs: 100,
      normalHiSpeedLevel: 0,
      classicHiSpeed: true,
      floatingHiSpeed: false,
      fixedDisplayArea: false,
      judgeAlgorithm: 'duration',
      longNoteModifier: 'REMOVE',
      longNoteRate: 1,
      extraNoteDepth: 0,
      extraNoteScratch: false,
      sevenToNinePattern: 0,
      sevenToNineType: 0,
      battleMode: 'OFF',
      dBattleScratch: false,
      gauge2P: 'GROOVE',
      mRan1P: false,
      mRan2P: false,
      longNoteMode: 'LN',
      customJudge: false,
      practice: false,
      practiceStartMs: 0,
      practiceEndMs: 0,
      practiceGauge: 'NORMAL',
      practiceGaugeCategory: 'MODE',
      practiceStartGauge: 20,
      practiceJudgeRank: 0,
      practiceTotal: 0,
      customJudgeKeyPerfectGreat: 400,
      customJudgeKeyGreat: 400,
      customJudgeKeyGood: 100,
      customJudgeScratchPerfectGreat: 400,
      customJudgeScratchGreat: 400,
      customJudgeScratchGood: 100,
      customJudgeLongNoteMargin: 100,
      lr2ExtraMode: false,
      lr2ExtraLevel: 0,
      mineModifier: 'OFF',
      scrollModifier: 'OFF',
      scrollSection: 4,
      scrollRate: 0.5,
      gaugeAutoShift: 'NONE',
      bottomShiftableGauge: 'ASSIST-EASY',
      autoScratch1P: true,
      autoScratch2P: false,
      sort: 'LEVEL',
      keysFilter: 'KEYS_7',
      difficultyFilter: 'HYPER',
      hiSpeed: 3.5,
      hsFix: 'STARTBPM',
      displayAreaInfo: 'ON',
      hiddenSudden1P: 'SUDDEN',
      hiddenSudden2P: 'HID+SUD',
      laneCover: true,
      shutter: 0.4,
    });
  });
});

describe('copyPlayOptionsToGUI', () => {
  test("mirrors a select screen's options into the Debug Menu's state, leaving the hi-speed to the caller", () => {
    const state: GUIPlayOptions = { ...gui, hiSpeed: 2 };
    const options: PlayOptions = {
      ...DEFAULT_PLAY_OPTIONS,
      autoPlay: false,
      gauge1P: 'EASY',
      random1P: 'S-RANDOM',
      sort: 'TITLE',
      hiSpeed: 4,
    };
    copyPlayOptionsToGUI(options, state);
    expect(state).toEqual({
      autoPlay: false,
      gauge: 'EASY',
      random1P: 'S-RANDOM',
      hRandomThresholdBPM: 120,
      randomSeed1P: '-1',
      randomSeed2P: '-1',
      randomFixedLane1P: 0,
      randomFixedLane2P: 0,
      random2P: 'OFF',
      dpFlip: false,
      bpmGuide: false,
      judgeTimingMs: 0,
      judgeTimingAutoAdjust: false,
      visualConstant: false,
      noteDurationMs: 500,
      lift1P: 0.1,
      lift2P: 0.1,
      liftOn1P: false,
      liftOn2P: false,

      constantFadeMs: 100,
      normalHiSpeedLevel: 0,
      classicHiSpeed: false,
      floatingHiSpeed: false,
      fixedDisplayArea: false,
      judgeAlgorithm: 'combo',
      mineModifier: 'OFF',
      scrollModifier: 'OFF',
      scrollSection: 4,
      scrollRate: 0.5,
      gaugeAutoShift: 'NONE',
      bottomShiftableGauge: 'ASSIST-EASY',
      longNoteModifier: 'OFF',
      longNoteRate: 1,
      extraNoteDepth: 0,
      extraNoteScratch: false,
      sevenToNinePattern: 0,
      sevenToNineType: 0,
      battleMode: 'OFF',
      dBattleScratch: false,
      gauge2P: 'GROOVE',
      mRan1P: false,
      mRan2P: false,
      longNoteMode: 'LN',
      customJudge: false,
      practice: false,
      practiceStartMs: 0,
      practiceEndMs: 0,
      practiceGauge: 'NORMAL',
      practiceGaugeCategory: 'MODE',
      practiceStartGauge: 20,
      practiceJudgeRank: 0,
      practiceTotal: 0,
      customJudgeKeyPerfectGreat: 400,
      customJudgeKeyGreat: 400,
      customJudgeKeyGood: 100,
      customJudgeScratchPerfectGreat: 400,
      customJudgeScratchGreat: 400,
      customJudgeScratchGood: 100,
      customJudgeLongNoteMargin: 100,
      lr2ExtraMode: false,
      lr2ExtraLevel: 0,
      autoScratch1P: false,
      autoScratch2P: false,
      sort: 'TITLE',
      keysFilter: 'ALL',
      difficultyFilter: 'ALL',
      hiSpeed: 2,
      hsFix: 'OFF',
      displayAreaInfo: 'OFF',
      hiddenSudden1P: 'OFF',
      hiddenSudden2P: 'OFF',
      laneCover: false,
      shutter: 0.25,
    });
  });
});

describe('PlayOptionsService', () => {
  // The AC normal hi-speed (`classicHiSpeed`) has no HS-FIX, so these play on the regular one to keep it.
  const regular: GUIPlayOptions = { ...gui, classicHiSpeed: false };

  test("starts from the Debug Menu's options over the defaults", () => {
    const service = new PlayOptionsService(playOptionsFromGUI(regular));
    expect(service.current).toEqual({ ...DEFAULT_PLAY_OPTIONS, ...playOptionsFromGUI(regular) });
    expect(new PlayOptionsService(playOptionsFromGUI(gui)).current.hsFix).toBe('OFF');
  });

  test('keeps the options only a select screen changes, so the next select screen starts from them', () => {
    const service = new PlayOptionsService(playOptionsFromGUI(regular));
    // A select screen reports its whole set (`on.playOptions`): HS-FIX, SUDDEN and the lane cover changed on it.
    service.update({ ...service.current, hsFix: 'MAXBPM', hiddenSudden1P: 'SUDDEN', laneCover: true, shutter: 0.3 });
    // A Debug Menu change of another option leaves them alone.
    service.update({ gauge1P: 'DEATH' });
    expect(service.current).toMatchObject({
      gauge1P: 'DEATH',
      hsFix: 'MAXBPM',
      hiddenSudden1P: 'SUDDEN',
      laneCover: true,
      shutter: 0.3,
    });
  });

  test('checks a change as the select screen does: a value an option does not take puts it back to its default', () => {
    const service = new PlayOptionsService({
      random1P: 'MIRROR',
      hRandomThresholdBPM: 120,
      randomSeed1P: '-1',
      randomSeed2P: '-1',
      randomFixedLane1P: 0,
      randomFixedLane2P: 0,
      hiSpeed: 2,
    });
    service.update({ random1P: 'BACKWARDS' as PlayOptions['random1P'], hiSpeed: 2.0000000001 });
    expect(service.current.random1P).toBe(DEFAULT_PLAY_OPTIONS.random1P);
    expect(service.current.hiSpeed).toBe(2);
  });

  test('hands out copies, so a reader cannot change the options in force', () => {
    const service = new PlayOptionsService();
    const read = service.current;
    read.autoPlay = true;
    expect(service.current.autoPlay).toBe(false);
  });
});

describe('previous arrangement selection', () => {
  const previous = () =>
    ({
      chart: { notes: [{ type: 'normal', channel: '12', timeUs: 0, wav: '01' }] },
      play: {
        judgeRuleset: 'beatoraja',
        randomLane: { p1: 'RANDOM' },
        dpFlip: true,
        options: {
          random1P: 'RANDOM',
          randomSeed1P: '9223372036854775807',
          hiSpeed: 4,
          gauge1P: 'HARD',
          autoPlay: true,
        },
      },
      inputs: [{ kind: 'press', channel: '12', timeUs: 0 }],
    }) as unknown as BeMusicReplay;
  test('pins chart-specific lanes while preserving the current input, speed and gauge selections', () => {
    const service = new PlayOptionsService({ autoPlay: false, hiSpeed: 2, gauge1P: 'EASY' });
    expect(service.reusePreviousArrangement('beatoraja')).toBeUndefined();
    const replay = previous();
    service.rememberArrangement('chart-a', replay);
    replay.chart.notes[0]!.channel = '19';
    expect(service.reusePreviousArrangement('beatoraja')).toMatchObject({
      random1P: 'RANDOM',
      randomSeed1P: '9223372036854775807',
      dpFlip: true,
    });
    expect(service.current).toMatchObject({ autoPlay: false, hiSpeed: 2, gauge1P: 'EASY' });
    expect(service.arrangementFor('chart-a')?.chart.notes[0]!.channel).toBe('12');
    expect(service.arrangementFor('chart-b')).toBeUndefined();
    expect(service.arrangementFor('chart-a')).not.toHaveProperty('inputs');
    const copy = service.arrangementFor('chart-a')!;
    copy.chart.notes[0]!.channel = '11';
    expect(service.arrangementFor('chart-a')?.chart.notes[0]!.channel).toBe('12');
  });
  test('keeps a pin for display/gauge edits and idempotent option synchronization, clearing it on lane edits', () => {
    const service = new PlayOptionsService();
    service.rememberArrangement('chart', previous());
    const changes = service.reusePreviousArrangement('beatoraja')!;
    service.update(changes);
    service.update({ hiSpeed: 3, gauge1P: 'HARD' });
    expect(service.arrangementFor('chart')).toBeDefined();
    service.update({ randomSeed1P: '7' });
    expect(service.arrangementFor('chart')).toBeUndefined();
    service.reusePreviousArrangement('beatoraja');
    service.clearArrangement();
    expect(service.arrangementFor('chart')).toBeUndefined();
  });
  test('restores EXTRA parameters and clears previous layout on a parameter change', () => {
    const service = new PlayOptionsService();
    const replay = previous();
    replay.play.extraNoteDepth = 2;
    replay.play.extraNoteScratch = true;
    service.rememberArrangement('chart', replay);
    expect(service.reusePreviousArrangement('beatoraja')).toMatchObject({ extraNoteDepth: 2, extraNoteScratch: true });
    expect(service.arrangementFor('chart')).toBeDefined();
    service.update({ extraNoteDepth: 3 });
    expect(service.arrangementFor('chart')).toBeUndefined();
    service.reusePreviousArrangement('beatoraja');
    service.update({ extraNoteScratch: false });
    expect(service.arrangementFor('chart')).toBeUndefined();
  });
  test('retains a play under any judge rules and reuses it only under the same rules', () => {
    const service = new PlayOptionsService();
    const replay = previous();
    replay.play.judgeRuleset = 'lr2';
    replay.play.randomLane = { p1: 'SPIRAL' };
    service.rememberArrangement('chart', replay);
    expect(service.reusePreviousArrangement('beatoraja')).toBeUndefined();
    expect(service.arrangementFor('chart')).toBeUndefined();
    expect(service.reusePreviousArrangement('lr2')).toMatchObject({ random1P: 'SPIRAL' });
    expect(service.arrangementFor('chart')?.play.judgeRuleset).toBe('lr2');
  });
  test('restores the source addition rate and clears the pinned layout when that rate changes', () => {
    const service = new PlayOptionsService();
    const replay = previous();
    replay.play.longNoteModifier = 'ADD_LN';
    replay.play.longNoteRate = 0.375;
    service.rememberArrangement('chart', replay);
    expect(service.reusePreviousArrangement('beatoraja')).toMatchObject({
      longNoteModifier: 'ADD_LN',
      longNoteRate: 0.375,
    });
    expect(service.arrangementFor('chart')).toBeDefined();
    service.update({ longNoteRate: 0.5 });
    expect(service.arrangementFor('chart')).toBeUndefined();
  });
});

test('scroll REMOVE transfers between GUI and play options independently of visual CONSTANT', () => {
  const state = { ...gui, scrollModifier: 'REMOVE' as const, visualConstant: false };
  expect(playOptionsFromGUI(state)).toMatchObject({ scrollModifier: 'REMOVE', visualConstant: false });
  const restored = { ...gui };
  copyPlayOptionsToGUI({ ...DEFAULT_PLAY_OPTIONS, scrollModifier: 'REMOVE' }, restored);
  expect(restored.scrollModifier).toBe('REMOVE');
});

test('previous arrangement restores scroll ADD parameters, and editing either parameter unpins it', () => {
  const replay = {
    chart: { notes: [] },
    play: { judgeRuleset: 'beatoraja', scrollModifier: 'ADD', scrollSection: 8, scrollRate: 0.25 },
  } as unknown as BeMusicReplay;
  for (const change of [{ scrollSection: 4 }, { scrollRate: 0.5 }]) {
    const service = new PlayOptionsService();
    service.rememberArrangement('chart', replay);
    expect(service.reusePreviousArrangement('beatoraja')).toMatchObject({
      scrollModifier: 'ADD',
      scrollSection: 8,
      scrollRate: 0.25,
    });
    expect(service.arrangementFor('chart')).toBeDefined();
    service.update(change);
    expect(service.arrangementFor('chart')).toBeUndefined();
  }
});

test('LR2 EXTRA transfers independently through GUI options', () => {
  const state = { ...gui, lr2ExtraMode: true, lr2ExtraLevel: 2 as const };
  expect(playOptionsFromGUI(state)).toMatchObject({ lr2ExtraMode: true, lr2ExtraLevel: 2, extraNoteDepth: 0 });
  const restored = { ...gui };
  copyPlayOptionsToGUI({ ...DEFAULT_PLAY_OPTIONS, lr2ExtraMode: true, lr2ExtraLevel: 1 }, restored);
  expect(restored).toMatchObject({ lr2ExtraMode: true, lr2ExtraLevel: 1 });
});

test('battle conversion transfers independently through GUI options', () => {
  expect(playOptionsFromGUI({ ...gui, battleMode: 'SP-TO-DP' })).toMatchObject({ battleMode: 'SP-TO-DP' });
  const restored = { ...gui };
  copyPlayOptionsToGUI({ ...DEFAULT_PLAY_OPTIONS, battleMode: 'SP-TO-DP' }, restored);
  expect(restored.battleMode).toBe('SP-TO-DP');
});

test('7-to-9 GUI selections survive both directions of play option transfer', () => {
  expect(playOptionsFromGUI({ ...gui, sevenToNinePattern: 6, sevenToNineType: 2 })).toMatchObject({
    sevenToNinePattern: 6,
    sevenToNineType: 2,
  });
  const restored = { ...gui };
  copyPlayOptionsToGUI({ ...DEFAULT_PLAY_OPTIONS, sevenToNinePattern: 6, sevenToNineType: 2 }, restored);
  expect(restored).toMatchObject({ sevenToNinePattern: 6, sevenToNineType: 2 });
});
