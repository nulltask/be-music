import type { ResolvedChart, ResolvedNote, TimingResolver } from '@be-music/chart-model';

export type ScrollModifier = 'OFF' | 'REMOVE';

/**
 * beatoraja 0.8.9 ScrollSpeedModifier.REMOVE: retain every timeline's time while replacing
 * its section with first-BPM * time / 60, its BPM/scroll with the first values and its STOP with zero.
 * This is a resolved-chart transformation, before LN/mine modifiers; source events remain untouched.
 */
export function removeScrollChanges(source: ResolvedChart): { chart: ResolvedChart; changed: boolean } {
  const bpm = source.timing.bpmAtBeat(0);
  if (!Number.isFinite(bpm) || bpm <= 0) throw new RangeError('Scroll REMOVE requires a positive initial BPM.');
  let scroll = 1;
  for (const point of source.scroll) if (point.beat <= 0) scroll = point.speed;
  const changed =
    source.timing.tempoPoints.some((point) => point.beat > 0 && point.bpm !== bpm) ||
    source.timing.stopPoints.some((point) => point.seconds !== 0) ||
    source.scroll.some((point) => point.beat > 0 && point.speed !== scroll);
  const toBeat = (seconds: number): number => (seconds * bpm) / 60;
  const mapBeat = (beat: number): number => toBeat(source.timing.beatToSeconds(beat));
  const timing: TimingResolver = {
    tempoPoints: [{ beat: 0, seconds: 0, bpm }],
    stopPoints: [],
    beatToSeconds: (beat) => (beat * 60) / bpm,
    eventToSeconds: (event) => source.timing.eventToSeconds(event),
    bpmAtBeat: () => bpm,
    displayBPMAtBeat: () => bpm,
  };
  const mapNotes = (notes: readonly ResolvedNote[]): ResolvedNote[] =>
    notes.map((note) => ({
      ...note,
      beat: toBeat(note.seconds),
      ...(note.endSeconds !== undefined ? { endBeat: toBeat(note.endSeconds) } : {}),
    }));
  // Explicit delegation keeps the source's lazy caches bound to the source and makes each changed coordinate clear.
  const chart: ResolvedChart = {
    source: source.source,
    sourceFormat: source.sourceFormat,
    randomDraws: source.randomDraws,
    hasUnresolvedControlFlow: source.hasUnresolvedControlFlow,
    idBase: source.idBase,
    playVariant: source.playVariant,
    layouts: source.layouts,
    lnMode: source.lnMode,
    inferBmsLNTypeWhenMissing: source.inferBmsLNTypeWhenMissing,
    beatResolver: {
      measureToBeat: (measure, position) => mapBeat(source.beatResolver.measureToBeat(measure, position)),
      eventToBeat: (event) => toBeat(source.timing.eventToSeconds(event)),
    },
    timing,
    reversal: undefined,
    sortedEvents: source.sortedEvents,
    notes: mapNotes(source.notes),
    shadowedNotes: mapNotes(source.shadowedNotes),
    mines: mapNotes(source.mines),
    invisibleNotes: mapNotes(source.invisibleNotes),
    sampleTriggers: source.sampleTriggers.map((trigger) => ({ ...trigger, beat: toBeat(trigger.seconds) })),
    volumeChanges: source.volumeChanges,
    bga: source.bga,
    scroll: [{ beat: 0, speed: scroll }],
    speed: source.speed.map((point) => ({ ...point, beat: mapBeat(point.beat) })),
    barLines: source.barLines.map(mapBeat),
    barLinesSuppressed: source.barLinesSuppressed,
    judgeRank: source.judgeRank,
    total: source.total,
    lastNoteSeconds: source.lastNoteSeconds,
  };
  return { chart, changed };
}
