import { isPlayLaneSoundChannel } from '@be-music/chart';
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
import { type JudgeWindowRuleset } from './judge-window.ts';
import { judgeWindowLateReachUs, resolveRuleset, rulesetChartFactsFromChart } from '../ruleset/index.ts';
import {
  advanceJudgeCoreReplay,
  createJudgeCoreReplay,
  createJudgeCoreState,
  isJudgeCoreSettled,
  isJudgingClosed,
  maxJudgeReachSeconds,
  resolveJudgeInputChannels,
  runJudgeCoreStep,
  type JudgeCoreInput,
} from './judge-core.ts';
import { createPlaylogRecorder } from '../playlog/recorder.ts';
import { courseStageCarryCombo, courseStageRulesetOptions } from '../playlog/rulesets.ts';
import { createBeatAtSecondsResolverFromTimingResolver } from './timeline.ts';
import { createInitialPlayerSummary, preparePlaybackChart } from './bootstrap.ts';
import { appendShadowedNoteTriggers, collectRealtimeAudioTriggers } from './engine-audio.ts';
import {
  createAudioPlaybackClockSource,
  createPlaybackClock,
  delay,
  elapsedMsToGameSeconds,
  PAUSE_POLL_INTERVAL_MS,
  REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS,
  resolveJudgeNowMsFromPressedAt,
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
  formatJudgeWindowSet,
  printLaneMap,
  renderSummary,
  resolveOutputWriter,
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
 * The manual play driver: feeds the judge core clock time and key input, and replays play logs.
 */
export async function manualPlay(json: BeMusicJson, options: PlayerOptions = {}): Promise<PlayerSummary> {
  throwIfAborted(options.signal);
  const writeOutput = resolveOutputWriter(options);
  reportLoadProgress(options, 0.02, 'Resolving chart...');
  const controlFlowResolution = resolvePlayerChart(json, options);
  const resolvedJson = controlFlowResolution.resolvedJson;
  options.onResolvedChart?.(resolvedJson);
  const randomPatternSummary = formatRandomPatternSummary(controlFlowResolution.randomPatterns);
  const autoScratchEnabled = options.autoScratch === true;
  const speed = options.speed ?? 1;
  const judgeRuleset: JudgeWindowRuleset = options.judgeRuleset ?? 'lr2';
  const resolvedChart = resolveEngineChart(resolvedJson, options);
  const timingResolver = resolvedChart.timing;
  // Dynamic `#EXRANKxx` changes are a chart fact, recorded whatever the ruleset: LR2 applies them, while beatoraja and
  // IIDX keep their initial windows (their `windowsAt` ignores the timeline). A log played under one ruleset can then
  // be re-simulated under LR2 with the windows LR2 would have used.
  const dynamicJudgeRankChanges = resolvedChart.judgeRank.changes;
  const realtimeAudioVolumeEvents = collectRealtimeAudioVolumeEvents(resolvedChart);
  const leadInMs = options.leadInMs ?? 1500;
  const audioOffsetMs = options.audioOffsetMs ?? 0;
  const beatAtSeconds = createBeatAtSecondsResolverFromTimingResolver(timingResolver);
  const nonPlayableRealtimeAudioTriggers = collectRealtimeAudioTriggers(
    resolvedChart,
    (channel) => !isPlayLaneSoundChannel(channel),
  );
  const nonPlayableRealtimeAudioEndSeconds =
    options.audio === false
      ? 0
      : Math.max(nonPlayableRealtimeAudioTriggers.at(-1)?.seconds ?? 0, realtimeAudioVolumeEvents.at(-1)?.seconds ?? 0);
  // Same shared-instance fast path as `autoPlay`. See `PlayerOptions.preparedChart`.
  const playbackChart =
    options.preparedChart ??
    preparePlaybackChart(
      resolvedChart,
      { laneModeExtension: options.laneModeExtension },
      nonPlayableRealtimeAudioEndSeconds,
    );
  const {
    laneSoundNotes,
    landmineNotes,
    invisibleNotes,
    renderNotes,
    laneBindings,
    laneDisplayMode,
    scorableNotes,
    inputTokenToChannels,
  } = playbackChart;
  let { totalSeconds } = playbackChart;
  // A duplicate note that lost its lane and position to another note is not judged, but its keysound still sounds, as
  // background audio at its own time (auto play already sounds every play-lane trigger).
  appendShadowedNoteTriggers(nonPlayableRealtimeAudioTriggers, resolvedChart, playbackChart.shadowedNotes);
  // Hoisted constants — see the matching block in `autoPlay`. Same rationale: the manual-play loop touches both heavily
  // per tick / per input event, and these don't change across the play session.
  const idBase = resolveBmsBase(resolvedJson);
  const wavResources = resolvedJson.resources.wav;
  const scratchPlayableChannels = new Set(
    laneBindings.filter((binding) => binding.isScratch).map((binding) => binding.channel),
  );

  // The gauge the play runs on and the play log records: one value, so a re-simulation runs the same gauge. A host that
  // only declared it for the log (`recordPlaylog.gauge`) gets it played too.
  const selectedGauge = options.gauge ?? options.recordPlaylog?.gauge;
  const ruleset = resolveRuleset(
    rulesetChartFactsFromChart(resolvedJson, playbackChart, dynamicJudgeRankChanges, options.stageRanks),
    judgeRuleset,
    {
      ...(selectedGauge !== undefined ? { selectedGauge } : {}),
      ...(options.judgeWindowMs !== undefined ? { judgeWindowOverrideMs: options.judgeWindowMs } : {}),
      ...(options.course !== undefined ? { course: courseStageRulesetOptions(options.course) } : {}),
    },
  );
  reportResolvedRuleset(options, ruleset);
  const endOnFailure = options.endOnFailure ?? true;
  /** The BAD gate as a single width, for the log line and the host's judge-window readout. */
  const badWindowMs = judgeWindowLateReachUs(ruleset.windows.note) / 1000;

  const replayMode = options.replayInputs !== undefined;
  // Every judgment of the play is made by the deterministic judge core; this driver feeds it time and input and maps
  // its effects onto audio, the UI buses, the play log and the no-TUI trace.
  const judgeCore = createJudgeCoreState(
    {
      ruleset,
      scorableNotes,
      landmineNotes,
      invisibleNotes,
      laneSoundNotes,
      scratchChannels: scratchPlayableChannels,
      autoScratch: autoScratchEnabled,
      // Live play runs the hold-grace windows on the playback clock (wall-clock milliseconds). A replay has no wall
      // clock to honour: its millisecond domain is chart time, which keeps every judgment independent of `speed`.
      judgeMsPerChartSecond: replayMode ? 1000 : 1000 / speed,
      wavResources,
      idBase,
      sourceFormat: resolvedJson.sourceFormat,
      // LR2 negative-BPM reversal (#134): timing stays monotonic (the resolver integrates |BPM|), but from this chart
      // time on LR2's event pump freezes and presses are judged on the mirrored clock. The realtime audio streams are
      // already cut there (`collectRealtimeAudioTriggers` / `collectRealtimeAudioVolumeEvents`).
      reversalSeconds: resolvedChart.reversal?.seconds,
      endOnFailure,
    },
    {
      ...createInitialPlayerSummary(ruleset, ruleset.noteCount),
      scoreTracker: createScoreTracker({
        moneyScore: ruleset.moneyScore,
        ...(options.course !== undefined ? { course: courseStageCarryCombo(options.course) } : {}),
      }),
    },
  );
  const summary: PlayerSummary = judgeCore.summary;
  if (judgeCore.scoreTracker.course !== undefined) {
    // The same object the tracker updates, so the summary always shows the live course combo.
    summary.course = judgeCore.scoreTracker.course;
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
          dynamicJudgeRankChanges,
          ...(options.stageRanks !== undefined ? { stageRanks: options.stageRanks } : {}),
          reversalSeconds: resolvedChart.reversal?.seconds,
          play: {
            mode: 'manual',
            autoScratch: autoScratchEnabled,
            judgeWindowOverrideMs: options.judgeWindowMs,
            judgeRuleset: options.judgeRuleset,
            ...(options.randomDraws !== undefined ? { randomDraws: options.randomDraws } : {}),
            ...(endOnFailure ? { endOnFailure } : {}),
            ...(options.course !== undefined ? { course: options.course } : {}),
            ...hostPlaySettings,
            gauge: selectedGauge,
            // The tempo a live play ran at (its inputs are in chart time either way). A replay's `speed` only sets how
            // fast it is re-driven, so it records none.
            ...(speed !== 1 && !replayMode ? { tempo: speed } : {}),
          },
        });
      })()
    : undefined;
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
    mode: autoScratchEnabled ? 'AUTO SCRATCH' : 'MANUAL',
    laneDisplayMode,
    laneBindings,
    speed,
    judgeWindowMs: badWindowMs,
    highSpeed,
    randomPatternSummary,
    stateSignals,
    uiSignals,
    totalSeconds,
    audioMode: 'manual',
  });
  totalSeconds = playbackTotalSeconds;

  const inputRuntime = options.createInputRuntime?.({
    mode: 'manual',
    inputSignals,
    inputTokenToChannels,
  });
  const playbackEventTracer = uiEnabled
    ? createNoopPlaybackEventTracer()
    : createNoTuiPlaybackEventTracer({
        resolved: resolvedChart,
        writeOutput,
        judgeWindowMs: options.judgeWindowMs,
      });
  const playbackStateLogger = uiEnabled
    ? createNoopPlaybackStateLogger()
    : createNoTuiPlaybackStateLogger({ writeOutput, summary, base: idBase });

  throwIfAborted(options.signal);
  const audioBackendLabel = resolveAudioBackendLabel(options, audioSession);
  reportLoadProgress(options, 1, 'Ready');
  options.onLoadComplete?.();
  emitPlayerLog(options, 'info', 'playback.prepared', {
    mode: 'manual',
    uiEnabled,
    audioEnabled: audioSession !== undefined,
    totalSeconds,
  });
  const resolveDebugActiveAudioState = (): { activeAudioFiles?: string[]; activeAudioVoiceCount?: number } => {
    if (options.debugActiveAudio !== true) {
      return {};
    }
    return {
      activeAudioFiles: audioSession?.getActiveAudioFiles?.() ?? [],
      activeAudioVoiceCount: audioSession?.getActiveAudioVoiceCount?.() ?? 0,
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
    resolveDebugActiveAudioState: () => resolveDebugActiveAudioState(),
    reversal: resolvedChart.reversal,
  });

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
    playlogRecorder,
    publishUiFrame,
    beatAtSeconds,
  });
  const stepJudge = (input: JudgeCoreInput): void => {
    runJudgeCoreStep(judgeCore, input, applyJudgeEffect);
  };

  if (!uiEnabled) {
    writeOutput('Manual play start\n');
    writeOutput(`Lane mode: ${laneDisplayMode}\n`);
    if (randomPatternSummary) {
      writeOutput(`${randomPatternSummary}\n`);
    }
    if (autoScratchEnabled) {
      writeOutput('Mode: AUTO SCRATCH (16ch/26ch only)\n');
    }
    writeOutput(`Judge window (${ruleset.id}): ${formatJudgeWindowSet(ruleset.windows.note)}\n`);
    writeOutput('Press Space to pause/resume.\n');
    writeOutput('Press Shift+R to restart.\n');
    writeOutput(`Press ${highSpeedModifierLabel}+odd lane key to decrease HIGH-SPEED.\n`);
    writeOutput(`Press ${highSpeedModifierLabel}+even lane key to increase HIGH-SPEED.\n`);
    writeOutput('Press Ctrl+C to quit.\n');
    writeOutput('Press Esc to stop and open result.\n');
    printLaneMap(writeOutput, laneBindings);
  } else {
    emitPlayerLog(options, 'info', 'ui.start', {
      mode: 'manual',
    });
    uiRuntime?.start();
    activeStateSignals?.publishJudgeCombo('READY', 0);
    publishUiFrame(0, 0);
    emitPlayerLog(options, 'debug', 'ui.initial-frame.published', {
      mode: 'manual',
      seconds: 0,
      beat: 0,
    });
  }

  await delay(leadInMs);
  inputRuntime?.start();
  // Event-driven wake-up so a press lands within ~1 ms of consuming-and-judging instead of waiting up to
  // a full 16.67 ms tick. The judge timestamp itself is already correct via `pressedAt`; what this saves
  // is the AUDIO and VISUAL response window (keysound playback, lane flash queueing). Disposed in the
  // outer `finally` so the alien-signals subscription doesn't outlive the playback session.
  const inputWakeUp = createInputWakeUp(inputSignals);
  emitPlayerLog(options, 'info', 'audio.start', {
    mode: 'manual',
  });
  audioSession?.start();
  if (!uiEnabled) {
    writeRuntimeEventLog(writeOutput, 'playback-start', [
      ['time', formatSeconds(0)],
      ['mode', autoScratchEnabled ? 'auto-scratch' : 'manual'],
    ]);
  }

  const playbackClock = createPlaybackClock(
    createAudioPlaybackClockSource(audioSession),
    audioOffsetMs + (audioSession?.chartStartDelayMs ?? 0),
  );
  playbackEventTracer.flushUntil(0);
  // Widest reach across the whole chart — a mid-chart `#EXRANKxx` can widen the windows past the opening rank's.
  const maxBadWindowMs =
    1000 *
    Math.max(
      maxJudgeReachSeconds(judgeCore.config, 0),
      ...dynamicJudgeRankChanges.map((change) => maxJudgeReachSeconds(judgeCore.config, change.seconds)),
      ...(options.stageRanks ?? []).map((change) => maxJudgeReachSeconds(judgeCore.config, change.seconds)),
    );
  const horizon = (totalSeconds * 1000) / speed + leadInMs + maxBadWindowMs + 1000;
  let endedOnFailure = false;
  let interruptedReason: PlayerInterruptReason | undefined;
  let realtimeAudioVolumeEventIndex = 0;
  let nonPlayableRealtimeAudioTriggerIndex = 0;

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

  const triggerNonPlayableRealtimeAudioEvents = (referenceSeconds: number): void => {
    const triggerEvent = audioSession?.triggerEvent;
    if (!triggerEvent) {
      return;
    }
    const safeReferenceSeconds = Math.max(0, referenceSeconds) + REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS;
    while (nonPlayableRealtimeAudioTriggerIndex < nonPlayableRealtimeAudioTriggers.length) {
      const trigger = nonPlayableRealtimeAudioTriggers[nonPlayableRealtimeAudioTriggerIndex]!;
      if (trigger.seconds > safeReferenceSeconds) {
        break;
      }
      if (!uiEnabled) {
        writeRealtimeTriggeredEventLog(writeOutput, trigger, wavResources[trigger.sampleKey], 'realtime');
      }
      triggerEvent(trigger.event);
      nonPlayableRealtimeAudioTriggerIndex += 1;
    }
  };

  const candidateChannelsBuffer = new Set<string>();
  const resolveMappedInputChannels = (
    tokens: readonly string[],
    additionalTokens?: readonly string[],
  ): ReadonlySet<string> =>
    resolveJudgeInputChannels(
      judgeCore.config,
      inputTokenToChannels,
      candidateChannelsBuffer,
      tokens,
      additionalTokens,
    );

  const handleMappedInputTokens = (tokens: readonly string[], nowMs: number, nowSec: number): void => {
    const candidateChannels = resolveMappedInputChannels(tokens);
    if (candidateChannels.size === 0) {
      return;
    }
    stepJudge({ kind: 'press', channels: candidateChannels, tokens, nowSec, nowMs });
  };

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
  const resolveManualCommandSeconds = (): number => elapsedMsToGameSeconds(playbackClock.nowMs(), speed);

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
                  ['time', formatSeconds(resolveManualCommandSeconds())],
                  ['value', `x${nextHighSpeed.toFixed(1)}`],
                ]);
              }
            : undefined,
        });
      },
      onViewChange: (change) => playlogRecorder?.recordViewChange(resolveManualCommandSeconds(), change),
      onUnhandledCommand: (command) => {
        // Replay playback drives the lanes from the recorded input stream — live lane / key-state input must not
        // interleave with it (pause / high-speed / interrupt still arrive through the standard command path).
        if (replayMode && (command.kind === 'kitty-state' || command.kind === 'lane-input')) {
          return;
        }
        if (command.kind === 'kitty-state') {
          if (!uiEnabled) {
            if (command.pressTokens.length > 0) {
              writeRuntimeEventLog(writeOutput, 'input', [
                ['time', formatSeconds(resolveManualCommandSeconds())],
                ['action', 'press'],
                ['tokens', command.pressTokens.join(',')],
              ]);
            }
            if (command.repeatTokens.length > 0) {
              writeRuntimeEventLog(writeOutput, 'input', [
                ['time', formatSeconds(resolveManualCommandSeconds())],
                ['action', 'repeat'],
                ['tokens', command.repeatTokens.join(',')],
              ]);
            }
            if (command.releaseTokens.length > 0) {
              writeRuntimeEventLog(writeOutput, 'input', [
                ['time', formatSeconds(resolveManualCommandSeconds())],
                ['action', 'release'],
                ['tokens', command.releaseTokens.join(',')],
              ]);
            }
          }
          stepJudge({ kind: 'hold', channels: resolveMappedInputChannels(command.pressTokens, command.repeatTokens) });
          const releasedChannels = resolveMappedInputChannels(command.releaseTokens);
          if (releasedChannels.size > 0) {
            const releaseNowMs = playbackClock.nowMs();
            stepJudge({
              kind: 'release',
              channels: releasedChannels,
              tokens: command.releaseTokens,
              nowSec: elapsedMsToGameSeconds(releaseNowMs, speed),
              nowMs: releaseNowMs,
              // The play log records the release at the key event's own instant, like a press.
              recordSec: elapsedMsToGameSeconds(resolveJudgeNowMsFromPressedAt(releaseNowMs, command.pressedAt), speed),
            });
          }
          return;
        }
        if (playbackClock.isPaused()) {
          return;
        }
        if (command.kind !== 'lane-input') {
          return;
        }
        // The runtime adapter (web / node) snapshots `performance.now()` at OS-level event arrival and threads
        // it through as `command.pressedAt`. Adjusting the playback clock backwards by the wall-clock delta
        // means the judge resolves against the player's true press timing instead of the engine's drain time —
        // up to ~16 ms of artificial late-bias is removed on the 60 Hz tick. See `resolveJudgeNowMsFromPressedAt`
        // for the defensive bounds (negative / >50 ms deltas fall back to drain semantics).
        const nowMs = resolveJudgeNowMsFromPressedAt(playbackClock.nowMs(), command.pressedAt);
        const nowSec = elapsedMsToGameSeconds(nowMs, speed);
        if (!uiEnabled) {
          writeRuntimeEventLog(writeOutput, 'input', [
            ['time', formatSeconds(nowSec)],
            ['action', 'lane-input'],
            ['tokens', command.tokens.join(',')],
          ]);
        }
        const scheduledSec = elapsedMsToGameSeconds(playbackClock.scheduledMs(), speed);
        triggerRealtimeAudioVolumeEvents(scheduledSec);
        playbackEventTracer.flushUntil(nowSec);
        handleMappedInputTokens(command.tokens, nowMs, nowSec);
      },
      logInterrupt: !uiEnabled
        ? (reason) => {
            writeRuntimeEventLog(writeOutput, 'interrupt', [
              ['time', formatSeconds(resolveManualCommandSeconds())],
              ['reason', reason],
            ]);
          }
        : undefined,
    });
  };

  // Replay playback — recorded play-log inputs re-driven at their exact chart-relative timestamps, stepping the judge
  // core from one judgment instant to the next (`advanceJudgeCoreReplay`), so the replayed judgments are independent
  // of tick timing.
  const replay = options.replayInputs !== undefined ? createJudgeCoreReplay(options.replayInputs) : undefined;

  // A held play (`holdAfterChart`) runs past its horizon until the host ends it.
  const hold = options.holdAfterChart;
  let settled = false;
  const pastHorizon = (): boolean => {
    if (playbackClock.nowMs() < horizon) return false;
    if (hold === undefined || hold.signal.aborted) return true;
    if (!settled) {
      settled = true;
      hold.onSettled?.();
    }
    return hold.signal.aborted;
  };

  try {
    while (!pastHorizon()) {
      consumeInputCommands();
      if (interruptedReason) {
        break;
      }
      const nowMs = playbackClock.nowMs();
      if (playbackClock.isPaused()) {
        const nowSec = elapsedMsToGameSeconds(nowMs, speed);
        publishUiFrame(nowSec, beatAtSeconds(nowSec));
        // Resume / ESC arrive as input commands; cutting the poll short on input arrival makes pause-resume
        // feel instantaneous instead of after one ~16 ms poll boundary.
        await waitPreciseOrInput(PAUSE_POLL_INTERVAL_MS, inputWakeUp);
        continue;
      }
      const scheduledMs = playbackClock.scheduledMs();
      const nowSec = elapsedMsToGameSeconds(nowMs, speed);
      const scheduledSec = elapsedMsToGameSeconds(scheduledMs, speed);
      const nowBeat = beatAtSeconds(nowSec);
      if (replay) {
        advanceJudgeCoreReplay(judgeCore, replay, nowSec, applyJudgeEffect);
      }
      playbackEventTracer.flushUntil(nowSec);

      triggerRealtimeAudioVolumeEvents(scheduledSec);
      triggerNonPlayableRealtimeAudioEvents(scheduledSec);

      if (!replay) {
        stepJudge({ kind: 'advance', nowSec, nowMs });
      }
      publishUiFrame(nowSec, nowBeat);

      // A replay has only judged up to its last chart-time step, which can trail the tick by up to one step.
      const judgedThroughSeconds = replay ? replay.judgedThroughSeconds : nowSec;
      const safeNowSeconds = Math.max(0, judgedThroughSeconds) + REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS;
      // A play that ends on failure stops the moment its gauge empties.
      if (isJudgingClosed(judgeCore)) {
        endedOnFailure = true;
        break;
      }
      // Without audio a play may end as soon as its chart is over — unless the host holds it open.
      if (isJudgeCoreSettled(judgeCore) && !audioSession && hold === undefined && safeNowSeconds >= totalSeconds) {
        break;
      }

      // Race the 60 Hz tick against the next input arrival. The judge timestamp itself is recovered via
      // `command.pressedAt`, so this race doesn't change *what* a press is judged as — it changes *when*
      // the keysound and lane flash get triggered. Pressing right after a tick boundary used to wait the
      // full ~16 ms before the keysound fired; with the race, the engine wakes within ~1 ms.
      await waitPreciseOrInput(TUI_FRAME_INTERVAL_MS, inputWakeUp);
    }

    if (!interruptedReason) {
      if (replay && replay.events.length > 0) {
        // The loop can end once every note is judged while inputs are still queued — typically the release that
        // follows the last note. Drain them so the re-recorded play log carries the whole input stream no matter
        // how far the final tick overshot.
        advanceJudgeCoreReplay(
          judgeCore,
          replay,
          replay.events[replay.events.length - 1]!.timeUs / 1_000_000,
          applyJudgeEffect,
        );
      }
      playbackEventTracer.flushUntil(totalSeconds);
      stepJudge({ kind: 'finish', totalSeconds });
    }
  } finally {
    if (interruptedReason || endedOnFailure) {
      await disposeAudioSessionSafely(audioSession);
    } else {
      await finalizeAudioSessionSafely(audioSession);
    }
    inputRuntime?.stop();
    inputWakeUp.dispose();
    await settleMaybeAsyncWithTimeout(uiRuntime?.stop(), 300);
    await settleMaybeAsyncWithTimeout(uiRuntime?.dispose(), 300);
  }

  if (interruptedReason) {
    if (interruptedReason === 'escape') {
      if (!uiEnabled) {
        writeRuntimeEventLog(writeOutput, 'playback-end', [
          ['time', formatSeconds(totalSeconds)],
          ['reason', interruptedReason],
        ]);
        playbackStateLogger.logResult(totalSeconds, {
          reason: interruptedReason,
          summary,
        });
      }
      if (playlogRecorder) {
        options.onPlaylogRecorded?.(
          playlogRecorder.finalize({
            summary,
            maxCombo: judgeCore.scoreTracker.maxCombo,
            aborted: true,
            abortedAtSeconds: judgeCore.advancedThroughSeconds,
          }),
        );
      }
      writeOutput(renderSummary(summary, ruleset.moneyScore));
      return summary;
    }
    throw new PlayerInterruptedError(interruptedReason);
  }

  if (!uiEnabled) {
    writeRuntimeEventLog(writeOutput, 'playback-end', [
      ['time', formatSeconds(totalSeconds)],
      ['reason', endedOnFailure ? 'failed' : 'complete'],
    ]);
    playbackStateLogger.logResult(totalSeconds, {
      reason: endedOnFailure ? 'failed' : 'complete',
      summary,
    });
  }
  if (playlogRecorder) {
    options.onPlaylogRecorded?.(playlogRecorder.finalize({ summary, maxCombo: judgeCore.scoreTracker.maxCombo }));
  }
  writeOutput(renderSummary(summary, ruleset.moneyScore));
  return summary;
}
