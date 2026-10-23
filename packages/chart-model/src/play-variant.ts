import { KEYBOARD_MODE_HINT_VARIANTS, resolveKeyboardModeHint } from './keyboard-mode-hint.ts';
import { normalizeChannel } from '@be-music/chart-source';
import { PLAY_MODE_LAYOUTS } from './play-modes.ts';
import { EXTENDED_LANE_CODE_MIN, isPlayableChannel, mapBMSLongNoteChannelToPlayable } from './channels.ts';

/**
 * LR2 / beatoraja play-skin lane family. `'24'` / `'48'` are the Keyboardmania-style keyboard modes whose lanes run
 * past the classic `11..19` / `21..29` bank onto the extended `1A..1O` / `2A..2O` channels, plus the wheel up / down
 * on `1P` / `1Q` (`2P` / `2Q`).
 */
export type ChartPlayVariant = '5' | '7' | '9' | '10' | '14' | '24' | '48';

export interface ChartPlayVariantInput {
  chartPath?: string;
  events: ReadonlyArray<{ channel: string }>;
  bms?: {
    player?: number;
  };
  /**
   * The bmson `mode_hint` (`json.bmson.info.modeHint`). Only the Keyboardmania hints are authoritative — see
   * {@link resolveChartPlayVariant} — every other hint leaves the decision to the chart's lanes.
   */
  bmson?: {
    info?: {
      modeHint?: string;
    };
  };
}

const laneChannelsOf = (layout: keyof typeof PLAY_MODE_LAYOUTS): string[] =>
  PLAY_MODE_LAYOUTS[layout].lanes.map((lane) => lane.channel);
/** The BME-type 9 KEY layout: every one of `11..19`. */
const BME_NINE_KEY_CHANNELS: readonly string[] = laneChannelsOf('9-bme');
/** PMS-STD keys 6..9, authored on the 2P bank (`22..25`). */
const PMS_STD_2P_CHANNELS: readonly string[] = laneChannelsOf('9-pms').filter((channel) => channel.startsWith('2'));
/** The That-Which-Must-Not-Be-Named 2P side PMS-STD never uses: `21`, the 6 / 7 keys `28` / `29`, the scratch `26` and the FREE ZONE `27`. */
const _____ONLY_2P_CHANNELS: readonly string[] = [
  ...laneChannelsOf('14'),
  ...PLAY_MODE_LAYOUTS['14'].freeZones.map((zone) => zone.channel),
].filter((channel) => channel.startsWith('2') && !PMS_STD_2P_CHANNELS.includes(channel));
/** The 6 / 7 key columns (`18` / `19` / `28` / `29`): the lanes 14 KEY has and 10 KEY lacks. */
const _____SIX_SEVEN_KEY_CHANNELS: readonly string[] = laneChannelsOf('14').filter(
  (channel) => !laneChannelsOf('10').includes(channel),
);

