// What a play is made with, apart from its chart, its kit and where it leads (`createPlayScene`): the Debug Menu's
// picks and the play options in force, with a course's lane limits, a replay's recorded setup and the tempo the play
// runs at. Pure, so the rules are tested without a scene.

import type { ChartFileHashes } from '@be-music/player-browser/collection';
import type { PlaySceneCourse, PlaySceneSettings } from '@be-music/player-browser/host';
import { resolveCourseStagePlaySettings, resolveCourseStageSettings } from '@be-music/player-engine/course';
import type { BeMusicReplay, ReplayRecorderInfo } from '@be-music/player-engine/replay';
import { resolvePlayOptions, resolveCourseView, type PlayOptions } from '@be-music/player-scene-model';
import type { ActiveCourse, CourseStagePlay } from '../course-flow.ts';
import { tempoFromPercent } from '../play-tempo-settings.ts';
import type { PlayerGUIState } from '../types.ts';
import type { NonstopPlay } from './routes/nonstop.ts';

/** The Debug Menu's state a play is made with: its lane, gauge, tempo, audio and debug options. */
export type PlaySceneGUIState = Pick<
  PlayerGUIState,
  | 'autoPlay'
  | 'random1P'
  | 'random2P'
  | 'dpFlip'
  | 'gauge'
  | 'autoScratch1P'
  | 'autoScratch2P'
  | 'replayView'
  | 'tempoEnabled'
  | 'tempoPercent'
  | 'tempoPitchMode'
  | 'tempoStretchAlgorithm'
  | 'judgeRuleset'
  | 'autoPauseOnBlur'
  | 'hiSpeed'
  | 'judgeTimingMs'
  | 'normalHiSpeedLevel'
  | 'keyVolume'
  | 'bgmVolume'
  | 'peakGain'
  | 'compressor'
  | 'compressorKey'
  | 'compressorBGM'
  | 'compressorMaster'
  | 'bgaResizeMaxEdgePx'
  | 'bgaUseWebCodecs'
  | 'showInvisibleNotes'
  | 'judgedNoteDisplay'
>;

export interface PlaySceneOptionsInput {
  /** The Debug Menu's state. */
  readonly guiState: PlaySceneGUIState;
  /** The play options in force (`PlayOptionsService.current`): the covers, HS-FIX, BGA and score graph. */
  readonly playOptions: PlayOptions;
  /** The start's AUTO; the Debug Menu's when it set none. */
  readonly autoPlay?: boolean;
  /** A replay to play back instead of the player's input. */
  readonly replay?: BeMusicReplay;
  readonly fixedArrangement?: Pick<BeMusicReplay, 'chart' | 'play'>;
  /** The chart file's hashes, which the replay records. */
  readonly chartHashes?: ChartFileHashes;
  /** The EXPERT / GRADE course stage this play is. */
  readonly courseStage?: CourseStagePlay;
  /** The EXPERT / GRADE course being played, whose run limits a stage's lane options. */
  readonly activeCourse?: Pick<ActiveCourse, 'run'>;
  /** The NONSTOP course whose stitched chart this play is. */
  readonly nonstop?: NonstopPlay;
  /** The compressor's parameters as the Debug Menu tunes them. */
  readonly audioCompressorParams: PlaySceneSettings['audioCompressorParams'];
  /** The compressor architecture every play mounts with (`?compressor=`). */
  readonly audioCompressorMode: 'split' | 'legacy';
  /** This app as the recorder of its replays. */
  readonly replayRecorder: Omit<ReplayRecorderInfo, 'engine'>;
}

/** A play's settings and course, and the AUTO and tempo it runs with, which its record keys depend on. */
export interface PlaySceneOptions {
  readonly autoPlay: boolean;
  /** The tempo the play starts at: the slider's, a replay's recorded one, or 1 on an LR2 GRADE course. */
  readonly tempo: number;
  readonly settings: PlaySceneSettings;
  /** The course stage the play is: an EXPERT / GRADE stage, or a NONSTOP run as one stage. */
  readonly course?: PlaySceneCourse;
}

