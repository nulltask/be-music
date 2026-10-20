import type { RandomDraws } from '@be-music/chart-model';
import type { BeMusicJSON } from '@be-music/chart-source';
import { manualPlay, type PlayerSummary } from '@be-music/player-engine';
import type { PlayerGaugeSummary } from '@be-music/player-engine/signals';
import type {
  BeMusicReplay,
  ReplayInputEvent,
  ReplayNote,
  RulesetId,
  ReplayRulesetResult,
} from '@be-music/player-engine/replay';

/**
 * Fixed input scenarios and the engine replay driver shared by the regression suites. Every stream is a pure
 * function of the engine's prepared note list, so each run replays exactly the same presses and releases.
 */

/** The judge rulesets the engine runs under (and the simulators reproduce). */
export const JUDGE_RULESETS: readonly RulesetId[] = ['lr2', 'beatoraja', 'iidx'];

/**
 * Playback speed of the corpus's pinned engine replays. A replay is judged on the judge core's fixed chart-time grid,
 * so the speed only sets how long it takes on the wall clock; `engine-determinism.test.ts` checks that another speed
 * reaches the same outcome.
 */
export const ENGINE_REPLAY_SPEED = 64;

/**
 * Press offsets cycled per note in the `offset` scenario, chosen to land in every LR2 window from PGREAT to a missed
 * POOR on both the FAST and the SLOW side.
 */
const OFFSET_SCENARIO_US = [0, 12_000, -12_000, 30_000, -30_000, 70_000, -70_000, 150_000] as const;
/** Every Nth scorable note is left unpressed in the `offset` scenario. */
const OFFSET_SCENARIO_SKIP_EVERY = 7;
/** How long a tap is held, capped so it never runs into the lane's next press. */
const TAP_HOLD_US = 40_000;

/** The three input streams the corpus pins: no input, every note on time, and presses cycled across every window. */
export function buildScenarios(notes: readonly ReplayNote[]): Record<string, ReplayInputEvent[]> {
  return {
    missed: [],
    perfect: buildInputs(
      notes,
      () => 0,
      () => false,
    ),
    offset: buildInputs(
      notes,
      (index) => OFFSET_SCENARIO_US[index % OFFSET_SCENARIO_US.length]!,
      (index) => index % OFFSET_SCENARIO_SKIP_EVERY === OFFSET_SCENARIO_SKIP_EVERY - 1,
    ),
  };
}

export interface EngineReplayOptions {
  randomDraws: RandomDraws;
  inputs: readonly ReplayInputEvent[];
  judgeRuleset?: RulesetId;
  speed: number;
}

export interface EngineReplay {
  summary: PlayerSummary;
  replay: BeMusicReplay;
}

/**
 * Replays `inputs` through the live engine (`manualPlay`, no audio, no TUI, no lead-in) and returns its summary
 * together with the replay it re-recorded. The chart must already be resolved with `randomDraws`, the way the
 * hosts hand it to the engine.
 */
export async function replayEngine(json: BeMusicJSON, options: EngineReplayOptions): Promise<EngineReplay> {
  let replay: BeMusicReplay | undefined;
  const summary = await manualPlay(json, {
    randomDraws: options.randomDraws,
    speed: options.speed,
    leadInMs: 0,
    audio: false,
    tui: false,
    writeOutput: () => {},
    ...(options.judgeRuleset === undefined ? {} : { judgeRuleset: options.judgeRuleset }),
    replayInputs: options.inputs,
    recordReplay: {},
    onReplayRecorded: (recorded) => {
      replay = recorded;
    },
  });
  if (replay === undefined) {
    throw new Error('manualPlay finished without recording a replay');
  }
  return { summary, replay };
}

/**
 * The fields on which an engine replay's own result (the replay's `results.native`) and the simulator's result for
 * the same ruleset disagree, as `field engine/simulator`, or an empty list when they agree. Both report the same
 * fields the same way, and both apply the same gauge steps in the same order, so every field must match exactly.
 */
export function findEngineSimulatorMismatches(engine: EngineReplay, simulated: ReplayRulesetResult): string[] {
  const native = engine.replay.results?.native;
  if (native === undefined) {
    return ['results.native missing'];
  }
  const { ruleset: _engineRuleset, ...engineResult } = native;
  const { ruleset: _simulatedRuleset, ...simulatedResult } = simulated;
  const engineFields = flattenResult(engineResult);
  const simulatedFields = flattenResult(simulatedResult);
  return [...new Set([...engineFields.keys(), ...simulatedFields.keys()])]
    .filter((field) => engineFields.get(field) !== simulatedFields.get(field))
    .map((field) => `${field} ${String(engineFields.get(field))}/${String(simulatedFields.get(field))}`);
}

