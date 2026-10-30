import type { BmsonBGAFrame } from './bmson-bga.ts';
import { signal } from 'alien-signals';
import type { KeyBoundBGAFrame } from './key-bound-bga.ts';

type WritableSignal<T> = {
  (): T;
  (value: T): void;
};

export interface PlayerUIFrameSummary {
  total: number;
  perfect: number;
  fast: number;
  slow: number;
  great: number;
  good: number;
  bad: number;
  poor: number;
  /** Empty POOR (空POOR) count — see `PlayerSummary.emptyPoor`. */
  emptyPoor: number;
  exScore: number;
  score: number;
  /** The combo running now (`PlayerSummary.combo`); absent from a summary a host builds itself. */
  combo?: number;
  /** The highest combo so far (`PlayerSummary.maxCombo`). */
  maxCombo?: number;
  gauge?: PlayerGaugeSummary;
  /** A course stage's course-wide combo and max combo (`PlayerSummary.course`). */
  course?: { combo: number; maxCombo: number };
}

/**
 * The clock a frame's chart time holds at, so a host can run its own clock on from the frame: chart second
 * `currentSeconds` is reached when the output clock reads `outputSeconds`, and chart time runs `tempo` times as fast as
 * it from there unless `paused`.
 */
export interface PlayerUIFrameClock {
  /**
   * The audio session's output clock (`AudioSession.getClockState().outputSeconds`) — or, without one, the engine
   * scheduler's (`performance.now()`) in seconds — at which the play reaches the frame's chart second.
   */
  outputSeconds: number;
  /** Chart seconds per output-clock second. */
  tempo: number;
  /** The play is paused: chart time holds at the frame's second. */
  paused: boolean;
}

/**
 * Gauge state carried on every summary. Shared by the UI frame payload and the engine's own
 * `PlayerSummary` (`PlayerSummary.gauge`) so the two can never drift.
 */
export interface PlayerGaugeSummary {
  /** Raw values of parallel gauges, used to carry course class gauges independently. */
  values?: Readonly<Record<string, number>>;
  /** Raw gauge units, relative to `max`; PMS normal gauges use a maximum of 120. */
  current: number;
  max: number;
  clearThreshold: number;
  initial: number;
  effectiveTotal: number;
  cleared: boolean;
  /**
   * Ruleset-scoped gauge id — `'GROOVE'` / `'EASY'` / `'HARD'` / `'DEATH'` under LR2, `'NORMAL'` /
   * `'ASSIST-EASY'` / `'EX-HARD'` / `'HAZARD'` under beatoraja, `'ASSISTED-EASY'` / `'EX-HARD'` under That-Which-Must-Not-Be-Named.
   * Free-form because each ruleset has its own line-up.
   */
  type?: string;
  /** True for gauges that fail at 0 % instead of clearing on a threshold (HARD / EX-HARD / HAZARD families). */
  survival?: boolean;
  /** True once a survival gauge bottomed out mid-play; the run keeps judging but can no longer clear. */
  failedMidPlay?: boolean;
}

