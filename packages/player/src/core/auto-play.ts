import { isInvisibleNoteChannel } from '@be-music/chart';
import { throwIfAborted } from '@be-music/utils/core';
import { type BeMusicJson, resolveBmsBase } from '@be-music/json';
import { createPlayerStateSignals } from '../state-signals.ts';
import { formatSeconds, resolveAltModifierLabel } from '../utils.ts';
import { resolveHighSpeedMultiplier } from './high-speed-control.ts';
import { createPlayerUiSignalBus } from './ui-signal-bus.ts';
import { createPlayerInputSignalBus } from './input-signal-bus.ts';
import { createInputWakeUp } from './input-wakeup.ts';
import {
  applyPlaybackHighSpeedAction,
  consumePlaybackInputCommands,
  createNoopPlaybackStateLogger,
  createUiFramePublisher,
  togglePlaybackPause,
} from './playback-support.ts';
import { createScoreTracker } from './scoring.ts';
import { resolveRuleset, rulesetChartFactsFromChart } from '../ruleset/index.ts';
import { createAutoJudgeState, isAutoJudgeSettled, runAutoJudgeStep, type AutoJudgeInput } from './auto-judge-core.ts';
import { clampToReversal } from './judge-core.ts';
import { courseStageCarryCombo, courseStageRulesetOptions } from '../playlog/rulesets.ts';
import { createPlaylogRecorder } from '../playlog/recorder.ts';
import { createBeatAtSecondsResolverFromTimingResolver } from './timeline.ts';
import { createInitialPlayerSummary, preparePlaybackChart } from './bootstrap.ts';
import { collectRealtimeAudioTriggers, createDebugActiveAudioEstimator } from './engine-audio.ts';
import {
  createAudioPlaybackClockSource,
  createPlaybackClock,
  delay,
  elapsedMsToGameSeconds,
  PAUSE_POLL_INTERVAL_MS,
  type PlaybackClock,
  REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS,
  TUI_FRAME_INTERVAL_MS,
  waitPreciseOrInput,
} from './engine-clock.ts';
import { createJudgeEffectHandler } from './engine-effects.ts';
import {
  collectRealtimeAudioVolumeEvents,
  disposeAudioSessionSafely,
  finalizeAudioSessionSafely,
  formatRandomPatternSummary,
  initializePlaybackRuntimeResources,
  reportLoadProgress,
  reportResolvedRuleset,
  resolveAudioBackendLabel,
  resolveEngineChart,
  resolvePlayerChart,
  settleMaybeAsyncWithTimeout,
} from './engine-preparation.ts';
import {
  createNoopPlaybackEventTracer,
  createNoTuiPlaybackEventTracer,
  createNoTuiPlaybackStateLogger,
  emitPlayerLog,
  printLaneMap,
  renderSummary,
  resolveOutputWriter,
  writePlayableSampleTriggerEventLog,
  writeRealtimeTriggeredEventLog,
  writeRealtimeVolumeEventLog,
  writeRuntimeEventLog,
} from './engine-trace.ts';
import {
  PlayerInterruptedError,
  type PlayerInterruptReason,
  type PlayerOptions,
  type PlayerSummary,
} from './engine-types.ts';

/**
 * The AUTO play driver: steps the auto judge core from the playback clock.
 */
