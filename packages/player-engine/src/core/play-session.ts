import { BmsonBGAController } from './bmson-bga.ts';
import { ChartTextController } from './chart-text.ts';
import { selectPlaybackChartSide, type SecondPlayer } from './two-player.ts';
import { resolveEffectiveBattleMode } from './battle-mode.ts';
import { applySevenToNine } from './seven-to-nine.ts';
import { clampExtraNoteDepth } from './extra-note-modifier.ts';
import { buildAutoKeyBoundBGAInputs, KeyBoundBGAController } from './key-bound-bga.ts';
import { resolveAutoScratchChannels, resolveAutoScratchSides } from './auto-scratch.ts';
import {
  createBeatAtSecondsResolverFromTimingResolver,
  buildKeyBoundBGATimeline,
  buildBmsonBGAEventTimeline,
  buildChartTextTimeline,
  buildChartOptionTimeline,
  compileChartOptions,
  resolveChartOptionsAt,
  type ChartOptionProgram,
  isPlayLaneSoundChannel,
  type ResolvedChart,
} from '@be-music/chart-model';
import { throwIfAborted } from '@be-music/shared-utils/core';
import { type BeMusicEvent, type BeMusicJSON, resolveBMSBase } from '@be-music/chart-source';
import { createPlayerStateSignals, type PlayerStateSignals } from '../state-signals.ts';
import { resolveHighSpeedMultiplier } from './high-speed-control.ts';
import { createPlayerUISignalBus, type PlayerUISignalBus, type PlayerHCNLaneState } from './ui-signal-bus.ts';
import { createPlayerInputSignalBus, type PlayerInputSignalBus } from './input-signal-bus.ts';
import { createNoopPlaybackStateLogger, createUIFramePublisher, type PlaybackStateLogger } from './playback-support.ts';
import { createScoreTracker } from './scoring.ts';
import {
  judgeWindowLateReachUs,
  resolveRuleset,
  resolveGaugeEndOnFailure,
  rulesetChartFactsFromChart,
  type RulesetConfig,
} from '../ruleset/index.ts';
import type { JudgeCoreEffectSink, JudgeCoreScore } from './judge-core.ts';
import { createReplayRecorder, type ReplayRecorder } from '../replay/recorder.ts';
import { courseStageCarryCombo, courseStageRulesetOptions } from '../replay/rulesets.ts';
import { createInitialPlayerSummary, preparePlaybackChart, type PreparedPlaybackChartData } from './bootstrap.ts';
import {
  appendShadowedNoteTriggers,
  collectRealtimeAudioTriggers,
  createDebugActiveAudioEstimator,
} from './engine-audio.ts';
import { createAudioPlaybackClockSource, type PlaybackClock, type PlaybackClockSource } from './engine-clock.ts';
import { createJudgeEffectHandler } from './engine-effects.ts';
import { isLR2JudgeTimingAutoAdjust } from './judge-timing.ts';
import { createTempoClock, type TempoClock } from './tempo-clock.ts';
import {
  collectRealtimeAudioVolumeEvents,
  formatRandomPatternSummary,
  initializePlaybackRuntimeResources,
  reportLoadProgress,
  reportResolvedRuleset,
  resolveAudioBackendLabel,
  resolveEngineChart,
  resolvePlayerChart,
} from './engine-preparation.ts';
import {
  createNoopPlaybackEventTracer,
  createNoTUIPlaybackEventTracer,
  createNoTUIPlaybackStateLogger,
  emitPlayerLog,
  resolveOutputWriter,
  writeRealtimeTriggeredEventLog,
  writeRealtimeVolumeEventLog,
  type NoTUIPlaybackEventTracer,
} from './engine-trace.ts';
import type {
  AudioSession,
  CreatePlayerUIRuntimeContext,
  PlayerInputRuntime,
  PlayerOptions,
  PlayerSummary,
  PlayerUIRuntime,
} from './engine-types.ts';
import { createRealtimeAudioCursor, type RealtimeAudioCursor } from './play-audio-cursor.ts';
import type { JudgeStrategy } from './play-strategy.ts';

/** A chart sound the realtime audio fires at its time. */
type TimedChartSound = { readonly event: BeMusicEvent; readonly seconds: number };

/**
 * A play session: everything a play is set up with before its loop runs — the chart resolved for play, the tempo clock,
 * the ruleset, the score, the replay recorder, the UI / input buses and runtimes, the audio session, the no-TUI
 * trace and the realtime audio. The same for every judge strategy.
 */
