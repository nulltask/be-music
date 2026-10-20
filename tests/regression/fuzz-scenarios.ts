import { createEmptyJSON, type BeMusicJSON } from '@be-music/json';
import { manualPlay } from '@be-music/player';
import type { PlaylogInputEvent, PlaylogNote, PlaylogRulesetId } from '@be-music/player/playlog';
import type { EngineReplay } from './play-scenarios.ts';

/**
 * Seeded random charts and input streams for the engine / play-log simulator differential test. Everything is drawn
 * from one deterministic generator per seed, so a failing seed reproduces exactly.
 */

/** The play modes the fuzzer draws charts for: 7 / 14 keys (BMS), 5 keys, 9 keys (PMS) and the 24-key keyboard. */
export type FuzzMode = '7' | '14' | '5' | '9' | '24';

export const FUZZ_GAUGES = ['GROOVE', 'HARD', 'DEATH', 'EASY'] as const;
export type FuzzGauge = (typeof FUZZ_GAUGES)[number];

/** mulberry32: a small, fast, seedable generator returning floats in [0, 1). */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface FuzzChart {
  json: BeMusicJSON;
  /** The play variant to pass the engine; undefined lets it classify the chart (7 / 14 keys). */
  playVariant: '5' | '9' | '24' | undefined;
}

/**
 * A short chart (3 to 6 measures) for `mode` with a random mix of taps, long notes (`#LNOBJ`, in the drawn
 * `#LNMODE`), mines, a BPM change, an `#EXRANK` change, `#RANK` and `#TOTAL`. Long-note tails sometimes land on the
 * next head on purpose.
 */
export function buildFuzzChart(mode: FuzzMode, random: () => number): FuzzChart {
  const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)]!;
  const json = createEmptyJSON('bms');
  const lnMode = pick([1, 2, 3] as const);
  const mines = random() < 0.4;
  const bpmChange = random() < 0.3;
  const exRank = random() < 0.2;
  json.metadata.rank = pick([0, 1, 2, 3]);
  const total = random() < 0.5 ? pick([100, 160, 300]) : undefined;
  if (total !== undefined) json.metadata.total = total;
  json.metadata.bpm = pick([120, 140, 150.5, 177, 200]);
  json.bms.lnObjs = ['ZZ'];
  json.bms.lnMode = lnMode;
  json.resources.wav['01'] = 'a.wav';
  json.resources.bpm['01'] = 90;

  const lanes =
    mode === '5'
      ? ['11', '12', '13', '14', '15', '16']
      : mode === '9'
        ? ['11', '12', '13', '14', '15', '22', '23', '24', '25']
        : mode === '24'
          ? Array.from('123456789ABCDEFGHIJKLMNOPQ', (code) => `1${code}`)
          : ['11', '12', '13', '14', '15', '18', '19', '16'];
  if (mode === '14') lanes.push('21', '22', '23', '24', '25', '28', '29', '26');

  const slotsPerMeasure = 16;
  const totalSlots = (3 + Math.floor(random() * 4)) * slotsPerMeasure;
  const density = 0.06 + random() * 0.12;
  const events: BeMusicJSON['events'] = [];
  const at = (slot: number): { measure: number; position: [number, number] } => ({
    measure: 1 + Math.floor(slot / slotsPerMeasure),
    position: [slot % slotsPerMeasure, slotsPerMeasure],
  });
  for (const lane of lanes) {
    let slot = 0;
    while (slot < totalSlots) {
      const roll = random();
      if (roll < density) {
        events.push({ ...at(slot), channel: lane, value: '01' });
        slot += 1 + Math.floor(random() * 3);
      } else if (roll < density * 1.4) {
        const length = 1 + Math.floor(random() * 6);
        if (slot + length >= totalSlots) break;
        events.push({ ...at(slot), channel: lane, value: '01' });
        events.push({ ...at(slot + length), channel: lane, value: 'ZZ' });
        slot += length + Math.floor(random() * 3);
      } else if (mines && mode !== '24' && roll < density * 1.6) {
        events.push({
          ...at(slot),
          channel: `${lane[0] === '1' ? 'D' : 'E'}${lane[1]}`,
          value: pick(['05', '10', '0A', '20']),
        });
        slot += 1;
      } else {
        slot += 1;
      }
    }
  }
  if (bpmChange) {
    events.push({ measure: 2, channel: '08', position: [0, 1], value: '01' });
  }
  if (exRank) {
    json.bms.exRank['01'] = pick(['25', '48', '150']);
    events.push({ measure: 2, channel: 'A0', position: [8, 16], value: '01' });
  }
  json.events = events;
  return { json, playVariant: mode === '5' || mode === '9' || mode === '24' ? mode : undefined };
}

