import type { BeMusicEvent, BeMusicJSON } from '@be-music/chart-source';
import { autoPlay, manualPlay } from '../play.ts';
import {
  PlayerInterruptedError,
  type AudioSession,
  type CreatePlayerInputRuntimeContext,
  type CreatePlayerUIRuntimeContext,
  type PlayerOptions,
  type PlayerSummary,
} from '../engine-types.ts';
import type { PlayerInputCommand } from '../input-signal-bus.ts';
import type { PlayerUICommand, PlayerUIFrameNote, PlayerUIFramePayload } from '../ui-signal-bus.ts';
import type { BeMusicReplay, ReplayRulesetResult } from '../../replay/format.ts';
import { simulateReplayRulesets } from '../../replay/simulate.ts';
import { createVirtualClock } from './virtual-clock.ts';

/**
 * Test support: runs one `manualPlay` / `autoPlay` with scripted input, a test audio session and a recording UI
 * runtime, and collects everything a host could observe of it — the summary, the replay and its re-simulations, the
 * audio session's calls, the judge cues, the UI commands and frames, the host callbacks and the text output — as plain
 * data for the characterization snapshots. Times are milliseconds of the clock the play ran on, from the call that
 * started it (play-clock milliseconds when the lead-in is 0).
 */

export type CharacterizationDriver = 'manual' | 'auto';

/** One scripted input, `atMs` after the play started. Lanes are chart channels (`'11'`, `'16'`, ...). */
export type ScriptStep =
  /**
   * Keys go down, as the web input runtime sends them: a `lane-input` and a `kitty-state` press. `pressedAtMs` stamps
   * both with the wall-clock time the key really went down, as the web runtime stamps an event's `timeStamp`.
   */
  | { atMs: number; down: readonly string[]; pressedAtMs?: number }
  /** Keys come up: a `kitty-state` release, stamped with `pressedAtMs` (the instant they came up) when given. */
  | { atMs: number; up: readonly string[]; pressedAtMs?: number }
  /**
   * A `lane-input` alone, as a terminal without key release events sends it. `pressedAtMs` stamps the command with the
   * wall-clock time the key really went down (the engine judges it there, within 50 ms).
   */
  | { atMs: number; press: readonly string[]; pressedAtMs?: number }
  /** Any other input command (interrupt, pause, tempo, view, high speed). */
  | { atMs: number; command: PlayerInputCommand };

/** A key going down at `atMs` and up `holdMs` later. */
export function tap(atMs: number, lanes: string | readonly string[], holdMs = 60): ScriptStep[] {
  const list = typeof lanes === 'string' ? [lanes] : lanes;
  return [
    { atMs, down: list },
    { atMs: atMs + holdMs, up: list },
  ];
}

export function command(atMs: number, input: PlayerInputCommand): ScriptStep {
  return { atMs, command: input };
}

export interface TestAudioSessionOptions {
  /** `chartStartDelayMs` the session reports. */
  chartStartDelayMs?: number;
  /** How far the session's write head (`scheduledSeconds`) runs ahead of what is audible. */
  writeAheadMs?: number;
  /** Whether the session reports a clock (`getClockState`); without one the engine runs on the scheduler's clock. */
  clock?: boolean;
  /**
   * The audible clock moves in steps of this many ms, as Web Audio's `currentTime` moves a render quantum at a time,
   * while the wall clock (`pressedAt`) moves smoothly. Without it the audible clock moves smoothly too.
   */
  quantumMs?: number;
}

export interface CharacterizationPlay {
  driver: CharacterizationDriver;
  chart: BeMusicJSON;
  /** Engine options over the harness's own (no lead-in, the test runtimes and callbacks, replay recording). */
  options?: PlayerOptions;
  script?: readonly ScriptStep[];
  /**
   * Whether the scripted input runtime declares its key releases (`PlayerInputRuntime.reportsKeyReleases`). By default
   * it does, as the web input runtime does, unless the script sends terminal presses (`press` steps): the engine then
   * detects them.
   */
  reportsKeyReleases?: boolean;
  /** The test audio session (default), or none at all (`audio: false`). */
  audio?: false | TestAudioSessionOptions;
  /** With a UI runtime (default), or without one: the engine then writes its no-TUI trace to the output. */
  ui?: boolean;
  /** Hold the play open after its chart (`holdAfterChart`) and end it this long after `onSettled`. */
  holdAfterChart?: { releaseAfterMs: number };
  /** Chart seconds to take a {@link snapshotJudgeState} at: on the first frame at or past each. */
  captureAt?: readonly number[];
}

