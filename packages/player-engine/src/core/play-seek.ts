import { resolveBmsonBGAEventInput, type BmsonBGAEventInput } from './bmson-bga.ts';
import { resolveChartTextInput, type ChartTextInput } from './chart-text.ts';
import { formatSeconds } from '../utils.ts';
import { writeRuntimeEventLog } from './engine-trace.ts';
import type { PreparedPlaybackChartData } from './bootstrap.ts';
import type { JudgeCoreEffectSink } from './judge-core-types.ts';
import type { PlaySession } from './play-session.ts';
import type { PlayJudge } from './play-strategy.ts';
import type { PlayerUIFrameSummary, PlayerUISeekJudgment } from './ui-signal-bus.ts';

/**
 * Seeking: a command to the running play, handled by the play loop between two ticks (ADR 0016). The play is never
 * started again: its audio, its chart time and its judge move to the second sought, and the host is told through a
 * `seek` UI command and a frame of the next generation.
 */

/** A judge-core effect sink that keeps, of a judge rebuilt from the start, only the judgments it makes. */
export interface SeekRebuildSink {
  readonly emit: JudgeCoreEffectSink;
  readonly judgments: PlayerUISeekJudgment[];
  readonly bmsonBGAInputs: BmsonBGAEventInput[];
  readonly chartTextInputs: ChartTextInput[];
}

/**
 * The sink a judge is re-simulated into when it seeks: nothing is heard, shown or traced, and every judgment is kept
 * with the chart second it was made at and the gauge and EX score of `summary` right after it.
 */
export function createSeekRebuildSink(summary: Readonly<PlayerUIFrameSummary>): SeekRebuildSink {
  const judgments: PlayerUISeekJudgment[] = [];
  const bmsonBGAInputs: BmsonBGAEventInput[] = [];
  const chartTextInputs: ChartTextInput[] = [];
  let seconds = 0;
  return {
    judgments,
    bmsonBGAInputs,
    chartTextInputs,
    emit: (effect) => {
      const bgaInput = resolveBmsonBGAEventInput(effect);
      if (bgaInput) bmsonBGAInputs.push(bgaInput);
      const textInput = resolveChartTextInput(effect);
      if (textInput) chartTextInputs.push(textInput);
      if ('seconds' in effect && effect.seconds !== undefined) seconds = effect.seconds;
      if (effect.kind !== 'judge-combo') return;
      judgments.push({
        judge: effect.judge,
        combo: effect.combo,
        ...(effect.channel !== undefined ? { channel: effect.channel } : {}),
        ...(effect.signedDeltaMs !== undefined ? { deltaMs: effect.signedDeltaMs } : {}),
        seconds,
        ...(summary.gauge !== undefined ? { gauge: summary.gauge.current } : {}),
        exScore: summary.exScore,
      });
    },
  };
}

/** Clears what the judge marked on the play's notes (judged, the long-note visibility), so it can judge them again. */
export function resetPlayNotes(chart: PreparedPlaybackChartData): void {
  for (const notes of [chart.notes, chart.renderNotes, chart.scorableNotes, chart.invisibleNotes]) {
    for (const note of notes) {
      note.judged = false;
      note.visibleUntilBeat = undefined;
    }
  }
  for (const mine of chart.landmineNotes) mine.judged = false;
}

/** The seek target within the chart or an aborted replay's recorded end; a non-finite value goes to the start. */
export function clampSeekSeconds(session: PlaySession, seconds: number): number {
  if (!Number.isFinite(seconds)) return 0;
  const replayEnd = session.replay ? session.options.replayAbortedAtUs : undefined;
  const endSeconds =
    replayEnd !== undefined && Number.isFinite(replayEnd)
      ? Math.min(session.totalSeconds, Math.max(0, replayEnd / 1_000_000))
      : session.totalSeconds;
  return Math.max(0, Math.min(seconds, endSeconds));
}

/**
 * Applies a seek to chart second `seconds` at play-clock time `nowMs`, when the judge can seek; returns the second it
 * went to, or `undefined` when it could not. The audio session stops what plays and resets its gains (`seek`), the
 * volume changes before the target apply again and the sounds still ringing there start partway; chart time re-bases on
 * the play clock at the tempo in force (a paused play stays paused); the judge rebuilds its state from the start; the
 * UI buses drop what they still hold of the old position and get the `seek` command, the long notes held across the
 * target and a cleared POOR image; and a frame at the target goes out. A play that seeks records no replay.
 */
