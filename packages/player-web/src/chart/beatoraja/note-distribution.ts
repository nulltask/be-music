// Per-second, per-category note distribution analysis for a parsed BMS chart.
//
// Mirrors beatoraja's `SkinNoteDistributionGraph.updateData()` (TYPE_NORMAL = 0): for each
// 1-second bucket of chart playback, count notes split into seven categories whose colors
// the upstream renderer hard-codes. The same chart walk also extracts the BPM transitions
// (timeline-ordered `(timeMs, bpm)` segments) since `SkinBPMGraph` plots the same curve at
// the same destination box.
//
// Output is consumed by the select / decide / play scenes' `notes-graph` (judgegraph type=0)
// and `bpmgraph` destinations. Caches at the host level keyed by `song.id` — the analysis
// is pure-data and stable for the chart's lifetime.

import { resolveChart, resolveChartMainBPM } from '@be-music/chart';
import type { BeMusicJSON } from '@be-music/json';
import {
  collectBeatorajaChartTimedEntries,
  computeBeatorajaMeasureBaseBeats,
  resolveBeatorajaInitialBPM,
} from './timing.ts';

/**
 * Note distribution category indices. Mirrors `SkinNoteDistributionGraph.JGRAPH[0]` —
 * the order doubles as the stack order (cat 0 stacks at the bottom of each bar).
 */
export const NOTE_DISTRIBUTION_CATEGORIES = {
  /** Scratch lane (lane 6) LN-end note. */
  SCRATCH_LN_END: 0,
  /** Scratch lane LN body — counts every bucket the LN spans. */
  SCRATCH_LN_BODY: 1,
  /** Scratch lane normal (single-tap) note. */
  SCRATCH_NORMAL: 2,
  /** Key lane (everything except scratch) LN-end note. */
  KEY_LN_END: 3,
  /** Key lane LN body — counts every bucket the LN spans. */
  KEY_LN_BODY: 4,
  /** Key lane normal note. */
  KEY_NORMAL: 5,
  /** Mine note (any lane). */
  MINE: 6,
} as const;

const NOTE_DISTRIBUTION_CATEGORY_COUNT = 7;

/**
 * RGB tints (hex) for each category, matching upstream beatoraja's `JGRAPH[0]` palette.
 * The renderer fills 4×4 chips with these colors. Order parallels
 * {@link NOTE_DISTRIBUTION_CATEGORIES}.
 */
export const NOTE_DISTRIBUTION_COLORS: ReadonlyArray<number> = [
  0x44ff44, // SCRATCH_LN_END  (light green)
  0x228822, // SCRATCH_LN_BODY (dark green)
  0xff4444, // SCRATCH_NORMAL  (red)
  0x4444ff, // KEY_LN_END      (blue)
  0x222288, // KEY_LN_BODY     (dark blue)
  0xcccccc, // KEY_NORMAL      (light gray)
  0x880000, // MINE            (dark red)
];

/**
 * BPM transition point produced by the chart walk. `timeMs = 0` for the chart's initial
 * BPM; subsequent entries are at the millisecond offset of each `#BPMxx` change event in
 * playback time order. STOP events produce a synthetic `(stopStart, 0)` entry per the
 * upstream `SkinBPMGraph` convention so the BPM graph can render the magenta stop line.
 */
export interface BeatorajaBPMSegment {
  /** Wallclock millisecond offset from chart start. */
  timeMs: number;
  /** BPM value applying from `timeMs` onward (= 0 = stop). */
  bpm: number;
}

export interface BeatorajaChartNoteDistribution {
  /**
   * One bucket per second of chart playback (`buckets.length = ceil(totalMs / 1000) + 1`).
   * Each entry is a 7-element array indexed by {@link NOTE_DISTRIBUTION_CATEGORIES}.
   */
  buckets: ReadonlyArray<ReadonlyArray<number>>;
  /** Y-axis max — `max(20, ceil(densest_bucket_total / 10) * 10)` capped at 100. */
  maxCount: number;
  /** Total chart length in ms (= last note's wallclock time, rounded up). */
  totalMs: number;
  /** BPM transitions in playback time order. First entry is at `timeMs = 0`. */
  bpmSegments: ReadonlyArray<BeatorajaBPMSegment>;
  /**
   * The chart's main BPM, the BPM the most judged notes sit at (`resolveChartMainBPM`, the one
   * rule HS-FIX and the play log read too), else the initial BPM for a chart without notes.
   * Beatoraja's BPM graph normalises the y axis around this value, so segments at `mainBPM`
   * paint at the vertical centre and segments at half / double map to the bottom / top edges.
   */
  mainBPM: number;
  /** Minimum positive BPM observed (excluding stops). */
  minBPM: number;
  /** Maximum BPM observed. */
  maxBPM: number;
}

/**
 * Walk a chart's events in beat-then-time order, accumulating wallclock seconds across
 * BPM changes and stops, and bucket every playable note into 1-second windows by
 * category. Returns the analysis bundle the bpmgraph + notes-graph renderers need.
 *
 * Mirrors `SkinNoteDistributionGraph.updateData()` for the per-bucket categorisation and
 * `SkinBPMGraph.updateGraph(BMSModel)` for the BPM segments. The main BPM is the chart's
 * (`resolveChartMainBPM`), which `SkinBPMGraph` counts the same way.
 */