function flattenResult(value: object, prefix = ''): Map<string, unknown> {
  const fields = new Map<string, unknown>();
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== null && typeof entry === 'object') {
      for (const [nested, nestedEntry] of flattenResult(entry, `${prefix}${key}.`)) fields.set(nested, nestedEntry);
    } else {
      fields.set(`${prefix}${key}`, entry);
    }
  }
  return fields;
}

/**
 * Replays one input stream through the live engine under every judge ruleset. The replays run concurrently: each
 * spends most of its time waiting for the next tick, and a replay is judged on the judge core's fixed chart-time grid,
 * so overlapping them only shortens the wall-clock time.
 */
export async function replayEngineRulesets(
  json: BeMusicJSON,
  options: Omit<EngineReplayOptions, 'judgeRuleset'>,
): Promise<Array<{ ruleset: RulesetId; replay: EngineReplay }>> {
  return Promise.all(
    JUDGE_RULESETS.map(async (ruleset) => ({
      ruleset,
      replay: await replayEngine(json, { ...options, judgeRuleset: ruleset }),
    })),
  );
}

/** What the corpus pins for one engine replay: its summary with floats rounded, plus the max combo it recorded. */
export function summarizeEngineReplay({ summary, replay }: EngineReplay): Record<string, unknown> {
  return {
    ...summary,
    maxCombo: replay.results?.native?.maxCombo,
    gauge: summary.gauge === undefined ? undefined : roundGauge(summary.gauge),
  };
}

export const round6 = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

function roundGauge(gauge: PlayerGaugeSummary): PlayerGaugeSummary {
  return {
    ...gauge,
    current: round6(gauge.current),
    max: round6(gauge.max),
    clearThreshold: round6(gauge.clearThreshold),
    initial: round6(gauge.initial),
    effectiveTotal: round6(gauge.effectiveTotal),
  };
}

/**
 * Builds a replay input stream that presses every scorable note on its own lane. `offsetUs` shifts a note's press
 * (and, for long notes, its release) and `skip` leaves a note unpressed; both are keyed by the note's index among
 * the pressable notes so the stream is deterministic. Presses on one lane never overlap: a press waits for the
 * lane's previous release, and a tap is released before the lane's next press.
 */
function buildInputs(
  notes: readonly ReplayNote[],
  offsetUs: (index: number) => number,
  skip: (index: number) => boolean,
): ReplayInputEvent[] {
  const pressable = notes.filter((note) => note.type !== 'mine' && note.type !== 'invisible');
  const byChannel = new Map<string, Array<{ note: ReplayNote; index: number }>>();
  pressable.forEach((note, index) => {
    if (skip(index)) {
      return;
    }
    const lane = byChannel.get(note.channel) ?? [];
    lane.push({ note, index });
    byChannel.set(note.channel, lane);
  });

  const events: Array<Omit<ReplayInputEvent, 'seq'>> = [];
  for (const [channel, lane] of byChannel) {
    let lastUpUs = Number.NEGATIVE_INFINITY;
    lane.forEach(({ note, index }, position) => {
      const offset = offsetUs(index);
      const downUs = Math.max(note.timeUs + offset, lastUpUs + 1);
      const next = lane[position + 1];
      const nextDownUs = next === undefined ? Number.POSITIVE_INFINITY : next.note.timeUs + offsetUs(next.index);
      const naturalUpUs = note.endTimeUs === undefined ? downUs + TAP_HOLD_US : note.endTimeUs + offset;
      const upUs = Math.max(downUs + 1, Math.min(naturalUpUs, nextDownUs - 1));
      events.push({ timeUs: downUs, action: 'down', channels: [channel] });
      events.push({ timeUs: upUs, action: 'up', channels: [channel] });
      lastUpUs = upUs;
    });
  }

  // Releases sort ahead of presses that share a timestamp, then lanes in channel order, so `seq` is stable.
  events.sort(
    (left, right) =>
      left.timeUs - right.timeUs ||
      (left.action === right.action ? 0 : left.action === 'up' ? -1 : 1) ||
      left.channels[0]!.localeCompare(right.channels[0]!),
  );
  return events.map((event, seq) => ({ seq, ...event }));
}
