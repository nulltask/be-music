import { throwIfAborted } from '@be-music/shared-utils/core';
import { formatSeconds } from '../utils.ts';
import { maxJudgeReachSeconds } from './judge-core.ts';
import { createInputWakeUp, type InputWakeUp } from './input-wakeup.ts';
import {
  createPlaybackClock,
  getEngineScheduler,
  PAUSE_POLL_INTERVAL_MS,
  type PlaybackClock,
  REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS,
  TUI_FRAME_INTERVAL_MS,
  waitPreciseOrInput,
} from './engine-clock.ts';
import {
  disposeAudioSessionSafely,
  finalizeAudioSessionSafely,
  settleMaybeAsyncWithTimeout,
} from './engine-preparation.ts';
import { emitPlayerLog, writeRuntimeEventLog } from './engine-trace.ts';
import type { PlayerInterruptReason } from './engine-types.ts';
import type { PlayControls } from './play-controls.ts';
import { applySeek, clampSeekSeconds, isPracticeLoopDue, restartPractice } from './play-seek.ts';
import { isSeamlessPracticeLoop } from './practice.ts';
import type { PlaySession } from './play-session.ts';
import type { PlayJudge, PlayTick } from './play-strategy.ts';

/**
 * The play loop: one for every judge strategy. It opens the play (the UI or the no-TUI introduction), waits out the
 * lead-in, starts the chart's audio and the play clock, and then ticks at 60 Hz (or sooner, when input arrives): input
 * commands, a seek (the last one asked for, `play-seek.ts`), realtime audio against the audio write head, the judge, a
 * UI frame. It ends at an interrupt, when judging
 * closes on a failed gauge, once the chart is over and judged, or at its horizon — held open past it while the host
 * holds the play (`holdAfterChart`) — and always closes the audio session, the input runtime and the UI runtime. A
 * looping PRACTICE play (`PlayPractice.loop`) ends only at an interrupt: where another play would end, it goes back to
 * its start (`restartPractice`) and plays its range again.
 */

/** How a play's loop ended. */
export interface PlayOutcome {
  interruptedReason: PlayerInterruptReason | undefined;
  /** Judging closed when a survival gauge emptied (`endOnFailure`). */
  endedOnFailure: boolean;
  completedAtReversal: boolean;
}

/** The widest reach any lane's windows have anywhere in the chart, in seconds: a mid-chart `#EXRANKxx` can widen it. */
function widestJudgeReachSeconds(session: PlaySession): number {
  const { ruleset } = session;
  return Math.max(
    maxJudgeReachSeconds({ ruleset }, 0),
    ...session.resolvedChart.judgeRank.changes.map((change) => maxJudgeReachSeconds({ ruleset }, change.seconds)),
    ...(session.options.stageRanks ?? []).map((change) => maxJudgeReachSeconds({ ruleset }, change.seconds)),
  );
}

/** Shows the play is about to start: the UI runtime's READY frame, or the no-TUI introduction. */
function openPlay(session: PlaySession): void {
  const { options, strategy, uiEnabled } = session;
  if (!uiEnabled) {
    strategy.writeIntro(session);
    return;
  }
  emitPlayerLog(options, 'info', 'ui.start', { mode: strategy.mode });
  session.uiRuntime?.start();
  session.activeStateSignals?.publishJudgeCombo('READY', 0);
  session.publishUIFrame(0, 0);
  emitPlayerLog(options, 'debug', 'ui.initial-frame.published', { mode: strategy.mode, seconds: 0, beat: 0 });
}

/**
 * Waits out the lead-in, taking the commands sent during it: an interrupt ends it at once, a tempo or HIGH-SPEED
 * change sets what the chart starts with, a view change is recorded at the chart's start, a pause holds the chart at
 * its start, a seek sets where it starts, and lane input is dropped (there is nothing to judge yet).
 */