export function computeBeatorajaChartNoteDistribution(chart: BeMusicJSON): BeatorajaChartNoteDistribution {
  const measureBaseBeat = computeBeatorajaMeasureBaseBeats(chart);
  if (measureBaseBeat.length === 0) {
    return {
      buckets: [],
      maxCount: 20,
      totalMs: 0,
      bpmSegments: [],
      mainBPM: chart.metadata.bpm > 0 ? chart.metadata.bpm : 130,
      minBPM: chart.metadata.bpm > 0 ? chart.metadata.bpm : 130,
      maxBPM: chart.metadata.bpm > 0 ? chart.metadata.bpm : 130,
    };
  }

  // LN object table — channels `1X..2X` notes whose value matches an `lnObjs` entry close
  // an LN that opened earlier on the same lane. We track open LN states per lane while
  // walking events.
  const lnObjs = new Set((chart.bms?.lnObjs ?? []).map((v) => v.toUpperCase()));

  // Build a unified entry list keyed by beat. Note events carry channel + value so we
  // can classify them (scratch vs. key, normal vs. LN, mine).
  const entries = collectBeatorajaChartTimedEntries(chart, measureBaseBeat, (event) =>
    isNoteChannel(event.channel) ? { channel: event.channel, value: event.value } : undefined,
  );

  // Walk and convert to wallclock ms. Track:
  //   - `bpmSegments`: list of (timeMs, bpm) BPM transitions. Stops emit `(stopStart, 0)`
  //     and `(stopEnd, prevBPM)` so the bpm-graph can render the magenta stop line.
  //   - LN body span: per-lane (channel) tracking of open LNs so each bucket the LN
  //     covers gets its body cell incremented.
  const initialBPM = resolveBeatorajaInitialBPM(chart);
  let bpm = initialBPM;
  let timeMs = 0;
  let cursorBeat = 0;
  const bpmSegments: BeatorajaBPMSegment[] = [{ timeMs: 0, bpm: initialBPM }];
  // Per-lane LN open state — `key = channel` (e.g. '11'), `value = startTimeMs`. Channel
  // mapping: BMS uses `1X` / `2X` for visible notes and `5X` / `6X` for LN-channel-style
  // longs; we treat both, plus `#LNOBJ`-marker LN closures on the visible channels.
  const openLNs = new Map<string, number>();
  // Note time-stamps (ms) per category — bucketed at the end so we know `totalMs` first.
  type NoteEvent = { timeMs: number; category: number };
  const noteEvents: NoteEvent[] = [];

  for (const e of entries) {
    if (e.beat > cursorBeat) {
      timeMs += ((e.beat - cursorBeat) * 60_000) / bpm;
      cursorBeat = e.beat;
    }
    if (e.kind === 'bpm') {
      // STOP-then-BPM at the same beat is rare; the next iteration's beat advance handles
      // pre-stop time, then this branch installs the new BPM for forward time.
      bpm = e.bpm;
      bpmSegments.push({ timeMs, bpm });
    } else if (e.kind === 'stop') {
      // Stop emits a `(stopStart, 0)` then `(stopEnd, prevBPM)` segment pair so the bpm
      // graph can render a magenta horizontal at the stop region.
      bpmSegments.push({ timeMs, bpm: 0 });
      timeMs += (e.durationBeats * 60_000) / bpm;
      bpmSegments.push({ timeMs, bpm });
    } else if (e.kind === 'note') {
      const { channel, value } = e.note;
      const isScratch = isScratchChannel(channel);
      const isLNChannel = channel[0] === '5' || channel[0] === '6';
      const isMine = channel[0] === 'D' || channel[0] === 'E' || channel[0] === 'd' || channel[0] === 'e';
      if (isMine) {
        noteEvents.push({ timeMs, category: NOTE_DISTRIBUTION_CATEGORIES.MINE });
        continue;
      }
      if (isLNChannel) {
        // Channel `5X` / `6X` LN — paired note: opening sets the start, closing emits the
        // end-event AND the body-spans get backfilled below. Pair detection: if the lane
        // is open, this note CLOSES the LN; otherwise it opens.
        const open = openLNs.get(channel);
        if (open === undefined) {
          openLNs.set(channel, timeMs);
          continue;
        }
        // Closing — emit body events spanning [openTimeMs, timeMs] in 1-second buckets.
        // Body category depends on lane; end gets its own category.
        pushLongNoteDistributionEvents(noteEvents, open, timeMs, isScratch);
        openLNs.delete(channel);
        continue;
      }
      // Visible note channel (`1X` / `2X`). LNOBJ-marker closure: if the value matches
      // an `lnObjs` entry AND a previous note opened on the same lane, this note CLOSES
      // the LN at body end time.
      if (lnObjs.has(value.toUpperCase())) {
        const open = openLNs.get(channel);
        if (open !== undefined) {
          pushLongNoteDistributionEvents(noteEvents, open, timeMs, isScratch);
          openLNs.delete(channel);
          continue;
        }
        // No prior open on this lane — record the LNOBJ marker as the opening tap. The
        // chart's NEXT note on this lane will close it.
        openLNs.set(channel, timeMs);
        // Also count the head as a normal note in the distribution (matches beatoraja's
        // "head visible like a regular tap").
        const cat = isScratch ? NOTE_DISTRIBUTION_CATEGORIES.SCRATCH_NORMAL : NOTE_DISTRIBUTION_CATEGORIES.KEY_NORMAL;
        noteEvents.push({ timeMs, category: cat });
        continue;
      }
      // Plain visible tap.
      const cat = isScratch ? NOTE_DISTRIBUTION_CATEGORIES.SCRATCH_NORMAL : NOTE_DISTRIBUTION_CATEGORIES.KEY_NORMAL;
      noteEvents.push({ timeMs, category: cat });
    }
  }

  // Determine totalMs — last event time (note or BPM). Round up to the next second so the
  // last bucket includes any trailing notes.
  let lastEventMs = 0;
  for (const ne of noteEvents) {
    if (ne.timeMs > lastEventMs) lastEventMs = ne.timeMs;
  }
  for (const seg of bpmSegments) {
    if (seg.timeMs > lastEventMs) lastEventMs = seg.timeMs;
  }
  const totalMs = lastEventMs;
  // Empty chart (no notes / no BPM transitions beyond the initial seed) → no buckets at all
  // so callers can hide the graph cleanly. Anything non-zero → at least 1 bucket.
  const hasContent = noteEvents.length > 0 || bpmSegments.length > 1;
  const bucketCount = hasContent ? Math.floor(totalMs / 1000) + 1 : 0;

  // Allocate buckets and fill. Each bucket is its own 7-element array.
  const buckets: number[][] = Array.from({ length: bucketCount }, () =>
    Array.from({ length: NOTE_DISTRIBUTION_CATEGORY_COUNT }, () => 0),
  );
  for (const ne of noteEvents) {
    if (bucketCount === 0) break;
    const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor(ne.timeMs / 1000)));
    buckets[idx]![ne.category] += 1;
  }

  // Y-axis max — match upstream's "snap to next 10, cap at 100" rule.
  let densest = 0;
  for (const bucket of buckets) {
    let total = 0;
    for (const v of bucket) total += v;
    if (total > densest) densest = total;
  }
  const maxCount = Math.max(20, Math.min(100, Math.ceil(densest / 10) * 10));

  // The chart's main BPM: one rule for the graph, the skin's main-BPM numbers, HS-FIX and the play log. A chart
  // the walk found no notes in has none, so it skips resolving the chart.
  const mainBPM = (noteEvents.length > 0 ? resolveChartMainBPM(resolveChart(chart)) : undefined) ?? initialBPM;

  // Min / max BPM — exclude stops (bpm = 0).
  let minBPM = Number.POSITIVE_INFINITY;
  let maxBPM = 0;
  for (const seg of bpmSegments) {
    if (seg.bpm <= 0) continue;
    if (seg.bpm < minBPM) minBPM = seg.bpm;
    if (seg.bpm > maxBPM) maxBPM = seg.bpm;
  }
  if (!Number.isFinite(minBPM)) minBPM = initialBPM;
  if (maxBPM <= 0) maxBPM = initialBPM;

  return { buckets, maxCount, totalMs, bpmSegments, mainBPM, minBPM, maxBPM };
}

