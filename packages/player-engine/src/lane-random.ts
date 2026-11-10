import { drawLaneRandomIndex } from './lane-random-source.ts';
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
  /** beatoraja's ordinary PMS S-RANDOM uses S_RANDOM_NO_THRESHOLD. */
  mode?: 'pms';
  /**
   * LR2's nine-key S-RANDOM: one more destination outside the playfield. LR2 draws `startlane + GetRand(9)`, and the
   * inclusive `GetRand` reaches raw lane 10, the 2P scratch (OpenLR2 `LR2f.cpp` L27354, L27372). A note placed there
   * cannot be hit, as SCATTER's does.
   */
  outside?: string;
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
  const pms = options.ruleset === 'beatoraja' && options.mode === 'pms';
  return randomizeTimeBasedNotes(notes, lanes, options, pms ? 0 : 40, options.ruleset === 'beatoraja');
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

/** beatoraja ALL-SCR: alternate scratch destinations; DP fallback favors the outside keys. */
export function randomizeAllScratchNotes(
  notes: readonly SRandomNote[],
  lanes: readonly string[],
  options: {
    random: () => number;
    scratchLanes: readonly string[];
    thresholdBPM?: number;
    doublePlay?: boolean;
    side?: '1P' | '2P';
  },
): string[] {
  if (options.scratchLanes.length === 0 || options.scratchLanes.some((lane) => !lanes.includes(lane)))
    throw new RangeError('ALL-SCR requires the mode/side scratch lanes in the lane domain.');
  return randomizeTimeBasedNotes(
    notes,
    lanes,
    { ruleset: 'beatoraja', random: options.random },
    Math.ceil(15000 / clampHRandomThresholdBPM(options.thresholdBPM ?? 120)),
    true,
    options,
  );
}

/** beatoraja PMS CONVERGE favors the longest recent jack streak among eligible lanes. */
export function randomizePMSConvergeNotes(
  notes: readonly SRandomNote[],
  lanes: readonly string[],
  options: { random: () => number; thresholdBPM?: number },
): string[] {
  return randomizeTimeBasedNotes(
    notes,
    lanes,
    { ruleset: 'beatoraja', random: options.random },
    Math.ceil(15000 / clampHRandomThresholdBPM(options.thresholdBPM ?? 120)),
    true,
    undefined,
    true,
  );
}

const PMS_PLAYABLE_CHORDS = [
  [0, 1, 2, 3, 4, 5],
  [0, 1, 2, 4, 5, 6],
  [0, 1, 2, 5, 6, 7],
  [0, 1, 2, 6, 7, 8],
  [1, 2, 3, 4, 5, 6],
  [1, 2, 3, 5, 6, 7],
  [1, 2, 3, 6, 7, 8],
  [2, 3, 4, 5, 6, 7],
  [2, 3, 4, 6, 7, 8],
  [3, 4, 5, 6, 7, 8],
] as const;

/**
 * beatoraja 0.8.9 PMS S_RANDOM_PLAYABLE prioritizes one source six-key playable
 * combination per row, retaining holds and the configurable H-RANDOM threshold.
 * The pinned source throws on its empty post-threshold candidate list; preserve
 * that failure explicitly rather than inventing a different fallback policy.
 */
export function randomizePMSPlayableNotes(
  notes: readonly SRandomNote[],
  lanes: readonly string[],
  options: { random: () => number; thresholdBPM?: number },
): string[] {
  if (lanes.length !== 9 || new Set(lanes).size !== 9)
    throw new RangeError('PMS playable S-RANDOM requires nine lanes.');
  return randomizeTimeBasedNotes(
    notes,
    lanes,
    { ruleset: 'beatoraja', random: options.random },
    Math.ceil(15000 / clampHRandomThresholdBPM(options.thresholdBPM ?? 120)),
    true,
    undefined,
    false,
    true,
  );
}

