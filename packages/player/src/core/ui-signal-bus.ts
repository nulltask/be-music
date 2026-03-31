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
  gauge?: {
    current: number;
    max: number;
    clearThreshold: number;
    initial: number;
    effectiveTotal: number;
    cleared: boolean;
  };
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
}

export interface PlayerUiFramePayload {
  currentBeat: number;
  currentSeconds: number;
  totalSeconds: number;
  summary: PlayerUiFrameSummary;
  notes: PlayerUiFrameNote[];
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
