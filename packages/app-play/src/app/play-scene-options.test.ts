import { createEmptyJSON } from '@be-music/chart-source';
import type { ChartFileHashes } from '@be-music/player-browser/collection';
import type { PlaySceneSettings } from '@be-music/player-browser/host';
import type { CourseConstraint, CourseDefinition, CourseKind, CourseSource } from '@be-music/player-engine/course';
import type { BeMusicReplay } from '@be-music/player-engine/replay';
import {
  DEFAULT_PLAY_OPTIONS,
  resolveCourseView,
  type LibraryChart,
  type LibraryCourse,
  type PlayOptions,
} from '@be-music/player-scene-model';
import { describe, expect, test } from 'vite-plus/test';
import { nextCourseStagePlay, startCourseRun } from '../course-flow.ts';
import { resolvePlaySceneOptions, type PlaySceneGUIState, type PlaySceneOptionsInput } from './play-scene-options.ts';
import type { NonstopPlay } from './routes/nonstop.ts';

function chartEntry(id: string): LibraryChart {
  return {
    id,
    sourceId: 'drop1',
    sourceLabel: 'pack',
    sourceKind: 'directory',
    chartPath: `${id}.bms`,
    directoryLabel: 'pack',
    fileLabel: `${id}.bms`,
    title: id,
    artist: 'artist',
    totalNotes: 10,
    chart: createEmptyJSON('bms'),
  };
}

function course(
  kind: CourseKind,
  constraints: CourseConstraint[],
  source: CourseSource = { format: 'beatoraja-json' },
): LibraryCourse {
  const definition: CourseDefinition = {
    name: 'Dan',
    kind,
    stages: [{ md5: '1'.repeat(32) }, { md5: '2'.repeat(32) }],
    constraints,
    trophies: [],
    release: true,
    source,
  };
  return {
    id: 'dan#0',
    definition,
    stages: [
      { title: 'a', chart: chartEntry('a') },
      { title: 'b', chart: chartEntry('b') },
    ],
    playable: true,
  };
}

const LR2CRS: CourseSource = { format: 'lr2crs', type: 0, header: '', hash: '' };

/** The Debug Menu as a player left it: RANDOM on 1P, FLIP, auto scratch, the EASY gauge, a slower tempo. */
function gui(changes: Partial<PlaySceneGUIState> = {}): PlaySceneGUIState {
  return {
    autoPlay: false,
    random1P: 'RANDOM',
    random2P: 'MIRROR',
    dpFlip: true,
    gauge: 'EASY',
    autoScratch1P: true,
    autoScratch2P: true,
    replayView: { tempo: true, hiSpeed: true, covers: true, lift: true },
    tempoEnabled: true,
    tempoPercent: -10,
    tempoPitchMode: 'pitch',
    tempoStretchAlgorithm: 'wsola',
    judgeRuleset: 'lr2',
    autoPauseOnBlur: false,
    hiSpeed: 2.5,
    keyVolume: 80,
    bgmVolume: 60,
    peakGain: false,
    compressor: true,
    compressorKey: true,
    compressorBGM: false,
    compressorMaster: true,
    bgaResizeMaxEdgePx: 0,
    bgaUseWebCodecs: false,
    showInvisibleNotes: false,
    judgedNoteDisplay: 'KEEP_SCROLLING',
    ...changes,
  } as PlaySceneGUIState;
}

/** The play options in force: SUDDEN on 1P, HS-FIX, a lane cover and the BGA off. */
const PLAY_OPTIONS: PlayOptions = {
  ...DEFAULT_PLAY_OPTIONS,
  hiddenSudden1P: 'SUDDEN',
  hiddenSudden2P: 'OFF',
  hsFix: 'AVERAGE',
  laneCover: true,
  bga: 'OFF',
};

const HASHES = { sha256: 'f'.repeat(64), md5: 'e'.repeat(32) } as ChartFileHashes;
const COMPRESSOR_PARAMS = {} as PlaySceneSettings['audioCompressorParams'];
const RECORDER = { name: 'be-music-web', version: '0.0.0', platform: 'web' as const };

function input(changes: Partial<PlaySceneOptionsInput> = {}): PlaySceneOptionsInput {
  return {
    guiState: gui(),
    playOptions: PLAY_OPTIONS,
    audioCompressorParams: COMPRESSOR_PARAMS,
    audioCompressorMode: 'split',
    replayRecorder: RECORDER,
    ...changes,
  };
}