/**
 * Resolves the LR2/play-skin lane family for a chart from its playable lane usage, `#PLAYER`, and the `.pms` extension.
 *
 * This is the single lane-mode rule every host shares: the engine derives its lane mode from it (unless the host
 * declares a variant explicitly), and the web / skin hosts pick play skins with it. Pass the RESOLVED chart (after
 * `#RANDOM` / `#SWITCH`) when classifying a play, so lanes a chosen branch adds are counted. `chartPath` may be a full
 * path or a bare extension (`.pms`).
 *
 * Lane usage counts the `1x` / `2x` lane channels plus the `5x` / `6x` `#LNTYPE` long-note channels mapped to their
 * lanes, so `#LNOBJ` and `#LNTYPE` notations of the same chart classify alike. Mines (`Dx` / `Ex`) and invisible
 * objects (`3x` / `4x`) never count.
 *
 * Detection order — first match wins:
 *
 *  -1. **bmson keyboard `mode_hint`** — `keyboard-24k` → `'24'`, `keyboard-24k-double` → `'48'`, whatever lanes the
 *      chart uses: its `x` values already went through the keyboard lane map, so a chart that only touches the first
 *      nine keys is still a 24-key chart. Other hints are not authoritative (`beat-7k` is also the spec default for a
 *      missing hint, and real charts mislabel their mode), so they fall through to the lane rules.
 *   0. **Extended lane channels (`1A..1Z` / `2A..2Z`)** — the 24-key (Keyboardmania) lane bank. Only these modes
 *      author lanes past the classic nine columns, so one extended channel decides it: `'48'` when the chart also
 *      uses the 2P side, `'24'` otherwise. Checked first because a 24-key chart fills all nine classic 1P columns
 *      too, which rule 3 would otherwise claim for `'9'`.
 *   1. **`.pms` extension** — unambiguous POPN-9 marker. Trumps all content heuristics so a `.pms` file authored
 *      with `#PLAYER 1` and an unusual channel layout still routes to `'9'`.
 *   2. **`#PLAYER 3` + channel `17`, no That-Which-Must-Not-Be-Named 2P side** — `#PLAYER 3` is "DP or 9-key" and channel `17` is FREE
 *      ZONE under That-Which-Must-Not-Be-Named conventions; a `#PLAYER 3` chart that authors notes on `17` without `21` / `26..29` is POPN-9.
 *      With the That-Which-Must-Not-Be-Named 2P side present it is a double-play chart with a FREE ZONE and falls through to rule 5.
 *   3. **BME POPN-9 (PLAYER 1, full 1P keyboard)** — 1P-only chart that populates ALL nine of `11..19` as
 *      playable channels. That-Which-Must-Not-Be-Named 7K uses at most `11..15 + 16 + 18 + 19` (8 channels, with `16` = scratch and `17`
 *      typically unused or FREE-ZONE keysound only); a chart that lights up all 9 columns is POPN-9 authored as
 *      BME. Without this rule the chart would fall through to `'7'` and the engine's 7-key SP bindings would
 *      treat `16` as scratch, `17` as FREE-ZONE, and drop the POPN-9 `f/v/g/b` lane bindings.
 *   4. **PMS-STD content (any extension)** — chart authors any of channels `22..25` AND does NOT author
 *      the traditional That-Which-Must-Not-Be-Named 2P channels (`21` / `26..29`). Genuine That-Which-Must-Not-Be-Named DP charts always pair each side's
 *      keyboard with `21` and / or scratch (`26`), so bare `22..25` without those is a reliable PMS-STD
 *      signal regardless of `#PLAYER`, extension, 1P-side scratch (`16`), or 6/7K column (`18`/`19`)
 *      usage. Catches PMS-STD authored as `.bme` / `.bms` (common when chart authors export PMS charts
 *      to `.bme` for table-friendly tooling) without requiring an explicit `.pms` extension.
 *   5. **That-Which-Must-Not-Be-Named fallback** — classify by `2X` presence (`usesPlayer2`) and `18/19/28/29` (`uses6or7`) as That-Which-Must-Not-Be-Named
 *      `5/7/10/14`. The lanes in use decide, whatever the extension: a `.bme` chart without a 6 / 7 key column is
 *      `5` / `10` like beatoraja reads it (be-music decision, see docs/format-compat.md §5).
 */
