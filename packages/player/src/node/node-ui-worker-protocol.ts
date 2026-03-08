import type { BeMusicJson } from '@be-music/json';
import type { PlayerUiCommand, PlayerUiFramePayload } from '../core/player-ui-signal-bus.ts';
import type { LaneBinding } from '../manual-input.ts';
import type { PlayerJudgeComboSignalState } from '../player-state-signals.ts';

export interface NodeUiWorkerInitData {
  json: BeMusicJson;
  mode: 'AUTO' | 'MANUAL' | 'AUTO SCRATCH';
  laneDisplayMode: string;
  laneBindings: LaneBinding[];
  speed: number;
  judgeWindowMs: number;
  highSpeed: number;
  showLaneChannels?: boolean;
  randomPatternSummary?: string;
  baseDir: string;
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
}

export type NodeUiWorkerInboundMessage =
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
  | { kind: 'ready' }
  | { kind: 'unsupported' }
  | { kind: 'stopped' }
  | { kind: 'disposed' }
  | { kind: 'bga-load-progress'; progress: { ratio: number; detail?: string } }
  | { kind: 'error'; message: string };
