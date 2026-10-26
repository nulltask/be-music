import {
  adjustBeatorajaJudgeTiming,
  createLR2JudgeTimingSamples,
  isLR2JudgeTimingAutoAdjust,
  sampleLR2JudgeTiming,
  settleLR2JudgeTiming,
  type JudgeTimingAutoAdjust,
} from './judge-timing.ts';
import { type PlayerStateSignals } from '../state-signals.ts';
import { formatSeconds } from '../utils.ts';
import { type PlayerUISignalBus } from './ui-signal-bus.ts';
import { type PlaybackStateLogger } from './playback-support.ts';
import { type JudgeCoreEffectSink } from './judge-core.ts';
import { type ReplayRecorder } from '../replay/recorder.ts';
import {
  type NoTUIPlaybackEventTracer,
  writePlayableSampleTriggerEventLog,
  writeRuntimeEventLog,
  writeSampleStopEventLog,
} from './engine-trace.ts';
import { type AudioSession } from './engine-types.ts';

/**
 * Maps judge-core effects onto a play's audio session, UI buses, replay and no-TUI trace.
 */
/** What a driver hands {@link createJudgeEffectHandler}: the host side of every judge-core effect. */
interface JudgeEffectHost {
  uiEnabled: boolean;
  /**
   * The automatic judge-timing adjustment this play runs (`OFF` for none: AUTO, replays, or a mode the play skips), and
   * the live timing it moves. `currentSeconds` is the chart time an LR2 step is recorded at.
   */
  judgeTiming?: { mode: JudgeTimingAutoAdjust; value: number; currentSeconds?: () => number };
  writeOutput: (text: string) => void;
  wavResources: Readonly<Record<string, string>>;
  idBase: 36 | 62;
  audioSession: AudioSession | undefined;
  playbackStateLogger: PlaybackStateLogger;
  playbackEventTracer: NoTUIPlaybackEventTracer;
  uiSignals: PlayerUISignalBus;
  activeStateSignals: PlayerStateSignals | undefined;
  replayRecorder: ReplayRecorder | undefined;
  publishUIFrame: (seconds: number, beat: number) => void;
  beatAtSeconds: (seconds: number) => number;
}

/** The judge-effect sink of one play, with the step LR2's automatic judge timing takes once per judging pass. */
export interface JudgeEffectHandler extends JudgeCoreEffectSink {
  /** Ends a judging pass: LR2's adjustment steps when its window is full (a no-op in any other mode). */
  settleJudgeTiming(): void;
}

/**
 * Interprets judge-core effects for one play: audio always, UI cues or the no-TUI trace depending on the mode, and
 * the replay when one is being recorded. Shared by the manual and the auto drivers.
 */
export function createJudgeEffectHandler(host: JudgeEffectHost): JudgeEffectHandler {
  const {
    uiEnabled,
    writeOutput,
    wavResources,
    idBase,
    audioSession,
    playbackStateLogger,
    playbackEventTracer,
    uiSignals,
    activeStateSignals,
    replayRecorder,
    publishUIFrame,
    beatAtSeconds,
  } = host;
  const judgeTiming = host.judgeTiming;
  const judgeTimingMode = judgeTiming?.mode ?? 'OFF';
  // LR2's window starts empty with the play (OpenLR2 leaves the reset at play start undetermined).
  const lr2Samples = isLR2JudgeTimingAutoAdjust(judgeTimingMode) ? createLR2JudgeTimingSamples() : undefined;
  const changeJudgeTiming = (next: number, seconds: number): void => {
    judgeTiming!.value = next;
    replayRecorder?.recordOptionChange(Math.max(0, seconds, judgeTiming!.currentSeconds?.() ?? 0), {
      judgeTimingMs: next,
    });
    uiSignals.pushCommand({ kind: 'judge-timing', value: next });
  };
  const sink: JudgeCoreEffectSink = (effect) => {
    switch (effect.kind) {
      case 'record-input':
        replayRecorder?.recordInput(effect.action, effect.seconds, effect.tokens, effect.channels, effect.inferred);
        return;
      case 'record-empty-poor':
        replayRecorder?.recordEmptyPoor();
        return;
      case 'input-time':
        playbackEventTracer.flushUntil(effect.seconds);
        return;
      case 'sound':
        if (!uiEnabled) {
          writePlayableSampleTriggerEventLog(
            writeOutput,
            effect.event,
            effect.seconds,
            wavResources,
            effect.source,
            effect.channel,
            idBase,
          );
        }
        audioSession?.triggerEvent?.(effect.event);
        return;
      case 'stop-sound':
        if (!uiEnabled) {
          writeSampleStopEventLog(
            writeOutput,
            effect.channel,
            effect.seconds,
            effect.reason,
            effect.event,
            wavResources,
            idBase,
          );
        }
        audioSession?.stopChannel?.(effect.channel);
        return;
      case 'gauge':
        playbackStateLogger.logGaugeChange(effect.seconds, {
          reason: effect.reason,
          judge: effect.judge,
          delta: effect.delta,
        });
        return;
      case 'combo':
        playbackStateLogger.logComboChange(effect.seconds, {
          value: effect.value,
          reason: effect.reason,
          judge: effect.judge,
          channel: effect.channel,
        });
        return;
      case 'long-note':
        playbackStateLogger.logLongNoteState(effect.seconds, {
          channel: effect.channel,
          state: effect.state,
          mode: effect.mode,
          event: effect.event,
          resources: wavResources,
          endSeconds: effect.endSeconds,
        });
        return;
      case 'ui':
        if (uiEnabled) {
          uiSignals.pushCommand(effect.command);
        }
        return;
      case 'poor-bga':
        uiSignals.pushCommand(
          effect.action === 'trigger'
            ? { kind: 'trigger-poor-bga', seconds: effect.seconds }
            : { kind: 'clear-poor-bga' },
        );
        return;
      case 'poor-trace':
        if (!uiEnabled) {
          if (effect.action === 'trigger') {
            playbackEventTracer.logPoorTriggered(effect.seconds);
          } else {
            playbackEventTracer.logPoorCleared(effect.seconds);
          }
        }
        return;
      case 'judge-combo':
        if (judgeTimingMode === 'BEATORAJA' && effect.seconds !== undefined) {
          const next = adjustBeatorajaJudgeTiming(judgeTiming!.value, effect.judge, effect.signedDeltaMs);
          if (next !== judgeTiming!.value) changeJudgeTiming(next, effect.seconds);
        } else if (lr2Samples !== undefined) {
          sampleLR2JudgeTiming(lr2Samples, effect.judge, effect.signedDeltaMs, effect.longNote === true);
        }
        activeStateSignals?.publishJudgeCombo(
          effect.judge,
          effect.combo,
          effect.channel,
          undefined,
          effect.signedDeltaMs,
        );
        return;
      case 'trace':
        if (!uiEnabled) {
          writeRuntimeEventLog(writeOutput, effect.name, [['time', formatSeconds(effect.seconds)], ...effect.fields]);
        }
        return;
      case 'frame':
        if (uiEnabled) {
          publishUIFrame(effect.seconds, effect.beat ?? beatAtSeconds(effect.seconds));
        }
        return;
    }
  };
  return Object.assign(sink, {
    settleJudgeTiming: () => {
      if (lr2Samples === undefined) return;
      const next = settleLR2JudgeTiming(judgeTiming!.value, lr2Samples);
      if (next !== judgeTiming!.value) changeJudgeTiming(next, 0);
    },
  });
}
