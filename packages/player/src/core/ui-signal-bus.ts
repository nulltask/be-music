import { signal } from 'alien-signals';

type WritableSignal<T> = {
  (): T;
  (value: T): void;
};

export interface PlayerUiFrameSummary {
  total: number;
  perfect: number;
  fast: number;
  slow: number;
  great: number;
  good: number;
  bad: number;
  poor: number;
  exScore: number;
  score: number;
  gauge?: PlayerGaugeSummary;
}

/**
 * Gauge state carried on every summary. Shared by the UI frame payload and the engine's own
 * `PlayerSummary` so the two can never drift; the engine re-exports it as `PlayerGrooveGaugeSummary`.
 */
export interface PlayerGaugeSummary {
  current: number;
  max: number;
  clearThreshold: number;
  initial: number;
  effectiveTotal: number;
  cleared: boolean;
  /**
   * Ruleset-scoped gauge id — `'GROOVE'` / `'EASY'` / `'HARD'` / `'DEATH'` under LR2, `'NORMAL'` /
   * `'ASSIST-EASY'` / `'EX-HARD'` / `'HAZARD'` under beatoraja, `'ASSISTED-EASY'` / `'EX-HARD'` under IIDX.
   * Free-form because each ruleset has its own line-up.
   */
  type?: string;
  /** True for gauges that fail at 0 % instead of clearing on a threshold (HARD / EX-HARD / HAZARD families). */
  survival?: boolean;
  /** True once a survival gauge bottomed out mid-play; the run keeps judging but can no longer clear. */
  failedMidPlay?: boolean;
}

export interface PlayerUiFrameNote {
  channel: string;
  beat: number;
  endBeat?: number;
  visibleUntilBeat?: number;
  seconds: number;
  judged: boolean;
  mine?: boolean;
  invisible?: boolean;
  /**
   * Long-note mode for the note's pair: `1` = LN (legacy long note), `2` = CN (charge note),
   * `3` = HCN (hell charge note). Only meaningful when `endBeat` is set. Undefined for tap
   * notes.
   *
   * Surfaces to the renderer so it can match upstream beatoraja's `LaneRenderer.drawLongNote`
   * (`LaneRenderer.java:671-697`) per-mode visual divergence:
   *   - mode 1 (LN): draws body + tail only; HEAD is rendered through the regular `note[]`
   *     image (the same sprite a tap note uses). The upstream LN code path explicitly skips
   *     `longImage[0]` (= `lnstart`) for LN.
   *   - mode 2 (CN): draws head (`lnstart[]`) + body + tail.
   *   - mode 3 (HCN): same as CN visually; head + body + tail.
   *
   * Without this field the renderer cannot replicate the LN-vs-CN head distinction and ends
   * up drawing every LN with the small `lnstart` cap on top of the body — user-visible
   * symptom: the LN head's small `lns-*` cap stuck onto the body looked off compared to
   * upstream's full note-sized head. LR2 renderers that don't
   * inspect this field continue to render as before.
   */
  longNoteMode?: 1 | 2 | 3;
}

export interface PlayerUiFramePayload {
  currentBeat: number;
  currentSeconds: number;
  totalSeconds: number;
  summary: PlayerUiFrameSummary;
  notes: PlayerUiFrameNote[];
  landmineNotes?: PlayerUiFrameNote[];
  invisibleNotes?: PlayerUiFrameNote[];
  audioBackend?: string;
  activeAudioFiles?: string[];
  activeAudioVoiceCount?: number;
}

export type PlayerUiCommand =
  | { kind: 'flash-lane'; channel: string }
  | { kind: 'hold-lane-until-beat'; channel: string; beat: number }
  | { kind: 'press-lane'; channel: string }
  | { kind: 'release-lane'; channel: string }
  | { kind: 'trigger-poor-bga'; seconds: number }
  | { kind: 'clear-poor-bga' };

export interface PlayerUiSignalBus {
  readonly frameTick: WritableSignal<number>;
  readonly commandTick: WritableSignal<number>;
  getFrame: () => Readonly<PlayerUiFramePayload>;
  publishFrame: (frame: PlayerUiFramePayload) => void;
  pushCommand: (command: PlayerUiCommand) => void;
  drainCommands: () => PlayerUiCommand[];
}

export function createPlayerUiSignalBus(initialFrame: PlayerUiFramePayload): PlayerUiSignalBus {
  const frameTick = signal(0);
  const commandTick = signal(0);
  const frameState: PlayerUiFramePayload = initialFrame;
  const commandQueue: PlayerUiCommand[] = [];

  const publishFrame = (frame: PlayerUiFramePayload): void => {
    frameState.currentBeat = frame.currentBeat;
    frameState.currentSeconds = frame.currentSeconds;
    frameState.totalSeconds = frame.totalSeconds;
    frameState.summary = frame.summary;
    frameState.notes = frame.notes;
    frameState.landmineNotes = frame.landmineNotes;
    frameState.invisibleNotes = frame.invisibleNotes;
    frameState.audioBackend = frame.audioBackend;
    frameState.activeAudioFiles = frame.activeAudioFiles;
    frameState.activeAudioVoiceCount = frame.activeAudioVoiceCount;
    frameTick(frameTick() + 1);
  };

  const pushCommand = (command: PlayerUiCommand): void => {
    commandQueue.push(command);
    commandTick(commandTick() + 1);
  };

  const drainCommands = (): PlayerUiCommand[] => commandQueue.splice(0, commandQueue.length);

  return {
    frameTick,
    commandTick,
    getFrame: () => frameState,
    publishFrame,
    pushCommand,
    drainCommands,
  };
}