export interface PlaySession {
  readonly options: PlayerOptions;
  readonly strategy: JudgeStrategy;
  readonly writeOutput: (text: string) => void;
  /** The chart after control flow, as the engine plays it. */
  readonly resolvedJSON: BeMusicJSON;
  readonly resolvedChart: ResolvedChart;
  readonly playbackChart: PreparedPlaybackChartData;
  readonly randomPatternSummary: string | undefined;
  readonly ruleset: RulesetConfig;
  /** The score and gauge every judgment goes through; `score.summary` is the play's summary. */
  readonly score: JudgeCoreScore;
  readonly summary: PlayerSummary;
  /** Chart seconds the play lasts: its last note or sound, or the UI runtime's own end. */
  readonly totalSeconds: number;
  readonly speed: number;
  /** HIGH-SPEED at the start of the play. */
  readonly highSpeed: number;
  /** The play tempo over the play clock: `speed` at the start, re-anchored by every tempo change. */
  readonly tempoClock: TempoClock;
  readonly leadInMs: number;
  /** The chart second the play starts at (`PlayerOptions.startAtSeconds`, its first seek): 0 unless asked for later. */
  readonly startAtSeconds: number;
  readonly audioOffsetMs: number;
  readonly beatAtSeconds: (seconds: number) => number;
  readonly idBase: 36 | 62;
  readonly wavResources: Readonly<Record<string, string>>;
  /** AUTO SCRATCH in a manual play: the judge plays the scratch lanes. */
  readonly autoScratch: boolean;
  /** ANY KEY in a manual play: the judge routes each press to the nearest note on any lane. */
  readonly anyKey: boolean;
  readonly endOnFailure: boolean;
  /** The play re-drives a recorded play (`PlayerOptions.replayInputs`). */
  readonly replay: boolean;
  readonly replayRecorder: ReplayRecorder | undefined;
  readonly stateSignals: PlayerStateSignals;
  readonly uiSignals: PlayerUISignalBus;
  readonly inputSignals: PlayerInputSignalBus;
  readonly uiRuntime: PlayerUIRuntime | undefined;
  readonly uiEnabled: boolean;
  /** The state signals while a UI runtime shows them. */
  readonly activeStateSignals: PlayerStateSignals | undefined;
  readonly audioSession: AudioSession | undefined;
  readonly inputRuntime: PlayerInputRuntime | undefined;
  readonly tracer: NoTUIPlaybackEventTracer;
  readonly stateLogger: PlaybackStateLogger;
  readonly publishUIFrame: (seconds: number, beat: number) => void;
  readonly keyBoundBGA?: KeyBoundBGAController;
  readonly bmsonBGA?: BmsonBGAController;
  readonly chartText?: ChartTextController;
  readonly chartOptions: ChartOptionProgram;
  /** The judge supplies HCN display facts from its existing state; no second simulation. */
  readHCNLanes?: (seconds: number) => readonly PlayerHCNLaneState[];
  /** Maps the judge's effects onto audio, the UI buses, the replay and the trace. */
  readonly applyJudgeEffect: JudgeCoreEffectSink;
  /** Ends a judging pass of a manual play: LR2's automatic judge timing steps here (`JudgeEffectHandler`). */
  readonly settleJudgeTiming: () => void;
  /** The chart's volume changes (`#97` / `#98`), queued against the audio write head. */
  readonly volumeChanges: RealtimeAudioCursor<TimedChartSound>;
  /** The chart's background sounds, queued against the audio write head. */
  readonly backgroundAudio: RealtimeAudioCursor<TimedChartSound>;
  /** What the play clock runs on: the audio session's output clock, or the engine scheduler's. */
  readonly clockSource: PlaybackClockSource;
  /** The play clock, from the moment the chart starts (after the lead-in). */
  clock: PlaybackClock | undefined;
  /** The seek generation: one more for every seek applied (`play-seek.ts`); a play that sought records no replay. */
  seekGeneration: number;
  /** Puts the score, the gauge and the combos back to the play's start, in place (a seek rebuilds from there). */
  readonly resetScore: () => void;
  /** The 2P player of a two-player play (`battleMode: 'TWO-PLAYER'`); the session's own score is the 1P player's. */
  readonly secondPlayer?: SecondPlayer;
}

/** The UI runtime's label for the mode. */
function uiModeLabel(strategy: JudgeStrategy, autoScratch: boolean): CreatePlayerUIRuntimeContext['mode'] {
  if (strategy.mode === 'auto') return 'AUTO';
  return autoScratch ? 'AUTO SCRATCH' : 'MANUAL';
}

