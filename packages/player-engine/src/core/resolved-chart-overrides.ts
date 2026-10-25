import type { ResolvedChart } from '@be-music/chart-model';

/** Keep source getters bound to their owner; spreading a lazy chart would drop them. */
export function withChartOverrides(source: ResolvedChart, overrides: Partial<ResolvedChart>): ResolvedChart {
  return {
    get source() {
      return source.source;
    },
    get sourceFormat() {
      return source.sourceFormat;
    },
    get randomDraws() {
      return source.randomDraws;
    },
    get hasUnresolvedControlFlow() {
      return source.hasUnresolvedControlFlow;
    },
    get idBase() {
      return source.idBase;
    },
    get playVariant() {
      return source.playVariant;
    },
    get layouts() {
      return source.layouts;
    },
    get lnMode() {
      return source.lnMode;
    },
    get inferBmsLNTypeWhenMissing() {
      return source.inferBmsLNTypeWhenMissing;
    },
    get beatResolver() {
      return source.beatResolver;
    },
    get timing() {
      return source.timing;
    },
    get reversal() {
      return source.reversal;
    },
    get sortedEvents() {
      return source.sortedEvents;
    },
    get notes() {
      return source.notes;
    },
    get shadowedNotes() {
      return source.shadowedNotes;
    },
    get mines() {
      return source.mines;
    },
    get invisibleNotes() {
      return source.invisibleNotes;
    },
    get sampleTriggers() {
      return source.sampleTriggers;
    },
    get volumeChanges() {
      return source.volumeChanges;
    },
    get bga() {
      return source.bga;
    },
    get scroll() {
      return source.scroll;
    },
    get speed() {
      return source.speed;
    },
    get barLines() {
      return source.barLines;
    },
    get barLinesSuppressed() {
      return source.barLinesSuppressed;
    },
    get judgeRank() {
      return source.judgeRank;
    },
    get total() {
      return source.total;
    },
    get lastNoteSeconds() {
      return source.lastNoteSeconds;
    },
    ...overrides,
  };
}