export function applySeek(session: PlaySession, judge: PlayJudge, seconds: number, nowMs: number): number | undefined {
  if (judge.seek === undefined) return undefined;
  const { audioSession, uiEnabled, uiSignals, summary } = session;
  const target = clampSeekSeconds(session, seconds);
  session.replayRecorder?.discard();
  session.seekGeneration += 1;
  session.keyBoundBGA?.reset();
  const generation = session.seekGeneration;

  audioSession?.seek?.(target);
  session.volumeChanges.seek(target);
  session.backgroundAudio.seek(target, (sound, offsetSeconds) =>
    audioSession?.triggerEventAt?.(sound.event, offsetSeconds),
  );
  session.tempoClock.rebase(nowMs, target);
  session.resetScore();
  resetPlayNotes(session.playbackChart);
  const rebuilt = judge.seek(target);
  session.bmsonBGA?.reset(rebuilt.bmsonBGAInputs);
  session.chartText?.reset(rebuilt.chartTextInputs);

  // What the buses still hold belongs to the old position.
  uiSignals.drainCommands();
  session.activeStateSignals?.drainPendingJudgeCombos();
  if (uiEnabled) {
    const { gauge, course, ...counts } = summary;
    uiSignals.pushCommand({
      kind: 'seek',
      generation,
      seconds: target,
      snapshot: {
        summary: {
          ...counts,
          ...(gauge !== undefined ? { gauge: { ...gauge } } : {}),
          ...(course !== undefined ? { course: { ...course } } : {}),
        },
        combo: session.score.scoreTracker.combo,
        maxCombo: session.score.scoreTracker.maxCombo,
        judgments: rebuilt.judgments,
      },
    });
    for (const held of rebuilt.heldLongNotes) {
      if (held.endBeat !== undefined) {
        uiSignals.pushCommand({ kind: 'hold-lane-until-beat', channel: held.channel, beat: held.endBeat });
      }
      uiSignals.pushCommand({ kind: 'long-note-start', channel: held.channel, beat: held.beat, mode: held.mode });
    }
    for (const passing of rebuilt.hellChargeNotes ?? []) {
      uiSignals.pushCommand({
        kind: 'hell-charge',
        channel: passing.channel,
        beat: passing.beat,
        state: passing.state,
      });
    }
    uiSignals.pushCommand({ kind: 'clear-poor-bga' });
  } else {
    writeRuntimeEventLog(session.writeOutput, 'seek', [
      ['time', formatSeconds(target)],
      ['generation', generation],
    ]);
  }
  session.tracer.flushUntil(target);
  session.publishUIFrame(target, session.beatAtSeconds(target));
  return target;
}

/** What the play loop knows on a tick when it asks whether a looping PRACTICE play goes back to its start. */
export interface PracticeLoopTick {
  /** The chart second of the tick. */
  nowSec: number;
  /** The play's end: a practice play's is the head of the bar after its range (`PreparedPlaybackChartData.totalSeconds`). */
  totalSeconds: number;
  /** Nothing is left to judge ({@link PlayJudge.isSettled}). */
  settled: boolean;
  /** Judging closed on an emptied survival gauge ({@link PlayJudge.isClosed}). */
  closed: boolean;
  /** The play clock passed the play's horizon (its end, the widest BAD reach and a second of grace). */
  pastHorizon: boolean;
}

/**
 * Whether a looping PRACTICE play (`PlayPractice.loop`, #949) goes back to its start on this tick: when its gauge
 * emptied, or once the play's end is reached with every note judged — or at the horizon at the latest, where a play
 * that did not loop would end.
 */
export function isPracticeLoopDue(tick: Readonly<PracticeLoopTick>): boolean {
  if (tick.closed || tick.pastHorizon) return true;
  return tick.settled && tick.nowSec >= tick.totalSeconds;
}

/**
 * PRACTICE's loop (#949): moves the play back to where it started (`PlaySession.startAtSeconds`, the head of the bar
 * before the range's) at play-clock time `nowMs`, as a seek there does (`applySeek`): the audio stops what still rings, the judge,
 * the score, the combo and the gauge go back to the practice settings, the notes are judged again, and the host gets a
 * `seek` UI command and a frame of the next generation, keeping the samples, the BGA and the skin it loaded. Returns
 * the second it went to, or `undefined` when the judge cannot seek.
 */
export function restartPractice(session: PlaySession, judge: PlayJudge, nowMs: number): number | undefined {
  return applySeek(session, judge, session.startAtSeconds, nowMs);
}
