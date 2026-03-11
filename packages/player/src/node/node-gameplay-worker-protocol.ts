import type { MessagePort } from 'node:worker_threads';
import type { BeMusicJson, BeMusicPlayLevel } from '@be-music/json';
import type { PlayerInputCommand } from '../core/input-signal-bus.ts';
import type { PlayerInterruptReason, PlayerLoadProgress, PlayerSummary } from '../core/engine.ts';
import type { PlayerUiCommand, PlayerUiFramePayload } from '../core/ui-signal-bus.ts';
import type { LaneBinding } from '../manual-input.ts';
import type { PlayerJudgeComboSignalState } from '../state-signals.ts';

export interface NodeGameplayWorkerPlayOptions {
  inferBmsLnTypeWhenMissing?: boolean;
  showInvisibleNotes?: boolean;
  compressor?: boolean;
  compressorThresholdDb?: number;
  compressorRatio?: number;
  compressorAttackMs?: number;
  compressorReleaseMs?: number;
  compressorMakeupDb?: number;
  limiter?: boolean;
  limiterCeilingDb?: number;
  limiterReleaseMs?: number;
  speed?: number;
  highSpeed?: number;
  judgeWindowMs?: number;
  debugActiveAudio?: boolean;
  leadInMs?: number;
  audio?: boolean;
  volume?: number;
  bgmVolume?: number;
  playVolume?: number;
  audioBaseDir?: string;
  audioTailSeconds?: number;
  audioOffsetMs?: number;
  audioHeadPaddingMs?: number;
  audioLeadMs?: number;
  audioLeadMaxMs?: number;
  audioLeadStepUpMs?: number;
  audioLeadStepDownMs?: number;
  laneModeExtension?: string;
  tui?: boolean;
}

export interface NodeGameplayWorkerInitData {
  json: BeMusicJson;
  mode: 'auto' | 'manual';
  autoScratch?: boolean;
  playOptions: NodeGameplayWorkerPlayOptions;
}

export interface NodeGameplayUiRuntimeInit {
  json: BeMusicJson;
  mode: 'AUTO' | 'MANUAL' | 'AUTO SCRATCH';
  laneDisplayMode: string;
  laneBindings: LaneBinding[];
  speed: number;
  judgeWindowMs: number;
  highSpeed: number;
  showLaneChannels: boolean;
  randomPatternSummary?: string;
  baseDir: string;
  initialFrame: PlayerUiFramePayload;
  initialPaused: boolean;
  initialJudgeCombo: PlayerJudgeComboSignalState;
}

export interface NodeGameplayInputRuntimeInit {
  mode: 'auto' | 'manual';
  inputTokenToChannelsEntries: Array<[string, string[]]>;
}

export interface NodeGameplayResolvedChartMetadata {
  title?: string;
  artist?: string;
  player?: number;
  rank: number;
  rankLabel?: string;
  playLevel?: BeMusicPlayLevel;
}

export type NodeGameplayWorkerInboundMessage =
  | { kind: 'abort'; reason?: string }
  | { kind: 'input-commands'; commands: PlayerInputCommand[] }
  | { kind: 'ui-init-result'; requestId: number; enabled: boolean; port?: MessagePort; bgaPlaybackEndSeconds?: number; error?: string }
  | { kind: 'ui-bga-load-progress'; requestId: number; progress: { ratio: number; detail?: string } }
  | { kind: 'ui-stop-result'; requestId: number; error?: string }
  | { kind: 'ui-dispose-result'; requestId: number; error?: string };

export type NodeGameplayWorkerOutboundMessage =
  | { kind: 'load-progress'; progress: PlayerLoadProgress }
  | { kind: 'load-complete' }
  | { kind: 'resolved-chart'; metadata: NodeGameplayResolvedChartMetadata }
  | { kind: 'output'; text: string }
  | { kind: 'high-speed'; value: number }
  | { kind: 'input-init'; runtime: NodeGameplayInputRuntimeInit }
  | { kind: 'input-start' }
  | { kind: 'input-stop' }
  | { kind: 'ui-init'; requestId: number; runtime: NodeGameplayUiRuntimeInit }
  | { kind: 'ui-start' }
  | { kind: 'ui-frame'; frame: PlayerUiFramePayload }
  | { kind: 'ui-commands'; commands: PlayerUiCommand[] }
  | { kind: 'ui-set-paused'; value: boolean }
  | { kind: 'ui-set-high-speed'; value: number }
  | { kind: 'ui-set-judge-combo'; state: PlayerJudgeComboSignalState }
  | { kind: 'ui-trigger-poor'; seconds: number }
  | { kind: 'ui-clear-poor' }
  | { kind: 'ui-stop'; requestId: number }
  | { kind: 'ui-dispose'; requestId: number }
  | { kind: 'result'; summary: PlayerSummary }
  | { kind: 'interrupted'; reason: PlayerInterruptReason }
  | { kind: 'error'; name?: string; message: string; stack?: string };
