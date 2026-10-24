import type { RulesetId } from './ruleset/definitions.ts';

/** One resolved event before lane randomization. A long note keeps its head and tail on this one channel. */
export interface SRandomNote {
  channel: string;
  timeMs: number;
  endTimeMs?: number;
  /** Mines and hidden notes do not update beatoraja's jack timing; LR2 treats mines as placed events. */
  kind?: 'note' | 'mine' | 'invisible';
}

export interface SRandomOptions {
  ruleset: RulesetId;
  random: () => number;
}

/**
 * Resolve S-RANDOM channels without mutating the input. Active LN destinations stay reserved through the tail row.
 * LR2 (and the provisional That-Which-Must-Not-Be-Named option) chooses free lanes without a jack threshold. beatoraja prefers lanes more
 * than 40 integer milliseconds after their last scoring note, falling back to the oldest available lanes.
 * `lanes` is one complete mode/side key domain; every event outside it passes through unchanged.
 */
export function randomizeSRandomNotes(
  notes: readonly SRandomNote[],
  lanes: readonly string[],
  options: SRandomOptions,
): string[] {
  return randomizeTimeBasedNotes(notes, lanes, options);
}

/** beatoraja 0.8.9 PlayerConfig accepts integer H-RANDOM threshold BPMs from 1 to 1000 (default 120). */
export function clampHRandomThresholdBPM(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(1000, Math.trunc(value))) : 120;
}

/** beatoraja H-RANDOM uses the configured 16th-note interval with the strict integer-ms jack threshold. */
export function randomizeHRandomNotes(
  notes: readonly SRandomNote[],
  lanes: readonly string[],
  options: { random: () => number; thresholdBPM?: number },
): string[] {
  const thresholdMs = Math.ceil(15000 / clampHRandomThresholdBPM(options.thresholdBPM ?? 120));
  return randomizeTimeBasedNotes(notes, lanes, { ruleset: 'beatoraja', random: options.random }, thresholdMs, true);
}

function randomizeTimeBasedNotes(
  notes: readonly SRandomNote[],
  lanes: readonly string[],
  options: SRandomOptions,
  thresholdMs = 40,
  visitAllRows = false,
): string[] {
  lanes = [...new Set(lanes)];
  const channels = notes.map((note) => note.channel);
  const domain = new Set(lanes);
  const rows = new Map<number, number[]>();
  notes.forEach((note, index) => {
    if (!visitAllRows && !domain.has(note.channel)) return;
    const row = rows.get(note.timeMs);
    if (row) row.push(index);
    else rows.set(note.timeMs, [index]);
    if (
      visitAllRows &&
      (note.kind ?? 'note') === 'note' &&
      note.endTimeMs !== undefined &&
      note.endTimeMs > note.timeMs &&
      !rows.has(note.endTimeMs)
    )
      rows.set(note.endTimeMs, []);
  });
  if (options.ruleset !== 'beatoraja') return randomizeLR2Notes(notes, lanes, rows, channels, options.random);
  const held = new Map<string, { target: string; endMs: number }>();
  const lastNoteTime = new Map(lanes.map((lane) => [lane, visitAllRows ? -10000 : Number.NEGATIVE_INFINITY]));
  for (const [timeMs, indices] of [...rows].sort(([left], [right]) => left - right)) {
    for (const [source, hold] of held) {
      if (hold.endMs < timeMs) held.delete(source);
    }
    const occupied = new Set([...held.values()].map((hold) => hold.target));
    const free = lanes.filter((lane) => !occupied.has(lane));
    const map = new Map([...held].map(([source, hold]) => [source, hold.target]));
    const scoring = new Set(
      indices.filter((index) => (notes[index]!.kind ?? 'note') === 'note').map((index) => notes[index]!.channel),
    );
    // Upstream assigns scoring sources first, then the row's empty/mine/hidden sources.
    const sources = lanes.filter((lane) => !held.has(lane));
    const ordered = [...sources.filter((lane) => scoring.has(lane)), ...sources.filter((lane) => !scoring.has(lane))];
    for (const source of ordered) {
      let candidates = free;
      if (options.ruleset === 'beatoraja' && scoring.has(source)) {
        const eligible = free.filter((lane) => Math.trunc(timeMs) - lastNoteTime.get(lane)! > thresholdMs);
        if (eligible.length > 0) candidates = eligible;
        else {
          const oldest = Math.min(...free.map((lane) => lastNoteTime.get(lane)!));
          candidates = free.filter((lane) => lastNoteTime.get(lane) === oldest);
        }
      }
      const target = pickLane(candidates, options.random);
      map.set(source, target);
      free.splice(free.indexOf(target), 1);
      if (options.ruleset === 'beatoraja' && scoring.has(source)) lastNoteTime.set(target, Math.trunc(timeMs));
    }
    for (const index of indices) {
      const note = notes[index]!;
      if (!domain.has(note.channel)) continue;
      const target = map.get(note.channel)!;
      channels[index] = target;
      if ((note.kind ?? 'note') === 'note' && note.endTimeMs !== undefined && note.endTimeMs > timeMs) {
        const previous = held.get(note.channel);
        held.set(note.channel, { target, endMs: Math.max(note.endTimeMs, previous?.endMs ?? note.endTimeMs) });
      }
    }
  }
  return channels;
}

