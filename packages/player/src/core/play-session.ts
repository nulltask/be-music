import { isPlayLaneSoundChannel, type ResolvedChart } from '@be-music/chart';
import { throwIfAborted } from '@be-music/utils/core';
import { type BeMusicJson, resolveBmsBase } from '@be-music/json';
import { createPlayerStateSignals, type PlayerStateSignals } from '../state-signals.ts';
import { resolveHighSpeedMultiplier } from './high-speed-control.ts';
import { createPlayerUiSignalBus, type PlayerUiSignalBus } from './ui-signal-bus.ts';
import { createPlayerInputSignalBus, type PlayerInputSignalBus } from './input-signal-bus.ts';
import { createNoopPlaybackStateLogger, createUiFramePublisher, type PlaybackStateLogger } from './playback-support.ts';
import { createScoreTracker } from './scoring.ts';
import {
  judgeWindowLateReachUs,
  resolveRuleset,
  rulesetChartFactsFromChart,
  type RulesetConfig,
} from '../ruleset/index.ts';
import type { JudgeCoreEffectSink, JudgeCoreScore } from './judge-core.ts';
import { createPlaylogRecorder, type PlaylogRecorder } from '../playlog/recorder.ts';
import { courseStageCarryCombo, courseStageRulesetOptions } from '../playlog/rulesets.ts';
import { createBeatAtSecondsResolverFromTimingResolver } from './timeline.ts';
import { createInitialPlayerSummary, preparePlaybackChart, type PreparedPlaybackChartData } from './bootstrap.ts';
import {
  appendShadowedNoteTriggers,
  collectRealtimeAudioTriggers,
  createDebugActiveAudioEstimator,
} from './engine-audio.ts';
import { type PlaybackClock } from './engine-clock.ts';
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
  createNoTuiPlaybackEventTracer,
  createNoTuiPlaybackStateLogger,
  emitPlayerLog,
  resolveOutputWriter,
  writeRealtimeTriggeredEventLog,
  writeRealtimeVolumeEventLog,
  type NoTuiPlaybackEventTracer,
} from './engine-trace.ts';
import type {
  AudioSession,
  CreatePlayerUiRuntimeContext,
  PlayerInputRuntime,
  PlayerOptions,
  PlayerSummary,
  PlayerUiRuntime,
} from './engine-types.ts';
import { createRealtimeAudioCursor, type RealtimeAudioCursor } from './play-audio-cursor.ts';
import type { JudgeStrategy } from './play-strategy.ts';

/**
 * A play session: everything a play is set up with before its loop runs — the chart resolved for play, the tempo clock,
 * the ruleset, the score, the play-log recorder, the UI / input buses and runtimes, the audio session, the no-TUI
 * trace and the realtime audio. The same for every judge strategy.
 */
export interface PlaySession {
  readonly options: PlayerOptions;
  readonly strategy: JudgeStrategy;
  readonly writeOutput: (text: string) => void;
  /** The chart after control flow, as the engine plays it. */
  readonly resolvedJson: BeMusicJson;
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
  readonly audioOffsetMs: number;
  readonly beatAtSeconds: (seconds: number) => number;
  readonly idBase: 36 | 62;
  readonly wavResources: Readonly<Record<string, string>>;
  /** AUTO SCRATCH in a manual play: the judge plays the scratch lanes. */
  readonly autoScratch: boolean;
  readonly endOnFailure: boolean;
  /** The play re-drives a recorded play (`PlayerOptions.replayInputs`). */
  readonly replay: boolean;
  readonly playlogRecorder: PlaylogRecorder | undefined;
  readonly stateSignals: PlayerStateSignals;
  readonly uiSignals: PlayerUiSignalBus;
  readonly inputSignals: PlayerInputSignalBus;
  readonly uiRuntime: PlayerUiRuntime | undefined;
  readonly uiEnabled: boolean;
  /** The state signals while a UI runtime shows them. */
  readonly activeStateSignals: PlayerStateSignals | undefined;
  readonly audioSession: AudioSession | undefined;
  readonly inputRuntime: PlayerInputRuntime | undefined;
  readonly tracer: NoTuiPlaybackEventTracer;
  readonly stateLogger: PlaybackStateLogger;
  readonly publishUiFrame: (seconds: number, beat: number) => void;
  /** Maps the judge's effects onto audio, the UI buses, the play log and the trace. */
  readonly applyJudgeEffect: JudgeCoreEffectSink;
  /** The chart's volume changes (`#97` / `#98`), queued against the audio write head. */
  readonly volumeChanges: RealtimeAudioCursor;
  /** The chart's background sounds, queued against the audio write head. */
  readonly backgroundAudio: RealtimeAudioCursor;
  /** The play clock, from the moment the chart starts (after the lead-in). */
  clock: PlaybackClock | undefined;
}