/** A replay of an AUTO play at 1.2× (`null`: one with no tempo recorded), on the HARD gauge with auto scratch. */
function rereplay(tempo: number | null = 1.2): BeMusicReplay {
  return {
    play: { mode: 'auto', autoScratch: true, gauge: 'HARD', ...(tempo !== null ? { tempo } : {}) },
  } as unknown as BeMusicReplay;
}

describe('resolvePlaySceneOptions: a single play', () => {
  test('takes the Debug Menu’s picks, the play options in force and the slider’s tempo', () => {
    const { autoPlay, tempo, settings, course } = resolvePlaySceneOptions(input({ chartHashes: HASHES }));
    expect(autoPlay).toBe(false);
    expect(tempo).toBe(0.9);
    expect(course).toBeUndefined();
    expect(settings).toEqual({
      autoPlay: false,
      autoPauseOnBlur: false,
      initialHiSpeed: 2.5,
      bga: 'OFF',
      bgaSize: PLAY_OPTIONS.bgaSize,
      scoreGraph: PLAY_OPTIONS.scoreGraph,
      hsFix: 'AVERAGE',
      bpmGuide: false,
      normalHiSpeedLevel: 0,
      classicHiSpeed: false,
      judgeAlgorithm: 'combo',
      longNoteModifier: 'OFF',
      hiddenSudden1P: 'SUDDEN',
      hiddenSudden2P: 'OFF',
      shutter: PLAY_OPTIONS.shutter,
      laneCover: true,
      autoScratch1P: true,
      autoScratch2P: true,
      dpFlip: true,
      random1P: 'RANDOM',
      random2P: 'MIRROR',
      gauge: 'EASY',
      tempo: 0.9,
      tempoPitchMode: 'pitch',
      tempoStretchAlgorithm: 'wsola',
      judgeRuleset: 'lr2',
      chartSHA256: HASHES.sha256,
      chartMD5: HASHES.md5,
      replayRecorder: RECORDER,
      replayView: { tempo: true, hiSpeed: true, covers: true, lift: true },
      audioVolumes: { key: 0.8, bgm: 0.6 },
      audioCompressorParams: COMPRESSOR_PARAMS,
      audioCompressor: true,
      audioCompressorMode: 'split',
      audioCompressorStages: { key: true, bgm: false, master: true },
      bgaTranscodeMaxLongEdgePx: undefined,
      bgaTranscodeUseWebCodecs: false,
      showInvisibleNotes: false,
      judgedNoteDisplay: 'KEEP_SCROLLING',
    });
  });

  test('passes peak gain only when the Debug Menu turned it on', () => {
    expect(resolvePlaySceneOptions(input()).settings.peakGain).toBeUndefined();
    expect(resolvePlaySceneOptions(input({ guiState: gui({ peakGain: true }) })).settings.peakGain).toBe(true);
  });

  test('bypasses the stored percentage when disabled but preserves replay tempo', () => {
    const guiState = gui({ tempoEnabled: false, tempoPercent: -20 });
    expect(resolvePlaySceneOptions(input({ guiState })).tempo).toBe(1);
    expect(resolvePlaySceneOptions(input({ guiState, replay: rereplay(1.2) })).tempo).toBe(1.2);
    guiState.tempoEnabled = true;
    expect(resolvePlaySceneOptions(input({ guiState })).tempo).toBe(0.8);
  });

  test('the start’s AUTO wins over the Debug Menu’s; without one the Debug Menu’s counts', () => {
    expect(resolvePlaySceneOptions(input({ autoPlay: true })).autoPlay).toBe(true);
    expect(resolvePlaySceneOptions(input({ autoPlay: true })).settings.autoPlay).toBe(true);
    expect(resolvePlaySceneOptions(input({ autoPlay: false, guiState: gui({ autoPlay: true }) })).autoPlay).toBe(false);
    expect(resolvePlaySceneOptions(input({ guiState: gui({ autoPlay: true }) })).autoPlay).toBe(true);
  });

  test('a play with no chart hashes records none', () => {
    const { settings } = resolvePlaySceneOptions(input());
    expect(settings).not.toHaveProperty('chartSHA256');
    expect(settings).not.toHaveProperty('chartMD5');
  });

  test('a BGA resize cap passes on when set, and the replay view is a copy the play cannot change', () => {
    const guiState = gui({ bgaResizeMaxEdgePx: 720 });
    const { settings } = resolvePlaySceneOptions(input({ guiState }));
    expect(settings.bgaTranscodeMaxLongEdgePx).toBe(720);
    expect(settings.replayView).toEqual(guiState.replayView);
    expect(settings.replayView).not.toBe(guiState.replayView);
  });
});

