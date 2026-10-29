import type { BmsonBGAEventCue, KeyBoundBGACue } from '@be-music/chart-model';
import type { MessagePort } from 'node:worker_threads';
import type { LogEntry } from '@be-music/shared-utils/log';
import type { RandomDraws } from '@be-music/chart-model';
import type { BeMusicJSON, BeMusicPlayLevel } from '@be-music/chart-source';
import type {
  PlayerInputCommand,
  PlayerJudgeComboSignalState,
  PlayerUICommand,
  PlayerUIFramePayload,
} from '@be-music/player-engine/signals';
import type { PlayerInterruptReason, PlayerLoadProgress, PlayerSummary } from '@be-music/player-engine';
import type { LaneBinding } from '../manual-input.ts';
import type { ImageResizeAlgorithm, TUINoteHeight } from '@be-music/player-engine/display';
import type { GaugeType, RulesetId } from '@be-music/player-engine/ruleset';

export interface NodeGameplayWorkerPlayOptions {
  keyBoundBGACues?: readonly KeyBoundBGACue[];
  bmsonBGACues?: readonly BmsonBGAEventCue[];
  inferBmsLNTypeWhenMissing?: boolean;
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
  uiFPS?: number;
  tuiVisibleNotesLimit?: number;
  tuiNoteHeight?: TUINoteHeight;
  imageResizeAlgorithm?: ImageResizeAlgorithm;
  highSpeed?: number;
  judgeWindowMs?: number;
  judgeRuleset?: RulesetId;
  gauge?: GaugeType;
  debugActiveAudio?: boolean;
  leadInMs?: number;
  audio?: boolean;
  volume?: number;
  bgmVolume?: number;
  playVolume?: number;
  audioBaseDir?: string;
  audioTailSeconds?: number;
  audioHeadPaddingMs?: number;
  audioLeadMs?: number;
  audioLeadMaxMs?: number;
  audioLeadStepUpMs?: number;
  audioLeadStepDownMs?: number;
  laneModeExtension?: string;
  tui?: boolean;
  kittyGraphics?: boolean;
  videoBGAStreaming?: boolean;
}

export interface NodeGameplayWorkerInitData {
  /** The chart to play, already resolved. */
  json: BeMusicJSON;
  /** The `#RANDOM` / `#SWITCH` draws `json` was resolved with. */
  randomDraws?: RandomDraws;
  mode: 'auto' | 'manual';
  autoScratch?: boolean;
  playOptions: NodeGameplayWorkerPlayOptions;
  /**
   * The terminal had negotiated a stateful keyboard protocol before the play (`hasNegotiatedStatefulKeyboardProtocol`):
   * the worker's input runtime declares that its keys report their releases (`PlayerInputRuntime.reportsKeyReleases`).
   */
  inputReportsKeyReleases?: boolean;
}

export interface NodeGameplayUIRuntimeInit {
  keyBoundBGACues?: readonly KeyBoundBGACue[];
  bmsonBGACues?: readonly BmsonBGAEventCue[];
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
  showLaneChannels: boolean;
  randomPatternSummary?: string;
  baseDir: string;
  kittyGraphics?: boolean;
  videoBGAStreaming?: boolean;
  initialFrame: PlayerUIFramePayload;
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
  | {
      kind: 'ui-init-result';
      requestId: number;
      enabled: boolean;
      port?: MessagePort;
      bgaPlaybackEndSeconds?: number;
      error?: string;
      errorName?: string;
    }
  | { kind: 'ui-bga-load-progress'; requestId: number; progress: { ratio: number; detail?: string } }
  | { kind: 'ui-stop-result'; requestId: number; error?: string }
  | { kind: 'ui-dispose-result'; requestId: number; error?: string };

export type NodeGameplayWorkerOutboundMessage =
  | { kind: 'load-progress'; progress: PlayerLoadProgress }
  | { kind: 'load-complete' }
  | { kind: 'log'; entry: LogEntry }
  | { kind: 'resolved-chart'; metadata: NodeGameplayResolvedChartMetadata }
  | { kind: 'output'; text: string }
  | { kind: 'high-speed'; value: number }
  | { kind: 'input-init'; runtime: NodeGameplayInputRuntimeInit }
  | { kind: 'input-start' }
  | { kind: 'input-stop' }
  | { kind: 'ui-init'; requestId: number; runtime: NodeGameplayUIRuntimeInit }
  | { kind: 'ui-start' }
  | { kind: 'ui-frame'; frame: PlayerUIFramePayload }
  | { kind: 'ui-commands'; commands: PlayerUICommand[] }
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