/** Sets a play up: resolves its chart, builds its judging setup and starts its runtimes (not the play itself). */
export async function createPlaySession(
  json: BeMusicJSON,
  options: PlayerOptions,
  strategy: JudgeStrategy,
): Promise<PlaySession> {
  // Effective calibration is local to this run, even when the caller reuses or freezes its settings.
  options = { ...options };
  options.scrollModifier ??= options.preparedChart?.scrollModifierApplied;
  options.scrollSection ??= options.preparedChart?.scrollSection;
  options.scrollRate ??= options.preparedChart?.scrollRate;
  options.sevenToNinePattern ??= options.preparedChart?.sevenToNinePattern;
  options.sevenToNineType ??= options.preparedChart?.sevenToNineType;
  options.hRandomThresholdBPM ??= options.preparedChart?.sevenToNineThresholdBPM;
  const { mode } = strategy;
  if (options.practice !== undefined) assertPracticeOptions(options);
  throwIfAborted(options.signal);
  const writeOutput = resolveOutputWriter(options);
  reportLoadProgress(options, 0.02, 'Resolving chart...');
  const controlFlowResolution = resolvePlayerChart(json, options);
  const resolvedJSON = controlFlowResolution.resolvedJSON;
  options.onResolvedChart?.(resolvedJSON);
  const randomPatternSummary = formatRandomPatternSummary(controlFlowResolution.randomPatterns);
  const scratchSides = resolveAutoScratchSides(options);
  const autoScratch = mode === 'manual' && (scratchSides.autoScratch1P || scratchSides.autoScratch2P);
  const anyKey = mode === 'manual' && options.anyKey === true;
  const speed = options.speed ?? 1;
  const tempoClock = createTempoClock(speed);
  const leadInMs = options.leadInMs ?? 1500;
  // PRACTICE starts 1000 ms before its range (`starttimeoffset`).
  const requestedStartAtSeconds =
    options.startAtSeconds ??
    (options.practice !== undefined ? Math.max(0, Math.trunc(options.practice.startMs) - 1000) / 1000 : 0);
  const startAtSeconds =
    Number.isFinite(requestedStartAtSeconds) && requestedStartAtSeconds > 0 ? requestedStartAtSeconds : 0;
  const audioOffsetMs = options.audioOffsetMs ?? 0;
  const replay = options.replayInputs !== undefined;
  let resolvedChart = options.preparedChart?.resolvedChart ?? resolveEngineChart(resolvedJSON, options);
  // Dynamic `#EXRANKxx` changes are a chart fact, recorded whatever the ruleset: LR2 applies them, while beatoraja and
  // That-Which-Must-Not-Be-Named keep their initial windows (their `windowsAt` ignores the timeline). A log played under one ruleset can then
  // be re-simulated under LR2 with the windows LR2 would have used.
  const judgeRankChanges = resolvedChart.judgeRank.changes;
  const volumeEvents = collectRealtimeAudioVolumeEvents(resolvedChart);
  // Background audio: every sound that is not a play lane's — a play lane's keysound is the judge strategy's to play
  // (on the player's press, or AUTO play's own note keysounds).
  let backgroundTriggers = collectRealtimeAudioTriggers(resolvedChart, (channel) => !isPlayLaneSoundChannel(channel));
  const realtimeAudioEndSeconds =
    options.audio === false ? 0 : Math.max(backgroundTriggers.at(-1)?.seconds ?? 0, volumeEvents.at(-1)?.seconds ?? 0);
  // Prefer the host-provided `preparedChart` over running our own extract pass. See `PlayerOptions.preparedChart`
  // for the why — sharing the playable / landmine / invisible note arrays with the renderer eliminates a whole
  // class of "view and engine each ran `extractTimedNotes` with subtly different arguments and the parallel
  // arrays drifted" bugs.
  const playbackChart =
    options.preparedChart ??
    preparePlaybackChart(
      resolvedChart,
      {
        laneModeExtension: options.laneModeExtension,
        longNoteModifier: options.longNoteModifier,
        longNoteRate: options.longNoteRate,
        battleMode: options.battleMode,
        dBattleScratch: options.dBattleScratch,
        practice: options.practice,
        judgeRuleset: options.judgeRuleset,
        autoScratch: options.autoScratch,
        autoScratch1P: options.autoScratch1P,
        autoScratch2P: options.autoScratch2P,
        lr2ExtraMode: options.lr2ExtraMode,
        lr2ExtraLevel: options.lr2ExtraLevel,
        speed: options.speed,
        course: options.course,
        extraNoteDepth: options.extraNoteDepth,
        extraNoteScratch: options.extraNoteScratch,
        longNoteModifierPlacements: options.longNoteModifierPlacements,
        mineModifier: options.mineModifier,
        mineModifierPlacements: options.mineModifierPlacements,
        scrollModifier: options.scrollModifier,
        scrollSection: options.scrollSection,
        scrollRate: options.scrollRate,
        scrollModifierTimeline: options.scrollModifierTimeline,
      },
      realtimeAudioEndSeconds,
      Math.random,
    );
  resolvedChart = playbackChart.resolvedChart;
  backgroundTriggers = collectRealtimeAudioTriggers(resolvedChart, (channel) => !isPlayLaneSoundChannel(channel));
  const battleRequested = options.battleMode ?? playbackChart.battleMode ?? 'OFF';
  const expectedBattle = resolveEffectiveBattleMode(
    battleRequested,
    options.judgeRuleset ?? 'lr2',
    playbackChart.battleSourceVariant ?? resolvedChart.playVariant,
    options.course !== undefined,
    resolvedChart.sourceFormat === 'bms' ? resolvedChart.source.bms.player : undefined,
  );
  if ((playbackChart.battleMode ?? 'OFF') !== expectedBattle)
    throw new RangeError('The shared prepared chart must include the selected battle mode.');
  const lr2ExtraRequested = options.lr2ExtraMode ?? playbackChart.lr2ExtraMode ?? false;
  if ((playbackChart.lr2ExtraMode ?? false) !== (lr2ExtraRequested && options.course === undefined))
    throw new RangeError('The shared prepared chart must include the selected LR2 EXTRA mode.');
  if (lr2ExtraRequested && options.lr2ExtraLevel !== undefined && playbackChart.lr2ExtraLevel !== options.lr2ExtraLevel)
    throw new RangeError('The shared prepared chart must include the selected LR2 EXTRA level.');
  if (!options.preparedChart && (options.sevenToNinePattern !== undefined || options.sevenToNineType !== undefined))
    applySevenToNine(playbackChart, options);
  if (
    options.preparedChart &&
    ((options.sevenToNinePattern !== undefined &&
      options.sevenToNinePattern !== (playbackChart.sevenToNinePattern ?? 0)) ||
      (options.sevenToNineType !== undefined && options.sevenToNineType !== (playbackChart.sevenToNineType ?? 0)) ||
      (options.hRandomThresholdBPM !== undefined &&
        options.hRandomThresholdBPM !== (playbackChart.sevenToNineThresholdBPM ?? 120)))
  )
    throw new RangeError('Prepared 7-to-9 conversion does not match selected options.');
  resolvedChart = playbackChart.resolvedChart;
  const compiledOptions =
    options.chartOptionProgram === undefined
      ? compileChartOptions(buildChartOptionTimeline(resolvedChart.source, resolvedChart.timing))
      : { program: structuredClone(options.chartOptionProgram), diagnostics: [] };
  const chartOptions = compiledOptions.program;
  for (const diagnostic of [...compiledOptions.diagnostics, ...(options.chartOptionDiagnostics ?? [])])
    emitPlayerLog(options, 'warn', 'chart.option', { ...diagnostic });
  const extraDepth = clampExtraNoteDepth(options.extraNoteDepth ?? playbackChart.extraNoteDepth ?? 0);
  const extraScratch = options.extraNoteScratch ?? playbackChart.extraNoteScratch ?? false;
  if ((playbackChart.extraNoteDepth ?? 0) !== extraDepth || (playbackChart.extraNoteScratch ?? false) !== extraScratch)
    throw new RangeError('The shared prepared chart must include the selected EXTRA note options.');
  const beatAtSeconds = createBeatAtSecondsResolverFromTimingResolver(resolvedChart.timing);
  if ((options.scrollModifier ?? 'OFF') !== (playbackChart.scrollModifierApplied ?? 'OFF'))
    throw new RangeError('The shared prepared chart must include the selected scroll modifier.');
  if (
    options.longNoteModifier?.startsWith('ADD_') &&
    playbackChart.longNoteModifierApplied !== options.longNoteModifier
  )
    throw new RangeError('The shared prepared chart must include the selected long-note modifier.');
  // Long-note addition builds a chart and is offered under every judge ruleset (#774): the added long notes are judged
  // as the ruleset's long notes, so ADD CN / ADD HCN keep their CN / HCN distinction only under beatoraja rules.
  if (options.mineModifier?.startsWith('ADD_') && playbackChart.mineModifierApplied !== options.mineModifier)
    throw new RangeError('The shared prepared chart must include the selected mine modifier.');
  if (options.mineModifier === 'REMOVE') {
    const removed = playbackChart.landmineNotes.length;
    playbackChart.mineModifierChangeCount = (playbackChart.mineModifierChangeCount ?? 0) + removed;
    // Keep the shared array identity when the host prepared the chart before choosing REMOVE.
    playbackChart.landmineNotes.length = 0;
  }
  // BMS duplicate keysounds play as BGM. bmson layers belong to the judged note's input instead.
  if (resolvedJSON.sourceFormat !== 'bmson')
    appendShadowedNoteTriggers(backgroundTriggers, resolvedChart, playbackChart.shadowedNotes);
  // Constant for the whole play and read on every tick and judgment: hoisted out of the hot paths.
  const idBase = resolveBMSBase(resolvedJSON);
  const wavResources = resolvedJSON.resources.wav;

  // The gauge the play runs on and the replay records: one value, so a re-simulation runs the same gauge. A host that
  // only declared it for the log (`recordReplay.gauge`) gets it played too.
  const selectedGauge = options.gauge ?? options.recordReplay?.gauge;
  if (
    options.judgeAlgorithm !== undefined &&
    options.judgeAlgorithm !== 'combo' &&
    options.judgeRuleset !== 'beatoraja'
  ) {
    throw new RangeError('Selectable judgment algorithms belong to beatoraja 0.8.9.');
  }
  // Two players judge one side each: each side's notes make its own judgment count and TOTAL.
  const twoPlayer = playbackChart.battleMode === 'TWO-PLAYER' || playbackChart.battleMode === 'COUPLE';
  const ruleset = resolveRuleset(
    rulesetChartFactsFromChart(
      resolvedJSON,
      twoPlayer ? selectPlaybackChartSide(playbackChart, 1) : playbackChart,
      judgeRankChanges,
      options.stageRanks,
    ),
    options.judgeRuleset ?? 'lr2',
    {
      ...(options.judgeAlgorithm !== undefined ? { judgeAlgorithm: options.judgeAlgorithm } : {}),
      bmsonTotalMode: options.bmsonTotalMode,
      ...(options.customJudge !== undefined ? { customJudge: options.customJudge } : {}),
      ...(options.practice !== undefined
        ? {
            practice: {
              sourceNotes: playbackChart.practiceSourceNotes ?? { normal: 0, long: { 1: 0, 2: 0, 3: 0 } },
              gauge: options.practice.gauge,
              startGauge: options.practice.startGauge,
              ...(options.practice.gaugeCategory !== undefined
                ? { gaugeCategory: options.practice.gaugeCategory }
                : {}),
              ...(options.practice.total !== undefined ? { total: options.practice.total } : {}),
              ...(options.practice.judgeRank !== undefined ? { judgeRank: options.practice.judgeRank } : {}),
            },
          }
        : {}),
      ...(selectedGauge !== undefined ? { selectedGauge } : {}),
      ...(options.bottomShiftableGauge !== undefined ? { bottomShiftableGauge: options.bottomShiftableGauge } : {}),
      ...(options.gaugeAutoShift !== undefined ? { gaugeAutoShift: options.gaugeAutoShift } : {}),
      ...(options.judgeWindowMs !== undefined ? { judgeWindowOverrideMs: options.judgeWindowMs } : {}),
      ...(options.course !== undefined ? { course: courseStageRulesetOptions(options.course) } : {}),
    },
  );
  reportResolvedRuleset(options, ruleset);
  const endOnFailure = resolveGaugeEndOnFailure(options.gaugeAutoShift, ruleset.rulesetId, options.endOnFailure);

  const courseCarry = options.course !== undefined ? courseStageCarryCombo(options.course) : undefined;
  const { score, summary, resetScore: resetPrimaryScore } = createPlayerScore(ruleset, courseCarry);
  const secondPlayer = twoPlayer
    ? createSecondPlayer(resolvedJSON, playbackChart, judgeRankChanges, options, selectedGauge)
    : undefined;
  if (secondPlayer !== undefined) summary.secondPlayer = secondPlayer.summary;
  const resetScore = (): void => {
    resetPrimaryScore();
    secondPlayer?.resetScore();
  };
  // The source saves nothing from PRACTICE.
  const replayRecorder =
    options.onReplayRecorded && options.practice === undefined
      ? (() => {
          const { chartSHA256, chartMD5, recorder, sourceChart, ...hostPlaySettings } = options.recordReplay ?? {};
          return createReplayRecorder({
            json: resolvedJSON,
            chartOptions,
            moneyScore: ruleset.moneyScore,
            chart: playbackChart,
            chartSHA256,
            chartMD5,
            recorder,
            laneModeExtension: options.laneModeExtension,
            // The chart the engine was handed is the source when it resolved the control flow itself.
            sourceChart: sourceChart ?? json,
            dynamicJudgeRankChanges: judgeRankChanges,
            ...(options.stageRanks !== undefined ? { stageRanks: options.stageRanks } : {}),
            reversalSeconds: resolvedChart.reversal?.seconds,
            play: {
              mode,
              autoScratch,
              judgeAlgorithm: ruleset.rulesetId === 'beatoraja' ? (options.judgeAlgorithm ?? 'combo') : undefined,
              ...(options.bmsonTotalMode !== undefined ? { bmsonTotalMode: options.bmsonTotalMode } : {}),
              ...(options.customJudge !== undefined ? { customJudge: { ...options.customJudge } } : {}),
              longNoteModifier: options.longNoteModifier,
              ...(options.autoScratch1P !== undefined || options.autoScratch2P !== undefined
                ? {
                    autoScratch1P: mode === 'manual' && scratchSides.autoScratch1P,
                    autoScratch2P: mode === 'manual' && scratchSides.autoScratch2P,
                  }
                : {}),
              ...(anyKey ? { anyKey: true } : {}),
              judgeWindowOverrideMs: options.judgeWindowMs,
              judgeRuleset: options.judgeRuleset,
              ...(options.randomDraws !== undefined ? { randomDraws: options.randomDraws } : {}),
              ...(options.course !== undefined ? { course: options.course } : {}),
              ...hostPlaySettings,
              ...(options.scrollModifier !== undefined
                ? {
                    scrollModifier: options.scrollModifier,
                    scrollModifierChanged: playbackChart.scrollModifierChanged ?? false,
                    ...(options.scrollModifier === 'ADD'
                      ? {
                          scrollSection: playbackChart.scrollSection,
                          scrollRate: playbackChart.scrollRate,
                          scrollModifierTimeline: playbackChart.scrollModifierTimeline,
                        }
                      : {}),
                  }
                : {}),
              ...(options.judgeTimingMs !== undefined || options.judgeTimingAutoAdjust !== undefined
                ? {
                    options: {
                      ...hostPlaySettings.options,
                      judgeTimingAutoAdjust: options.judgeTimingAutoAdjust ?? 'OFF',
                      judgeTimingMs: options.judgeTimingMs ?? 0,
                    },
                  }
                : {}),
              ...(options.mineModifier !== undefined
                ? {
                    mineModifier: options.mineModifier,
                    mineModifierChangeCount: playbackChart.mineModifierChangeCount ?? 0,
                  }
                : {}),
              ...(playbackChart.sevenToNinePattern !== undefined
                ? {
                    sevenToNinePattern: playbackChart.sevenToNinePattern,
                    sevenToNineType: playbackChart.sevenToNineType,
                    sevenToNineThresholdBPM: playbackChart.sevenToNineThresholdBPM,
                    sevenToNineApplied: playbackChart.sevenToNineApplied,
                  }
                : {}),
              ...(options.battleMode !== undefined || playbackChart.battleMode !== undefined
                ? {
                    battleMode: playbackChart.battleMode ?? 'OFF',
                    battleSourceVariant: playbackChart.battleSourceVariant ?? playbackChart.resolvedChart.playVariant,
                    battleTempo: playbackChart.battleTempo ?? 1,
                    battleAssist1P: playbackChart.battleAssist1P ?? false,
                    battleAssist2P: playbackChart.battleAssist2P ?? false,
                    battleChangedObjectCount: playbackChart.battleChangedObjectCount ?? 0,
                    battleDroppedObjectCount: playbackChart.battleDroppedObjectCount ?? 0,
                    ...(playbackChart.dBattleScratch !== undefined
                      ? { dBattleScratch: playbackChart.dBattleScratch }
                      : {}),
                  }
                : {}),
              ...(options.lr2ExtraMode !== undefined || playbackChart.lr2ExtraMode !== undefined
                ? {
                    lr2ExtraMode: playbackChart.lr2ExtraMode ?? false,
                    lr2ExtraLevel: playbackChart.lr2ExtraLevel ?? 0,
                    lr2ExtraEffectiveLevel: playbackChart.lr2ExtraEffectiveLevel ?? 0,
                    lr2ExtraConvertedObjectCount: playbackChart.lr2ExtraConvertedObjectCount ?? 0,
                    lr2ExtraTempo: playbackChart.lr2ExtraTempo ?? 1,
                  }
                : {}),
              ...(options.extraNoteDepth !== undefined ||
              options.extraNoteScratch !== undefined ||
              playbackChart.extraNoteDepth !== undefined
                ? {
                    extraNoteDepth: playbackChart.extraNoteDepth ?? 0,
                    extraNoteScratch: playbackChart.extraNoteScratch ?? false,
                    extraNoteChangeCount: playbackChart.extraNoteChangeCount ?? 0,
                  }
                : {}),
              ...(options.longNoteModifier?.startsWith('ADD_')
                ? {
                    longNoteRate: playbackChart.longNoteModifierRate ?? 1,
                    longNoteModifierChangeCount: playbackChart.longNoteModifierChangeCount ?? 0,
                  }
                : {}),
              gaugeAutoShift: options.gaugeAutoShift,
              ...(options.bottomShiftableGauge !== undefined
                ? { bottomShiftableGauge: options.bottomShiftableGauge }
                : {}),
              endOnFailure: endOnFailure ? true : undefined,
              gauge: selectedGauge,
              // The tempo a live play ran at (its inputs are in chart time either way). A replay's `speed` only sets how
              // fast it is re-driven, so it records none.
              ...(speed !== 1 && !replay ? { tempo: speed } : {}),
            },
          });
        })()
      : undefined;

  const highSpeed = resolveHighSpeedMultiplier(options.highSpeed);
  const stateSignals = createPlayerStateSignals(highSpeed);
  const { landmineNotes, invisibleNotes, renderNotes, laneBindings, laneDisplayMode, inputTokenToChannels } =
    playbackChart;
  const finalOptionCue = chartOptions.cues
    .filter((cue) => cue.timeUs <= (resolvedChart.reversal?.seconds ?? Infinity) * 1_000_000)
    .at(-1);
  let textPlaybackEndSeconds =
    options.practice === undefined && finalOptionCue ? finalOptionCue.timeUs / 1_000_000 + 1 : 0;
  for (const stage of options.practice === undefined ? (options.chartTextStages ?? []) : []) {
    const last = stage.timeline.cues.filter((cue) => cue.seconds <= (stage.freezeSeconds ?? Infinity)).at(-1);
    if (last)
      textPlaybackEndSeconds = Math.max(
        textPlaybackEndSeconds,
        Math.min(stage.endSeconds, stage.offsetSeconds + (last.seconds + 1) / stage.rate),
      );
  }
  const uiSignals = createPlayerUISignalBus({
    currentBeat: 0,
    currentSeconds: 0,
    totalSeconds: Math.max(playbackChart.totalSeconds, textPlaybackEndSeconds),
    summary,
    notes: renderNotes,
    landmineNotes,
    invisibleNotes,
  });
  const inputSignals = createPlayerInputSignalBus();
  const { uiRuntime, totalSeconds, uiEnabled, activeStateSignals, audioSession } =
    await initializePlaybackRuntimeResources({
      resolvedJSON,
      resolvedChart,
      options,
      mode: uiModeLabel(strategy, autoScratch),
      laneDisplayMode,
      laneBindings,
      speed,
      // The BAD gate as a single width, for the host's judge-window readout.
      judgeWindowMs: mode === 'auto' ? 0 : judgeWindowLateReachUs(ruleset.windows.note) / 1000,
      highSpeed,
      randomPatternSummary,
      stateSignals,
      uiSignals,
      totalSeconds: Math.max(playbackChart.totalSeconds, textPlaybackEndSeconds),
      audioMode: mode,
    });

  const inputRuntime = options.createInputRuntime?.({ mode, inputSignals, inputTokenToChannels });
  const tracer = uiEnabled
    ? createNoopPlaybackEventTracer()
    : createNoTUIPlaybackEventTracer({
        resolved: resolvedChart,
        writeOutput,
        judgeWindowMs: options.judgeWindowMs,
      });
  const stateLogger = uiEnabled
    ? createNoopPlaybackStateLogger()
    : createNoTUIPlaybackStateLogger({ writeOutput, summary, base: idBase });

  throwIfAborted(options.signal);
  const audioBackendLabel = resolveAudioBackendLabel(options, audioSession);
  let activeAudioEstimator: Awaited<ReturnType<typeof createDebugActiveAudioEstimator>> | undefined;
  if (strategy.estimatesActiveAudio) {
    activeAudioEstimator = options.debugActiveAudio
      ? await createDebugActiveAudioEstimator(resolvedChart, {
          baseDir: options.audioBaseDir,
          signal: options.signal,
          loadSampleDurations: options.loadAudioSampleDurations,
        })
      : undefined;
    throwIfAborted(options.signal);
  }
  reportLoadProgress(options, 1, 'Ready');
  options.onLoadComplete?.();
  emitPlayerLog(options, 'info', 'playback.prepared', {
    mode,
    uiEnabled,
    audioEnabled: audioSession !== undefined,
    totalSeconds,
  });
  const clockSource = createAudioPlaybackClockSource(audioSession);
  // `session` is returned below; the frames read its clock and seek generation as they are published.
  let session: PlaySession | undefined;
  const keyBoundCues = options.keyBoundBGACues ?? buildKeyBoundBGATimeline(resolvedChart.source, resolvedChart.timing);
  const assistedChannels = resolveAutoScratchChannels(
    options,
    playbackChart.laneBindings.filter((lane) => lane.isScratch).map((lane) => lane.channel),
  );
  const freezeSeconds = resolvedChart.reversal?.seconds ?? Infinity;
  const keyBoundBGA =
    keyBoundCues.length === 0
      ? undefined
      : new KeyBoundBGAController(keyBoundCues, {
          freezeSeconds,
          inputs: [
            ...(options.replayInputs ?? []).map((input) => ({
              seconds: input.timeUs / 1e6,
              action: input.action,
              channels: input.channels,
            })),
            ...buildAutoKeyBoundBGAInputs(
              playbackChart.scorableNotes.filter(
                (note) => note.seconds <= freezeSeconds && (mode === 'auto' || assistedChannels.has(note.channel)),
              ),
            ),
          ],
        });
  const bmsonCues =
    options.bmsonBGACues ??
    buildBmsonBGAEventTimeline(resolvedChart.source, resolvedChart.timing, {
      includeOrdinaryLayerClears: true,
    });
  const bmsonBGA = bmsonCues.length > 0 ? new BmsonBGAController(bmsonCues, freezeSeconds) : undefined;
  const textTimeline = buildChartTextTimeline(resolvedChart.source, resolvedChart.timing);
  const chartText =
    options.chartTextStages !== undefined || textTimeline.cues.length || textTimeline.missText !== undefined
      ? new ChartTextController(textTimeline, freezeSeconds, options.chartTextStages)
      : undefined;
  const publishUIFrame = createUIFramePublisher({
    uiEnabled,
    uiSignals,
    totalSeconds,
    summary,
    notes: renderNotes,
    landmineNotes,
    invisibleNotes,
    audioBackend: audioBackendLabel,
    ...(secondPlayer !== undefined ? { summary2P: secondPlayer.summary } : {}),
    ...(bmsonBGA ? { resolveBmsonBGA: (seconds: number) => bmsonBGA.read(seconds) } : {}),
    ...(chartOptions.initial.hiSpeed !== undefined || chartOptions.cues.length > 0
      ? {
          resolveChartOptions: (seconds: number) =>
            resolveChartOptionsAt(chartOptions, Math.round(Math.min(seconds, freezeSeconds) * 1_000_000)),
        }
      : {}),
    ...(chartText ? { resolveChartText: (seconds: number) => chartText.read(seconds) } : {}),
    resolveHCNLanes: (seconds) => session?.readHCNLanes?.(seconds),
    ...(keyBoundBGA ? { resolveKeyBoundBGA: (seconds: number) => keyBoundBGA.read(seconds) } : {}),
    resolveJudgedNoteCount: () =>
      Math.max(
        0,
        summary.perfect +
          summary.great +
          summary.good +
          summary.bad +
          summary.poor -
          (ruleset.emptyPoorCountsInPoorDisplay ? summary.emptyPoor : 0) -
          ('minePoor' in summary && typeof summary.minePoor === 'number' ? summary.minePoor : 0),
      ),
    resolveDebugActiveAudioState: (seconds) => {
      if (options.debugActiveAudio !== true) {
        return {};
      }
      const activeAudioFiles = audioSession?.getActiveAudioFiles?.() ?? [];
      const activeAudioVoiceCount = audioSession?.getActiveAudioVoiceCount?.() ?? 0;
      if (activeAudioEstimator === undefined || activeAudioVoiceCount > 0 || activeAudioFiles.length > 0) {
        return { activeAudioFiles, activeAudioVoiceCount };
      }
      const estimated = activeAudioEstimator.resolve(seconds);
      return {
        activeAudioFiles: estimated?.activeAudioFiles ?? [],
        activeAudioVoiceCount: estimated?.activeAudioVoiceCount ?? 0,
      };
    },
    reversal: resolvedChart.reversal,
    resolveClock: (seconds) => {
      const clock = session?.clock;
      return {
        generation: session?.seekGeneration ?? 0,
        clock: {
          outputSeconds:
            (clock === undefined ? clockSource.nowMs() : clock.sourceMsAt(tempoClock.clockMsAt(seconds))) / 1000,
          tempo: tempoClock.tempo,
          paused: clock?.isPaused() ?? true,
        },
      };
    },
  });
  const applyJudgeEffect = createJudgeEffectHandler({
    ...(chartText ? { onChartTextInput: (input) => chartText.addInput(input) } : {}),
    ...(bmsonBGA ? { onBmsonBGAInput: (input) => bmsonBGA.addInput(input) } : {}),
    ...(keyBoundBGA && !replay
      ? {
          onInput: (input: { seconds: number; action: 'down' | 'up'; channels: ReadonlySet<string> }) =>
            keyBoundBGA.addInput({ seconds: input.seconds, action: input.action, channels: [...input.channels] }),
        }
      : {}),
    judgeTiming: {
      // Manual play only, under any judge rules; LR2 skips its own adjustment in a two-player BATTLE (`battle` 1).
      mode:
        mode !== 'manual' ||
        options.replayInputs !== undefined ||
        (twoPlayer && isLR2JudgeTimingAutoAdjust(options.judgeTimingAutoAdjust))
          ? 'OFF'
          : (options.judgeTimingAutoAdjust ?? 'OFF'),
      currentSeconds: () => (session?.clock ? tempoClock.chartSecondsAt(session.clock.nowMs()) : 0),
      get value() {
        return options.judgeTimingMs ?? 0;
      },
      set value(value: number) {
        options.judgeTimingMs = value;
      },
    },
    uiEnabled,
    writeOutput,
    wavResources,
    idBase,
    audioSession,
    playbackStateLogger: stateLogger,
    playbackEventTracer: tracer,
    uiSignals,
    activeStateSignals,
    replayRecorder,
    publishUIFrame,
    beatAtSeconds,
  });

  // Realtime audio goes only to a session that takes it; without one nothing is queued (or traced).
  const queuesAudio = audioSession?.triggerEvent !== undefined;
  const volumeChanges = createRealtimeAudioCursor(queuesAudio ? volumeEvents : [], (change) => {
    if (!uiEnabled) {
      writeRealtimeVolumeEventLog(writeOutput, change.seconds, change.event);
    }
    audioSession!.triggerEvent!(change.event);
  });
  const backgroundAudio = createRealtimeAudioCursor(queuesAudio ? backgroundTriggers : [], (trigger) => {
    if (!uiEnabled) {
      writeRealtimeTriggeredEventLog(writeOutput, trigger, wavResources[trigger.sampleKey], 'realtime');
    }
    audioSession!.triggerEvent!(trigger.event);
  });

  session = {
    options,
    strategy,
    writeOutput,
    resolvedJSON,
    resolvedChart,
    playbackChart,
    randomPatternSummary,
    ruleset,
    score,
    summary,
    totalSeconds,
    speed,
    highSpeed,
    tempoClock,
    leadInMs,
    startAtSeconds,
    audioOffsetMs,
    beatAtSeconds,
    idBase,
    wavResources,
    autoScratch,
    anyKey,
    endOnFailure,
    replay,
    replayRecorder,
    stateSignals,
    uiSignals,
    inputSignals,
    uiRuntime,
    uiEnabled,
    activeStateSignals,
    audioSession,
    inputRuntime,
    tracer,
    stateLogger,
    publishUIFrame,
    ...(keyBoundBGA ? { keyBoundBGA } : {}),
    ...(bmsonBGA ? { bmsonBGA } : {}),
    ...(chartText ? { chartText } : {}),
    chartOptions,
    applyJudgeEffect,
    settleJudgeTiming: () => applyJudgeEffect.settleJudgeTiming(),
    volumeChanges,
    backgroundAudio,
    clockSource,
    clock: undefined,
    seekGeneration: 0,
    resetScore,
    ...(secondPlayer !== undefined ? { secondPlayer } : {}),
  };
  return session;
}