function isNoteChannel(channel: string): boolean {
  if (channel.length !== 2) return false;
  const lead = channel[0]!;
  return (
    lead === '1' ||
    lead === '2' ||
    lead === '5' ||
    lead === '6' ||
    lead === 'D' ||
    lead === 'E' ||
    lead === 'd' ||
    lead === 'e'
  );
}

function pushLongNoteDistributionEvents(
  noteEvents: Array<{ timeMs: number; category: number }>,
  openTimeMs: number,
  closeTimeMs: number,
  isScratch: boolean,
): void {
  const bodyCat = isScratch ? NOTE_DISTRIBUTION_CATEGORIES.SCRATCH_LN_BODY : NOTE_DISTRIBUTION_CATEGORIES.KEY_LN_BODY;
  const endCat = isScratch ? NOTE_DISTRIBUTION_CATEGORIES.SCRATCH_LN_END : NOTE_DISTRIBUTION_CATEGORIES.KEY_LN_END;
  const startBucket = Math.floor(openTimeMs / 1000);
  const endBucket = Math.floor(closeTimeMs / 1000);
  for (let b = startBucket; b <= endBucket; b += 1) {
    noteEvents.push({ timeMs: b * 1000, category: bodyCat });
  }
  noteEvents.push({ timeMs: closeTimeMs, category: endCat });
}

function isScratchChannel(channel: string): boolean {
  if (channel.length !== 2) return false;
  // Scratch is lane '6' on both 1P and 2P (channels `16`, `26`, `56`, `66`, `D6`, `E6`).
  return channel[1] === '6';
}