async function waitOutLeadIn(session: PlaySession, controls: PlayControls, wakeUp: InputWakeUp): Promise<void> {
  const scheduler = getEngineScheduler();
  const endMs = scheduler.now() + session.leadInMs;
  for (;;) {
    throwIfAborted(session.options.signal);
    controls.consume();
    if (controls.interruptedReason !== undefined) return;
    const remainingMs = endMs - scheduler.now();
    if (remainingMs <= 0 && controls.startRequested) return;
    await waitPreciseOrInput(remainingMs > 0 ? remainingMs : PAUSE_POLL_INTERVAL_MS, wakeUp);
  }
}

/** Starts the chart's audio and the play clock (chart second 0; a play starting partway seeks on its first tick). */
function startChart(session: PlaySession): PlaybackClock {
  const { options, strategy, audioSession, uiEnabled } = session;
  emitPlayerLog(options, 'info', 'audio.start', { mode: strategy.mode });
  audioSession?.start();
  if (!uiEnabled) {
    writeRuntimeEventLog(session.writeOutput, 'playback-start', [
      ['time', formatSeconds(0)],
      ['mode', strategy.mode === 'auto' ? 'auto' : session.autoScratch ? 'auto-scratch' : 'manual'],
    ]);
  }
  const clock = createPlaybackClock(
    session.clockSource,
    session.audioOffsetMs + (audioSession?.chartStartDelayMs ?? 0),
  );
  session.clock = clock;
  session.tracer.flushUntil(0);
  return clock;
}

type ChartEnding = 'complete' | 'failed' | 'reversal';

/**
 * Plays the chart from its start to the end of the play: ticks until an interrupt, a failed gauge, the chart being
 * over and judged, or the horizon (held open past it while the host holds the play), then applies the end-of-play
 * rules. The ending determines how the result and replay are finalized.
 */
