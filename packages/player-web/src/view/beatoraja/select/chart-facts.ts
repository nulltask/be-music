/**
 * What the beatoraja select view's skin reads of a chart bar beyond its library entry (`BeatorajaSelectView`): the
 * chart's key mode, traits, note kinds, densities, length, BPM range and main BPM, worked out once per chart and kept in
 * weak maps keyed by the library entry.
 */

import type { ChartPlayVariant } from '@be-music/chart';
import type { BeatorajaChartTraits, BeatorajaSelectChartFacts } from '@be-music/beatoraja-skin/scene';
import { resolveLR2ChartFeatures } from '@be-music/lr2-skin/state';
import { resolveLibraryChartPlayVariant, type LibraryChart } from '@be-music/scene-model';
import { computeBeatorajaChartDensity, type ChartDensity } from '../../../chart/beatoraja/density.ts';
import { computeBeatorajaChartTotalSeconds } from '../../../chart/beatoraja/duration.ts';
import { extractChartSubartist } from '../../../chart/beatoraja/meta.ts';
import { computeBeatorajaNoteBreakdown, type NoteBreakdown } from '../../../chart/beatoraja/note-counts.ts';
import { resolveShownChartMainBPM } from '../../../chart/main-bpm.ts';

/**
 * `resolveLibraryChartPlayVariant` walks the chart's events / metadata to classify keys mode. On a
 * malformed entry it can throw; a per-frame op-set computation must never throw, so we wrap
 * with a try/catch and fall back to `undefined` (= no `KEYSONG_*` op set, "modeless" bar).
 */
export function safeResolveChartVariant(song: LibraryChart): ChartPlayVariant | undefined {
  try {
    return resolveLibraryChartPlayVariant(song);
  } catch {
    return undefined;
  }
}

/**
 * Cached chart duration in seconds for the focused song. The underlying computation walks the
 * full event list + bpm/stop tables; caching keyed by the `LibraryChart` reference (= the
 * chart never changes once loaded) keeps per-frame resolves O(1).
 */
function resolveSongLengthSeconds(song: LibraryChart): number {
  const cached = SONG_LENGTH_CACHE.get(song);
  if (cached !== undefined) return cached;
  const seconds = computeBeatorajaChartTotalSeconds(song.chart);
  SONG_LENGTH_CACHE.set(song, seconds);
  return seconds;
}
const SONG_LENGTH_CACHE = new WeakMap<LibraryChart, number>();

/**
 * Cached note breakdown for the focused song. Same caching pattern as the duration helper —
 * the events scan happens once per song, then per-frame resolves are O(1) lookups.
 */
function resolveNoteBreakdown(song: LibraryChart): NoteBreakdown {
  const cached = NOTE_BREAKDOWN_CACHE.get(song);
  if (cached !== undefined) return cached;
  const breakdown = computeBeatorajaNoteBreakdown(song.chart);
  NOTE_BREAKDOWN_CACHE.set(song, breakdown);
  return breakdown;
}
const NOTE_BREAKDOWN_CACHE = new WeakMap<LibraryChart, NoteBreakdown>();

/** Cached note density (peak / end / avg NPS) for the focused song. */
function resolveDensity(song: LibraryChart): ChartDensity {
  const cached = NOTE_DENSITY_CACHE.get(song);
  if (cached !== undefined) return cached;
  const density = computeBeatorajaChartDensity(song.chart);
  NOTE_DENSITY_CACHE.set(song, density);
  return density;
}
const NOTE_DENSITY_CACHE = new WeakMap<LibraryChart, ChartDensity>();

/**
 * Walk the chart's BPM-change events (channels `03` / `08`) and return the integer min / max
 * BPM. Includes the chart's `metadata.bpm` so a chart that doesn't change BPM still gets a
 * sensible (min === max === main) result. Returns `undefined` when neither metadata BPM nor
 * any change event yields a finite positive number (corrupt / empty chart).
 *
 * Cached per song via WeakMap — the events array is iterated once and reused across frames.
 */