function randomizeTimeBasedNotes(
  notes: readonly SRandomNote[],
  lanes: readonly string[],
  options: SRandomOptions,
  thresholdMs = 40,
  visitAllRows = false,
  allScratch?: { scratchLanes: readonly string[]; doublePlay?: boolean; side?: '1P' | '2P' },
  converge = false,
  playable = false,
): string[] {
  lanes = [...new Set(lanes)];
  const channels = notes.map((note) => note.channel);
  const domain = new Set(lanes);
  const laneNumbers = allScratch?.doublePlay === true ? new Map(lanes.map((lane, index) => [lane, index])) : undefined;
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
  if (options.ruleset !== 'beatoraja')
    return randomizeLR2Notes(notes, lanes, rows, channels, options.random, options.outside);
  let scratchIndex = 0;
  const changeable = [...lanes];
  const assignable = [...lanes];
  const streak = new Map(lanes.map((lane) => [lane, 0]));
  const held = new Map<string, { target: string; endMs: number }>();
  const lastNoteTime = new Map(lanes.map((lane) => [lane, visitAllRows ? -10000 : Number.NEGATIVE_INFINITY]));
  for (const [timeMs, indices] of [...rows].sort(([left], [right]) => left - right)) {
    // Upstream restores released lanes at the end of its mutable lane lists.
    // Their order is observable when the same Java seed is reused.
    if (held.size > 0) {
      const released = [...held]
        .filter(([, hold]) => hold.endMs < timeMs)
        .sort(([left], [right]) => lanes.indexOf(left) - lanes.indexOf(right));
      for (const [source, hold] of released) {
        held.delete(source);
        changeable.push(source);
        assignable.push(hold.target);
      }
    }
    if (converge)
      for (const lane of lanes) if (Math.trunc(timeMs) - lastNoteTime.get(lane)! > thresholdMs * 2) streak.set(lane, 0);
    // The mutable source and destination lists already exclude lanes reserved by active holds.
    const free = assignable.slice();
    const map = new Map<string, string>();
    for (const [source, hold] of held) map.set(source, hold.target);
    const scoring = new Set<string>();
    for (const index of indices) {
      const note = notes[index]!;
      if (domain.has(note.channel) && (note.kind ?? 'note') === 'note') scoring.add(note.channel);
    }
    let playableCombination: readonly string[] | undefined;
    if (playable) {
      // getNoteExistLane includes LN tails; source noteCount additionally counts
      // every active hold, so tails contribute twice on their exact timeline.
      const noteCount = scoring.size + held.size + [...held.values()].filter((hold) => hold.endMs === timeMs).length;
      if (noteCount > 2 && noteCount < 7) {
        const occupied = [...held.values()].map((hold) => hold.target);
        const combinations = PMS_PLAYABLE_CHORDS.map((chord) => chord.map((index) => lanes[index]!)).filter((chord) =>
          occupied.every((lane) => chord.includes(lane)),
        );
        if (combinations.length > 0) {
          const candidates = combinations
            .map((chord) => chord.filter((lane) => Math.trunc(timeMs) - lastNoteTime.get(lane)! >= thresholdMs))
            .filter((chord) => chord.length >= noteCount);
          if (candidates.length === 0)
            throw new RangeError(
              'beatoraja 0.8.9 S_RANDOM_PLAYABLE has no post-threshold candidate (upstream nextInt(0)).',
            );
          playableCombination = pickRandom(candidates, options.random);
        }
      }
    }
    // Upstream assigns scoring sources first, then the row's empty/mine/hidden sources.
    const sources = allScratch ? changeable.slice() : changeable;
    if (allScratch) {
      const scratch = allScratch.scratchLanes[scratchIndex]!;
      const source = sources.find((lane) => scoring.has(lane));
      if (source !== undefined && free.includes(scratch) && Math.trunc(timeMs) - lastNoteTime.get(scratch)! > 40) {
        map.set(source, scratch);
        free.splice(free.indexOf(scratch), 1);
        sources.splice(sources.indexOf(source), 1);
        lastNoteTime.set(scratch, Math.trunc(timeMs));
        scratchIndex = (scratchIndex + 1) % allScratch.scratchLanes.length;
      }
    }
    const nowMs = Math.trunc(timeMs);
    const pastThreshold = (lane: string): boolean => nowMs - lastNoteTime.get(lane)! > thresholdMs;
    for (const source of sources) {
      if (!scoring.has(source)) continue;
      let candidates = free.filter(pastThreshold);
      const hasPast = candidates.length > 0;
      if (!hasPast) {
        const oldest = Math.min(...free.map((lane) => lastNoteTime.get(lane)!));
        candidates = free.filter((lane) => lastNoteTime.get(lane) === oldest);
      } else {
        if (converge) {
          const longest = Math.max(...candidates.map((lane) => streak.get(lane)!));
          candidates = candidates.filter((lane) => streak.get(lane) === longest);
        }
        if (playableCombination !== undefined) {
          const allowed = candidates.filter((lane) => playableCombination.includes(lane));
          if (allowed.length > 0) candidates = allowed;
        }
      }
      // DP ALL-SCR leans toward the scratch by lane number, regardless of how a released LN reordered the lanes.
      const target =
        allScratch?.doublePlay === true && hasPast
          ? pickSideLane(candidates, laneNumbers!, allScratch.side === '2P')
          : pickRandom(candidates, options.random);
      if (converge && hasPast) streak.set(target, streak.get(target)! + 1);
      map.set(source, target);
      free.splice(free.indexOf(target), 1);
      lastNoteTime.set(target, nowMs);
    }

    // Upstream appends recent destinations after the past-threshold ones for empty, mine and hidden sources.
    // Empty sources don't update jack times, and removing a draw preserves the order, so partition just once per row.
    const emptySources = sources.filter((lane) => !scoring.has(lane));
    if (emptySources.length > 0) {
      const firstRecent = free.findIndex((lane) => !pastThreshold(lane));
      if (firstRecent !== -1) {
        const recent = [free[firstRecent]!];
        let pastEnd = firstRecent;
        for (let index = firstRecent + 1; index < free.length; index++) {
          const lane = free[index]!;
          if (pastThreshold(lane)) free[pastEnd++] = lane;
          else recent.push(lane);
        }
        free.length = pastEnd;
        free.push(...recent);
      }
      for (const source of emptySources) {
        const index = drawLaneRandomIndex(free.length, options.random);
        map.set(source, free.splice(index, 1)[0]!);
      }
    }
    for (const index of indices) {
      const note = notes[index]!;
      if (!domain.has(note.channel)) continue;
      const target = map.get(note.channel)!;
      channels[index] = target;
      if ((note.kind ?? 'note') === 'note' && note.endTimeMs !== undefined && note.endTimeMs > timeMs) {
        const previous = held.get(note.channel);
        if (!previous) {
          changeable.splice(changeable.indexOf(note.channel), 1);
          assignable.splice(assignable.indexOf(target), 1);
        }
        held.set(note.channel, { target, endMs: Math.max(note.endTimeMs, previous?.endMs ?? note.endTimeMs) });
      }
    }
  }
  return channels;
}