/** What a host could observe of one play. */
export interface PlayObservation {
  /** `completed`, `interrupted: <reason>` (a thrown `PlayerInterruptedError`) or `error: <message>`. */
  outcome: string;
  /** When the call settled. */
  endedAtMs: number;
  summary?: PlayerSummary;
  replay?: BeMusicReplay;
  /** `simulateReplay` of the recorded log under each ruleset. */
  simulated?: Record<string, ReplayRulesetResult>;
  /** The audio session's calls. */
  audio: string[];
  /** Judgment cues (`publishJudgeCombo`), with the gauge as it stood then. */
  judges: string[];
  /** UI commands (lane flashes, long notes, POOR BGA). */
  ui: string[];
  /** Frames published, the last one, and when each note, mine and invisible note first showed as judged. */
  frames: { count: number; last?: string; judged: string[] };
  /** Host callbacks and runtime lifecycle. */
  host: string[];
  /** `onLog` entries. */
  log: string[];
  /** Text written to `writeOutput`. */
  output: string[];
  /** The judge state at each of {@link CharacterizationPlay.captureAt}, by its chart second. */
  captured?: Record<string, JudgeStateSnapshot>;
}

/**
 * The judge state a host can read off a frame: the judgment counts, the scores and the gauge, the combo, and which
 * notes, mines and invisible notes show as judged (a long note with the beat it stays visible until).
 */
export interface JudgeStateSnapshot {
  counts: Record<string, number>;
  gauge: number | undefined;
  combo: number;
  notes: string[];
  landmines: string[];
  invisibleNotes: string[];
}

/**
 * Snapshots the judge state `frame` shows, with `combo` as the host reads it (the last judge cue's). Two plays whose
 * snapshots at a chart second are equal show the same play there.
 */
export function snapshotJudgeState(frame: Readonly<PlayerUIFramePayload>, combo: number): JudgeStateSnapshot {
  const { gauge, ...counts } = frame.summary;
  const judged = (notes: readonly PlayerUIFrameNote[] | undefined): string[] =>
    (notes ?? [])
      .filter((note) => note.judged)
      .map(
        (note) =>
          `${note.channel}@${formatNumber(note.seconds)}` +
          `${note.visibleUntilBeat === undefined ? '' : ` until=${formatNumber(note.visibleUntilBeat)}`}`,
      );
  return {
    counts: Object.fromEntries(
      Object.entries(counts).filter((entry): entry is [string, number] => typeof entry[1] === 'number'),
    ),
    gauge: gauge?.current,
    combo,
    notes: judged(frame.notes),
    landmines: judged(frame.landmineNotes),
    invisibleNotes: judged(frame.invisibleNotes),
  };
}

/** Where a play takes its time from: the virtual clock, or the host's own (to check the two agree). */
export interface PlayTimeSource {
  now(): number;
  /** The wall-clock time (the domain of `pressedAt`) at `ms`. */
  wallClockAt(ms: number): number;
  at(atMs: number, callback: () => void): () => void;
  run<T>(play: () => Promise<T>): Promise<T>;
}

/** Runs a play on a fresh virtual clock. */
export function virtualTime(): PlayTimeSource {
  const clock = createVirtualClock();
  return {
    now: () => clock.now(),
    wallClockAt: (ms) => clock.wallClockNow() - clock.now() + ms,
    at: (atMs, callback) => clock.at(atMs, callback),
    run: (play) => clock.run(play),
  };
}

/** Runs a play on the host's clock and timers, in real time. */
export function realTime(): PlayTimeSource {
  const originMs = performance.now();
  return {
    now: () => performance.now() - originMs,
    wallClockAt: (ms) => performance.timeOrigin + originMs + ms,
    at: (atMs, callback) => {
      const handle = setTimeout(callback, Math.max(0, atMs - (performance.now() - originMs)));
      return () => clearTimeout(handle);
    },
    run: (play) => play(),
  };
}

const formatMs = (ms: number): string => ms.toFixed(3);

const formatNumber = (value: number | undefined): string =>
  value === undefined ? '-' : String(Math.round(value * 1e6) / 1e6);

const formatEvent = (event: BeMusicEvent): string =>
  `${event.channel}:${event.value}@${event.measure}+${event.position[0]}/${event.position[1]}`;