/** A player's score and gauge on `ruleset`, and how to put them back to the play's start. */
function createPlayerScore(
  ruleset: RulesetConfig,
  courseCarry: ReturnType<typeof courseStageCarryCombo> | undefined,
): { score: JudgeCoreScore; summary: PlayerSummary; resetScore: () => void } {
  const { reset: resetSummary, ...initialSummary } = createInitialPlayerSummary(ruleset, ruleset.noteCount);
  const score: JudgeCoreScore = {
    ...initialSummary,
    scoreTracker: createScoreTracker({
      moneyScore: ruleset.moneyScore,
      ...(courseCarry !== undefined ? { course: courseCarry } : {}),
    }),
  };
  const summary: PlayerSummary = score.summary;
  const tracker = score.scoreTracker;
  // The summary reads the combos off the tracker the judges update, so it always shows the live ones.
  Object.defineProperties(summary, {
    combo: { get: () => tracker.combo, enumerable: true, configurable: true },
    maxCombo: { get: () => tracker.maxCombo, enumerable: true, configurable: true },
  });
  if (tracker.course !== undefined) {
    // The same object the tracker updates, so the summary always shows the live course combo.
    summary.course = tracker.course;
  }
  return {
    score,
    summary,
    resetScore: () => {
      resetSummary();
      tracker.combo = 0;
      tracker.maxCombo = 0;
      if (tracker.course !== undefined && courseCarry !== undefined) {
        tracker.course.combo = courseCarry.combo;
        tracker.course.maxCombo = Math.max(courseCarry.maxCombo, courseCarry.combo);
      }
    },
  };
}