async function playChart(
  session: PlaySession,
  judge: PlayJudge,
  controls: PlayControls,
  wakeUp: InputWakeUp,
): Promise<ChartEnding> {
  const { options, tempoClock, totalSeconds, tracer, publishUIFrame, beatAtSeconds } = session;
  const clock = startChart(session);
  controls.chartStarted();

  // A held play (`holdAfterChart`) runs past its horizon until the host ends it.
  const hold = options.holdAfterChart;
  // The chart's end, the widest BAD reach (its last notes can still be judged until then) and a second of grace for the
  // audio to play out. On the play clock, which starts after the lead-in, so a tempo change during the play moves it.
  const widestReachMs = 1000 * widestJudgeReachSeconds(session);
  const horizonMs = (): number => tempoClock.clockMsAt(totalSeconds) + widestReachMs + 1000;
  // Without audio to play out a play ends as soon as its chart is over and judged — unless the host holds it open.
  const endsWithChart = session.audioSession === undefined && hold === undefined;
  // A looping PRACTICE play (`PlayPractice.loop`) never reaches its horizon: it goes back to its start before it.
  const loopsPractice = options.practice?.loop === true && judge.seek !== undefined;
  // A loop of picked bars is seamless: back at the play's end, the time past it carried over.
  const seamlessPractice = loopsPractice && isSeamlessPracticeLoop(options.practice);
  // A replay of an ESC-aborted log stops where the play was aborted, as the replay simulators do.
  const replayStopSeconds =
    session.replay && options.replayAbortedAtUs !== undefined ? options.replayAbortedAtUs / 1_000_000 : undefined;
  const recordedCompletion =
    session.replay && options.replayCompletedAtReversal && replayStopSeconds === undefined
      ? session.reversalAnchor?.seconds
      : undefined;
  const reversedStage = session.resolvedChart.reversal !== undefined;
  // Once the reversing dispatch finishes, later ticks cannot advance the frozen pump. A recorded
  // play has its own end: legacy completed recordings still finish at their original horizon.
  const waitsForExit =
    reversedStage &&
    (!session.replay || replayStopSeconds !== undefined || recordedCompletion !== undefined) &&
    !options.practice;
  const stopAt = replayStopSeconds ?? recordedCompletion;
  let settled = false;
  const pastHorizon = (): boolean => {
    if (waitsForExit) return hold?.signal.aborted === true && judge.isSettled();
    // A host that lets go of its hold before the horizon (ESC once every note is judged) ends the play as soon as
    // nothing is left to judge, the way the chart's end does.
    if (hold?.signal.aborted === true && judge.isSettled()) return true;
    if (clock.nowMs() < horizonMs()) return false;
    if (hold === undefined || hold.signal.aborted) return true;
    if (!settled) {
      settled = true;
      hold.onSettled?.();
    }
    return hold.signal.aborted;
  };

  let end: ChartEnding = 'complete';
  // The chart second of the last frame the loop published: the closing frame never shows an earlier one.
  let lastFrameSeconds: number | undefined;
  while (loopsPractice || !pastHorizon()) {
    controls.consume();
    if (controls.interruptedReason !== undefined) {
      return 'complete';
    }
    const nowMs = clock.nowMs();
    const seekSeconds = controls.takeSeek();
    if (seekSeconds !== undefined) {
      controls.seekReplayTempoChanges(clampSeekSeconds(session, seekSeconds), nowMs);
      const sought = applySeek(session, judge, seekSeconds, nowMs);
      if (sought !== undefined) {
        if (!session.replay && session.reversalAnchor) session.reversalAnchor.seconds = Infinity;
        lastFrameSeconds = sought;
        // A play sought back out of its hold after the chart settles again; the host's outro is its to cancel.
        if (sought < totalSeconds) settled = false;
      }
    }
    if (clock.isPaused()) {
      const nowSec = tempoClock.chartSecondsAt(nowMs);
      publishUIFrame(nowSec, beatAtSeconds(nowSec));
      lastFrameSeconds = nowSec;
      // Resume / ESC arrive as input commands; cutting the poll short on their arrival makes resuming immediate.
      await waitPreciseOrInput(PAUSE_POLL_INTERVAL_MS, wakeUp);
      continue;
    }
    controls.followReplayTempoChanges(tempoClock.chartSecondsAt(nowMs));
    const nowSec = tempoClock.chartSecondsAt(nowMs);
    // The tick that reaches a replay's stop judges up to it and no further.
    const stopping = replayStopSeconds !== undefined && nowSec >= replayStopSeconds;
    const tick: PlayTick =
      stopAt !== undefined && nowSec >= stopAt
        ? { nowMs, nowSec: stopAt, scheduledSec: stopAt }
        : { nowMs, nowSec, scheduledSec: tempoClock.chartSecondsAt(clock.scheduledMs()) };
    const anchor = session.reversalAnchor;
    let completesAtReversal = false;
    const clockMs = Math.floor(tick.nowSec * 1000);
    if (
      !session.replay &&
      anchor &&
      clockMs > session.resolvedChart.reversal!.seconds * 1000 &&
      !Number.isFinite(anchor.seconds)
    ) {
      // The pump fires on the first tick strictly past the event. Store its observed clock in replay precision.
      anchor.seconds = Math.round(tick.nowSec * 1e6) / 1e6;
      anchor.beat = beatAtSeconds(anchor.seconds);
      // LR2 checks for exhaustion and song_runtime here, before subsequent ticks freeze the pump.
      completesAtReversal = session.reversalEndSeconds !== undefined && clockMs > session.reversalEndSeconds * 1000;
    }
    judge.beforeAudio?.(tick);
    tracer.flushUntil(tick.nowSec);
    // Queue audio against the write head, then judge and render against what is actually audible.
    session.volumeChanges.triggerUntil(tick.scheduledSec);
    session.backgroundAudio.triggerUntil(tick.scheduledSec);
    // A chain note waits on the clock its press was judged on, so it sounds as long after the press's keysound as it
    // follows its note in the chart.
    session.chainSounds.triggerUntil(tick.nowSec);
    judge.judge(tick);
    publishUIFrame(tick.nowSec, beatAtSeconds(tick.nowSec));
    lastFrameSeconds = tick.nowSec;

    // A looping PRACTICE play goes back to its start instead of ending (#949): on its next tick it plays the range again.
    if (
      loopsPractice &&
      isPracticeLoopDue({
        nowSec: tick.nowSec,
        totalSeconds,
        settled: judge.isSettled(),
        closed: judge.isClosed(),
        pastHorizon: clock.nowMs() >= horizonMs(),
        seamless: seamlessPractice,
      })
    ) {
      const overshoot = seamlessPractice && !judge.isClosed() ? tick.nowSec - totalSeconds : 0;
      const restarted = restartPractice(session, judge, tick.nowMs, overshoot);
      if (restarted !== undefined) lastFrameSeconds = restarted;
      await waitPreciseOrInput(TUI_FRAME_INTERVAL_MS, wakeUp);
      continue;
    }

    // A play that ends on failure stops the moment its gauge empties.
    if (judge.isClosed()) {
      end = 'failed';
      break;
    }
    if (stopping) {
      controls.interrupt('escape', tick.nowSec);
      return 'complete';
    }
    if (completesAtReversal || (recordedCompletion !== undefined && tick.nowSec >= recordedCompletion)) {
      end = 'reversal';
      lastFrameSeconds = anchor!.seconds;
      break;
    }
    const safeNowSeconds = Math.max(0, judge.judgedThroughSeconds(tick)) + REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS;
    if (!waitsForExit && endsWithChart && judge.isSettled() && safeNowSeconds >= totalSeconds) {
      break;
    }
    // Race the 60 Hz tick against the next input arrival.
    await waitPreciseOrInput(TUI_FRAME_INTERVAL_MS, wakeUp);
  }

  if (waitsForExit && end === 'complete' && hold?.signal.aborted) {
    // The browser releases its hold when the player leaves a stage with every note judged.
    controls.interrupt('escape', judge.settledThroughSeconds());
    return 'complete';
  }
  judge.beforeFinish?.();
  tracer.flushUntil(end === 'reversal' ? lastFrameSeconds! : totalSeconds);
  judge.finish();
  // A closing frame shows the state `finish` left, at the time of the loop's last frame — past the chart's end, or
  // where the play failed — so the time a host is shown never steps back.
  const endSeconds = lastFrameSeconds ?? totalSeconds;
  publishUIFrame(endSeconds, beatAtSeconds(endSeconds));
  return end;
}