/** The UI runtime's label for the mode. */
function uiModeLabel(strategy: JudgeStrategy, autoScratch: boolean): CreatePlayerUiRuntimeContext['mode'] {
  if (strategy.mode === 'auto') return 'AUTO';
  return autoScratch ? 'AUTO SCRATCH' : 'MANUAL';
}

/** Sets a play up: resolves its chart, builds its judging setup and starts its runtimes (not the play itself). */
export async function createPlaySession(
  json: BeMusicJson,
  options: PlayerOptions,
  strategy: JudgeStrategy,
): Promise<PlaySession> {
  const { mode, drifts } = strategy;
  throwIfAborted(options.signal);
  const writeOutput = resolveOutputWriter(options);
  reportLoadProgress(options, 0.02, 'Resolving chart...');
  const controlFlowResolution = resolvePlayerChart(json, options);
  const resolvedJson = controlFlowResolution.resolvedJson;
  options.onResolvedChart?.(resolvedJson);
  const randomPatternSummary = formatRandomPatternSummary(controlFlowResolution.randomPatterns);
  const autoScratch = mode === 'manual' && options.autoScratch === true;
  const speed = options.speed ?? 1;
  const tempoClock = createTempoClock(speed);
  const leadInMs = options.leadInMs ?? 1500;
  const audioOffsetMs = options.audioOffsetMs ?? 0;
  const replay = options.replayInputs !== undefined;
  const resolvedChart = resolveEngineChart(resolvedJson, options);
  const beatAtSeconds = createBeatAtSecondsResolverFromTimingResolver(resolvedChart.timing);
  // Dynamic `#EXRANKxx` changes are a chart fact, recorded whatever the ruleset: LR2 applies them, while beatoraja and
  // IIDX keep their initial windows (their `windowsAt` ignores the timeline). A log played under one ruleset can then
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
    preparePlaybackChart(resolvedChart, { laneModeExtension: options.laneModeExtension }, realtimeAudioEndSeconds);
  // A duplicate note that lost its lane and position to another note is not judged, but its keysound still sounds, as
  // background audio at its own time.
  appendShadowedNoteTriggers(backgroundTriggers, resolvedChart, playbackChart.shadowedNotes);
  // Constant for the whole play and read on every tick and judgment: hoisted out of the hot paths.
  const idBase = resolveBmsBase(resolvedJson);
  const wavResources = resolvedJson.resources.wav;

  // The gauge the play runs on and the play log records: one value, so a re-simulation runs the same gauge. A host that
  // only declared it for the log (`recordPlaylog.gauge`) gets it played too.
  const selectedGauge = options.gauge ?? options.recordPlaylog?.gauge;
  const ruleset = resolveRuleset(
    rulesetChartFactsFromChart(resolvedJson, playbackChart, judgeRankChanges, options.stageRanks),
    options.judgeRuleset ?? 'lr2',
    {
      ...(selectedGauge !== undefined ? { selectedGauge } : {}),
      ...(options.judgeWindowMs !== undefined ? { judgeWindowOverrideMs: options.judgeWindowMs } : {}),
      ...(options.course !== undefined ? { course: courseStageRulesetOptions(options.course) } : {}),
    },
  );
  reportResolvedRuleset(options, ruleset);
  const endOnFailure = options.endOnFailure ?? true;

  const score: JudgeCoreScore = {
    ...createInitialPlayerSummary(ruleset, ruleset.noteCount),
    scoreTracker: createScoreTracker({
      moneyScore: ruleset.moneyScore,
      ...(options.course !== undefined ? { course: courseStageCarryCombo(options.course) } : {}),
    }),
  };
  const summary: PlayerSummary = score.summary;
  if (score.scoreTracker.course !== undefined) {
    // The same object the tracker updates, so the summary always shows the live course combo.
    summary.course = score.scoreTracker.course;
  }
  const playlogRecorder = options.onPlaylogRecorded
    ? (() => {
        const { chartSha256, chartMd5, recorder, sourceChart, ...hostPlaySettings } = options.recordPlaylog ?? {};
        return createPlaylogRecorder({
          json: resolvedJson,
          moneyScore: ruleset.moneyScore,
          chart: playbackChart,
          chartSha256,
          chartMd5,
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
            judgeWindowOverrideMs: options.judgeWindowMs,
            judgeRuleset: options.judgeRuleset,
            ...(options.randomDraws !== undefined ? { randomDraws: options.randomDraws } : {}),
            ...(endOnFailure && !drifts.omitsEndOnFailure ? { endOnFailure } : {}),
            ...(options.course !== undefined ? { course: options.course } : {}),
            ...hostPlaySettings,
            gauge: selectedGauge,
            // The tempo a live play ran at (its inputs are in chart time either way). A replay's `speed` only sets how
            // fast it is re-driven, so it records none.
            ...(speed !== 1 && (!replay || drifts.recordsTempoInReplay) ? { tempo: speed } : {}),
          },
        });
      })()
    : undefined;

  const highSpeed = resolveHighSpeedMultiplier(options.highSpeed);
  const stateSignals = createPlayerStateSignals(highSpeed);
  const { landmineNotes, invisibleNotes, renderNotes, laneBindings, laneDisplayMode, inputTokenToChannels } =
    playbackChart;
  const uiSignals = createPlayerUiSignalBus({
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
      resolvedJson,
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
    : createNoTuiPlaybackEventTracer({
        resolved: resolvedChart,
        writeOutput,
        judgeWindowMs: options.judgeWindowMs,
      });
  const stateLogger = uiEnabled
    ? createNoopPlaybackStateLogger()
    : createNoTuiPlaybackStateLogger({ writeOutput, summary, base: idBase });

  throwIfAborted(options.signal);
  const audioBackendLabel = resolveAudioBackendLabel(options, audioSession);
  let activeAudioEstimator: Awaited<ReturnType<typeof createDebugActiveAudioEstimator>> | undefined;
  if (strategy.estimatesActiveAudio) {
    activeAudioEstimator = options.debugActiveAudio
      ? await createDebugActiveAudioEstimator(resolvedChart, { baseDir: options.audioBaseDir, signal: options.signal })
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
  const publishUiFrame = createUiFramePublisher({
    uiEnabled,
    uiSignals,
    totalSeconds,
    summary,
    notes: renderNotes,
    landmineNotes,
    invisibleNotes,
    audioBackend: audioBackendLabel,
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
    playlogRecorder,
    publishUiFrame,
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

  return {
    options,
    strategy,
    writeOutput,
    resolvedJson,
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
    audioOffsetMs,
    beatAtSeconds,
    idBase,
    wavResources,
    autoScratch,
    endOnFailure,
    replay,
    playlogRecorder,
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
    publishUiFrame,
    applyJudgeEffect,
    volumeChanges,
    backgroundAudio,
    clock: undefined,
  };
}
