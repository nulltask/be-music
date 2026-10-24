import type { SRandomNote } from './lane-random.ts';

/**
 * LR2 beta3 CONVERGE: try the selected lane first for each note; if occupied by
 * a chord or LN (including its tail time), fall back to a random free key lane.
 * Scratch remains fixed unless it is the selected destination. The caller passes
 * the complete side key domain and the source mode's default/selected target.
 */
export function randomizeLR2ConvergeNotes(
  notes: readonly SRandomNote[],
  lanes: readonly string[],
  options: { target: string; scratch?: string; random: () => number },
): string[] {
  const channels = notes.map((note) => note.channel);
  const domain = new Set(lanes);
  if (!domain.has(options.target) && options.target !== options.scratch)
    throw new RangeError('CONVERGE target must be a key or scratch of this side.');
  const held = new Map<string, { source: string; endMs: number }>();
  const rows = new Map<number, number[]>();
  notes.forEach((note, index) => {
    if (!domain.has(note.channel) && note.channel !== options.scratch) return;
    const row = rows.get(note.timeMs);
    if (row) row.push(index);
    else rows.set(note.timeMs, [index]);
  });
  for (const [timeMs, indices] of [...rows].sort(([a], [b]) => a - b)) {
    for (const [target, hold] of held) if (hold.endMs < timeMs) held.delete(target);
    const used = new Set(held.keys());
    const map = new Map<string, string>();
    // Native scratch events are fixed and must reserve the scratch before keys
    // try to converge there. Scratch LNs also reserve it on later timelines.
    for (const index of indices) {
      const note = notes[index]!;
      if (note.channel !== options.scratch || note.kind === 'invisible') continue;
      used.add(note.channel);
      map.set(note.channel, note.channel);
      if (note.endTimeMs !== undefined && note.endTimeMs > timeMs)
        held.set(note.channel, { source: note.channel, endMs: note.endTimeMs });
    }
    const place = (note: SRandomNote, visible: boolean): string => {
      let target = map.get(note.channel) ?? [...held].find(([, hold]) => hold.source === note.channel)?.[0];
      if (visible || target === undefined) {
        if (!used.has(options.target)) target = options.target;
        else {
          const free = lanes.filter((lane) => !used.has(lane));
          if (free.length === 0) throw new RangeError('CONVERGE has more simultaneous events than available lanes.');
          const draw = options.random();
          if (!Number.isFinite(draw) || draw < 0 || draw >= 1)
            throw new RangeError('Lane randomness must be in [0, 1).');
          target = free[Math.floor(draw * free.length)]!;
        }
        used.add(target);
        map.set(note.channel, target);
      }
      if (visible && note.endTimeMs !== undefined && note.endTimeMs > timeMs)
        held.set(target, { source: note.channel, endMs: note.endTimeMs });
      return target;
    };
    const visible = indices
      .filter((index) => domain.has(notes[index]!.channel) && notes[index]!.kind !== 'invisible')
      .sort((a, b) => lanes.indexOf(notes[a]!.channel) - lanes.indexOf(notes[b]!.channel));
    for (const index of visible) channels[index] = place(notes[index]!, true);
    for (const index of indices) {
      const note = notes[index]!;
      if (domain.has(note.channel) && note.kind === 'invisible') channels[index] = place(note, false);
    }
  }
  return channels;
}
