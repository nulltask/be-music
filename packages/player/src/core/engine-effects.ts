import { type PlayerStateSignals } from '../state-signals.ts';
import { formatSeconds } from '../utils.ts';
import { type PlayerUiSignalBus } from './ui-signal-bus.ts';
import { type PlaybackStateLogger } from './playback-support.ts';
import { type JudgeCoreEffectSink } from './judge-core.ts';
import { type PlaylogRecorder } from '../playlog/recorder.ts';
import {
  type NoTuiPlaybackEventTracer,
  writePlayableSampleTriggerEventLog,
  writeRuntimeEventLog,
  writeSampleStopEventLog,
} from './engine-trace.ts';
import { type AudioSession } from './engine-types.ts';

/**
 * Maps judge-core effects onto a play's audio session, UI buses, play log and no-TUI trace.
 */
/** What a driver hands {@link createJudgeEffectHandler}: the host side of every judge-core effect. */
interface JudgeEffectHost {
  uiEnabled: boolean;
  writeOutput: (text: string) => void;
  wavResources: Readonly<Record<string, string>>;
  idBase: 36 | 62;
  audioSession: AudioSession | undefined;
  playbackStateLogger: PlaybackStateLogger;
  playbackEventTracer: NoTuiPlaybackEventTracer;
  uiSignals: PlayerUiSignalBus;
  activeStateSignals: PlayerStateSignals | undefined;
  playlogRecorder: PlaylogRecorder | undefined;
  publishUiFrame: (seconds: number, beat: number) => void;
  beatAtSeconds: (seconds: number) => number;
}

/**
 * Interprets judge-core effects for one play: audio always, UI cues or the no-TUI trace depending on the mode, and
 * the play log when one is being recorded. Shared by the manual and the auto drivers.
 */
export function createJudgeEffectHandler(host: JudgeEffectHost): JudgeCoreEffectSink {
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
    playlogRecorder,
    publishUiFrame,
    beatAtSeconds,
  } = host;
  return (effect) => {
    switch (effect.kind) {
      case 'record-input':
        playlogRecorder?.recordInput(effect.action, effect.seconds, effect.tokens, effect.channels);
        return;
      case 'record-empty-poor':
        playlogRecorder?.recordEmptyPoor();
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
          publishUiFrame(effect.seconds, effect.beat ?? beatAtSeconds(effect.seconds));
        }
        return;
    }
  };
}
