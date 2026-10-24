import { resolveAutoScratchSides } from './auto-scratch.ts';
import {
  createBeatAtSecondsResolverFromTimingResolver,
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
  /** The judge supplies HCN display facts from its existing state; no second simulation. */
  readHCNLanes?: (seconds: number) => readonly PlayerHCNLaneState[];
  /** Maps the judge's effects onto audio, the UI buses, the replay and the trace. */
  readonly applyJudgeEffect: JudgeCoreEffectSink;
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
  const { mode } = strategy;
  if (options.mineModifier !== undefined && options.mineModifier !== 'OFF' && options.judgeRuleset !== 'beatoraja')
    throw new RangeError('Mine modification is available only for beatoraja.');
  throwIfAborted(options.signal);
  const writeOutput = resolveOutputWriter(options);
  reportLoadProgress(options, 0.02, 'Resolving chart...');
  const controlFlowResolution = resolvePlayerChart(json, options);
  const resolvedJSON = controlFlowResolution.resolvedJSON;
  options.onResolvedChart?.(resolvedJSON);
  const randomPatternSummary = formatRandomPatternSummary(controlFlowResolution.randomPatterns);
  const scratchSides = resolveAutoScratchSides(options);
  const autoScratch = mode === 'manual' && (scratchSides.autoScratch1P || scratchSides.autoScratch2P);
  const speed = options.speed ?? 1;
  const tempoClock = createTempoClock(speed);
  const leadInMs = options.leadInMs ?? 1500;
  const requestedStartAtSeconds = options.startAtSeconds ?? 0;
  const startAtSeconds =
    Number.isFinite(requestedStartAtSeconds) && requestedStartAtSeconds > 0 ? requestedStartAtSeconds : 0;
  const audioOffsetMs = options.audioOffsetMs ?? 0;
  const replay = options.replayInputs !== undefined;
  const resolvedChart = resolveEngineChart(resolvedJSON, options);
  const beatAtSeconds = createBeatAtSecondsResolverFromTimingResolver(resolvedChart.timing);
  // Dynamic `#EXRANKxx` changes are a chart fact, recorded whatever the ruleset: LR2 applies them, while beatoraja and
  // That-Which-Must-Not-Be-Named keep their initial windows (their `windowsAt` ignores the timeline). A log played under one ruleset can then
  // be re-simulated under LR2 with the windows LR2 would have used.
  const judgeRankChanges = resolvedChart.judgeRank.changes;
  const volumeEvents = collectRealtimeAudioVolumeEvents(resolvedChart);
  // Background audio: every sound that is not a play lane's — a play lane's keysound is the judge strategy's to play
  // (on the player's press, or AUTO play's own note keysounds).
  const backgroundTriggers = collectRealtimeAudioTriggers(resolvedChart, (channel) => !isPlayLaneSoundChannel(channel));
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
        longNoteModifierPlacements: options.longNoteModifierPlacements,
        mineModifier: options.mineModifier,
        mineModifierPlacements: options.mineModifierPlacements,
      },
      realtimeAudioEndSeconds,
      Math.random,
    );
  if (
    options.longNoteModifier?.startsWith('ADD_') &&
    playbackChart.longNoteModifierApplied !== options.longNoteModifier
  )
    throw new RangeError('The shared prepared chart must include the selected long-note modifier.');
  if (options.longNoteModifier?.startsWith('ADD_') && (options.judgeRuleset ?? 'lr2') !== 'beatoraja')
    throw new RangeError('Long-note addition is available only for beatoraja.');
  if (options.mineModifier?.startsWith('ADD_') && playbackChart.mineModifierApplied !== options.mineModifier)
    throw new RangeError('The shared prepared chart must include the selected mine modifier.');
  if (options.mineModifier === 'REMOVE') {
    const removed = playbackChart.landmineNotes.length;
    playbackChart.mineModifierChangeCount = (playbackChart.mineModifierChangeCount ?? 0) + removed;
    // Keep the shared array identity when the host prepared the chart before choosing REMOVE.
    playbackChart.landmineNotes.length = 0;
  }
  // A duplicate note that lost its lane and position to another note is not judged, but its keysound still sounds, as
  // background audio at its own time.
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
  const ruleset = resolveRuleset(
    rulesetChartFactsFromChart(resolvedJSON, playbackChart, judgeRankChanges, options.stageRanks),
    options.judgeRuleset ?? 'lr2',
    {
      ...(options.judgeAlgorithm !== undefined ? { judgeAlgorithm: options.judgeAlgorithm } : {}),
      ...(selectedGauge !== undefined ? { selectedGauge } : {}),
      ...(options.judgeWindowMs !== undefined ? { judgeWindowOverrideMs: options.judgeWindowMs } : {}),
      ...(options.course !== undefined ? { course: courseStageRulesetOptions(options.course) } : {}),
    },
  );
  reportResolvedRuleset(options, ruleset);
  const endOnFailure = resolveGaugeEndOnFailure(options.gaugeAutoShift, ruleset.rulesetId, options.endOnFailure);

  const { reset: resetSummary, ...initialSummary } = createInitialPlayerSummary(ruleset, ruleset.noteCount);
  const courseCarry = options.course !== undefined ? courseStageCarryCombo(options.course) : undefined;
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
  const resetScore = (): void => {
    resetSummary();
    tracker.combo = 0;
    tracker.maxCombo = 0;
    if (tracker.course !== undefined && courseCarry !== undefined) {
      tracker.course.combo = courseCarry.combo;
      tracker.course.maxCombo = Math.max(courseCarry.maxCombo, courseCarry.combo);
    }
  };
  const replayRecorder = options.onReplayRecorded
    ? (() => {
        const { chartSHA256, chartMD5, recorder, sourceChart, ...hostPlaySettings } = options.recordReplay ?? {};
        return createReplayRecorder({
          json: resolvedJSON,
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
            longNoteModifier: options.longNoteModifier,
            ...(options.autoScratch1P !== undefined || options.autoScratch2P !== undefined
              ? {
                  autoScratch1P: mode === 'manual' && scratchSides.autoScratch1P,
                  autoScratch2P: mode === 'manual' && scratchSides.autoScratch2P,
                }
              : {}),
            judgeWindowOverrideMs: options.judgeWindowMs,
            judgeRuleset: options.judgeRuleset,
            ...(options.randomDraws !== undefined ? { randomDraws: options.randomDraws } : {}),
            ...(options.course !== undefined ? { course: options.course } : {}),
            ...hostPlaySettings,
            ...(options.mineModifier !== undefined
              ? {
                  mineModifier: options.mineModifier,
                  mineModifierChangeCount: playbackChart.mineModifierChangeCount ?? 0,
                }
              : {}),
            ...(options.longNoteModifier?.startsWith('ADD_')
              ? {
                  longNoteRate: playbackChart.longNoteModifierRate ?? 1,
                  longNoteModifierChangeCount: playbackChart.longNoteModifierChangeCount ?? 0,
                }
              : {}),
            gaugeAutoShift: options.gaugeAutoShift,
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
  const uiSignals = createPlayerUISignalBus({
    currentBeat: 0,
    currentSeconds: 0,
    totalSeconds: playbackChart.totalSeconds,
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
      totalSeconds: playbackChart.totalSeconds,
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
  const publishUIFrame = createUIFramePublisher({
    uiEnabled,
    uiSignals,
    totalSeconds,
    summary,
    notes: renderNotes,
    landmineNotes,
    invisibleNotes,
    audioBackend: audioBackendLabel,
    resolveHCNLanes: (seconds) => session?.readHCNLanes?.(seconds),
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
    applyJudgeEffect,
    volumeChanges,
    backgroundAudio,
    clockSource,
    clock: undefined,
    seekGeneration: 0,
    resetScore,
  };
  return session;
}
