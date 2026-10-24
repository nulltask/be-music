import { DEFAULT_PLAY_OPTIONS, type PlayOptions } from '@be-music/player-scene-model';
import { describe, expect, test } from 'vite-plus/test';
import { copyPlayOptionsToGUI, playOptionsFromGUI, PlayOptionsService, type GUIPlayOptions } from './play-options.ts';

const gui: GUIPlayOptions = {
  autoPlay: true,
  gauge: 'HARD',
  random1P: 'MIRROR',
  random2P: 'RANDOM',
  dpFlip: true,
  bpmGuide: true,
  judgeTimingMs: 0,
  visualConstant: false,
  noteDurationMs: 500,
  constantFadeMs: 100,
  normalHiSpeedLevel: 0,
  classicHiSpeed: true,
  judgeAlgorithm: 'duration',
  longNoteModifier: 'REMOVE',
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
      random2P: 'RANDOM',
      dpFlip: true,
      bpmGuide: true,
      judgeTimingMs: 0,
      visualConstant: false,
      noteDurationMs: 500,
      constantFadeMs: 100,
      normalHiSpeedLevel: 0,
      classicHiSpeed: true,
      judgeAlgorithm: 'duration',
      longNoteModifier: 'REMOVE',
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
      constantFadeMs: 100,
      normalHiSpeedLevel: 0,
      classicHiSpeed: false,
      judgeAlgorithm: 'combo',
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
    const service = new PlayOptionsService({ random1P: 'MIRROR', hiSpeed: 2 });
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
