// Per-kind note counts for a parsed BMS chart.
//
// ModernChic's `Select/lua/bmsanalysis.lua` authors `value[]` displays for the focused chart's
// note breakdown — total normal taps, total scratches, total LN, total BSS (back-spin scratch
// LN). Beatoraja's prop.lua exposes these via `MAIN.NUM.TOTALNOTE_NORMAL=350 / TOTALNOTE_LN=351
// / TOTALNOTE_SCRATCH=352 / TOTALNOTE_BSS=353`. Without resolvers those panels sit at zero.
//
// Categorisation:
//   - **scratch**: channel ends in `6` (BMS turntable convention — `16` for 1P, `26` for 2P).
//   - **ln**: notes whose channel is `5X` / `6X` (LN start/end, LNTYPE=2 / bmson long-note),
//     OR whose value matches the chart's `lnObjs[]` table (LNTYPE=1 / inline LN object).
//     A note that's both LN AND scratch (channel 56/66) lands in the BSS bucket instead.
//   - **bss**: LN + scratch (back-spin scratch). Channel 56 (1P) or 66 (2P), or scratch +
//     `lnObj`-match.
//   - **normal**: any other playable note (channels `1X`/`2X` minus scratch).
//
// Each note is counted ONCE per LN-pair (the start event), so the breakdown reports note
// COUNTS, not raw event counts. LN-end events are skipped.

import type { BeMusicJson } from '@be-music/json';

export interface NoteBreakdown {
  /** Regular key taps. */
  normal: number;
  /** Long-note taps (LN start; the matching end event is not counted again). */
  ln: number;
  /** Single-tap scratches (turntable, channel `*6`). */
  scratch: number;
  /** Long scratches / back-spin scratches (channel `56` / `66`, or scratch + lnObj match). */
  bss: number;
}

/**
 * Compute the chart's per-kind note breakdown. Returns a fresh `NoteBreakdown` — caller is
 * expected to cache by `BrowserSongEntry` reference (see select scene's WeakMap).
 */
export function computeBeatorajaNoteBreakdown(chart: BeMusicJson): NoteBreakdown {
  const result: NoteBreakdown = { normal: 0, ln: 0, scratch: 0, bss: 0 };
  const lnObjValues = collectLnObjValues(chart);
  // For LNTYPE=2 (channel 5X/6X), we count START events only — half the events on those
  // channels are start, half end. Pair them per channel per measure×position via a bookkeeping
  // map: even-index occurrences (0, 2, ...) are starts, odd are ends. Beatoraja's standard
  // resolver does the same pairing.
  const lnPairCount = new Map<string, number>();

  for (const event of chart.events ?? []) {
    if (event.value === '00' || event.value === '') continue;
    if (!isPlayableLane(event.channel)) continue;

    const isScratch = isScratchChannel(event.channel);
    const isLnPairChannel = isLnPairChannel_(event.channel);
    const isLnObjMatch = lnObjValues.has(event.value) || lnObjValues.has(event.value.toUpperCase());

    if (isLnPairChannel) {
      // Channel 5X/6X — count only the START half of each pair. Track a per-channel counter so
      // start = 0,2,4,…  ; end = 1,3,5,….
      const key = event.channel;
      const seen = lnPairCount.get(key) ?? 0;
      lnPairCount.set(key, seen + 1);
      if (seen % 2 !== 0) continue; // end event — don't count again.
      if (isScratch) result.bss += 1;
      else result.ln += 1;
      continue;
    }

    if (isLnObjMatch) {
      // LNTYPE=1 inline LN — channel 1X/2X with value === lnObj. The matching end (same value
      // re-appearing later in the chart) is also lnObj-matched, so we'd double-count. We can't
      // disambiguate start vs end without the chart's pairing logic, so under-count by halving.
      // Authors typically use ONE lnObj per chart for all LN starts AND ends, so this gives the
      // right count.
      // Track per-channel pair counter same as LNTYPE=2 above.
      const key = `LNOBJ:${event.channel}`;
      const seen = lnPairCount.get(key) ?? 0;
      lnPairCount.set(key, seen + 1);
      if (seen % 2 !== 0) continue;
      if (isScratch) result.bss += 1;
      else result.ln += 1;
      continue;
    }

    // Plain tap.
    if (isScratch) result.scratch += 1;
    else result.normal += 1;
  }
  return result;
}

/** Channel is a playable lane — `1X` (1P) or `2X` (2P), or LN-equivalent `5X` / `6X`. */
function isPlayableLane(channel: string): boolean {
  if (channel.length !== 2) return false;
  const lead = channel[0]!;
  return lead === '1' || lead === '2' || lead === '5' || lead === '6';
}

/** Channel ends in `6` — BMS turntable convention (`16` = 1P scratch, `26` = 2P, etc.). */
function isScratchChannel(channel: string): boolean {
  return channel.length === 2 && channel[1] === '6';
}

/** Channel is the LN-pair convention (LNTYPE=2): leads with `5` (1P) or `6` (2P). */
function isLnPairChannel_(channel: string): boolean {
  return channel.length === 2 && (channel[0] === '5' || channel[0] === '6');
}

/**
 * Collect the chart's `#LNOBJ` values — one or more 2-char base-36 codes that mark inline LN
 * boundaries on regular `1X`/`2X` channels. Empty when the chart uses LNTYPE=2 (channel-based)
 * or no LN at all.
 */
function collectLnObjValues(chart: BeMusicJson): Set<string> {
  const out = new Set<string>();
  const lnObjs = chart.bms?.lnObjs;
  if (!Array.isArray(lnObjs)) return out;
  for (const v of lnObjs) {
    if (typeof v === 'string' && v.length > 0) {
      out.add(v);
      out.add(v.toUpperCase());
    }
  }
  return out;
}