/** The 2P player of a two-player play: its own gauge (`gauge2P`) on its own side's notes. */
function createSecondPlayer(
  resolvedJSON: BeMusicJSON,
  playbackChart: PreparedPlaybackChartData,
  judgeRankChanges: ResolvedChart['judgeRank']['changes'],
  options: PlayerOptions,
  selectedGauge: string | undefined,
): SecondPlayer {
  const gauge = options.gauge2P ?? selectedGauge;
  const ruleset = resolveRuleset(
    rulesetChartFactsFromChart(resolvedJSON, selectPlaybackChartSide(playbackChart, 2), judgeRankChanges),
    options.judgeRuleset ?? 'lr2',
    {
      bmsonTotalMode: options.bmsonTotalMode,
      ...(gauge !== undefined ? { selectedGauge: gauge } : {}),
      ...(options.judgeWindowMs !== undefined ? { judgeWindowOverrideMs: options.judgeWindowMs } : {}),
    },
  );
  const { score, summary, resetScore } = createPlayerScore(ruleset, undefined);
  return {
    ruleset,
    score,
    summary,
    resetScore,
    endOnFailure: resolveGaugeEndOnFailure(undefined, ruleset.rulesetId, options.endOnFailure),
  };
}

/** PRACTICE is a beatoraja single play without chart modifiers (they apply only in PLAY / AUTOPLAY). */
function assertPracticeOptions(options: Readonly<PlayerOptions>): void {
  if (options.judgeRuleset !== 'beatoraja') throw new RangeError('PRACTICE is available only for beatoraja.');
  if (options.course !== undefined) throw new RangeError('PRACTICE plays a single chart.');
  if (
    (options.battleMode ?? 'OFF') !== 'OFF' ||
    (options.scrollModifier ?? 'OFF') !== 'OFF' ||
    (options.longNoteModifier ?? 'OFF') !== 'OFF' ||
    (options.mineModifier ?? 'OFF') !== 'OFF' ||
    (options.extraNoteDepth ?? 0) > 0 ||
    options.lr2ExtraMode === true
  )
    throw new RangeError('PRACTICE applies no chart modifier.');
}