/**
 * The settings a play is made with: the Debug Menu's picks and the play options in force, the lane options limited to
 * what a course allows, a replay's recorded setup in place of the player's, and the tempo chosen.
 */
export function resolvePlaySceneOptions(input: PlaySceneOptionsInput): PlaySceneOptions {
  const { guiState, replay, courseStage, nonstop } = input;
  const playOptions = replay?.play.options
    ? resolvePlayOptions({ ...input.playOptions, ...replay.play.options })
    : input.playOptions;
  const autoPlay = input.autoPlay ?? guiState.autoPlay;
  // A course limits the lane options (both sides and DP FLIP) to what its constraint allows (`grade` none,
  // `grade_mirror` MIRROR, ...), a NONSTOP course's stitched play included, and an LR2 GRADE course also turns off
  // what LR2 turns off when one starts (EASY gauge, HIDDEN / SUDDEN, auto scratch, FLIP, the tempo).
  const picked = {
    random1P: guiState.random1P,
    random2P: guiState.random2P,
    dpFlip: guiState.dpFlip,
    gauge: guiState.gauge,
    hiddenSudden1P: playOptions.hiddenSudden1P,
    hiddenSudden2P: playOptions.hiddenSudden2P,
    autoScratch1P: guiState.autoScratch1P,
    autoScratch2P: guiState.autoScratch2P,
    tempo:
      replay !== undefined && guiState.replayView.tempo
        ? (replay.play.tempo ?? 1)
        : tempoFromPercent(guiState.tempoEnabled ? guiState.tempoPercent : 0),
  };
  const lanes =
    input.activeCourse !== undefined && courseStage !== undefined
      ? input.activeCourse.run.playSettings(picked)
      : nonstop !== undefined
        ? resolveCourseStagePlaySettings(nonstop.course.definition, picked)
        : picked;
  const tempo = lanes.tempo;
  const sharedOptions = {
    ...(input.fixedArrangement !== undefined ? { fixedArrangement: input.fixedArrangement } : {}),
    // The replay-relevant options (auto play / random / DP flip / auto scratch / gauge / judge) read from
    // `guiState` — the Debug Menu's "Play options" folder and the LR2 select panel two-way sync into it, and it
    // is the surface that exists on every family (default / beatoraja selects have no LR2 PLAY OPTION panel).
    autoPlay,
    autoPauseOnBlur: guiState.autoPauseOnBlur,
    // The remembered hi-speed (two-way synced with the LR2 select panel's HS); in-play changes come back to be
    // remembered for the next play.
    initialHiSpeed: guiState.hiSpeed,
    bga: playOptions.bga,
    bgaSize: playOptions.bgaSize,
    scoreGraph: playOptions.scoreGraph,
    hsFix: playOptions.classicHiSpeed || playOptions.normalHiSpeedLevel > 0 ? ('OFF' as const) : playOptions.hsFix,
    bpmGuide: playOptions.bpmGuide,
    judgeTimingAutoAdjust: playOptions.judgeTimingAutoAdjust,
    classicHiSpeed: playOptions.classicHiSpeed,
    visualConstant: playOptions.visualConstant,
    noteDurationMs: playOptions.noteDurationMs,
    lift1P: playOptions.lift1P,
    lift2P: playOptions.lift2P,
    liftOn1P: playOptions.liftOn1P,
    liftOn2P: playOptions.liftOn2P,

    constantFadeMs: playOptions.constantFadeMs,
    judgeTimingMs: playOptions.judgeTimingMs,
    normalHiSpeedLevel: playOptions.normalHiSpeedLevel,
    floatingHiSpeed: playOptions.floatingHiSpeed,
    fixedDisplayArea: playOptions.fixedDisplayArea,
    hRandomThresholdBPM: playOptions.hRandomThresholdBPM,
    randomSeed1P: playOptions.randomSeed1P,
    randomSeed2P: playOptions.randomSeed2P,
    randomFixedLane1P: playOptions.randomFixedLane1P,
    randomFixedLane2P: playOptions.randomFixedLane2P,
    judgeAlgorithm: replay?.play.judgeAlgorithm ?? playOptions.judgeAlgorithm,
    longNoteModifier: playOptions.longNoteModifier,
    mineModifier: playOptions.mineModifier,
    scrollModifier: playOptions.scrollModifier,
    scrollSection: playOptions.scrollSection,
    scrollRate: playOptions.scrollRate,
    longNoteRate: playOptions.longNoteRate,
    battleMode: playOptions.battleMode,
    lr2ExtraMode: playOptions.lr2ExtraMode,
    lr2ExtraLevel: playOptions.lr2ExtraLevel,
    extraNoteDepth: playOptions.extraNoteDepth,
    extraNoteScratch: playOptions.extraNoteScratch,
    gaugeAutoShift: playOptions.gaugeAutoShift,
    bottomShiftableGauge: playOptions.bottomShiftableGauge,
    hiddenSudden1P: lanes.hiddenSudden1P,
    hiddenSudden2P: lanes.hiddenSudden2P,
    shutter: playOptions.shutter,
    laneCover: playOptions.laneCover,
    // Replay playback restores the RECORDED play setup: the log's auto-scratch / gauge / judge ruleset govern
    // judging and the gauge readout, and the lane transforms stay off because the view re-applies the recorded
    // arrangement directly (see `PlaySceneOptions.replay`).
    autoScratch1P: replay !== undefined ? (replay.play.autoScratch1P ?? replay.play.autoScratch) : lanes.autoScratch1P,
    autoScratch2P: replay !== undefined ? (replay.play.autoScratch2P ?? replay.play.autoScratch) : lanes.autoScratch2P,
    dpFlip: replay !== undefined ? false : lanes.dpFlip,
    random1P: replay !== undefined ? ('OFF' as const) : lanes.random1P,
    random2P: replay !== undefined ? ('OFF' as const) : lanes.random2P,
    gauge: replay !== undefined ? replay.play.gauge : lanes.gauge,
    ...(courseStage !== undefined
      ? { course: courseStage.course, courseInfo: courseStage.courseInfo, hiSpeedLocked: courseStage.hiSpeedLocked }
      : {}),
    ...(nonstop !== undefined
      ? {
          course: resolveCourseStageSettings(nonstop.course.definition),
          courseInfo: resolveCourseView(nonstop.course, 0),
          nonstop: nonstop.prepared.stitched.map,
        }
      : {}),
    // A replay plays at the tempo its log recorded (the scene reads it from `replay`); the pitch setting applies to
    // the song tempo and NONSTOP FIT stages alike.
    tempo,
    tempoPitchMode: guiState.tempoPitchMode,
    tempoStretchAlgorithm: guiState.tempoStretchAlgorithm,
    ...(replay === undefined ? { judgeRuleset: guiState.judgeRuleset } : {}),
    ...(input.chartHashes !== undefined
      ? { chartSHA256: input.chartHashes.sha256, chartMD5: input.chartHashes.md5 }
      : {}),
    replayRecorder: input.replayRecorder,
    // What the replay shows of the recorded view (the Debug Menu's "Replay / ghost" toggles, latched at song start).
    replayView: { ...guiState.replayView },
    audioVolumes: { key: guiState.keyVolume / 100, bgm: guiState.bgmVolume / 100 },
    ...(guiState.peakGain ? { peakGain: true } : {}),
    audioCompressorParams: input.audioCompressorParams,
    audioCompressor: guiState.compressor,
    audioCompressorMode: input.audioCompressorMode,
    audioCompressorStages: {
      key: guiState.compressorKey,
      bgm: guiState.compressorBGM,
      master: guiState.compressorMaster,
    },
    bgaTranscodeMaxLongEdgePx: guiState.bgaResizeMaxEdgePx > 0 ? guiState.bgaResizeMaxEdgePx : undefined,
    bgaTranscodeUseWebCodecs: guiState.bgaUseWebCodecs,
    showInvisibleNotes: guiState.showInvisibleNotes,
    judgedNoteDisplay: guiState.judgedNoteDisplay,
  };
  const { course, courseInfo, ...settings } = sharedOptions;
  return {
    autoPlay,
    tempo,
    settings,
    ...(course !== undefined
      ? { course: { stage: course, ...(courseInfo !== undefined ? { view: courseInfo } : {}) } }
      : {}),
  };
}
