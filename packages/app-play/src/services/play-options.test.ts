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
  judgeAlgorithm: 'duration',
  longNoteModifier: 'REMOVE',
  mineModifier: 'OFF',
  gaugeAutoShift: 'NONE',
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
      judgeAlgorithm: 'duration',
      longNoteModifier: 'REMOVE',
      mineModifier: 'OFF',
      gaugeAutoShift: 'NONE',
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
      random2P: 'OFF',
      dpFlip: false,
      bpmGuide: false,
      judgeTimingMs: 0,
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
      judgeAlgorithm: 'combo',
      mineModifier: 'OFF',
      gaugeAutoShift: 'NONE',
      longNoteModifier: 'OFF',
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
  test("starts from the Debug Menu's options over the defaults", () => {
    const service = new PlayOptionsService(playOptionsFromGUI(gui));
    expect(service.current).toEqual({ ...DEFAULT_PLAY_OPTIONS, ...playOptionsFromGUI(gui) });
  });

  test('keeps the options only a select screen changes, so the next select screen starts from them', () => {
    const service = new PlayOptionsService(playOptionsFromGUI(gui));
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
    expect(service.reusePreviousArrangement()).toBeUndefined();
    const replay = previous();
    service.rememberArrangement('chart-a', replay);
    replay.chart.notes[0]!.channel = '19';
    expect(service.reusePreviousArrangement()).toMatchObject({
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
    const changes = service.reusePreviousArrangement()!;
    service.update(changes);
    service.update({ hiSpeed: 3, gauge1P: 'HARD' });
    expect(service.arrangementFor('chart')).toBeDefined();
    service.update({ randomSeed1P: '7' });
    expect(service.arrangementFor('chart')).toBeUndefined();
    service.reusePreviousArrangement();
    service.clearArrangement();
    expect(service.arrangementFor('chart')).toBeUndefined();
  });
});
