import type { MessagePort } from 'node:worker_threads';
import type { LogEntry } from '@be-music/utils/log';
import type { BeMusicJSON } from '@be-music/json';
import type { PlayerJudgeComboSignalState, PlayerUICommand } from '@be-music/player/signals';
import type { LaneBinding } from '../manual-input.ts';
import type { ImageResizeAlgorithm, TUINoteHeight } from '@be-music/player/display';
import type { PlayerUIFramePatch } from './ui-frame-patch.ts';

export interface NodeUIWorkerInitData {
  json: BeMusicJSON;
  mode: 'AUTO' | 'MANUAL' | 'AUTO SCRATCH';
  laneDisplayMode: string;
  laneBindings: LaneBinding[];
  speed: number;
  uiFPS?: number;
  tuiVisibleNotesLimit?: number;
  tuiNoteHeight: TUINoteHeight;
  judgeWindowMs: number;
  highSpeed: number;
  imageResizeAlgorithm: ImageResizeAlgorithm;
  showLaneChannels?: boolean;
  randomPatternSummary?: string;
  baseDir: string;
  kittyGraphics?: boolean;
  videoBGAStreaming?: boolean;
  useAlternateScreen?: boolean;
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  initialPaused: boolean;
  initialJudgeCombo: PlayerJudgeComboSignalState;
}

export type NodeUIWorkerInboundMessage =
  | { kind: 'attach-bridge-port'; port: MessagePort }
  | { kind: 'abort'; reason?: string }
  | { kind: 'start' }
  | { kind: 'stop' }
  | { kind: 'dispose' }
  | { kind: 'frame'; frame: PlayerUIFramePatch }
  | { kind: 'commands'; commands: PlayerUICommand[] }
  | { kind: 'set-paused'; value: boolean }
  | { kind: 'set-high-speed'; value: number }
  | { kind: 'set-judge-combo'; state: PlayerJudgeComboSignalState }
  | { kind: 'trigger-poor'; seconds: number }
  | { kind: 'clear-poor' }
  | { kind: 'resize'; columns?: number; rows?: number };

export type NodeUIWorkerOutboundMessage =
  | { kind: 'ready'; bgaPlaybackEndSeconds?: number }
  | { kind: 'log'; entry: LogEntry }
  | { kind: 'unsupported' }
  | { kind: 'stopped' }
  | { kind: 'disposed' }
  | { kind: 'bga-load-progress'; progress: { ratio: number; detail?: string } }
  | { kind: 'error'; message: string };
