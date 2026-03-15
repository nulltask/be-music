import type { MessagePort } from 'node:worker_threads';
import type { LogEntry } from '@be-music/utils';
import type { BeMusicJson } from '@be-music/json';
import type { PlayerUiCommand, PlayerUiFramePayload } from '../core/ui-signal-bus.ts';
import type { LaneBinding } from '../manual-input.ts';
import type { PlayerJudgeComboSignalState } from '../state-signals.ts';

export interface NodeUiWorkerInitData {
  json: BeMusicJson;
  mode: 'AUTO' | 'MANUAL' | 'AUTO SCRATCH';
  laneDisplayMode: string;
  laneBindings: LaneBinding[];
  speed: number;
  uiFps?: number;
  judgeWindowMs: number;
  highSpeed: number;
  showLaneChannels?: boolean;
  randomPatternSummary?: string;
  baseDir: string;
  kittyGraphics?: boolean;
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  initialPaused: boolean;
  initialJudgeCombo: PlayerJudgeComboSignalState;
}

export type NodeUiWorkerInboundMessage =
  | { kind: 'attach-bridge-port'; port: MessagePort }
  | { kind: 'abort'; reason?: string }
  | { kind: 'start' }
  | { kind: 'stop' }
  | { kind: 'dispose' }
  | { kind: 'frame'; frame: PlayerUiFramePayload }
  | { kind: 'commands'; commands: PlayerUiCommand[] }
  | { kind: 'set-paused'; value: boolean }
  | { kind: 'set-high-speed'; value: number }
  | { kind: 'set-judge-combo'; state: PlayerJudgeComboSignalState }
  | { kind: 'trigger-poor'; seconds: number }
  | { kind: 'clear-poor' }
  | { kind: 'resize'; columns?: number; rows?: number };

export type NodeUiWorkerOutboundMessage =
  | { kind: 'ready'; bgaPlaybackEndSeconds?: number }
  | { kind: 'log'; entry: LogEntry }
  | { kind: 'unsupported' }
  | { kind: 'stopped' }
  | { kind: 'disposed' }
  | { kind: 'bga-load-progress'; progress: { ratio: number; detail?: string } }
  | { kind: 'error'; message: string };