function createTestAudioSession(
  time: PlayTimeSource,
  options: TestAudioSessionOptions,
  record: (entry: string) => void,
): AudioSession {
  let startedAtMs: number | undefined;
  let pausedAtMs: number | undefined;
  let pausedMs = 0;
  const outputMs = (): number => {
    if (startedAtMs === undefined) return 0;
    const elapsedMs = Math.max(0, (pausedAtMs ?? time.now()) - startedAtMs - pausedMs);
    const quantumMs = options.quantumMs;
    return quantumMs === undefined || !(quantumMs > 0) ? elapsedMs : Math.floor(elapsedMs / quantumMs) * quantumMs;
  };
  const entry = (text: string): void => record(`${formatMs(time.now())} ${text}`);
  return {
    backendLabel: 'characterization',
    chartStartDelayMs: options.chartStartDelayMs ?? 0,
    start: () => {
      startedAtMs = time.now();
      entry('start');
    },
    finish: async () => entry('finish'),
    dispose: async () => entry('dispose'),
    pause: () => {
      pausedAtMs = time.now();
      entry('pause');
    },
    resume: () => {
      if (pausedAtMs !== undefined) pausedMs += time.now() - pausedAtMs;
      pausedAtMs = undefined;
      entry('resume');
    },
    ...(options.clock === false
      ? {}
      : {
          getClockState: () => ({
            outputSeconds: outputMs() / 1000,
            scheduledSeconds: (outputMs() + (startedAtMs === undefined ? 0 : (options.writeAheadMs ?? 0))) / 1000,
          }),
        }),
    triggerEvent: (event) => entry(`trigger ${formatEvent(event)}`),
    triggerEventAt: (event, offsetSeconds) => entry(`trigger-at ${formatEvent(event)} +${formatNumber(offsetSeconds)}`),
    stopChannel: (channel) => entry(`stop ${channel}`),
    setTempo: (tempo) => entry(`tempo ${tempo}`),
  };
}

/** Turns lanes into the input tokens bound to them. */
function laneTokens(context: CreatePlayerInputRuntimeContext, lanes: readonly string[]): string[] {
  return lanes.map((lane) => {
    for (const [token, channels] of context.inputTokenToChannels) {
      if (channels.length === 1 && channels[0] === lane) return token;
    }
    for (const [token, channels] of context.inputTokenToChannels) {
      if (channels.includes(lane)) return token;
    }
    throw new Error(`No input token is bound to lane ${lane}.`);
  });
}

function scriptCommands(
  context: CreatePlayerInputRuntimeContext,
  step: ScriptStep,
  wallClockAt: (ms: number) => number,
): PlayerInputCommand[] {
  // Each lane is its own key: its own commands, in the order the keys are listed.
  if ('command' in step) return [step.command];
  const stamp = step.pressedAtMs === undefined ? {} : { pressedAt: wallClockAt(step.pressedAtMs) };
  if ('down' in step) {
    return laneTokens(context, step.down).flatMap((token): PlayerInputCommand[] => [
      { kind: 'lane-input', tokens: [token], ...stamp },
      { kind: 'kitty-state', pressTokens: [token], repeatTokens: [], releaseTokens: [], ...stamp },
    ]);
  }
  if ('up' in step) {
    return laneTokens(context, step.up).map((token): PlayerInputCommand => ({
      kind: 'kitty-state',
      pressTokens: [],
      repeatTokens: [],
      releaseTokens: [token],
      ...stamp,
    }));
  }
  return laneTokens(context, step.press).map((token): PlayerInputCommand => ({
    kind: 'lane-input',
    tokens: [token],
    ...stamp,
  }));
}