function pickLane(lanes: readonly string[], random: () => number): string {
  const draw = random();
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1) throw new RangeError('Lane randomness must be in [0, 1).');
  return lanes[Math.floor(draw * lanes.length)]!;
}

/** LR2 assigns each visible note/mine to a free destination; only the destination is locked by an LN. */
function randomizeLR2Notes(
  notes: readonly SRandomNote[],
  lanes: readonly string[],
  rows: ReadonlyMap<number, number[]>,
  channels: string[],
  random: () => number,
): string[] {
  const held = new Map<string, { source: string; endMs: number }>();
  for (const [timeMs, indices] of [...rows].sort(([left], [right]) => left - right)) {
    for (const [target, hold] of held) if (hold.endMs < timeMs) held.delete(target);
    const free = lanes.filter((lane) => !held.has(lane));
    const map = new Map<string, string>();
    const visible = indices
      .filter((index) => notes[index]!.kind !== 'invisible')
      .sort((left, right) => lanes.indexOf(notes[left]!.channel) - lanes.indexOf(notes[right]!.channel));
    for (const index of visible) {
      const note = notes[index]!;
      if (free.length === 0) throw new RangeError('S-RANDOM has more simultaneous events than available lanes.');
      const target = pickLane(free, random);
      free.splice(free.indexOf(target), 1);
      channels[index] = target;
      map.set(note.channel, target);
      if (note.endTimeMs !== undefined && note.endTimeMs > timeMs)
        held.set(target, { source: note.channel, endMs: note.endTimeMs });
    }
    for (const index of indices) {
      const note = notes[index]!;
      if (note.kind !== 'invisible') continue;
      let target = map.get(note.channel) ?? [...held].find(([, hold]) => hold.source === note.channel)?.[0];
      if (target === undefined) {
        const candidates = free.length > 0 ? free : lanes.filter((lane) => !held.has(lane));
        target = candidates.length > 0 ? pickLane(candidates, random) : note.channel;
        const position = free.indexOf(target);
        if (position >= 0) free.splice(position, 1);
        map.set(note.channel, target);
      }
      channels[index] = target;
    }
  }
  return channels;
}

/**
 * beatoraja 0.8.9 SPIRAL: choose one increment in [1, N-1], advance on every
 * occupied timeline, and freeze through an active LN's tail timeline.
 * Pass events from both sides, scratches, mines and hidden notes: upstream also
 * visits timelines with no event in the modified key domain. Tail-only rows count.
 */
export function randomizeSpiralNotes(
  notes: readonly SRandomNote[],
  lanes: readonly string[],
  random: () => number,
): string[] {
  const channels = notes.map((note) => note.channel);
  lanes = [...new Set(lanes)];
  if (lanes.length < 2) return channels;
  const increment = lanes.indexOf(pickLane(lanes.slice(1), random));
  const domain = new Map(lanes.map((lane, index) => [lane, index]));
  const rows = new Map<number, number[]>();
  notes.forEach((note, index) => {
    const row = rows.get(note.timeMs);
    if (row) row.push(index);
    else rows.set(note.timeMs, [index]);
    if (
      (note.kind ?? 'note') === 'note' &&
      note.endTimeMs !== undefined &&
      note.endTimeMs > note.timeMs &&
      !rows.has(note.endTimeMs)
    )
      rows.set(note.endTimeMs, []);
  });
  const held = new Map<string, number>();
  let head = 0;
  for (const [timeMs, indices] of [...rows].sort(([left], [right]) => left - right)) {
    for (const [source, endMs] of held) if (endMs < timeMs) held.delete(source);
    if (held.size === 0) head = (head + increment) % lanes.length;
    for (const index of indices) {
      const note = notes[index]!;
      const source = domain.get(note.channel);
      if (source === undefined) continue;
      channels[index] = lanes[(source + head) % lanes.length]!;
      if ((note.kind ?? 'note') === 'note' && note.endTimeMs !== undefined && note.endTimeMs > timeMs)
        held.set(note.channel, Math.max(note.endTimeMs, held.get(note.channel) ?? note.endTimeMs));
    }
  }
  return channels;
}