export async function autoPlay(json: BeMusicJson, options: PlayerOptions = {}): Promise<PlayerSummary> {
  throwIfAborted(options.signal);
  const writeOutput = resolveOutputWriter(options);
  reportLoadProgress(options, 0.02, 'Resolving chart...');
  const controlFlowResolution = resolvePlayerChart(json, options);
  const resolvedJson = controlFlowResolution.resolvedJson;
  options.onResolvedChart?.(resolvedJson);
  const randomPatternSummary = formatRandomPatternSummary(controlFlowResolution.randomPatterns);
  const speed = options.speed ?? 1;
  const leadInMs = options.leadInMs ?? 1500;
  const audioOffsetMs = options.audioOffsetMs ?? 0;
  const resolvedChart = resolveEngineChart(resolvedJson, options);
  const timingResolver = resolvedChart.timing;
  const beatAtSeconds = createBeatAtSecondsResolverFromTimingResolver(timingResolver);
  const realtimeAudioVolumeEvents = collectRealtimeAudioVolumeEvents(resolvedChart);
  const realtimeAudioTriggers = collectRealtimeAudioTriggers(
    resolvedChart,
    (channel) => !isInvisibleNoteChannel(channel),
  );
  const realtimeAudioEndSeconds =
    options.audio === false
      ? 0
      : Math.max(realtimeAudioTriggers.at(-1)?.seconds ?? 0, realtimeAudioVolumeEvents.at(-1)?.seconds ?? 0);
  // Prefer the host-provided `preparedChart` over running our own extract pass. See `PlayerOptions.preparedChart`
  // for the why — sharing the playable / landmine / invisible note arrays with the renderer eliminates a whole
  // class of "view and engine each ran `extractTimedNotes` with subtly different arguments and the parallel
  // arrays drifted" bugs that plagued the web runtime through the Phase-4c shared-engine migration.
  const playbackChart =
    options.preparedChart ??
    preparePlaybackChart(resolvedChart, { laneModeExtension: options.laneModeExtension }, realtimeAudioEndSeconds);
  const {
    landmineNotes,
    invisibleNotes,
    renderNotes,
    laneBindings,
    laneDisplayMode,
    scorableNotes,
    inputTokenToChannels,
  } = playbackChart;
  let { totalSeconds } = playbackChart;
  // Hoist values that are constant for the entire play session out of the per-frame / per-event hot loops. Both fields
  // live on `resolvedJson`, which the engine treats as immutable from this point on. The auto-play loop touches each
  // many times per tick (LN body, every triggered sample, mine resolution, ...), and `resolveBmsBase` does a tiny
  // property walk each call — small individually but accumulates into measurable per-second overhead on dense charts.
  const idBase = resolveBmsBase(resolvedJson);
  const wavResources = resolvedJson.resources.wav;
  const keyMap = new Map(laneBindings.map((binding) => [binding.channel, binding.keyLabel]));
  // The gauge the play runs on and the play log records: one value, so a re-simulation runs the same gauge. A host that
  // only declared it for the log (`recordPlaylog.gauge`) gets it played too.
  const selectedGauge = options.gauge ?? options.recordPlaylog?.gauge;
  const autoRuleset = resolveRuleset(
    rulesetChartFactsFromChart(resolvedJson, playbackChart, [], options.stageRanks),
    options.judgeRuleset ?? 'lr2',
    {
      ...(selectedGauge !== undefined ? { selectedGauge } : {}),
      ...(options.judgeWindowMs !== undefined ? { judgeWindowOverrideMs: options.judgeWindowMs } : {}),
      ...(options.course !== undefined ? { course: courseStageRulesetOptions(options.course) } : {}),
    },
  );
  reportResolvedRuleset(options, autoRuleset);
  // LR2 negative-BPM reversal (#134) — see `manualPlay`. AUTO play freezes the same way: no judging and no audio past
  // it (the realtime streams are cut in `collectRealtimeAudioTriggers`), and a mirrored display clock.
  const reversalSeconds = resolvedChart.reversal?.seconds;
  const autoJudge = createAutoJudgeState(
    { ruleset: autoRuleset, scorableNotes, landmineNotes, invisibleNotes, keyLabels: keyMap, reversalSeconds },
    {
      ...createInitialPlayerSummary(autoRuleset, autoRuleset.noteCount),
      scoreTracker: createScoreTracker({
        moneyScore: autoRuleset.moneyScore,
        ...(options.course !== undefined ? { course: courseStageCarryCombo(options.course) } : {}),
      }),
    },
  );
  const summary: PlayerSummary = autoJudge.summary;
  if (autoJudge.scoreTracker.course !== undefined) {
    summary.course = autoJudge.scoreTracker.course;
  }
  // AUTO plays never have manual inputs, but recording still snapshots the resolved chart + play settings so an
  // auto run produces a structurally complete playlog (simulators treat an empty input stream as all-miss; the
  // cached native result carries the actual AUTO outcome).
  const playlogRecorder = options.onPlaylogRecorded
    ? (() => {
        const { chartSha256, chartMd5, recorder, sourceChart, ...hostPlaySettings } = options.recordPlaylog ?? {};
        return createPlaylogRecorder({
          json: resolvedJson,
          moneyScore: autoRuleset.moneyScore,
          chart: playbackChart,
          chartSha256,
          chartMd5,
          recorder,
          laneModeExtension: options.laneModeExtension,
          // The chart the engine was handed is the source when it resolved the control flow itself.
          sourceChart: sourceChart ?? json,
          dynamicJudgeRankChanges: resolvedChart.judgeRank.changes,
          ...(options.stageRanks !== undefined ? { stageRanks: options.stageRanks } : {}),
          reversalSeconds,
          play: {
            mode: 'auto',
            autoScratch: false,
            judgeWindowOverrideMs: options.judgeWindowMs,
            judgeRuleset: options.judgeRuleset,
            ...(options.randomDraws !== undefined ? { randomDraws: options.randomDraws } : {}),
            ...(options.course !== undefined ? { course: options.course } : {}),
            ...hostPlaySettings,
            gauge: selectedGauge,
            // The tempo the play ran at; its inputs are in chart time either way.
            ...(speed !== 1 ? { tempo: speed } : {}),
          },
        });
      })()
    : undefined;
  let interruptedReason: PlayerInterruptReason | undefined;
  let highSpeed = resolveHighSpeedMultiplier(options.highSpeed);
  const stateSignals = createPlayerStateSignals(highSpeed);
  const uiSignals = createPlayerUiSignalBus({
    currentBeat: 0,
    currentSeconds: 0,
    totalSeconds,
    summary,
    notes: renderNotes,
    landmineNotes,
    invisibleNotes,
  });
  const inputSignals = createPlayerInputSignalBus();
  const {
    uiRuntime,
    totalSeconds: playbackTotalSeconds,
    uiEnabled,
    activeStateSignals,
    audioSession,
  } = await initializePlaybackRuntimeResources({
    resolvedJson,
    resolvedChart,
    options,
    mode: 'AUTO',
    laneDisplayMode,
    laneBindings,
    speed,
    judgeWindowMs: 0,
    highSpeed,
    randomPatternSummary,
    stateSignals,
    uiSignals,
    totalSeconds,
    audioMode: 'auto',
  });
  totalSeconds = playbackTotalSeconds;

  const inputRuntime = options.createInputRuntime?.({
    mode: 'auto',
    inputSignals,
    inputTokenToChannels,
  });
  const playbackEventTracer = uiEnabled
    ? createNoopPlaybackEventTracer()
    : createNoTuiPlaybackEventTracer({
        resolved: resolvedChart,
        writeOutput,
      });
  const playbackStateLogger = uiEnabled
    ? createNoopPlaybackStateLogger()
    : createNoTuiPlaybackStateLogger({ writeOutput, summary, base: idBase });
  throwIfAborted(options.signal);
  const audioBackendLabel = resolveAudioBackendLabel(options, audioSession);
  const autoDebugAudioEstimator = options.debugActiveAudio
    ? await createDebugActiveAudioEstimator(resolvedChart, {
        baseDir: options.audioBaseDir,
        signal: options.signal,
      })
    : undefined;
  throwIfAborted(options.signal);
  reportLoadProgress(options, 1, 'Ready');
  options.onLoadComplete?.();
  emitPlayerLog(options, 'info', 'playback.prepared', {
    mode: 'auto',
    uiEnabled,
    audioEnabled: audioSession !== undefined,
    totalSeconds,
  });
  const resolveDebugActiveAudioState = (
    nowSeconds: number,
  ): { activeAudioFiles?: string[]; activeAudioVoiceCount?: number } => {
    if (options.debugActiveAudio !== true) {
      return {};
    }
    const sessionVoiceCount = audioSession?.getActiveAudioVoiceCount?.() ?? 0;
    const sessionFiles = audioSession?.getActiveAudioFiles?.() ?? [];
    if (sessionVoiceCount > 0 || sessionFiles.length > 0) {
      return {
        activeAudioFiles: sessionFiles,
        activeAudioVoiceCount: sessionVoiceCount,
      };
    }
    const estimated = autoDebugAudioEstimator?.resolve(nowSeconds);
    return {
      activeAudioFiles: estimated?.activeAudioFiles ?? [],
      activeAudioVoiceCount: estimated?.activeAudioVoiceCount ?? 0,
    };
  };
  const highSpeedModifierLabel = resolveAltModifierLabel();
  const publishUiFrame = createUiFramePublisher({
    uiEnabled,
    uiSignals,
    totalSeconds,
    summary,
    notes: renderNotes,
    landmineNotes,
    invisibleNotes,
    audioBackend: audioBackendLabel,
    resolveDebugActiveAudioState,
    reversal: resolvedChart.reversal,
  });

  if (!uiEnabled) {
    writeOutput('Auto play start\n');
    writeOutput(`Lane mode: ${laneDisplayMode}\n`);
    if (randomPatternSummary) {
      writeOutput(`${randomPatternSummary}\n`);
    }
    printLaneMap(writeOutput, laneBindings);
    writeOutput('Press Space to pause/resume. Press Shift+R to restart.\n');
    writeOutput('Press Ctrl+C or Esc to quit.\n');
    writeOutput(`Press ${highSpeedModifierLabel}+odd lane key to decrease HIGH-SPEED.\n`);
    writeOutput(`Press ${highSpeedModifierLabel}+even lane key to increase HIGH-SPEED.\n`);
  } else {
    emitPlayerLog(options, 'info', 'ui.start', {
      mode: 'auto',
    });
    uiRuntime?.start();
    activeStateSignals?.publishJudgeCombo('READY', 0);
    publishUiFrame(0, 0);
    emitPlayerLog(options, 'debug', 'ui.initial-frame.published', {
      mode: 'auto',
      seconds: 0,
      beat: 0,
    });
  }

  let playbackClock: PlaybackClock | undefined;
  let realtimeAudioVolumeEventIndex = 0;
  let realtimeAudioTriggerIndex = 0;
  const resolveAutoCommandSeconds = (): number =>
    playbackClock ? elapsedMsToGameSeconds(playbackClock.nowMs(), speed) : 0;
  const resolveAutoInterruptSeconds = (): number | undefined =>
    playbackClock ? elapsedMsToGameSeconds(playbackClock.nowMs(), speed) : undefined;

  const togglePause = (): void => {
    togglePlaybackPause({
      playbackClock,
      audioSession,
      activeStateSignals,
      onStateChange: !uiEnabled
        ? (state, nowMs) => {
            writeRuntimeEventLog(writeOutput, 'playback-state', [
              ['time', formatSeconds(elapsedMsToGameSeconds(nowMs, speed))],
              ['state', state],
            ]);
          }
        : undefined,
    });
  };
  const consumeInputCommands = (): void => {
    consumePlaybackInputCommands({
      inputSignals,
      isInterrupted: () => interruptedReason !== undefined,
      setInterruptedReason: (reason) => {
        interruptedReason = reason;
      },
      onTogglePause: togglePause,
      onHighSpeedAction: (action) => {
        highSpeed = applyPlaybackHighSpeedAction({
          action,
          currentHighSpeed: highSpeed,
          activeStateSignals,
          onHighSpeedChange: options.onHighSpeedChange,
          logHighSpeedChange: !uiEnabled
            ? (nextHighSpeed) => {
                writeRuntimeEventLog(writeOutput, 'high-speed-change', [
                  ['time', formatSeconds(resolveAutoCommandSeconds())],
                  ['value', `x${nextHighSpeed.toFixed(1)}`],
                ]);
              }
            : undefined,
        });
      },
      onViewChange: (change) => playlogRecorder?.recordViewChange(resolveAutoCommandSeconds(), change),
      logInterrupt: !uiEnabled
        ? (reason) => {
            const interruptSeconds = resolveAutoInterruptSeconds();
            if (interruptSeconds === undefined) {
              return;
            }
            writeRuntimeEventLog(writeOutput, 'interrupt', [
              ['time', formatSeconds(interruptSeconds)],
              ['reason', reason],
            ]);
          }
        : undefined,
    });
  };

  const triggerRealtimeAudioVolumeEvents = (referenceSeconds: number): void => {
    const triggerEvent = audioSession?.triggerEvent;
    if (!triggerEvent) {
      return;
    }
    const safeReferenceSeconds = Math.max(0, referenceSeconds) + REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS;
    while (realtimeAudioVolumeEventIndex < realtimeAudioVolumeEvents.length) {
      const volumeEvent = realtimeAudioVolumeEvents[realtimeAudioVolumeEventIndex]!;
      if (volumeEvent.seconds > safeReferenceSeconds) {
        break;
      }
      if (!uiEnabled) {
        writeRealtimeVolumeEventLog(writeOutput, volumeEvent.seconds, volumeEvent.event);
      }
      triggerEvent(volumeEvent.event);
      realtimeAudioVolumeEventIndex += 1;
    }
  };

  const triggerRealtimeAudioEvents = (referenceSeconds: number): void => {
    const triggerEvent = audioSession?.triggerEvent;
    if (!triggerEvent) {
      return;
    }
    const safeReferenceSeconds = Math.max(0, referenceSeconds) + REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS;
    while (realtimeAudioTriggerIndex < realtimeAudioTriggers.length) {
      const trigger = realtimeAudioTriggers[realtimeAudioTriggerIndex]!;
      if (trigger.seconds > safeReferenceSeconds) {
        break;
      }
      if (!uiEnabled) {
        writeRealtimeTriggeredEventLog(writeOutput, trigger, wavResources[trigger.sampleKey], 'realtime');
      }
      triggerEvent(trigger.event);
      realtimeAudioTriggerIndex += 1;
    }
  };

  const applyJudgeEffect = createJudgeEffectHandler({
    uiEnabled,
    writeOutput,
    wavResources,
    idBase,
    audioSession,
    playbackStateLogger,
    playbackEventTracer,
    uiSignals,
    activeStateSignals,
    playlogRecorder: undefined,
    publishUiFrame,
    beatAtSeconds,
  });
  const stepAutoJudge = (input: AutoJudgeInput): void => {
    runAutoJudgeStep(autoJudge, input, applyJudgeEffect);
  };

  inputRuntime?.start();

  // Event-driven wake-up so the loop's inter-tick sleep can be cut short the moment a control command
  // arrives (toggle-pause / interrupt / high-speed). autoPlay doesn't act on lane-input but every
  // `pushCommand` still flips `inputSignals.tick` once and resolves the wake-up — that's harmless because
  // the loop's next iteration just consumes-and-discards the lane-input. The wake-up is disposed in the
  // outer `finally` below so its alien-signals subscription doesn't outlive the playback session.
  const inputWakeUp = createInputWakeUp(inputSignals);

  try {
    await delay(leadInMs);
    consumeInputCommands();
    if (!interruptedReason) {
      emitPlayerLog(options, 'info', 'audio.start', {
        mode: 'auto',
      });
      audioSession?.start();
      if (!uiEnabled) {
        writeRuntimeEventLog(writeOutput, 'playback-start', [
          ['time', formatSeconds(0)],
          ['mode', 'auto'],
        ]);
      }

      const chartClock = createPlaybackClock(
        createAudioPlaybackClockSource(audioSession),
        audioOffsetMs + (audioSession?.chartStartDelayMs ?? 0),
      );
      playbackClock = chartClock;
      playbackEventTracer.flushUntil(0);
      let autoPlayableAudioIndex = 0;

      const triggerAutoPlayableNoteAudio = (referenceSeconds: number): void => {
        // Note keysounds freeze with the judge pump at an LR2 negative-BPM reversal (#134).
        const safeReferenceSeconds =
          Math.max(0, clampToReversal(autoJudge.config, referenceSeconds)) + REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS;
        while (autoPlayableAudioIndex < scorableNotes.length) {
          const note = scorableNotes[autoPlayableAudioIndex]!;
          if (note.seconds > safeReferenceSeconds) {
            break;
          }
          if (!uiEnabled) {
            writePlayableSampleTriggerEventLog(
              writeOutput,
              note.event,
              note.seconds,
              wavResources,
              'auto-note',
              note.channel,
              idBase,
            );
          }
          audioSession?.triggerEvent?.(note.event);
          autoPlayableAudioIndex += 1;
        }
      };

      const playbackHorizonMs = (totalSeconds * 1000) / speed + 1000;
      while (chartClock.nowMs() < playbackHorizonMs) {
        consumeInputCommands();
        if (interruptedReason) {
          break;
        }

        const nowMs = chartClock.nowMs();
        if (chartClock.isPaused()) {
          const nowSec = elapsedMsToGameSeconds(nowMs, speed);
          publishUiFrame(nowSec, beatAtSeconds(nowSec));
          // While paused, the only useful inputs are toggle-pause (resume) and interrupt — both processed
          // by the next iteration's `consumeInputCommands`. Cutting the poll short on input arrival makes
          // pause-resume feel instantaneous.
          await waitPreciseOrInput(PAUSE_POLL_INTERVAL_MS, inputWakeUp);
          continue;
        }

        const scheduledMs = chartClock.scheduledMs();
        const nowSec = elapsedMsToGameSeconds(nowMs, speed);
        const scheduledSec = elapsedMsToGameSeconds(scheduledMs, speed);
        playbackEventTracer.flushUntil(nowSec);
        // Queue audio against the write head, then judge and render against what is actually audible.
        triggerRealtimeAudioVolumeEvents(scheduledSec);
        triggerRealtimeAudioEvents(scheduledSec);
        triggerAutoPlayableNoteAudio(scheduledSec);
        stepAutoJudge({ kind: 'advance', nowSec });
        publishUiFrame(nowSec, beatAtSeconds(nowSec));

        const safeNowSeconds = Math.max(0, nowSec) + REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS;
        if (
          autoPlayableAudioIndex >= scorableNotes.length &&
          isAutoJudgeSettled(autoJudge) &&
          safeNowSeconds >= totalSeconds
        ) {
          break;
        }

        // Race the 60 Hz tick against the next input arrival so control commands (Space / ESC / high-speed)
        // resolve within ~1 ms instead of waiting up to a full tick. autoPlay doesn't act on lane-input,
        // but lane presses still wake the loop — that's harmless because the next iteration just
        // consumes-and-discards them via `consumeInputCommands`.
        await waitPreciseOrInput(TUI_FRAME_INTERVAL_MS, inputWakeUp);
      }

      if (!interruptedReason) {
        triggerRealtimeAudioVolumeEvents(totalSeconds);
        triggerRealtimeAudioEvents(totalSeconds);
        triggerAutoPlayableNoteAudio(totalSeconds);
        stepAutoJudge({ kind: 'reach', nowSec: totalSeconds });
        const totalScheduledMs = (totalSeconds * 1000) / speed;
        const totalWaitMs = Math.max(0, totalScheduledMs - chartClock.nowMs());
        if (totalWaitMs > 0) {
          // Trailing wait for chart end. ESC during this window should still abort promptly, so race the
          // sleep against the wake-up the same way the main tick does.
          await waitPreciseOrInput(Math.min(totalWaitMs, TUI_FRAME_INTERVAL_MS), inputWakeUp);
        }
        playbackEventTracer.flushUntil(totalSeconds);
        stepAutoJudge({ kind: 'finish', totalSeconds });
        publishUiFrame(totalSeconds, beatAtSeconds(totalSeconds));
      }
    }
  } finally {
    if (interruptedReason) {
      await disposeAudioSessionSafely(audioSession);
    } else {
      await finalizeAudioSessionSafely(audioSession);
    }
    inputRuntime?.stop();
    inputWakeUp.dispose();
    await settleMaybeAsyncWithTimeout(uiRuntime?.stop(), 300);
    await settleMaybeAsyncWithTimeout(uiRuntime?.dispose(), 300);
  }

  if (interruptedReason === 'ctrl-c') {
    throw new PlayerInterruptedError(interruptedReason);
  }
  if (interruptedReason === 'restart') {
    throw new PlayerInterruptedError(interruptedReason);
  }

  if (!uiEnabled) {
    writeRuntimeEventLog(writeOutput, 'playback-end', [
      ['time', formatSeconds(totalSeconds)],
      ['reason', 'complete'],
    ]);
    playbackStateLogger.logResult(totalSeconds, {
      reason: 'complete',
      summary,
    });
  }
  if (playlogRecorder) {
    options.onPlaylogRecorded?.(
      playlogRecorder.finalize({
        summary,
        maxCombo: autoJudge.scoreTracker.maxCombo,
        aborted: interruptedReason === 'escape',
      }),
    );
  }
  writeOutput(renderSummary(summary, autoRuleset.moneyScore));
  return summary;
}