/** Runs one play and collects what it showed. */
export async function observePlay(
  play: CharacterizationPlay,
  time: PlayTimeSource = virtualTime(),
): Promise<PlayObservation> {
  const audio: string[] = [];
  const judges: string[] = [];
  const ui: string[] = [];
  const host: string[] = [];
  const log: string[] = [];
  const outputChunks: string[] = [];
  const frames: PlayObservation['frames'] = { count: 0, judged: [] };
  const captured: Record<string, JudgeStateSnapshot> = {};
  const pendingCaptures = [...(play.captureAt ?? [])].sort((a, b) => a - b);
  const now = (): string => formatMs(time.now());
  const hostEntry = (text: string): void => {
    host.push(`${now()} ${text}`);
  };
  let replay: BeMusicReplay | undefined;
  const pendingInputs: Array<() => void> = [];
  const holdController = play.holdAfterChart === undefined ? undefined : new AbortController();

  const options: PlayerOptions = {
    leadInMs: 0,
    tui: false,
    ...(play.audio === false
      ? { audio: false }
      : {
          createAudioSession: async () => createTestAudioSession(time, play.audio || {}, (entry) => audio.push(entry)),
        }),
    writeOutput: (text) => {
      outputChunks.push(text);
    },
    onLog: (entry) => {
      const { emittedAtUnixMs: _unix, emittedAtMonotonicMs: _monotonic, ...fields } = entry.fields ?? {};
      log.push(`${now()} ${entry.level} ${entry.event} ${JSON.stringify(fields)}`);
    },
    onLoadComplete: () => hostEntry('load-complete'),
    onTempoChange: (change) => hostEntry(`tempo x${change.tempo} at ${formatNumber(change.seconds)}`),
    onHighSpeedChange: (highSpeed) => hostEntry(`high-speed ${formatNumber(highSpeed)}`),
    onRulesetResolved: (info) =>
      hostEntry(`ruleset ${info.id} ${info.longNoteStyle} note=${JSON.stringify(info.windows.note)}`),
    recordReplay: {},
    onReplayRecorded: (recorded) => {
      replay = recorded;
    },
    createInputRuntime: (context) => {
      hostEntry(`input-runtime create ${context.mode}`);
      // Scripted input is scheduled from the start of the play, whether or not the runtime was started: a host pushes
      // its interrupt and view commands straight onto the bus too.
      for (const step of play.script ?? []) {
        pendingInputs.push(
          time.at(step.atMs, () => {
            for (const input of scriptCommands(context, step, (ms) => time.wallClockAt(ms)))
              context.inputSignals.pushCommand(input);
          }),
        );
      }
      const reportsKeyReleases = play.reportsKeyReleases ?? !(play.script ?? []).some((step) => 'press' in step);
      return {
        start: () => hostEntry('input-runtime start'),
        stop: () => hostEntry('input-runtime stop'),
        ...(reportsKeyReleases ? { reportsKeyReleases } : {}),
      };
    },
    ...(play.ui === false
      ? {}
      : {
          createUIRuntime: async (context: CreatePlayerUIRuntimeContext) => {
            observeUI(context);
            return {
              tuiEnabled: true,
              start: () => hostEntry('ui start'),
              stop: () => hostEntry('ui stop'),
              dispose: () => hostEntry('ui dispose'),
              triggerPoor: (seconds: number) => hostEntry(`ui trigger-poor ${formatNumber(seconds)}`),
              clearPoor: () => hostEntry('ui clear-poor'),
            };
          },
        }),
    ...(holdController === undefined
      ? {}
      : {
          holdAfterChart: {
            signal: holdController.signal,
            onSettled: () => {
              hostEntry('hold settled');
              time.at(time.now() + play.holdAfterChart!.releaseAfterMs, () => {
                hostEntry('hold release');
                holdController.abort();
              });
            },
          },
        }),
    ...play.options,
  };

  function observeUI(context: CreatePlayerUIRuntimeContext): void {
    const { stateSignals, uiSignals } = context;
    const publishJudgeCombo = stateSignals.publishJudgeCombo;
    stateSignals.publishJudgeCombo = (judge, combo, channel, updatedAtMs, deltaMs) => {
      const gauge = uiSignals.getFrame().summary.gauge;
      judges.push(
        `${now()} ${judge} combo=${combo}${channel === undefined ? '' : ` ch=${channel}`}` +
          `${deltaMs === undefined ? '' : ` delta=${formatNumber(deltaMs)}`} gauge=${formatNumber(gauge?.current)}`,
      );
      publishJudgeCombo(judge, combo, channel, updatedAtMs, deltaMs);
    };
    const pushCommand = uiSignals.pushCommand;
    uiSignals.pushCommand = (uiCommand: PlayerUICommand) => {
      const { kind, ...fields } = uiCommand;
      const details = Object.entries(fields).map(([key, value]) =>
        key === 'channel'
          ? ` ${String(value)}`
          : ` ${key}=${typeof value === 'number' ? formatNumber(value) : String(value)}`,
      );
      ui.push(`${now()} ${kind}${details.join('')}`);
      pushCommand(uiCommand);
    };
    const seen = new Set<PlayerUIFrameNote>();
    const publishFrame = uiSignals.publishFrame;
    uiSignals.publishFrame = (frame) => {
      frames.count += 1;
      frames.last =
        `${now()} seconds=${formatNumber(frame.currentSeconds)} beat=${formatNumber(frame.currentBeat)}` +
        `${frame.displayBeat === undefined ? '' : ` displayBeat=${formatNumber(frame.displayBeat)}`}`;
      const scan = (kind: string, notes: readonly PlayerUIFrameNote[] | undefined): void => {
        for (const note of notes ?? []) {
          if (!note.judged || seen.has(note)) continue;
          seen.add(note);
          frames.judged.push(
            `${now()} seconds=${formatNumber(frame.currentSeconds)} ${kind} ${note.channel}@${formatNumber(note.seconds)}`,
          );
        }
      };
      scan('note', frame.notes);
      scan('mine', frame.landmineNotes);
      scan('invisible', frame.invisibleNotes);
      publishFrame(frame);
      while (pendingCaptures.length > 0 && frame.currentSeconds >= pendingCaptures[0]!) {
        const at = pendingCaptures.shift()!;
        captured[formatNumber(at)] = snapshotJudgeState(frame, stateSignals.getJudgeCombo().combo);
      }
    };
  }

  const driver = play.driver === 'manual' ? manualPlay : autoPlay;
  let outcome = 'completed';
  let summary: PlayerSummary | undefined;
  try {
    summary = await time.run(() => driver(play.chart, options));
  } catch (error) {
    outcome =
      error instanceof PlayerInterruptedError
        ? `interrupted: ${error.reason}`
        : `error: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    for (const cancel of pendingInputs) cancel();
  }
  const endedAtMs = time.now();

  return {
    outcome,
    endedAtMs: Math.round(endedAtMs * 1000) / 1000,
    ...(summary === undefined ? {} : { summary }),
    ...(replay === undefined ? {} : { replay, simulated: simulateReplayRulesets(replay) }),
    audio,
    judges,
    ui,
    frames,
    host,
    log,
    ...(play.captureAt === undefined ? {} : { captured }),
    // The HIGH-SPEED hint names the host platform's modifier key (Option on macOS, Alt elsewhere).
    output: outputChunks
      .join('')
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => line.replace(/\b(?:Option|Alt)\+/g, '<Alt/Option>+')),
  };
}

/** Parts of a play that often repeat an earlier play's of the same case; a repeat is written as a reference. */
const SHARED_PARTS: ReadonlyArray<readonly string[]> = [
  ['replay', 'chart'],
  ['replay', 'inputs'],
  ['replay', 'results'],
  ['simulated'],
  ['log'],
  ['output'],
];

/**
 * The snapshot form of the plays of one case: volatile replay fields dropped (`createdAt`, the recorder's engine
 * version), every number rounded to a millionth (so reordering float arithmetic does not churn the snapshots while any
 * real change still shows), and a large part that equals an earlier play's written as `"(same as <play>)"`.
 */
export function snapshotOf(plays: Readonly<Record<string, PlayObservation>>): Record<string, unknown> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const [name, observation] of Object.entries(plays)) {
    const play = roundNumbers(observation) as Record<string, unknown>;
    if (observation.replay !== undefined) {
      const { createdAt: _createdAt, recorder: _recorder, ...replay } = play.replay as Record<string, unknown>;
      play.replay = replay;
    }
    for (const path of SHARED_PARTS) {
      const value = readPath(play, path);
      if (value === undefined) continue;
      const json = JSON.stringify(value);
      const earlier = Object.keys(result).find((other) => JSON.stringify(readPath(result[other]!, path)) === json);
      if (earlier !== undefined) writePath(play, path, `(same as ${earlier})`);
    }
    result[name] = play;
  }
  return result;
}

function readPath(value: Record<string, unknown>, path: readonly string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' && current.startsWith('(same as ') ? undefined : current;
}

function writePath(value: Record<string, unknown>, path: readonly string[], replacement: unknown): void {
  let current = value;
  for (const key of path.slice(0, -1)) current = current[key] as Record<string, unknown>;
  current[path.at(-1)!] = replacement;
}

function roundNumbers(value: unknown): unknown {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : Math.round(value * 1e6) / 1e6 || 0;
  }
  if (Array.isArray(value)) return value.map(roundNumbers);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, roundNumbers(child)]));
}

/** JSON with every object or array that fits in 120 columns on one line, so a snapshot stays short and diffs by line. */
export function formatSnapshot(value: unknown, indent = ''): string {
  const inline = JSON.stringify(value);
  if (inline === undefined) return 'null';
  if (typeof value !== 'object' || value === null || indent.length + inline.length <= 120) return inline;
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    return `[\n${value.map((item) => `${inner}${formatSnapshot(item, inner)}`).join(',\n')}\n${indent}]`;
  }
  const entries = Object.entries(value).filter(([, child]) => child !== undefined);
  const lines = entries.map(([key, child]) => `${inner}${JSON.stringify(key)}: ${formatSnapshot(child, inner)}`);
  return `{\n${lines.join(',\n')}\n${indent}}`;
}