function resolveBPMRange(song: LibraryChart): { min: number; max: number } | undefined {
  const cached = BPM_RANGE_CACHE.get(song);
  if (cached !== undefined) return cached === null ? undefined : cached;
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  const considerBPM = (bpm: number): void => {
    if (!Number.isFinite(bpm) || bpm <= 0) return;
    if (bpm < min) min = bpm;
    if (bpm > max) max = bpm;
  };
  considerBPM(song.chart.metadata.bpm);
  const bpmTable = song.chart.resources?.bpm ?? {};
  for (const event of song.chart.events ?? []) {
    if (event.value === '00' || event.value === '') continue;
    if (event.channel === '03') {
      considerBPM(parseInt(event.value, 16));
    } else if (event.channel === '08') {
      const looked =
        bpmTable[event.value] ?? bpmTable[event.value.toLowerCase()] ?? bpmTable[event.value.toUpperCase()];
      if (typeof looked === 'number') considerBPM(looked);
      else if (typeof looked === 'string') considerBPM(Number.parseFloat(looked));
    }
  }
  if (!Number.isFinite(min) || max <= 0) {
    BPM_RANGE_CACHE.set(song, null);
    return undefined;
  }
  const result = { min: Math.round(min), max: Math.round(max) };
  BPM_RANGE_CACHE.set(song, result);
  return result;
}
const BPM_RANGE_CACHE = new WeakMap<LibraryChart, { min: number; max: number } | null>();

/**
 * What the skin reads of a chart bar beyond its library entry (`BeatorajaSelectChartFacts`), kept per chart. The facts
 * that walk the chart (traits, note kinds, densities, length, BPM range, main BPM) are read the first time a skin asks
 * for them.
 */
export function selectChartFacts(song: LibraryChart): BeatorajaSelectChartFacts {
  let facts = SELECT_CHART_FACTS.get(song);
  if (facts === undefined) {
    const meta = song.chart.metadata;
    let traits: BeatorajaChartTraits | undefined;
    const playVariant = safeResolveChartVariant(song);
    facts = {
      ...(playVariant !== undefined ? { playVariant } : {}),
      get traits(): BeatorajaChartTraits {
        if (traits === undefined) {
          const features = resolveLR2ChartFeatures(song.chart);
          traits = {
            longNote: features.longNote,
            bga: features.bga,
            bpmChange: features.bpmChange,
            random: features.random,
            stop: chartHasStop(song),
            stageFile: Boolean(meta.stageFile),
            banner: Boolean(meta.banner),
            backBMP: Boolean(meta.backBMP),
          };
        }
        return traits;
      },
      ...(meta.difficulty !== undefined ? { difficulty: meta.difficulty } : {}),
      ...(meta.rank !== undefined ? { judgeRank: meta.rank } : {}),
      ...(typeof meta.total === 'number' ? { total: meta.total } : {}),
      ...(song.chart.bms?.lnMode !== undefined ? { lnMode: song.chart.bms.lnMode } : {}),
      get subartist(): string {
        return extractChartSubartist(song.chart);
      },
      get noteBreakdown(): NoteBreakdown {
        return resolveNoteBreakdown(song);
      },
      get density(): ChartDensity {
        return resolveDensity(song);
      },
      get lengthSeconds(): number {
        return resolveSongLengthSeconds(song);
      },
      get bpmRange(): { min: number; max: number } | undefined {
        return resolveBPMRange(song);
      },
      get mainBPM(): number | undefined {
        return resolveShownChartMainBPM(song.chart, song.chartPath);
      },
    };
    SELECT_CHART_FACTS.set(song, facts);
  }
  return facts;
}
const SELECT_CHART_FACTS = new WeakMap<LibraryChart, BeatorajaSelectChartFacts>();

/**
 * `true` when the chart authored at least one stop event (channel `09` in BMS, scaled stop in
 * bmson). Used to fire `HAS_BPMSTOP` (1177). Iterates events linearly — at typical chart sizes
 * (a few thousand events) this is microseconds; the WeakMap-cached `resolveLR2ChartFeatures` next to
 * it amortises any worst-case cost across the same select-scene tick.
 */
function chartHasStop(song: LibraryChart): boolean {
  const cached = STOP_PRESENCE_CACHE.get(song);
  if (cached !== undefined) return cached;
  const has = (song.chart.events ?? []).some((event) => event.channel === '09');
  STOP_PRESENCE_CACHE.set(song, has);
  return has;
}
const STOP_PRESENCE_CACHE = new WeakMap<LibraryChart, boolean>();