export function resolveChartPlayVariant(chart: ChartPlayVariantInput): ChartPlayVariant {
  const keyboardHint = resolveKeyboardModeHint(chart.bmson?.info?.modeHint);
  const hintedVariant = keyboardHint !== undefined ? KEYBOARD_MODE_HINT_VARIANTS.get(keyboardHint) : undefined;
  if (hintedVariant !== undefined) {
    return hintedVariant;
  }
  const channels = new Set<string>();
  for (const event of chart.events) {
    const channel = normalizeChannel(event.channel);
    if (isPlayableChannel(channel)) {
      channels.add(channel);
      continue;
    }
    // `#LNTYPE` long notes live on `5x` / `6x` but occupy the same lane as `1x` / `2x`, so they count as that lane.
    const longNoteLane = mapBMSLongNoteChannelToPlayable(channel);
    if (longNoteLane !== undefined) {
      channels.add(longNoteLane);
    }
  }
  const usesPlayer2 = [...channels].some((channel) => channel.startsWith('2'));

  // Rule 0 — 24-key (Keyboardmania) family. Lanes past the classic nine columns are only reachable through the
  // extended `1A..1Z` / `2A..2Z` channels, so a single extended lane is an unambiguous marker. Checked before every
  // other rule because a 24-key chart also populates all nine classic 1P columns, which rule 3 would claim for `'9'`.
  const usesExtendedLane = [...channels].some((channel) => channel.charCodeAt(1) >= EXTENDED_LANE_CODE_MIN);
  if (usesExtendedLane) {
    return usesPlayer2 ? '48' : '24';
  }

  if (isPMSExtension(chart.chartPath)) {
    return '9';
  }
  // `#PLAYER 3` is "DP or 9-key", so the POPN-9 reading needs the That-Which-Must-Not-Be-Named 2P side (`21` / `26..29`) to be absent: a
  // double-play chart with a FREE ZONE on `17` stays That-Which-Must-Not-Be-Named DP.
  const usesOther2P = _____ONLY_2P_CHANNELS.some((c) => channels.has(c));
  if (chart.bms?.player === 3 && channels.has('17') && !usesOther2P) {
    return '9';
  }

  // Rule 3 — BME POPN-9: 1P chart that authors every one of `11..19`. The That-Which-Must-Not-Be-Named 7K format never populates all
  // nine, so a full 1P keyboard is a strong POPN-9 signal regardless of `#PLAYER` or filename extension.
  if (BME_NINE_KEY_CHANNELS.every((c) => channels.has(c)) && !usesPlayer2) {
    return '9';
  }

  // Rule 4 — PMS-STD masquerading as `.bms` / `.bme`. PMS-STD = 1P (`11..15`) + 2P-side POPN columns
  // (`22..25`). The discriminator versus genuine That-Which-Must-Not-Be-Named 5K / 14K DP is the absence of the OTHER 2P
  // channels (`21` / `26..29`): real That-Which-Must-Not-Be-Named DP charts always pair each side's keyboard with `21` and / or
  // scratch (`26`) — they don't author bare `22..25` without the rest of the 2P side. So `22..25` used
  // WITHOUT `21` / `26..29` is a reliable PMS-STD signal regardless of 1P-side scratch (`16`) or 6/7K
  // column (`18` / `19`) use. (A chart that combines `22..25` with 1P scratch is a non-standard hybrid
  // — we resolve it as POPN-9 since `22..25` is the POPN-specific signature.)
  const usesPMSStd2P = PMS_STD_2P_CHANNELS.some((c) => channels.has(c));
  if (usesPMSStd2P && !usesOther2P) {
    return '9';
  }

  // Rule 5 — That-Which-Must-Not-Be-Named families. A 6 / 7 key column decides 7 / 14 KEY, anything else is 5 / 10 KEY. The `.bme` extension
  // does not complete the mode: beatoraja reads the mode from the lanes in use, and so do we.
  const uses6or7 = _____SIX_SEVEN_KEY_CHANNELS.some((channel) => channels.has(channel));
  if (usesPlayer2) {
    return uses6or7 ? '14' : '10';
  }
  return uses6or7 ? '7' : '5';
}

function isPMSExtension(chartPath: string | undefined): boolean {
  return resolveChartPathExtension(chartPath) === '.pms';
}

/**
 * Lowercased extension (with its dot) of a chart path or of a bare extension such as `.pms`. Only the last path segment
 * counts, so a dotted directory name (`Song.pms/main`) is not mistaken for the chart's own extension.
 */
function resolveChartPathExtension(chartPath: string | undefined): string | undefined {
  if (typeof chartPath !== 'string' || chartPath.length === 0) {
    return undefined;
  }
  const trimmed = chartPath.trim();
  const dotIndex = trimmed.lastIndexOf('.');
  const slashIndex = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (dotIndex < 0 || dotIndex < slashIndex) return undefined;
  return trimmed.slice(dotIndex).toLowerCase();
}
