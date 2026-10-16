import { formatSeconds } from '../utils.ts';
import { maxJudgeReachSeconds } from './judge-core.ts';
import { createInputWakeUp, type InputWakeUp } from './input-wakeup.ts';
import {
  createAudioPlaybackClockSource,
  createPlaybackClock,
  delay,
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
import type { PlaySession } from './play-session.ts';
import type { PlayJudge, PlayTick } from './play-strategy.ts';

/**
 * The play loop: one for every judge strategy. It opens the play (the UI or the no-TUI introduction), waits out the
 * lead-in, starts the chart's audio and the play clock, and then ticks at 60 Hz (or sooner, when input arrives): input
 * commands, realtime audio against the audio write head, the judge, a UI frame. It ends at an interrupt, when judging
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
  session.publishUiFrame(0, 0);
  emitPlayerLog(options, 'debug', 'ui.initial-frame.published', { mode: strategy.mode, seconds: 0, beat: 0 });
}

/** Starts the chart's audio and the play clock (chart second 0). */
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
    createAudioPlaybackClockSource(audioSession),
    session.audioOffsetMs + (audioSession?.chartStartDelayMs ?? 0),
  );
  session.clock = clock;
  session.tracer.flushUntil(0);
  return clock;
}

/** Runs a play from its lead-in to its end, then closes its runtimes. */
export async function runPlayLoop(
  session: PlaySession,
  judge: PlayJudge,
  controls: PlayControls,
): Promise<PlayOutcome> {
  const { options, strategy, tempoClock, totalSeconds, audioSession, tracer, publishUiFrame, beatAtSeconds } = session;
  const { drifts } = strategy;
  openPlay(session);

  let wakeUp: InputWakeUp | undefined;
  const startInput = (): InputWakeUp => {
    session.inputRuntime?.start();
    // Event-driven wake-up: the loop's sleep is cut short the moment a command arrives, so a keysound, a lane flash
    // or a pause lands within ~1 ms instead of at the next 60 Hz tick (the judge timestamp itself comes from
    // `pressedAt`).
    return createInputWakeUp(session.inputSignals);
  };
  let endedOnFailure = false;
  try {
    if (drifts.startsInputRuntimeAfterLeadIn) {
      await delay(session.leadInMs);
      wakeUp = startInput();
    } else {
      wakeUp = startInput();
      await delay(session.leadInMs);
    }
    if (!drifts.startsChartAfterLeadInEscape) {
      controls.consume();
    }
    if (controls.interruptedReason === undefined) {
      const clock = startChart(session);
      const loopWakeUp = wakeUp;

      // A held play (`holdAfterChart`) runs past its horizon until the host ends it.
      const hold = drifts.ignoresHoldAfterChart ? undefined : options.holdAfterChart;
      // On the play clock, so a tempo change during the play moves it.
      const widestReachMs = 1000 * widestJudgeReachSeconds(session);
      const horizonMs = (): number =>
        drifts.horizon === 'chart-end'
          ? tempoClock.clockMsAt(totalSeconds) + 1000
          : tempoClock.clockMsAt(totalSeconds) + session.leadInMs + widestReachMs + 1000;
      // Without audio to play out a play ends as soon as its chart is over and judged — unless the host holds it open.
      const endsWithChart = drifts.horizon === 'chart-end' || (audioSession === undefined && hold === undefined);
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

      while (!pastHorizon()) {
        controls.consume();
        if (controls.interruptedReason !== undefined) {
          break;
        }
        const nowMs = clock.nowMs();
        if (clock.isPaused()) {
          const nowSec = tempoClock.chartSecondsAt(nowMs);
          publishUiFrame(nowSec, beatAtSeconds(nowSec));
          // Resume / ESC arrive as input commands; cutting the poll short on their arrival makes resuming immediate.
          await waitPreciseOrInput(PAUSE_POLL_INTERVAL_MS, loopWakeUp);
          continue;
        }
        controls.followReplayTempoChanges(tempoClock.chartSecondsAt(nowMs));
        const tick: PlayTick = {
          nowMs,
          nowSec: tempoClock.chartSecondsAt(nowMs),
          scheduledSec: tempoClock.chartSecondsAt(clock.scheduledMs()),
        };
        judge.beforeAudio?.(tick);
        tracer.flushUntil(tick.nowSec);
        // Queue audio against the write head, then judge and render against what is actually audible.
        session.volumeChanges.triggerUntil(tick.scheduledSec);
        session.backgroundAudio.triggerUntil(tick.scheduledSec);
        judge.judge(tick);
        publishUiFrame(tick.nowSec, beatAtSeconds(tick.nowSec));

        // A play that ends on failure stops the moment its gauge empties.
        if (judge.isClosed()) {
          endedOnFailure = true;
          break;
        }
        const safeNowSeconds = Math.max(0, judge.judgedThroughSeconds(tick)) + REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS;
        if (endsWithChart && judge.isSettled() && safeNowSeconds >= totalSeconds) {
          break;
        }
        // Race the 60 Hz tick against the next input arrival.
        await waitPreciseOrInput(TUI_FRAME_INTERVAL_MS, loopWakeUp);
      }

      if (controls.interruptedReason === undefined) {
        await judge.beforeFinish?.(loopWakeUp);
        tracer.flushUntil(totalSeconds);
        judge.finish();
        if (drifts.closingFrame) {
          publishUiFrame(totalSeconds, beatAtSeconds(totalSeconds));
        }
      }
    }
  } finally {
    if (controls.interruptedReason !== undefined || endedOnFailure) {
      await disposeAudioSessionSafely(audioSession);
    } else {
      await finalizeAudioSessionSafely(audioSession);
    }
    session.inputRuntime?.stop();
    wakeUp?.dispose();
    await settleMaybeAsyncWithTimeout(session.uiRuntime?.stop(), 300);
    await settleMaybeAsyncWithTimeout(session.uiRuntime?.dispose(), 300);
  }
  return { interruptedReason: controls.interruptedReason, endedOnFailure };
}