export interface PlayerUIFrameNote {
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

/** A Hell Charge note passing the judgment line and whether its gauge currently gains. */
export interface PlayerHCNLaneState {
  readonly channel: string;
  readonly gaining: boolean;
}

export interface PlayerUIFramePayload {
  /** Active chart-authored text, including the engine's transient TEXT00 miss selection. */
  chartText?: string;
  /** Active input-driven SWBGA frame; absent while no key-bound animation is visible. */
  keyBoundBGA?: KeyBoundBGAFrame;
  /** Active conditional bmson animation, resolved on the engine chart clock. */
  bmsonBGA?: BmsonBGAFrame;
  currentBeat: number;
  currentSeconds: number;
  /**
   * Display beat mirrored in chart-position space around the LR2 negative-BPM reversal
   * (`2 * reversalBeat - currentBeat`) — set only once the chart is past the reversal point. Renderers scroll from it
   * (falling back to `currentBeat`); the true clock keeps driving audio, BGA, and the forward judge-state sweep.
   */
  displayBeat?: number;
  /** Chart time of the LR2 negative-BPM reversal, when the chart has one — BGA compositors freeze there. */
  reversalSeconds?: number;
  totalSeconds: number;
  summary: PlayerUIFrameSummary;
  /** The 2P player's summary of a two-player play (LR2 BATTLE); `summary` is the 1P player's. */
  summary2P?: PlayerUIFrameSummary;
  notes: PlayerUIFrameNote[];
  /** Authoritative HCN animation state; absent before a judge is created. */
  hcnLanes?: readonly PlayerHCNLaneState[];
  /** Scored note judgments, excluding empty POOR and mine-only POOR. */
  judgedNoteCount?: number;
  landmineNotes?: PlayerUIFrameNote[];
  invisibleNotes?: PlayerUIFrameNote[];
  audioBackend?: string;
  activeAudioFiles?: string[];
  activeAudioVoiceCount?: number;
  /** The seek generation: 0 until the play first seeks, then one more for every seek the engine applied. */
  generation?: number;
  /** The clock the frame's chart time holds at; absent before the engine runs a clock. */
  clock?: PlayerUIFrameClock;
}

/** One judgment of a play rebuilt by a seek, in the order the play made it. */
export interface PlayerUISeekJudgment {
  judge: string;
  combo: number;
  channel?: string;
  /** Signed timing offset (positive = late), as on a judge cue; absent for AUTO judgments and misses. */
  deltaMs?: number;
  /** The chart second the judgment was made at. */
  seconds: number;
  /** The gauge right after it. */
  gauge?: number;
  /** The EX score right after it. */
  exScore: number;
}

/**
 * What a seek rebuilt the play to: its summary at the second sought (the combo and max combo with it) and every
 * judgment before it, so a host can rebuild what it derives from the judge cues (graphs, timings) without them.
 */
export interface PlayerUISeekSnapshot {
  summary: PlayerUIFrameSummary;
  combo: number;
  maxCombo: number;
  judgments: PlayerUISeekJudgment[];
}

/**
 * How the active ruleset plays a long note — which is not always the chart's `#LNMODE`: LR2 plays every long note as
 * an `'ln'`, That-Which-Must-Not-Be-Named plays them as charge notes. `'ln'` judges once (the start; an early release follows the ruleset's `lnEarlyRelease`), `'cn'` judges the
 * start and the release, `'hcn'` additionally drains the gauge while it isn't held.
 */
export type PlayerUILongNoteMode = 'ln' | 'cn' | 'hcn';

/**
 * How a held long note finished: `'complete'` when its end was judged a hit, `'dropped'` when it ended in a BAD / POOR
 * (released early, or a broken charge-note head under That-Which-Must-Not-Be-Named).
 */
export type PlayerUILongNoteOutcome = 'complete' | 'dropped';

export type PlayerUICommand =
  | { kind: 'judge-timing'; value: number }
  | { kind: 'flash-lane'; channel: string }
  | { kind: 'hold-lane-until-beat'; channel: string; beat: number }
  | { kind: 'press-lane'; channel: string }
  | { kind: 'release-lane'; channel: string }
  | { kind: 'trigger-poor-bga'; seconds: number }
  | { kind: 'clear-poor-bga' }
  /**
   * A long note's head was hit (or autoplayed) and the hold began. `beat` is the head's beat, which identifies the long
   * note on its lane; `mode` is the mode the engine actually plays it in. At most one long note is held per channel.
   */
  | { kind: 'long-note-start'; channel: string; beat: number; mode: PlayerUILongNoteMode }
  /** The long note held on `channel` (announced by the last `long-note-start` there) finished. */
  | { kind: 'long-note-end'; channel: string; outcome: PlayerUILongNoteOutcome }
  /**
   * The play sought to chart second `seconds` (`generation` is the frames' from now on): what a host showed of the play
   * before it is void — lane beams, bombs, held long notes, judgment plates, the POOR image — and the judge state is
   * `snapshot`. The long notes held across `seconds` are announced again right after it.
   */
  | { kind: 'seek'; generation: number; seconds: number; snapshot: PlayerUISeekSnapshot };

export interface PlayerUISignalBus {
  readonly frameTick: WritableSignal<number>;
  readonly commandTick: WritableSignal<number>;
  getFrame: () => Readonly<PlayerUIFramePayload>;
  publishFrame: (frame: PlayerUIFramePayload) => void;
  pushCommand: (command: PlayerUICommand) => void;
  drainCommands: () => PlayerUICommand[];
}

export function createPlayerUISignalBus(initialFrame: PlayerUIFramePayload): PlayerUISignalBus {
  const frameTick = signal(0);
  const commandTick = signal(0);
  const frameState: PlayerUIFramePayload = initialFrame;
  const commandQueue: PlayerUICommand[] = [];

  const publishFrame = (frame: PlayerUIFramePayload): void => {
    frameState.chartText = frame.chartText;
    frameState.keyBoundBGA = frame.keyBoundBGA;
    frameState.bmsonBGA = frame.bmsonBGA;
    frameState.currentBeat = frame.currentBeat;
    frameState.currentSeconds = frame.currentSeconds;
    frameState.displayBeat = frame.displayBeat;
    frameState.reversalSeconds = frame.reversalSeconds;
    frameState.totalSeconds = frame.totalSeconds;
    frameState.summary = frame.summary;
    frameState.summary2P = frame.summary2P;
    frameState.notes = frame.notes;
    frameState.hcnLanes = frame.hcnLanes;
    frameState.judgedNoteCount = frame.judgedNoteCount;
    frameState.landmineNotes = frame.landmineNotes;
    frameState.invisibleNotes = frame.invisibleNotes;
    frameState.audioBackend = frame.audioBackend;
    frameState.activeAudioFiles = frame.activeAudioFiles;
    frameState.activeAudioVoiceCount = frame.activeAudioVoiceCount;
    frameState.generation = frame.generation;
    frameState.clock = frame.clock;
    frameTick(frameTick() + 1);
  };

  const pushCommand = (command: PlayerUICommand): void => {
    commandQueue.push(command);
    commandTick(commandTick() + 1);
  };

  const drainCommands = (): PlayerUICommand[] => commandQueue.splice(0, commandQueue.length);

  return {
    frameTick,
    commandTick,
    getFrame: () => frameState,
    publishFrame,
    pushCommand,
    drainCommands,
  };
}
