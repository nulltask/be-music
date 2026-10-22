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
import { applySeek } from './play-seek.ts';
import type { PlaySession } from './play-session.ts';
import type { PlayJudge, PlayTick } from './play-strategy.ts';

/**
 * The play loop: one for every judge strategy. It opens the play (the UI or the no-TUI introduction), waits out the
 * lead-in, starts the chart's audio and the play clock, and then ticks at 60 Hz (or sooner, when input arrives): input
 * commands, a seek (the last one asked for, `play-seek.ts`), realtime audio against the audio write head, the judge, a
 * UI frame. It ends at an interrupt, when judging
 * closes on a failed gauge, once the chart is over and judged, or at its horizon — held open past it while the host
 * holds the play (`holdAfterChart`) — and always closes the audio session, the input runtime and the UI runtime.
 */

/** How a play's loop ended. */
export interface PlayOutcome {
  interruptedReason: PlayerInterruptReason | undefined;
  /** Judging closed when a survival gauge emptied (`endOnFailure`). */
  endedOnFailure: boolean;
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
    controls.consume();
    if (controls.interruptedReason !== undefined) return;
    const remainingMs = endMs - scheduler.now();
    if (remainingMs <= 0) return;
    await waitPreciseOrInput(remainingMs, wakeUp);
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

/**
 * Plays the chart from its start to the end of the play: ticks until an interrupt, a failed gauge, the chart being
 * over and judged, or the horizon (held open past it while the host holds the play), then applies the end-of-play
 * rules. Returns whether judging closed on a failed gauge.
 */
async function playChart(
  session: PlaySession,
  judge: PlayJudge,
  controls: PlayControls,
  wakeUp: InputWakeUp,
): Promise<boolean> {
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
  // A replay of an ESC-aborted log stops where the play was aborted, as the replay simulators do.
  const replayStopSeconds =
    session.replay && options.replayAbortedAtUs !== undefined ? options.replayAbortedAtUs / 1_000_000 : undefined;
  let settled = false;
  const pastHorizon = (): boolean => {
    if (clock.nowMs() < horizonMs()) return false;
    if (hold === undefined || hold.signal.aborted) return true;
    if (!settled) {
      settled = true;
      hold.onSettled?.();
    }
    return hold.signal.aborted;
  };

  let failed = false;
  // The chart second of the last frame the loop published: the closing frame never shows an earlier one.
  let lastFrameSeconds: number | undefined;
  while (!pastHorizon()) {
    controls.consume();
    if (controls.interruptedReason !== undefined) {
      return false;
    }
    const nowMs = clock.nowMs();
    const seekSeconds = controls.takeSeek();
    if (seekSeconds !== undefined) {
      const sought = applySeek(session, judge, seekSeconds, nowMs);
      if (sought !== undefined) {
        lastFrameSeconds = sought;
        // A play sought back out of its hold after the chart settles again; the host's outro is its to cancel.
        settled = false;
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
    const tick: PlayTick = stopping
      ? { nowMs, nowSec: replayStopSeconds, scheduledSec: replayStopSeconds }
      : { nowMs, nowSec, scheduledSec: tempoClock.chartSecondsAt(clock.scheduledMs()) };
    judge.beforeAudio?.(tick);
    tracer.flushUntil(tick.nowSec);
    // Queue audio against the write head, then judge and render against what is actually audible.
    session.volumeChanges.triggerUntil(tick.scheduledSec);
    session.backgroundAudio.triggerUntil(tick.scheduledSec);
    judge.judge(tick);
    publishUIFrame(tick.nowSec, beatAtSeconds(tick.nowSec));
    lastFrameSeconds = tick.nowSec;

    // A play that ends on failure stops the moment its gauge empties.
    if (judge.isClosed()) {
      failed = true;
      break;
    }
    if (stopping) {
      controls.interrupt('escape', tick.nowSec);
      return false;
    }
    const safeNowSeconds = Math.max(0, judge.judgedThroughSeconds(tick)) + REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS;
    if (endsWithChart && judge.isSettled() && safeNowSeconds >= totalSeconds) {
      break;
    }
    // Race the 60 Hz tick against the next input arrival.
    await waitPreciseOrInput(TUI_FRAME_INTERVAL_MS, wakeUp);
  }

  judge.beforeFinish?.();
  tracer.flushUntil(totalSeconds);
  judge.finish();
  // A closing frame shows the state `finish` left, at the time of the loop's last frame — past the chart's end, or
  // where the play failed — so the time a host is shown never steps back.
  const endSeconds = lastFrameSeconds ?? totalSeconds;
  publishUIFrame(endSeconds, beatAtSeconds(endSeconds));
  return failed;
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
  let endedOnFailure = false;
  try {
    // The input runtime runs from the start of the lead-in, so ESC, pause and the other commands work during it.
    session.inputRuntime?.start();
    await waitOutLeadIn(session, controls, wakeUp);
    // An ESC (or a restart) during the lead-in ends the play before its chart starts.
    if (controls.interruptedReason === undefined) {
      endedOnFailure = await playChart(session, judge, controls, wakeUp);
    }
  } finally {
    if (controls.interruptedReason !== undefined || endedOnFailure) {
      await disposeAudioSessionSafely(session.audioSession);
    } else {
      await finalizeAudioSessionSafely(session.audioSession);
    }
    session.inputRuntime?.stop();
    wakeUp.dispose();
    await settleMaybeAsyncWithTimeout(session.uiRuntime?.stop(), 300);
    await settleMaybeAsyncWithTimeout(session.uiRuntime?.dispose(), 300);
  }
  return { interruptedReason: controls.interruptedReason, endedOnFailure };
}
