import {
  getPlayModeLayouts,
  PLAY_MODE_LAYOUTS,
  type ResolvedChart,
  type TimedSampleTrigger,
} from '@be-music/chart-model';
import type { BeMusicEvent } from '@be-music/chart-source';
import type { TimedPlayableNote, TimedLandmineNote } from '../playable-notes.ts';
import { withChartOverrides } from './resolved-chart-overrides.ts';

const BATTLE_PLAY_VARIANTS = { '5': '10', '7': '14', '24': '48' } as const;

export interface DuplicateBattleOptions {
  /** beatoraja PlayerBattleModifier copies mines; LR2 D-BATTLE duplicates only 1x/3x/5x cells. */
  duplicateMines?: boolean;
  /**
   * Move each side's scratch (24KEY: wheel) objects to the background afterwards: beatoraja BATTLE AS
   * (AutoplayModifier, margin 0) and LR2 D-BATTLE without a held scratch key (op 10/20 → BGM op 1).
   */
  backgroundScratch?: boolean;
  /** LR2 zeroes a mine's value, so a scratch mine moved to the background plays WAV00; beatoraja drops it silently. */
  backgroundMineSample?: boolean;
}

/**
 * Source single-player DP BATTLE, after scroll/LN/mine/EXTRA and before lane random.
 * Each copied note has its own mutable state and event identity, including a paired LN.
 * Its 2P source channel identifies that copy independently in arrangement replays.
 * Background triggers, timing, TOTAL and source control-flow draws are shared once.
 */
export function duplicateBattleChart(
  source: ResolvedChart,
  notes: TimedPlayableNote[],
  mines: TimedLandmineNote[],
  invisible: TimedPlayableNote[],
  options: DuplicateBattleOptions = {},
): { chart: ResolvedChart; changedObjectCount: number } {
  const sourceVariant = source.playVariant;
  if (sourceVariant !== '5' && sourceVariant !== '7' && sourceVariant !== '24')
    throw new RangeError('DP BATTLE requires a 5KEY, 7KEY or 24KEY source chart.');
  const playVariant = BATTLE_PLAY_VARIANTS[sourceVariant];
  // Ignore decoder-inaccessible source cells (#17 in 7KEY is not a beatoraja lane).
  const allowed = new Set(PLAY_MODE_LAYOUTS[sourceVariant].lanes.map((lane) => lane.channel));
  let changedObjectCount = 0;
  const originOf = new Map<BeMusicEvent, BeMusicEvent>();
  for (const objects of options.duplicateMines === false ? [notes, invisible] : [notes, mines, invisible]) {
    for (let index = objects.length - 1; index >= 0; index--)
      if (!allowed.has(objects[index]!.channel)) objects.splice(index, 1);
    for (const original of [...objects]) {
      const copied = {
        ...original,
        channel: `2${original.channel.slice(1)}`,
        event: {
          ...original.event,
          position: [...original.event.position] as [number, number],
          channel: `${original.event.channel[0] === 'D' ? 'E' : original.event.channel[0] === '3' ? '4' : original.event.channel[0] === '5' ? '6' : '2'}${original.event.channel.slice(1)}`,
        },
      };
      // Both array element types have the same runtime fields; each array keeps its own note kind.
      objects.push(copied as TimedPlayableNote & TimedLandmineNote);
      originOf.set(copied.event, original.event);
      changedObjectCount++;
    }
    objects.sort((a, b) => a.seconds - b.seconds || a.channel.localeCompare(b.channel));
  }
  const sampleTriggers = options.backgroundScratch
    ? moveScratchToBackground(source, playVariant, notes, mines, originOf, options.backgroundMineSample === true)
    : undefined;
  return {
    chart: withChartOverrides(source, {
      playVariant,
      layouts: getPlayModeLayouts(playVariant),
      ...(sampleTriggers ? { sampleTriggers } : {}),
    }),
    changedObjectCount,
  };
}

/**
 * Remove judged scratch objects and sound each removed note's head as BGM at its own time.
 * Invisible objects are not timeline notes in either source and stay on their lanes.
 * An LN tail carries no keysound in the resolved model, so only the head is moved.
 */
function moveScratchToBackground(
  source: ResolvedChart,
  playVariant: '10' | '14' | '48',
  notes: TimedPlayableNote[],
  mines: TimedLandmineNote[],
  originOf: ReadonlyMap<BeMusicEvent, BeMusicEvent>,
  mineSample: boolean,
): TimedSampleTrigger[] {
  const scratch = new Set(
    PLAY_MODE_LAYOUTS[playVariant].lanes.filter((lane) => lane.kind !== 'key').map((lane) => lane.channel),
  );
  const triggerByEvent = new Map(source.sampleTriggers.map((trigger) => [trigger.event, trigger]));
  const added: TimedSampleTrigger[] = [];
  for (let index = notes.length - 1; index >= 0; index--) {
    const note = notes[index]!;
    if (!scratch.has(note.channel)) continue;
    notes.splice(index, 1);
    // A copy's event is a clone; its keysound trigger belongs to the 1P original.
    const original = triggerByEvent.get(originOf.get(note.event) ?? note.event);
    if (original === undefined) continue;
    added.push({
      ...original,
      event: { ...note.event, channel: '01' },
      channel: '01',
      beat: note.beat,
      seconds: note.seconds,
    });
  }
  for (let index = mines.length - 1; index >= 0; index--) {
    const mine = mines[index]!;
    if (!scratch.has(mine.channel)) continue;
    mines.splice(index, 1);
    if (mineSample && !mine.silent)
      added.push({
        event: { ...mine.event, channel: '01', value: '00' },
        channel: '01',
        sampleKey: '00',
        samplePath: source.source.resources.wav['00'],
        sampleOffsetSeconds: 0,
        beat: mine.beat,
        seconds: mine.seconds,
      });
  }
  return [...source.sampleTriggers, ...added].sort((a, b) => a.seconds - b.seconds);
}