/**
 * A key-state input stream over `notes`: each note pressed with an offset drawn across every window (and well past
 * them), some skipped, some preceded by a stray press, long notes released around, well before or well after their
 * tail, and keys sometimes held across mines. Every lane alternates down / up.
 */
export function buildFuzzInputs(notes: readonly PlaylogNote[], random: () => number): PlaylogInputEvent[] {
  const byLane = new Map<string, PlaylogNote[]>();
  for (const note of notes) {
    if (note.type === 'invisible') continue;
    const laneNotes = byLane.get(note.channel) ?? [];
    laneNotes.push(note);
    byLane.set(note.channel, laneNotes);
  }
  const offset = (): number => {
    const roll = random();
    if (roll < 0.35) return Math.round((random() - 0.5) * 30_000);
    if (roll < 0.7) return Math.round((random() - 0.5) * 150_000);
    if (roll < 0.9) return Math.round((random() - 0.5) * 400_000);
    return Math.round((random() - 0.5) * 1_200_000);
  };
  const events: Array<Omit<PlaylogInputEvent, 'seq'>> = [];
  const press = (channel: string, down: number, up: number): void => {
    events.push({ timeUs: down, action: 'down', channels: [channel] });
    events.push({ timeUs: up, action: 'up', channels: [channel] });
  };
  for (const [channel, laneNotes] of byLane) {
    laneNotes.sort((left, right) => left.timeUs - right.timeUs);
    let lastUp = -1;
    for (const note of laneNotes) {
      if (note.type === 'mine') {
        if (random() < 0.3) {
          const down = Math.max(lastUp + 1, note.timeUs - Math.round(random() * 200_000));
          lastUp = down + 1 + Math.round(random() * 300_000);
          press(channel, down, lastUp);
        }
        continue;
      }
      if (random() < 0.12) continue;
      if (random() < 0.08) {
        const stray = Math.max(lastUp + 1, note.timeUs - 300_000 - Math.round(random() * 700_000));
        lastUp = stray + 20_000;
        press(channel, stray, lastUp);
      }
      const down = Math.max(lastUp + 1, note.timeUs + offset());
      let up: number;
      if (note.endTimeUs !== undefined) {
        const roll = random();
        up =
          roll < 0.5
            ? note.endTimeUs + Math.round((random() - 0.5) * 40_000)
            : roll < 0.8
              ? note.endTimeUs - Math.round(random() * 600_000)
              : note.endTimeUs + Math.round(random() * 400_000);
      } else {
        up = down + 10_000 + Math.round(random() * 120_000);
      }
      lastUp = Math.max(up, down + 1);
      press(channel, down, lastUp);
    }
  }
  events.sort(
    (left, right) =>
      left.timeUs - right.timeUs ||
      (left.action === right.action ? 0 : left.action === 'up' ? -1 : 1) ||
      left.channels[0]!.localeCompare(right.channels[0]!),
  );
  // Sorting can interleave a lane's presses; keep its down / up alternation.
  const held = new Set<string>();
  return events
    .filter((event) => {
      const channel = event.channels[0]!;
      if (event.action === 'down') {
        if (held.has(channel)) return false;
        held.add(channel);
        return true;
      }
      if (!held.has(channel)) return false;
      held.delete(channel);
      return true;
    })
    .map((event, seq) => ({ seq, ...event }));
}

export interface FuzzReplayOptions {
  ruleset: PlaylogRulesetId;
  gauge: FuzzGauge;
  autoScratch: boolean;
}

/** Replays `inputs` through the live engine with the play options a fuzz case draws, recording a play log. */
export async function replayFuzzCase(
  chart: FuzzChart,
  inputs: readonly PlaylogInputEvent[],
  options: FuzzReplayOptions,
): Promise<EngineReplay> {
  let playlog: EngineReplay['playlog'] | undefined;
  const summary = await manualPlay(chart.json, {
    speed: 1024,
    leadInMs: 0,
    audio: false,
    tui: false,
    writeOutput: () => {},
    judgeRuleset: options.ruleset,
    ...(chart.playVariant === undefined ? {} : { playVariant: chart.playVariant }),
    gauge: options.gauge,
    autoScratch: options.autoScratch,
    replayInputs: inputs,
    recordPlaylog: { gauge: options.gauge },
    onPlaylogRecorded: (recorded) => {
      playlog = recorded;
    },
  });
  if (playlog === undefined) {
    throw new Error('manualPlay finished without recording a playlog');
  }
  return { summary, playlog };
}