/** Runs a play from its lead-in to its end, then closes its runtimes. */
export async function runPlayLoop(
  session: PlaySession,
  judge: PlayJudge,
  controls: PlayControls,
): Promise<PlayOutcome> {
  openPlay(session);
  // Event-driven wake-up: the loop's sleep is cut short the moment a command arrives, so a keysound, a lane flash, a
  // pause or an ESC lands within ~1 ms instead of at the next 60 Hz tick (the judge timestamp itself comes from
  // `pressedAt`).
  const wakeUp = createInputWakeUp(session.inputSignals);
  let ending: ChartEnding = 'complete';
  try {
    // The input runtime runs from the start of the lead-in, so ESC, pause and the other commands work during it.
    session.inputRuntime?.start();
    await waitOutLeadIn(session, controls, wakeUp);
    // An ESC (or a restart) during the lead-in ends the play before its chart starts.
    if (controls.interruptedReason === undefined) {
      ending = await playChart(session, judge, controls, wakeUp);
    }
  } finally {
    if (controls.interruptedReason !== undefined || ending === 'failed') {
      await disposeAudioSessionSafely(session.audioSession);
    } else {
      await finalizeAudioSessionSafely(session.audioSession);
    }
    session.inputRuntime?.stop();
    wakeUp.dispose();
    await settleMaybeAsyncWithTimeout(session.uiRuntime?.stop(), 300);
    await settleMaybeAsyncWithTimeout(session.uiRuntime?.dispose(), 300);
  }
  return {
    interruptedReason: controls.interruptedReason,
    endedOnFailure: ending === 'failed',
    completedAtReversal: ending === 'reversal',
  };
}
