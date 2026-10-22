/**
 * Seeking an AUTO play: the engine running the chart is stopped, the play's per-run state is cleared, and the engine
 * starts again at the chart second sought (`PlayerOptions.startAtSeconds`), reusing the decoded samples, the prepared
 * notes and the BGA. A preview's seek bar drives it; a manual play or a replay cannot seek.
 */

import { createPlayState } from '@be-music/player-scene-model';
import { interruptSharedEngine, launchSharedEngine } from './play-engine.ts';
import type { PlaySession } from './play-session.ts';

/** Seeks waiting on the run being stopped, by play: only the latest target of each counts. */
const pendingTargets = new WeakMap<PlaySession, number>();

/** Whether `play` can seek now: an AUTO play whose chart is running (past its intro, not ending). */
export function canSeekPlay(play: PlaySession): boolean {
  return (
    play.options.autoPlay === true &&
    play.options.replay === undefined &&
    !play.disposed &&
    !play.exiting &&
    play.sharedEnginePromise !== undefined
  );
}

/**
 * Moves `play` to chart second `seconds` (clamped to the chart) and plays on from there; a paused play resumes. Seeks
 * made while a previous one is still stopping the engine collapse into the last one. Resolves once the engine runs
 * again, or at once when the play cannot seek.
 */
export async function seekPlay(play: PlaySession, seconds: number): Promise<void> {
  if (!canSeekPlay(play) || !Number.isFinite(seconds)) return;
  const target = Math.max(0, Math.min(seconds, play.resolveChartDurationSeconds()));
  const stopping = pendingTargets.has(play);
  pendingTargets.set(play, target);
  // The playfield moves to the target at once, while the engine stops.
  anchorChartClock(play, target);
  if (stopping) return;
  const running = play.sharedEnginePromise;
  stopRun(play);
  await running?.catch(() => undefined);
  const latest = pendingTargets.get(play) ?? target;
  pendingTargets.delete(play);
  if (play.disposed || play.exiting) return;
  resetRunState(play);
  anchorChartClock(play, latest);
  play.startAtSeconds = latest;
  launchSharedEngine(play);
}

/** Stops the running engine as F5 does (its sounds cut), and resumes a paused play. */
function stopRun(play: PlaySession): void {
  interruptSharedEngine(play, 'restart');
  play.sharedEngineAbortController?.abort();
  play.chartEndHold?.abort();
  play.sharedEngineSignals = undefined;
  play.sharedEngineInputSignals = undefined;
  if (play.chartEndTimeout !== undefined) {
    window.clearTimeout(play.chartEndTimeout);
    play.chartEndTimeout = undefined;
  }
  if (play.paused) {
    play.paused = false;
    play.pauseTotal += performance.now() - play.pauseTime;
    void play.audioContext?.resume();
  }
  play.pauseAllBGAVideos();
  // The next BGA sync starts each video at the chart time sought.
  play.bgaActiveVideos = {};
}

/** Clears what one engine run left on the play, so the next run starts from a clean slate at its start second. */
function resetRunState(play: PlaySession): void {
  play.sharedEnginePromise = undefined;
  play.sharedEngineAbortController = undefined;
  play.chartEndHold = undefined;
  play.onHeldPlayEnded = undefined;
  play.sharedEngineInterrupt = undefined;
  play.sharedEngineChartSettled = false;
  play.sharedEngineLastJudgeComboTick = 0;
  play.engineFrame = undefined;
  play.chartEnded = false;
  play.liveTempo.attach(undefined);
  // The engine marks the shared notes as it judges them; the next run judges them again from its start.
  for (const note of [...play.notes, ...play.invisibleNotes]) {
    note.judged = false;
    note.visibleUntilBeat = undefined;
  }
  for (const mine of play.mineNotes) mine.judged = false;
  play.playState = createPlayState({ totalSeconds: play.playState.totalSeconds, view: play.playState.view });
  play.longNotes.clear();
  play.pressedChannels.clear();
  play.keyBeamStartedAt.clear();
  play.keyBeamFadeStartedAt.clear();
  play.bombStartedAt.clear();
  play.bombJudge.clear();
  for (const timeout of play.keyFlashTimeouts) window.clearTimeout(timeout);
  play.keyFlashTimeouts.clear();
  play.lanePressedAt.clear();
  play.laneReleasedAt.clear();
  play.fullComboFired = false;
  play.lastJudge = '';
  play.lastJudgeUntil = 0;
  play.lastPoorAt = -Number.POSITIVE_INFINITY;
  play.playMoments = {};
}

/** Sets the play's chart clock so that `currentSeconds()` reads `seconds` now; the engine's first frame confirms it. */
function anchorChartClock(play: PlaySession, seconds: number): void {
  const context = play.audioContext;
  if (context === undefined) return;
  play.audioContextStartTime = context.currentTime - play.tempoClock.clockMsAt(seconds) / 1000;
  play.sharedEngineClockAnchored = false;
}
