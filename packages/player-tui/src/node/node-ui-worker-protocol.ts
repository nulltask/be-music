import type { MessagePort } from 'node:worker_threads';
import type { LogEntry } from '@be-music/utils/log';
import type { BeMusicJson } from '@be-music/json';
import type { PlayerUiCommand } from '@be-music/player/core/ui-signal-bus';
import type { LaneBinding } from '../manual-input.ts';
import type { PlayerJudgeComboSignalState } from '@be-music/player/state-signals';
import type { ImageResizeAlgorithm } from '@be-music/player/image-resize-algorithm';
import type { TuiNoteHeight } from '@be-music/player/core/ui-options';
import type { PlayerUiFramePatch } from './ui-frame-patch.ts';

export interface NodeUiWorkerInitData {
  json: BeMusicJson;
  mode: 'AUTO' | 'MANUAL' | 'AUTO SCRATCH';
  laneDisplayMode: string;
  laneBindings: LaneBinding[];
  speed: number;
  uiFps?: number;
  tuiVisibleNotesLimit?: number;
  tuiNoteHeight: TuiNoteHeight;
  judgeWindowMs: number;
  highSpeed: number;
  imageResizeAlgorithm: ImageResizeAlgorithm;
  showLaneChannels?: boolean;
  randomPatternSummary?: string;
  baseDir: string;
  kittyGraphics?: boolean;
  videoBgaStreaming?: boolean;
  useAlternateScreen?: boolean;
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
  | { kind: 'frame'; frame: PlayerUiFramePatch }
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