describe('resolvePlaySceneOptions: a replay', () => {
  test('plays the recorded setup: no lane transforms, the log’s auto scratch and gauge, no judge of its own', () => {
    const { settings } = resolvePlaySceneOptions(input({ replay: rereplay() }));
    expect(settings).toMatchObject({
      random1P: 'OFF',
      random2P: 'OFF',
      dpFlip: false,
      autoScratch1P: true,
      autoScratch2P: true,
      gauge: 'HARD',
    });
    expect(settings).not.toHaveProperty('judgeRuleset');
  });

  test('runs at the tempo its log recorded, or the viewer’s own when the Replay / ghost options keep it', () => {
    expect(resolvePlaySceneOptions(input({ replay: rereplay() })).tempo).toBe(1.2);
    expect(resolvePlaySceneOptions(input({ replay: rereplay(null) })).tempo).toBe(1);
    const own = gui({ replayView: { tempo: false, hiSpeed: true, covers: true, lift: true } });
    expect(resolvePlaySceneOptions(input({ replay: rereplay(), guiState: own })).tempo).toBe(0.9);
  });
});

describe('resolvePlaySceneOptions: a course', () => {
  test('a stage plays with the lane options its course allows, and is handed the stage and the course view', () => {
    const active = startCourseRun(course('grade', ['grade']));
    const courseStage = nextCourseStagePlay(active)!;
    const { tempo, settings, course: stage } = resolvePlaySceneOptions(input({ courseStage, activeCourse: active }));
    expect(settings).toMatchObject({ random1P: 'OFF', random2P: 'OFF', dpFlip: false, gauge: 'EASY' });
    expect(settings.hiSpeedLocked).toBe(false);
    expect(tempo).toBe(0.9);
    expect(stage).toEqual({ stage: courseStage.course, view: courseStage.courseInfo });
  });

  test('a stage of a course that locks the hi-speed says so', () => {
    const active = startCourseRun(course('grade', ['grade', 'no_speed']));
    const courseStage = nextCourseStagePlay(active)!;
    expect(resolvePlaySceneOptions(input({ courseStage, activeCourse: active })).settings.hiSpeedLocked).toBe(true);
  });

  test('an LR2 GRADE course also turns off what LR2 turns off, the tempo included', () => {
    const active = startCourseRun(course('grade', [], LR2CRS));
    const courseStage = nextCourseStagePlay(active)!;
    const { tempo, settings } = resolvePlaySceneOptions(input({ courseStage, activeCourse: active }));
    expect(tempo).toBe(1);
    expect(settings).toMatchObject({
      tempo: 1,
      gauge: 'GROOVE',
      hiddenSudden1P: 'OFF',
      hiddenSudden2P: 'OFF',
      autoScratch1P: false,
      autoScratch2P: false,
      dpFlip: false,
      // A GRADE course with no lane constraint keeps the player's lane options.
      random1P: 'RANDOM',
    });
  });

  test('a stage with no course running keeps the player’s picks', () => {
    const courseStage = nextCourseStagePlay(startCourseRun(course('grade', ['grade'])))!;
    const { settings } = resolvePlaySceneOptions(input({ courseStage }));
    expect(settings).toMatchObject({ random1P: 'RANDOM', random2P: 'MIRROR', dpFlip: true });
  });

  test('a NONSTOP run is limited by its course too, and plays as its one stage with its stitched map', () => {
    const nonstopCourse = course('nonstop', ['grade_mirror']);
    const map = { stages: [] };
    const nonstop = { course: nonstopCourse, prepared: { stitched: { map } } } as unknown as NonstopPlay;
    const { settings, course: stage } = resolvePlaySceneOptions(input({ nonstop }));
    // `grade_mirror` keeps MIRROR only: RANDOM is turned off.
    expect(settings).toMatchObject({ random1P: 'OFF', random2P: 'OFF', dpFlip: false, nonstop: map });
    expect(settings).not.toHaveProperty('hiSpeedLocked');
    expect(stage).toEqual({ stage: { kind: 'nonstop' }, view: resolveCourseView(nonstopCourse, 0) });
  });
});

test('replay setup retains an explicitly unassisted DP side', () => {
  const replay = rereplay();
  replay.play.autoScratch1P = false;
  replay.play.autoScratch2P = true;
  const { settings } = resolvePlaySceneOptions(input({ replay }));
  expect(settings.autoScratch1P).toBe(false);
  expect(settings.autoScratch2P).toBe(true);
});