/** The lowest-numbered lane (the highest with `highest`), numbered as the source numbers them. */
function pickSideLane(lanes: readonly string[], numbers: ReadonlyMap<string, number>, highest: boolean): string {
  let best = lanes[0]!;
  for (const lane of lanes)
    if (highest ? numbers.get(lane)! > numbers.get(best)! : numbers.get(lane)! < numbers.get(best)!) best = lane;
  return best;
}

function pickRandom<T>(lanes: readonly T[], random: () => number): T {
  return lanes[drawLaneRandomIndex(lanes.length, random)]!;
}

/** LR2 assigns each visible note/mine to a free destination; only the destination is locked by an LN. */
function randomizeLR2Notes(
  notes: readonly SRandomNote[],
  lanes: readonly string[],
  rows: ReadonlyMap<number, number[]>,
  channels: string[],
  random: () => number,
  outside?: string,
): string[] {
  const held = new Map<string, { source: string; endMs: number }>();
  const destinations = outside === undefined ? lanes : [...lanes, outside];
  for (const [timeMs, indices] of [...rows].sort(([left], [right]) => left - right)) {
    for (const [target, hold] of held) if (hold.endMs < timeMs) held.delete(target);
    const free = destinations.filter((lane) => !held.has(lane));
    const map = new Map<string, string>();
    const visible = indices
      .filter((index) => notes[index]!.kind !== 'invisible')
      .sort((left, right) => lanes.indexOf(notes[left]!.channel) - lanes.indexOf(notes[right]!.channel));
    for (const index of visible) {
      const note = notes[index]!;
      if (free.length === 0) throw new RangeError('S-RANDOM has more simultaneous events than available lanes.');
      const target = pickRandom(free, random);
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
        const candidates = free.length > 0 ? free : destinations.filter((lane) => !held.has(lane));
        target = candidates.length > 0 ? pickRandom(candidates, random) : note.channel;
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
  const increment = lanes.indexOf(pickRandom(lanes.slice(1), random));
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
