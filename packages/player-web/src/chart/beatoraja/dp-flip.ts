// DP-flip chart transform.
//
// BMS channels encode `(lane group, lane number)` as a 2-char string where the first char
// identifies the side (and visible / invisible / LN / landmine slot):
//
//   `1X` 1P visible      `2X` 2P visible
//   `3X` 1P invisible    `4X` 2P invisible
//   `5X` 1P LN           `6X` 2P LN
//   `DX` 1P landmine     `EX` 2P landmine
//
// where X ∈ [1..9] (key 1..7 + scratch 6 + extra 8/9). DP flip swaps the side bit on every
// matching event channel — `1X ↔ 2X`, `3X ↔ 4X`, `5X ↔ 6X`, `DX ↔ EX` — leaving SP-only
// channels (BPM, BGA, key sounds at `01`, etc.) untouched. The result is a chart whose
// 1P / 2P sides are swapped, useful for players who prefer the opposite hand layout.
//
// Mirrors beatoraja's `Config.flipMode` + `BMSPlayer.applyFlip` semantics. The transform is
// pure — produces a new chart object without mutating the input.

import type { BeMusicJson, BeMusicEvent } from '@be-music/json';

const FLIP_MAP: Readonly<Record<string, string>> = Object.freeze({
  '1': '2',
  '2': '1',
  '3': '4',
  '4': '3',
  '5': '6',
  '6': '5',
  D: 'E',
  E: 'D',
});

/**
 * Swap the side digit on a single channel string. Returns the original string when the
 * channel doesn't match any flippable prefix (BPM `03`, BGA `04`, key sound `01`, etc.).
 */
export function flipDpChannel(channel: string): string {
  if (channel.length !== 2) return channel;
  const replacement = FLIP_MAP[channel[0]!];
  if (replacement === undefined) return channel;
  return replacement + channel[1]!;
}

/**
 * Walk every event in a chart and swap side digits on channels that map. Other events pass
 * through unchanged. Returns a new chart object — input is untouched, so callers can keep
 * the unflipped chart for fallback / re-flipping.
 *
 * Both BMS-mode and bmson-mode charts run their note events through the same
 * `BeMusicJson.events[]` channel-string field — the parser unifies channel encoding so we
 * only need to swap one place. The `measures[]` block carries no per-channel data; same
 * for `bms.events` (which is empty in our parser today — events are on the top-level).
 */
export function flipDpChart(chart: BeMusicJson): BeMusicJson {
  const events = chart.events;
  if (!Array.isArray(events) || events.length === 0) return chart;
  let mutated = false;
  const flippedEvents: BeMusicEvent[] = events.map((event) => {
    const next = flipDpChannel(event.channel);
    if (next === event.channel) return event;
    mutated = true;
    return { ...event, channel: next };
  });
  if (!mutated) return chart;
  return { ...chart, events: flippedEvents };
}
