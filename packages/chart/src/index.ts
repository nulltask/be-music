import {
  normalizeChannel,
  normalizeObjectKey,
  resolveBmsBase,
  type BeMusicEvent,
  type BeMusicJson,
} from '@be-music/json';

export interface BeatResolver {
  measureToBeat: (measure: number, position?: number) => number;
  eventToBeat: (event: BeMusicEvent) => number;
}

export type ChartPlayVariant = '5' | '7' | '9' | '10' | '14';

export interface ChartPlayVariantInput {
  chartPath?: string;
  events: ReadonlyArray<{ channel: string }>;
  bms?: {
    player?: number;
  };
}

const BMS_LONG_NOTE_PLAYABLE_1P = ['11', '12', '13', '14', '15', '16', '17', '18', '19'] as const;
const BMS_LONG_NOTE_PLAYABLE_2P = ['21', '22', '23', '24', '25', '26', '27', '28', '29'] as const;
const PACKED_CHANNEL_03 = 0x3033;
const PACKED_CHANNEL_08 = 0x3038;
const PACKED_CHANNEL_09 = 0x3039;
const PACKED_CHANNEL_97 = 0x3937;
const PACKED_CHANNEL_98 = 0x3938;
const PACKED_CHANNEL_SC = 0x5343;
const PACKED_CHANNEL_SP = 0x5350;

export function parseBpmFrom03Token(value: string): number {
  if (value.length === 2) {
    const high = parseHexDigitFast(value.charCodeAt(0));
    const low = parseHexDigitFast(value.charCodeAt(1));
    if (high >= 0 && low >= 0) {
      return (high << 4) + low;
    }
  }
  const parsed = Number.parseInt(value, 16);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getMeasureBeats(length: number): number {
  return 4 * length;
}

export function measureToBeat(json: BeMusicJson, measure: number, position = 0): number {
  const safeMeasure = Math.max(0, Math.floor(measure));
  if (json.measures.length === 0) {
    return safeMeasure * 4 + 4 * clamp01(position);
  }
  const safePosition = clamp01(position);
  const measureLengths = createExactMeasureLengthRecord(json);
  let beats = 0;
  for (let current = 0; current < safeMeasure; current += 1) {
    beats += getMeasureBeats(measureLengths[current] ?? 1);
  }
  beats += getMeasureBeats(measureLengths[safeMeasure] ?? 1) * safePosition;
  return beats;
}

export function eventToBeat(json: BeMusicJson, event: BeMusicEvent): number {
  if (json.measures.length === 0) {
    const measure = Math.max(0, Math.floor(event.measure));
    const denominator = normalizePositionDenominator(event.position[1]);
    const numerator = normalizePositionNumerator(event.position[0], denominator);
    return measure * 4 + (4 * numerator) / denominator;
  }
  return measureToBeat(json, event.measure, getEventPosition(event));
}

export function createBeatResolver(json: BeMusicJson): BeatResolver {
  if (json.measures.length === 0) {
    return {
      measureToBeat: (measure, position = 0) => {
        const safeMeasure = Math.max(0, Math.floor(measure));
        return safeMeasure * 4 + 4 * clamp01(position);
      },
      eventToBeat: (event) => {
        const safeMeasure = Math.max(0, Math.floor(event.measure));
        const denominator = normalizePositionDenominator(event.position[1]);
        const numerator = normalizePositionNumerator(event.position[0], denominator);
        return safeMeasure * 4 + (4 * numerator) / denominator;
      },
    };
  }

  const measureLengths: number[] = [];
  let maxDefinedMeasure = -1;
  for (const measure of json.measures) {
    const normalizedIndex = Math.max(0, Math.floor(measure.index));
    const normalizedLength = Number.isFinite(measure.length) && measure.length > 0 ? measure.length : 1;
    measureLengths[normalizedIndex] = normalizedLength;
    if (normalizedIndex > maxDefinedMeasure) {
      maxDefinedMeasure = normalizedIndex;
    }
  }

  const measureStartBeats: number[] = [];
  let cumulativeBeats = 0;
  for (let measure = 0; measure <= maxDefinedMeasure; measure += 1) {
    measureStartBeats[measure] = cumulativeBeats;
    cumulativeBeats += getMeasureBeats(measureLengths[measure] ?? 1);
  }
  const denseLimit = maxDefinedMeasure + 1;

  const resolveMeasureStartBeat = (measure: number): number => {
    if (measure <= 0) {
      return 0;
    }
    if (measure < denseLimit) {
      return measureStartBeats[measure] ?? 0;
    }
    return cumulativeBeats + (measure - denseLimit) * 4;
  };

  const resolveMeasureLength = (measure: number): number => (measure < denseLimit ? (measureLengths[measure] ?? 1) : 1);

  return {
    measureToBeat: (measure, position = 0) => {
      const safeMeasure = Math.max(0, Math.floor(measure));
      const safePosition = clamp01(position);
      const start = resolveMeasureStartBeat(safeMeasure);
      const measureBeats = getMeasureBeats(resolveMeasureLength(safeMeasure));
      return start + measureBeats * safePosition;
    },
    eventToBeat: (event) => {
      const safeMeasure = Math.max(0, Math.floor(event.measure));
      const start = resolveMeasureStartBeat(safeMeasure);
      const measureBeats = getMeasureBeats(resolveMeasureLength(safeMeasure));
      return start + measureBeats * getEventPosition(event);
    },
  };
}

export function sortEvents(events: BeMusicEvent[]): BeMusicEvent[] {
  if (events.length <= 1) {
    return [...events];
  }

  let sorted = true;
  for (let index = 1; index < events.length; index += 1) {
    if (compareEvents(events[index - 1]!, events[index]!) > 0) {
      sorted = false;
      break;
    }
  }
  if (sorted) {
    return [...events];
  }
  return [...events].sort(compareEvents);
}

export function compareEvents(left: BeMusicEvent, right: BeMusicEvent): number {
  if (left.measure !== right.measure) {
    return left.measure - right.measure;
  }
  const leftDenominator = normalizePositionDenominator(left.position[1]);
  const leftNumerator = normalizePositionNumerator(left.position[0], leftDenominator);
  const rightDenominator = normalizePositionDenominator(right.position[1]);
  const rightNumerator = normalizePositionNumerator(right.position[0], rightDenominator);
  if (leftDenominator === rightDenominator) {
    const numeratorDelta = leftNumerator - rightNumerator;
    if (numeratorDelta !== 0) {
      return numeratorDelta;
    }
  } else {
    const leftScaled = leftNumerator * rightDenominator;
    const rightScaled = rightNumerator * leftDenominator;
    if (Number.isSafeInteger(leftScaled) && Number.isSafeInteger(rightScaled)) {
      if (leftScaled < rightScaled) {
        return -1;
      }
      if (leftScaled > rightScaled) {
        return 1;
      }
    } else {
      const leftScaledBigInt = BigInt(leftNumerator) * BigInt(rightDenominator);
      const rightScaledBigInt = BigInt(rightNumerator) * BigInt(leftDenominator);
      if (leftScaledBigInt < rightScaledBigInt) {
        return -1;
      }
      if (leftScaledBigInt > rightScaledBigInt) {
        return 1;
      }
    }
  }
  if (left.channel !== right.channel) {
    return left.channel < right.channel ? -1 : 1;
  }
  if (left.value !== right.value) {
    return left.value < right.value ? -1 : 1;
  }
  return 0;
}

/**
 * Resolves the LR2/play-skin lane family for a chart from its extension, `#PLAYER`, and playable lane usage.
 *
 * Detection order — first match wins:
 *
 *   1. **`.pms` extension** — unambiguous POPN-9 marker. Trumps all content heuristics so a `.pms` file authored
 *      with `#PLAYER 1` and an unusual channel layout still routes to `'9'`.
 *   2. **`#PLAYER 3` + channel `17`** — `#PLAYER 3` is "DP or 9-key" and channel `17` is FREE ZONE under IIDX
 *      conventions; if a `#PLAYER 3` chart authors notes on `17` it can only be POPN-9.
 *   3. **BME POPN-9 (PLAYER 1, full 1P keyboard)** — 1P-only chart that populates ALL nine of `11..19` as
 *      playable channels. IIDX 7K uses at most `11..15 + 16 + 18 + 19` (8 channels, with `16` = scratch and `17`
 *      typically unused or FREE-ZONE keysound only); a chart that lights up all 9 columns is POPN-9 authored as
 *      BME. Without this rule the chart would fall through to `'7'` and the engine's 7-key SP bindings would
 *      treat `16` as scratch, `17` as FREE-ZONE, and drop the POPN-9 `f/v/g/b` lane bindings.
 *   4. **PMS-STD content (any extension)** — chart authors any of channels `22..25` AND does NOT author
 *      the traditional IIDX 2P channels (`21` / `26..29`). Genuine IIDX DP charts always pair each side's
 *      keyboard with `21` and / or scratch (`26`), so bare `22..25` without those is a reliable PMS-STD
 *      signal regardless of `#PLAYER`, extension, 1P-side scratch (`16`), or 6/7K column (`18`/`19`)
 *      usage. Catches PMS-STD authored as `.bme` / `.bms` (common when chart authors export PMS charts
 *      to `.bme` for table-friendly tooling) without requiring an explicit `.pms` extension.
 *   5. **Fallback** — classify by `2X` presence (`usesPlayer2`) and `18/19/28/29` (`uses6or7`) as IIDX `5/7/10/14`.
 */
export function resolveChartPlayVariant(chart: ChartPlayVariantInput): ChartPlayVariant {
  const channels = new Set<string>();
  for (const event of chart.events) {
    const channel = normalizeChannel(event.channel);
    if (isPlayableChannel(channel)) {
      channels.add(channel);
    }
  }
  if (isPmsExtension(chart.chartPath)) {
    return '9';
  }
  if (chart.bms?.player === 3 && channels.has('17')) {
    return '9';
  }
  const usesPlayer2 = [...channels].some((channel) => channel.startsWith('2'));

  // Rule 3 — BME POPN-9: 1P chart that authors every one of `11..19`. The IIDX 7K format never populates all
  // nine, so a full 1P keyboard is a strong POPN-9 signal regardless of `#PLAYER` or filename extension.
  const p1NineKeyChannels = ['11', '12', '13', '14', '15', '16', '17', '18', '19'];
  const p1Count = p1NineKeyChannels.reduce((n, c) => (channels.has(c) ? n + 1 : n), 0);
  if (p1Count === 9 && !usesPlayer2) {
    return '9';
  }

  // Rule 4 — PMS-STD masquerading as `.bms` / `.bme`. PMS-STD = 1P (`11..15`) + 2P-side POPN columns
  // (`22..25`). The discriminator versus genuine IIDX 5K / 14K DP is the absence of the OTHER 2P
  // channels (`21` / `26..29`): real IIDX DP charts always pair each side's keyboard with `21` and / or
  // scratch (`26`) — they don't author bare `22..25` without the rest of the 2P side. So `22..25` used
  // WITHOUT `21` / `26..29` is a reliable PMS-STD signal regardless of 1P-side scratch (`16`) or 6/7K
  // column (`18` / `19`) use. (A chart that combines `22..25` with 1P scratch is a non-standard hybrid
  // — we resolve it as POPN-9 since `22..25` is the POPN-specific signature.)
  const usesPmsStd2P = ['22', '23', '24', '25'].some((c) => channels.has(c));
  const usesOther2P = ['21', '26', '27', '28', '29'].some((c) => channels.has(c));
  if (usesPmsStd2P && !usesOther2P) {
    return '9';
  }

  const uses6or7 = ['18', '19', '28', '29'].some((channel) => channels.has(channel));
  if (usesPlayer2) {
    return uses6or7 ? '14' : '10';
  }
  return uses6or7 ? '7' : '5';
}

/**
 * Resolves the chart's reference BPM for hi-speed / scroll-speed normalization, honoring the BMS spec for `#BASEBPM`.
 *
 * Spec — `#BASEBPM N` (hitkey BMS Memo): declares the chart's reference BPM for HS-fix style scroll calibration. When
 * set, scroll-speed-aware consumers should treat that value as the "main BPM" instead of the chart's initial `#BPM`.
 * When absent we fall back to the parser-extracted `metadata.bpm`, which is the chart's first declared `#BPM`.
 *
 * `fallbackBpm` is the optional last-resort value the host can supply (e.g. a song-list-cached BPM hint) for charts
 * that omit both `#BASEBPM` and `#BPM` — a rare but legal corner of the spec.
 *
 * Returns `undefined` when no positive BPM is available, so callers can early-out without applying a meaningless ratio.
 */
export function resolveChartReferenceBpm(json: BeMusicJson, fallbackBpm?: number): number | undefined {
  const baseBpm = json.bms.baseBpm;
  if (typeof baseBpm === 'number' && Number.isFinite(baseBpm) && baseBpm > 0) {
    return baseBpm;
  }
  const metadataBpm = json.metadata.bpm;
  if (typeof metadataBpm === 'number' && Number.isFinite(metadataBpm) && metadataBpm > 0) {
    return metadataBpm;
  }
  if (typeof fallbackBpm === 'number' && Number.isFinite(fallbackBpm) && fallbackBpm > 0) {
    return fallbackBpm;
  }
  return undefined;
}

/**
 * Parsed `#EXWAVxx [flags] params filename` directive.
 *
 * `#EXWAVxx` declares an "extended" WAV slot whose playback should be modified by the listed parameters. The `flags`
 * token names which channels are present (in order), and `params` is a comma-separated list whose values match those
 * flags positionally.
 *
 * Supported flags (hitkey BMS Memo): - `p` — stereo pan (`-10000..10000` LR2-style, where 0 is center). - `v` —
 * playback volume in centibels (CB), where each step is `1/100` of a dB. Negative values attenuate, `0` is unity. - `f`
 * — playback frequency in Hz. The sample is resampled (or replayed at a different rate) so its native sample rate maps
 * onto this output rate.
 *
 * Real-world charts use this most often for `v` (per-slot volume trim) and occasionally `p` for stereo placement of
 * one-shots.
 */
export interface BmsExWav {
  /** Raw filename token, joined back together if it contained spaces. */
  filename: string;
  /** Pan, when the `p` flag was present. */
  pan?: number;
  /** Volume in centibels (1/100 dB), when the `v` flag was present. */
  volumeCentibels?: number;
  /** Playback frequency in Hz, when the `f` flag was present. */
  frequencyHz?: number;
}

/**
 * Parses one `#EXWAVxx` directive value (the post-`#EXWAVxx ` text).
 *
 * Token layout — three whitespace-separated groups: 1. Flag string in declaration order, e.g. `pvf` / `vp` / `v`. 2.
 * Comma-separated integer params matching the flag positions (`pvf 100,-200,48000` → pan=100, vol=-200, freq=48000). 3.
 * Filename. Any trailing whitespace-separated tokens are joined back together so chart authors can use names with
 * spaces.
 *
 * Returns `undefined` for malformed input — better to skip a broken `#EXWAV` than to apply nonsense to the audible
 * signal.
 */
export function parseBmsExWav(raw: string): BmsExWav | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const tokens = trimmed.split(/\s+/u);
  if (tokens.length < 3) return undefined;
  const flags = tokens[0]!.toLowerCase();
  const params = tokens[1]!.split(',');
  // Filename can legitimately contain spaces; rejoin every remaining token. (LR2 uses Windows-style paths, never URL-
  // encoded, so a literal space in the name is the only edge.)
  const filename = tokens.slice(2).join(' ');
  if (filename.length === 0) return undefined;
  const out: BmsExWav = { filename };
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    const valueRaw = params[index];
    if (valueRaw === undefined) break;
    const value = Number.parseInt(valueRaw.trim(), 10);
    if (!Number.isFinite(value)) continue;
    if (flag === 'p') out.pan = value;
    else if (flag === 'v') out.volumeCentibels = value;
    else if (flag === 'f') out.frequencyHz = value;
  }
  return out;
}

/**
 * Maps a centibel volume value (`#EXWAVxx v` parameter, `1/100 dB`) to a 0..N linear gain multiplier. `0 cB`
 * round-trips to `1.0` (unity); negative values attenuate; positive values boost. We clamp the output below `8.0` (≈
 * +18 dB) so a malformed chart can't blow the bus, and at `0` so very-negative inputs collapse to silence rather than
 * producing a denormal.
 *
 * Centibels rather than decibels because LR2 / beatoraja both persist `#EXWAV v` as cB — `v -200` = −2 dB, `v -600` =
 * −6 dB. Treating the value as straight dB would silently halve every attenuation in the wild.
 */
export function exWavVolumeCentibelsToLinearGain(centibels: number): number {
  if (!Number.isFinite(centibels)) return 1;
  const dB = centibels / 100;
  const gain = 10 ** (dB / 20);
  if (!Number.isFinite(gain) || gain < 0) return 0;
  return Math.min(8, gain);
}

/**
 * Builds a `slot → linear-gain-multiplier` map for every `#EXWAVxx` entry that supplies a `v` (volume) flag. Slots
 * without a parsed `v` (or whose `#EXWAVxx` doesn't even have three tokens) are absent from the result so the consumer
 * falls through to unity gain.
 *
 * `entries` is the parser-produced `chart.bms.exWav` map (raw post-`#EXWAVxx ` strings keyed by slot id). The returned
 * keys are passed through verbatim — they're already normalized to the chart's id base when the parser ingested them.
 */
export function collectBmsExWavVolumeMultipliers(entries: Readonly<Record<string, string>>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [slot, raw] of Object.entries(entries)) {
    const parsed = parseBmsExWav(raw);
    if (parsed === undefined) continue;
    if (parsed.volumeCentibels === undefined) continue;
    out.set(slot, exWavVolumeCentibelsToLinearGain(parsed.volumeCentibels));
  }
  return out;
}

/**
 * Parsed `#EXBMPxx a,r,g,b,filename` directive.
 *
 * Where `#BMPxx filename` declares an opaque image slot, `#EXBMPxx` declares the same slot's filename PLUS an ARGB
 * tuple that the player should apply on top — typically used by chart authors to chroma-key a backdrop color to
 * transparent (`a = 0` for the keyed color) or to dim a layer image (`a < 255`). The format is a single
 * `a,r,g,b,filename` string (commas separating the four byte channels and the filename).
 *
 * `argbRaw` keeps the AARRGGBB-equivalent string so consumers can pass it straight to {@link parseBmsArgb} — the same
 * parser `#ARGBxx` already uses, no second code path. `argb` is the pre-parsed shortcut for the common case.
 */
export interface BmsExBmp {
  /** Filename of the image to load into this `#BMPxx` slot. */
  filename: string;
  /**
   * Decoded ARGB values, or `undefined` when the directive omitted the ARGB tuple (e.g. `#EXBMP01 ,,,,filename.bmp`).
   */
  argb: BmsArgb | undefined;
  /**
   * Comma-separated AARRGGBB-equivalent text — kept so consumers can roundtrip through the same `parseBmsArgb` pipeline
   * that `#ARGBxx` uses, without re-emitting it from the `argb` shortcut.
   */
  argbRaw: string;
}

/**
 * Parses one `#EXBMPxx` directive value (the post-`#EXBMPxx ` text).
 *
 * Token layout: `a,r,g,b,filename`. Filenames containing literal commas are unsupported by the spec — that's a property
 * of the format, not a limitation here. Whitespace inside each field is trimmed.
 *
 * Returns `undefined` for malformed input (less than five comma groups or an empty filename). When the ARGB fields are
 * present but unparseable (e.g. `xxx,yyy,zzz,www,foo.bmp`), the entry's `argb` is `undefined` while `filename` is still
 * surfaced — so the consumer at least knows which file the slot points at.
 */
export function parseBmsExBmp(raw: string): BmsExBmp | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  // Five-way split on commas. `split(',', limit)` would silently drop trailing commas in the filename if a chart author
  // left any, so split unbounded and rejoin the tail.
  const parts = trimmed.split(',');
  if (parts.length < 5) return undefined;
  const [aRaw, rRaw, gRaw, bRaw, ...rest] = parts;
  const filename = rest.join(',').trim();
  if (filename.length === 0) return undefined;
  // The argb tuple may legally be empty (chart authors sometimes ship `#EXBMP01 ,,,,foo.bmp` to mean "filename only"),
  // in which case we still surface the filename and leave `argb` undefined so the consumer can fall back to `#ARGBxx`
  // or the image's own alpha channel.
  const argbCandidate = `${aRaw},${rRaw},${gRaw},${bRaw}`;
  const argbValuesAllBlank = [aRaw, rRaw, gRaw, bRaw].every((part) => part.trim().length === 0);
  const argb = argbValuesAllBlank ? undefined : parseBmsArgb(argbCandidate);
  return {
    filename,
    argb,
    argbRaw: argbCandidate,
  };
}

/**
 * Resolves the ARGB tint to apply when compositing `chart.bms.bmp[slot]`, folding the two BMS directives that can drive
 * it (in priority order):
 *
 * 1. `#ARGBxx` — explicit per-slot ARGB. Wins when present.
 * 2. `#EXBMPxx` — the ARGB embedded in the filename declaration. Used as a fallback so chart authors who only wrote the
 *    extended form still get their transparent / dim composite.
 *
 * Returns `undefined` when neither directive is present (or neither parses), letting the consumer skip the tint stage
 * entirely on the unaffected path.
 */
export function resolveBmsBmpArgb(chart: BeMusicJson, slot: string): BmsArgb | undefined {
  const argbRaw = chart.bms.argb[slot];
  if (typeof argbRaw === 'string') {
    const parsed = parseBmsArgb(argbRaw);
    if (parsed) return parsed;
  }
  const exBmpRaw = chart.bms.exBmp[slot];
  if (typeof exBmpRaw === 'string') {
    const parsed = parseBmsExBmp(exBmpRaw);
    if (parsed?.argb) return parsed.argb;
  }
  return undefined;
}

/**
 * Parsed `#SWBGAxx fr:tot:lp:ARGB N1 N2 …` directive.
 *
 * `#SWBGAxx` declares a switching ("animated") BGA: while the cue is active, the player cycles through the listed
 * `#BMPxx` slots one frame at a time. The header tokens — `fr` / `tot` / `lp` / optional `ARGB` — drive how the cycle
 * progresses, the rest of the line is the per-frame slot list.
 *
 * Field semantics (hitkey BMS Memo): - `fr` (frame rate): frame interval in `1/100`-second units, so `fr = 10` means
 * one frame every 100 ms. Stored here in ms. - `tot` (total frames): number of frames in the animation. The slot list
 * MAY be shorter / longer; a shorter list cycles itself, a longer one is truncated to `tot`. - `lp` (loop): `0` = play
 * once and hold the last frame, non-zero = loop. - `ARGB` (optional): AARRGGBB tint applied to every frame, same format
 * as `#ARGBxx`.
 */
export interface BmsSwitchingBga {
  /** Frame interval in milliseconds (`fr × 10`). */
  frameIntervalMs: number;
  /** Total frames the animation should advance through. */
  totalFrames: number;
  /** Whether playback should loop after reaching `totalFrames`. */
  loop: boolean;
  /**
   * ARGB tuple as a parser-faithful raw string (AARRGGBB hex), or `undefined` when the header omitted the `:ARGB`
   * field.
   */
  argbRaw?: string;
  /**
   * Per-frame `#BMPxx` slot ids, normalized via `normalizeObjectKey`. Empty / unparseable tokens are skipped.
   * `frames.length` may differ from `totalFrames` — consumers should index modulo `frames.length` while clamping to
   * `totalFrames`.
   */
  frames: string[];
}

/**
 * Parses one `#SWBGAxx` directive value (the post-`#SWBGAxx ` text). Returns `undefined` for malformed inputs (missing
 * header, non- positive frame rate / total, empty slot list, etc.) so the consumer can fall through to "no animation"
 * rather than show a stuck or scrambled frame.
 */
export function parseBmsSwBga(raw: string, idBase: 36 | 62 = 36): BmsSwitchingBga | undefined {
  if (typeof raw !== 'string') return undefined;
  const tokens = raw.trim().split(/\s+/u);
  if (tokens.length < 2) return undefined;
  const headerRaw = tokens[0]!;
  const headerParts = headerRaw.split(':');
  if (headerParts.length < 3) return undefined;
  const fr = Number.parseInt(headerParts[0]!, 10);
  const totalFrames = Number.parseInt(headerParts[1]!, 10);
  const lp = Number.parseInt(headerParts[2]!, 10);
  if (![fr, totalFrames, lp].every((value) => Number.isFinite(value))) return undefined;
  if (fr <= 0 || totalFrames <= 0) return undefined;
  const argbField = headerParts[3]?.trim();
  const argbRaw = argbField && argbField.length > 0 ? argbField : undefined;
  const frames: string[] = [];
  for (const token of tokens.slice(1)) {
    const slot = normalizeObjectKey(token, idBase);
    if (slot.length > 0) frames.push(slot);
  }
  if (frames.length === 0) return undefined;
  return {
    frameIntervalMs: fr * 10,
    totalFrames,
    loop: lp !== 0,
    argbRaw,
    frames,
  };
}

/**
 * Picks the `#BMPxx` slot id that should render at `elapsedMs` milliseconds into a switching BGA's playback. Honors
 * the directive's `frameIntervalMs`, `totalFrames`, and `loop` fields — when `loop = false` and the cycle has ended,
 * the last authored frame stays on screen ("hold last").
 *
 * Returns `undefined` only when the parsed entry has an empty `frames` list (which {@link parseBmsSwBga} already
 * filters out for us); included for safety so callers can use a single null check.
 */
export function pickSwitchingBgaFrame(swBga: BmsSwitchingBga, elapsedMs: number): string | undefined {
  if (swBga.frames.length === 0) return undefined;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return swBga.frames[0];
  }
  const rawIndex = Math.floor(elapsedMs / swBga.frameIntervalMs);
  let index: number;
  if (swBga.loop) {
    // Modulo against `frames.length` so a slot list shorter than `totalFrames` keeps cycling within the authored
    // frames.
    index = ((rawIndex % swBga.totalFrames) + swBga.totalFrames) % swBga.totalFrames;
    index = index % swBga.frames.length;
  } else {
    // Clamp to the last frame so post-end the BGA holds rather than disappearing.
    const clamped = Math.min(rawIndex, swBga.totalFrames - 1);
    index = Math.min(clamped, swBga.frames.length - 1);
  }
  return swBga.frames[index];
}

/**
 * Parsed `#BGAxx YY x1 y1 x2 y2 dx dy` directive.
 *
 * `#BGAxx` declares a sub-region BGA: it pulls a rectangle out of an existing `#BMPYY` slot and exposes it as the slot
 * ID `xx` so BGA cues referencing `xx` render only that crop. The destination offset `(dx, dy)` is the position INSIDE
 * the BMS 256x256 spec canvas where the cropped rectangle should be drawn — chart authors use it to compose multiple
 * sub-regions of one source BMP into different on-screen positions, e.g. assembling a sprite-sheet animation by
 * aliasing slots `01..09` to different tiles of `#BMP10`.
 */
export interface BmsSubRegionBga {
  /** Source BMP slot id, normalized via `normalizeObjectKey`. */
  sourceBmp: string;
  /** Top-left X of the source rectangle (pixel coordinates). */
  sx: number;
  /** Top-left Y of the source rectangle. */
  sy: number;
  /** Bottom-right X of the source rectangle (exclusive). */
  ex: number;
  /** Bottom-right Y of the source rectangle (exclusive). */
  ey: number;
  /** Destination X inside the 256x256 BGA spec canvas. */
  dx: number;
  /** Destination Y inside the 256x256 BGA spec canvas. */
  dy: number;
}

/**
 * Parses one `#BGAxx YY x1 y1 x2 y2 dx dy` directive. Whitespace- separated tokens, all integer except `YY` which is
 * the source BMP slot id (base-36 / base-62 depending on `#BASE`).
 *
 * Returns `undefined` for malformed lines (fewer than seven tokens, non-integer numerics, empty source slot, or a
 * degenerate rectangle where `ex <= sx` / `ey <= sy`).
 */
export function parseBmsBga(raw: string, idBase: 36 | 62 = 36): BmsSubRegionBga | undefined {
  if (typeof raw !== 'string') return undefined;
  const tokens = raw.trim().split(/\s+/u);
  if (tokens.length < 7) return undefined;
  const [sourceRaw, sxRaw, syRaw, exRaw, eyRaw, dxRaw, dyRaw] = tokens;
  if (
    sourceRaw === undefined ||
    sxRaw === undefined ||
    syRaw === undefined ||
    exRaw === undefined ||
    eyRaw === undefined ||
    dxRaw === undefined ||
    dyRaw === undefined
  ) {
    return undefined;
  }
  const sourceBmp = normalizeObjectKey(sourceRaw, idBase);
  if (sourceBmp.length === 0) return undefined;
  const sx = Number.parseInt(sxRaw, 10);
  const sy = Number.parseInt(syRaw, 10);
  const ex = Number.parseInt(exRaw, 10);
  const ey = Number.parseInt(eyRaw, 10);
  const dx = Number.parseInt(dxRaw, 10);
  const dy = Number.parseInt(dyRaw, 10);
  if (![sx, sy, ex, ey, dx, dy].every((value) => Number.isFinite(value))) return undefined;
  // Degenerate / inverted rectangles are unusable — they'd produce a zero-area frame and a runtime divide-by-zero in
  // the consumer.
  if (ex <= sx || ey <= sy) return undefined;
  return { sourceBmp, sx, sy, ex, ey, dx, dy };
}

/**
 * Parsed BMS `#ARGBxx` value — alpha + RGB channel in 0..255.
 *
 * Each component is clamped to the byte range so callers can blindly feed them into bit-shift / `/255` conversions
 * without re-validating.
 */
export interface BmsArgb {
  /** Alpha (0 = fully transparent, 255 = fully opaque). */
  a: number;
  r: number;
  g: number;
  b: number;
}

const BMS_ARGB_HEX_RE = /^[0-9A-Fa-f]{8}$/;

/**
 * Parses a BMS `#ARGBxx` raw string into A / R / G / B byte components. Recognizes both formats commonly found in the
 * wild:
 *
 * - **Hex AARRGGBB** — `'FF000000'` or `'#FF000000'` (8 hex digits, optional leading `#`). High byte = alpha.
 * - **Comma-separated decimal** — `'255,0,0,0'` (A,R,G,B with optional whitespace around each integer).
 *
 * Returns `undefined` for unrecognized / malformed input so the caller can fall back to "no tint".
 *
 * Spec note (hitkey BMS Memo): `#ARGBxx` adjusts the color / alpha of `#BMPxx` for BGA layer composition. Authors
 * typically use it to chroma-key a backdrop color to transparent, or to dim a layer image — in both cases the consumer
 * applies the parsed values as a tint × alpha at draw time.
 */
export function parseBmsArgb(raw: string): BmsArgb | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  // Comma-separated decimal: "A,R,G,B" with optional whitespace.
  if (trimmed.includes(',')) {
    const parts = trimmed.split(',');
    if (parts.length !== 4) return undefined;
    const ints: number[] = [];
    for (const part of parts) {
      const trimmedPart = part.trim();
      if (trimmedPart.length === 0) return undefined;
      const value = Number.parseInt(trimmedPart, 10);
      if (!Number.isFinite(value)) return undefined;
      // Clamp to 0..255 so `#ARGB01 300,-5,...` (clearly malformed but writeable) doesn't poison downstream alpha math.
      ints.push(Math.max(0, Math.min(255, Math.trunc(value))));
    }
    return { a: ints[0]!, r: ints[1]!, g: ints[2]!, b: ints[3]! };
  }
  // Hex AARRGGBB, optional leading '#'.
  const hex = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (!BMS_ARGB_HEX_RE.test(hex)) return undefined;
  return {
    a: Number.parseInt(hex.slice(0, 2), 16),
    r: Number.parseInt(hex.slice(2, 4), 16),
    g: Number.parseInt(hex.slice(4, 6), 16),
    b: Number.parseInt(hex.slice(6, 8), 16),
  };
}

/**
 * Parameter byte for a `#WAVCMD pp xx vv` entry.
 *
 * - `'pitch'` (`pp = 00`) — semitone shift, signed (`-127..127`).
 * - `'volume'` (`pp = 01`) — playback volume, `0..127` where 0 is mute and 127 is unity. We map this to a 0..1 linear
 *   gain multiplier so consumers can multiply directly into a gain stage.
 * - `'loop'` (`pp = 02`) — sample-frame loop point. `0` disables looping; otherwise the sample loops back to that frame
 *   index after reaching its end.
 */
export type BmsWavCmdParam = 'pitch' | 'volume' | 'loop';

export interface BmsWavCmdEntry {
  param: BmsWavCmdParam;
  /** Slot id (`#WAVxx`), normalized via `normalizeObjectKey`. */
  slot: string;
  /**
   * Raw integer value as written in the chart. The interpretation depends on `param` — see {@link BmsWavCmdParam}.
   * Volume here is the literal 0..127 byte; convert to a gain multiplier via {@link wavCmdVolumeByteToLinearGain}.
   */
  value: number;
}

/**
 * Maps a `#WAVCMD 01 xx vv` volume byte (0..127) to a 0..1 linear gain multiplier. `127 = 1.0` (unity), `0 = 0.0`
 * (mute), linear in between. Out-of-range bytes are clamped.
 *
 * Hitkey BMS Memo describes the 0..127 byte as the volume, with 127 the practical "loud as authored" reference. We
 * treat it as a straight ratio rather than a dB curve because most players (LR2 / beatoraja) implement it linearly and
 * chart authors compose against that.
 */
export function wavCmdVolumeByteToLinearGain(byteValue: number): number {
  if (!Number.isFinite(byteValue)) return 1;
  const clamped = Math.max(0, Math.min(127, byteValue));
  return clamped / 127;
}

/**
 * Parses one `#WAVCMD pp xx vv` line. Whitespace-separated tokens: - `pp` (parameter byte): `00`/`01`/`02`
 * (pitch/volume/loop). - `xx` (slot id): two-character base-36 (or base-62) id matching a `#WAVxx` declaration.
 * Returned as the normalized key. - `vv`: integer value.
 *
 * Returns `undefined` for malformed lines so callers can skip them rather than crashing on an unrecognized parameter
 * byte.
 *
 * @param idBase  Pass `62` for charts declared with `#BASE 62` so
 *                lowercase slot ids are preserved as-is.
 */
export function parseBmsWavCmd(line: string, idBase: 36 | 62 = 36): BmsWavCmdEntry | undefined {
  if (typeof line !== 'string') return undefined;
  const tokens = line.trim().split(/\s+/u);
  if (tokens.length < 3) return undefined;
  const [paramRaw, slotRaw, valueRaw] = tokens;
  if (paramRaw === undefined || slotRaw === undefined || valueRaw === undefined) {
    return undefined;
  }
  const paramByte = Number.parseInt(paramRaw, 10);
  const value = Number.parseInt(valueRaw, 10);
  if (!Number.isFinite(paramByte) || !Number.isFinite(value)) return undefined;
  let param: BmsWavCmdParam;
  switch (paramByte) {
    case 0:
      param = 'pitch';
      break;
    case 1:
      param = 'volume';
      break;
    case 2:
      param = 'loop';
      break;
    default:
      return undefined;
  }
  const slot = normalizeObjectKey(slotRaw, idBase);
  if (slot.length === 0) return undefined;
  return { param, slot, value };
}

/**
 * Builds a `slot → linear-gain-multiplier` map by collecting every `#WAVCMD 01 xx vv` (volume) line. Slots with no
 * `#WAVCMD 01` line stay absent (the consumer falls back to unity gain). When a chart writes multiple volume lines for
 * the same slot the LAST one wins, matching LR2 / beatoraja's "later directives override earlier" behavior.
 *
 * Pitch / loop lines are intentionally skipped — they require sample-graph wiring (playback rate, loop points) that
 * lives in the audio engine, not in this pure pre-process.
 */
export function collectBmsWavCmdVolumeMultipliers(
  lines: ReadonlyArray<string>,
  idBase: 36 | 62 = 36,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of lines) {
    const entry = parseBmsWavCmd(line, idBase);
    if (entry?.param === 'volume') {
      out.set(entry.slot, wavCmdVolumeByteToLinearGain(entry.value));
    }
  }
  return out;
}

export function isTempoChannel(channel: string): boolean {
  if (channel.length === 2) {
    const high = channel.charCodeAt(0);
    const low = channel.charCodeAt(1);
    if (high === 0x30 && (low === 0x33 || low === 0x38)) {
      return true;
    }
  }
  return matchesPackedOrNormalizedChannel(channel, isPackedTempoChannel, isTempoNormalizedChannel);
}

export function isStopChannel(channel: string): boolean {
  if (channel.length === 2 && channel.charCodeAt(0) === 0x30 && channel.charCodeAt(1) === 0x39) {
    return true;
  }
  return matchesPackedOrNormalizedChannel(channel, isPackedStopChannel, isStopNormalizedChannel);
}

export function isScrollChannel(channel: string): boolean {
  if (channel.length === 2) {
    const high = channel.charCodeAt(0) & 0xdf;
    const low = channel.charCodeAt(1) & 0xdf;
    if (high === 0x53 && low === 0x43) {
      return true;
    }
  }
  return matchesPackedOrNormalizedChannel(channel, isPackedScrollChannel, isScrollNormalizedChannel);
}

export function isLandmineChannel(channel: string): boolean {
  if (channel.length === 2) {
    const high = channel.charCodeAt(0) & 0xdf;
    const low = channel.charCodeAt(1);
    if ((high === 0x44 || high === 0x45) && low >= 0x31 && low <= 0x39) {
      return true;
    }
  }
  return matchesPackedOrNormalizedChannel(channel, isPackedLandmineChannel, isLandmineNormalizedChannel);
}

export function isSampleTriggerChannel(channel: string): boolean {
  if (channel.length === 2) {
    const highCode = channel.charCodeAt(0);
    const lowCode = channel.charCodeAt(1);
    if (highCode === 0x30) {
      return lowCode === 0x31;
    }
    if (highCode === 0x39 && (lowCode === 0x37 || lowCode === 0x38)) {
      return false;
    }
    if ((highCode & 0xdf) === 0x41 && lowCode === 0x30) {
      return false;
    }
    if ((highCode & 0xdf) === 0x53 && (lowCode & 0xdf) === 0x43) {
      return false;
    }
    if ((highCode & 0xdf) === 0x53 && (lowCode & 0xdf) === 0x50) {
      return false;
    }
    return true;
  }
  return matchesPackedOrNormalizedChannel(channel, isPackedSampleTriggerChannel, isSampleTriggerNormalizedChannel);
}

export function isPlayableChannel(channel: string): boolean {
  if (channel.length === 2) {
    const high = channel.charCodeAt(0);
    const low = channel.charCodeAt(1);
    if ((high === 0x31 || high === 0x32) && low >= 0x31 && low <= 0x39) {
      return true;
    }
  }
  return matchesPackedOrNormalizedChannel(channel, isPackedPlayableChannel, isPlayableNormalizedChannel);
}

export function isBmsLongNoteChannel(channel: string): boolean {
  if (channel.length === 2) {
    const high = channel.charCodeAt(0);
    const low = channel.charCodeAt(1);
    if ((high === 0x35 || high === 0x36) && low >= 0x31 && low <= 0x39) {
      return true;
    }
  }
  return matchesPackedOrNormalizedChannel(channel, isPackedBmsLongNoteChannel, isBmsLongNoteNormalizedChannel);
}

export function isPlayLaneSoundChannel(channel: string): boolean {
  return matchesPackedOrNormalizedChannel(channel, isPackedPlayLaneSoundChannel, isPlayLaneSoundNormalizedChannel);
}

export function isBmsBgmVolumeChangeChannel(channel: string): boolean {
  return matchesPackedOrNormalizedChannel(
    channel,
    isPackedBmsBgmVolumeChangeChannel,
    isBmsBgmVolumeChangeNormalizedChannel,
  );
}

export function isBmsKeyVolumeChangeChannel(channel: string): boolean {
  return matchesPackedOrNormalizedChannel(
    channel,
    isPackedBmsKeyVolumeChangeChannel,
    isBmsKeyVolumeChangeNormalizedChannel,
  );
}

export function isBmsDynamicVolumeChangeChannel(channel: string): boolean {
  return matchesPackedOrNormalizedChannel(
    channel,
    isPackedBmsDynamicVolumeChangeChannel,
    isBmsDynamicVolumeChangeNormalizedChannel,
  );
}

export function parseBmsDynamicVolumeGain(value: string): number | undefined {
  const normalized = normalizeObjectKey(value);
  const high = parseHexDigitFast(normalized.charCodeAt(0));
  const low = parseHexDigitFast(normalized.charCodeAt(1));
  if (high < 0 || low < 0) {
    return undefined;
  }
  const parsed = (high << 4) | low;
  if (parsed <= 0) {
    return undefined;
  }
  return parsed / 0xff;
}

export function mapBmsLongNoteChannelToPlayable(channel: string): string | undefined {
  const packed = tryPackChannel(channel);
  if (packed >= 0) {
    if (!isPackedBmsLongNoteChannel(packed)) {
      return undefined;
    }
    const low = packed & 0xff;
    const laneIndex = low - 0x31;
    return ((packed >> 8) & 0xff) === 0x35
      ? BMS_LONG_NOTE_PLAYABLE_1P[laneIndex]
      : BMS_LONG_NOTE_PLAYABLE_2P[laneIndex];
  }
  return mapBmsLongNoteNormalizedChannelToPlayable(resolveNormalizedChannelForPredicate(channel));
}

export interface BmsLongNote {
  event: BeMusicEvent;
  sourceChannel: string;
  channel: string;
  beat: number;
  endBeat?: number;
}

export interface BmsLongNoteResolution {
  notes: BmsLongNote[];
  suppressedTriggerEvents: Set<BeMusicEvent>;
}

export interface ResolveBmsLongNotesOptions {
  inferLnTypeWhenMissing?: boolean;
}

interface ResolvedBmsLongNoteEvent {
  event: BeMusicEvent;
  sourceChannel: string;
  channel: string;
  normalizedValue: string;
}

interface NormalizedChartEvent {
  event: BeMusicEvent;
  normalizedChannel: string;
}

export function resolveBmsLongNotes(
  json: BeMusicJson,
  options: ResolveBmsLongNotesOptions = {},
): BmsLongNoteResolution {
  if (json.sourceFormat !== 'bms') {
    return {
      notes: [],
      suppressedTriggerEvents: new Set(),
    };
  }

  const longNoteEvents = prepareResolvedBmsLongNoteEvents(json.events, resolveBmsBase(json));
  if (longNoteEvents.length === 0) {
    return {
      notes: [],
      suppressedTriggerEvents: new Set(),
    };
  }

  const beatResolver = createBeatResolver(json);
  const lnType = resolveBmsLongNoteType(json, longNoteEvents, options);
  return lnType === 2
    ? resolveBmsLongNotesType2(longNoteEvents, beatResolver)
    : resolveBmsLongNotesType1(longNoteEvents, beatResolver);
}

export function collectLnobjEndEvents(json: BeMusicJson): Set<BeMusicEvent> {
  return resolveLnobjLongNotes(json).endEvents;
}

export interface LnobjLongNoteResolution {
  startToEndBeat: Map<BeMusicEvent, number>;
  endEvents: Set<BeMusicEvent>;
}

export function resolveLnobjLongNotes(json: BeMusicJson): LnobjLongNoteResolution {
  if (json.sourceFormat !== 'bms') {
    return {
      startToEndBeat: new Map(),
      endEvents: new Set(),
    };
  }

  const idBase = resolveBmsBase(json);
  const lnObjValues = resolveLnobjValues(json, idBase);
  if (lnObjValues.size === 0) {
    return {
      startToEndBeat: new Map(),
      endEvents: new Set(),
    };
  }

  const beatResolver = createBeatResolver(json);
  const preparedEvents = prepareNormalizedChartEvents(json.events);
  const legacyLongNoteTicks = collectLegacyLongNoteTickKeysFromPreparedEvents(preparedEvents);
  const pendingStartByChannel = new Map<string, { event: BeMusicEvent; beat: number }>();
  const startToEndBeat = new Map<BeMusicEvent, number>();
  const endEvents = new Set<BeMusicEvent>();

  for (const item of preparedEvents) {
    const { event, normalizedChannel } = item;
    if (!isPlayableNormalizedChannel(normalizedChannel)) {
      continue;
    }
    const tickKey = createEventTickKey(event);
    if (legacyLongNoteTicks.has(`${normalizedChannel}:${tickKey}`)) {
      pendingStartByChannel.delete(normalizedChannel);
      continue;
    }

    const beat = beatResolver.eventToBeat(event);
    const normalizedValue = normalizeObjectKey(event.value, idBase);
    if (lnObjValues.has(normalizedValue)) {
      const start = pendingStartByChannel.get(normalizedChannel);
      if (start && beat > start.beat) {
        startToEndBeat.set(start.event, beat);
        endEvents.add(event);
      }
      pendingStartByChannel.delete(normalizedChannel);
      continue;
    }

    pendingStartByChannel.set(normalizedChannel, { event, beat });
  }

  return {
    startToEndBeat,
    endEvents,
  };
}

function resolveBmsLongNotesType1(
  events: ResolvedBmsLongNoteEvent[],
  beatResolver: BeatResolver,
): BmsLongNoteResolution {
  const notes: BmsLongNote[] = [];
  const suppressedTriggerEvents = new Set<BeMusicEvent>();
  const pendingByChannel = new Map<string, BmsLongNote>();

  for (const item of events) {
    const beat = beatResolver.eventToBeat(item.event);
    const pending = pendingByChannel.get(item.sourceChannel);
    if (pending && beat > pending.beat) {
      pending.endBeat = beat;
      suppressedTriggerEvents.add(item.event);
      pendingByChannel.delete(item.sourceChannel);
      continue;
    }
    const note: BmsLongNote = {
      event: item.event,
      sourceChannel: item.sourceChannel,
      channel: item.channel,
      beat,
    };
    notes.push(note);
    pendingByChannel.set(item.sourceChannel, note);
  }

  return { notes, suppressedTriggerEvents };
}

function resolveLnobjValues(json: BeMusicJson, base: 36 | 62 = 36): Set<string> {
  const values = new Set<string>();
  for (const candidate of json.bms.lnObjs ?? []) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      values.add(normalizeObjectKey(candidate, base));
    }
  }
  return values;
}

function prepareNormalizedChartEvents(events: ReadonlyArray<BeMusicEvent>): NormalizedChartEvent[] {
  const prepared: NormalizedChartEvent[] = [];
  for (const event of sortEvents(events as BeMusicEvent[])) {
    prepared.push({
      event,
      normalizedChannel: normalizeChannel(event.channel),
    });
  }
  return prepared;
}

function prepareResolvedBmsLongNoteEvents(
  events: ReadonlyArray<BeMusicEvent>,
  base: 36 | 62 = 36,
): ResolvedBmsLongNoteEvent[] {
  const prepared: ResolvedBmsLongNoteEvent[] = [];
  for (const event of sortEvents(events as BeMusicEvent[])) {
    const sourceChannel = normalizeChannel(event.channel);
    const mapped = mapBmsLongNoteNormalizedChannelToPlayable(sourceChannel);
    if (!mapped) {
      continue;
    }
    prepared.push({
      event,
      sourceChannel,
      channel: mapped,
      normalizedValue: normalizeObjectKey(event.value, base),
    });
  }
  return prepared;
}

function collectLegacyLongNoteTickKeysFromPreparedEvents(events: ReadonlyArray<NormalizedChartEvent>): Set<string> {
  const keys = new Set<string>();
  for (const item of events) {
    const playableChannel = mapBmsLongNoteNormalizedChannelToPlayable(item.normalizedChannel);
    if (!playableChannel) {
      continue;
    }
    keys.add(createNormalizedChannelTickKey(playableChannel, item.event));
  }
  return keys;
}

function createNormalizedChannelTickKey(normalizedChannel: string, event: BeMusicEvent): string {
  return `${normalizedChannel}:${createEventTickKey(event)}`;
}

function createEventTickKey(event: BeMusicEvent): string {
  const measure = Math.max(0, Math.floor(event.measure));
  const denominator = normalizePositionDenominator(event.position[1]);
  const numerator = normalizePositionNumerator(event.position[0], denominator);
  return `${measure}:${numerator}/${denominator}`;
}

function resolveBmsLongNotesType2(
  events: ResolvedBmsLongNoteEvent[],
  beatResolver: BeatResolver,
): BmsLongNoteResolution {
  const notes: BmsLongNote[] = [];
  const suppressedTriggerEvents = new Set<BeMusicEvent>();
  const eventsByChannel = groupResolvedLongNoteEventsBySourceChannel(events);

  for (const channelEvents of eventsByChannel.values()) {
    let runNote: BmsLongNote | undefined;
    let previousEvent: BeMusicEvent | undefined;

    for (const item of channelEvents) {
      const beat = beatResolver.eventToBeat(item.event);
      if (!runNote) {
        runNote = {
          event: item.event,
          sourceChannel: item.sourceChannel,
          channel: item.channel,
          beat,
        };
        notes.push(runNote);
        previousEvent = item.event;
        continue;
      }

      if (previousEvent && isBmsLongNoteType2Continuation(previousEvent, item.event)) {
        suppressedTriggerEvents.add(item.event);
        previousEvent = item.event;
        continue;
      }

      if (previousEvent) {
        const endBeat = resolveBmsLongNoteType2SegmentEndBeat(previousEvent, beatResolver);
        if (endBeat > runNote.beat) {
          runNote.endBeat = endBeat;
        }
      }
      runNote = {
        event: item.event,
        sourceChannel: item.sourceChannel,
        channel: item.channel,
        beat,
      };
      notes.push(runNote);
      previousEvent = item.event;
    }

    if (runNote && previousEvent) {
      const endBeat = resolveBmsLongNoteType2SegmentEndBeat(previousEvent, beatResolver);
      if (endBeat > runNote.beat) {
        runNote.endBeat = endBeat;
      }
    }
  }

  notes.sort((left, right) => {
    if (left.beat !== right.beat) {
      return left.beat - right.beat;
    }
    if (left.channel !== right.channel) {
      return left.channel < right.channel ? -1 : 1;
    }
    if (left.event.value !== right.event.value) {
      return left.event.value < right.event.value ? -1 : 1;
    }
    return 0;
  });

  return { notes, suppressedTriggerEvents };
}

function resolveBmsLongNoteType(
  json: BeMusicJson,
  events: ResolvedBmsLongNoteEvent[],
  options: ResolveBmsLongNotesOptions,
): 1 | 2 {
  if (json.bms.lnType === 1 || json.bms.lnType === 2) {
    return json.bms.lnType;
  }
  if (options.inferLnTypeWhenMissing !== true) {
    return 1;
  }
  return inferBmsLongNoteType(events);
}

function inferBmsLongNoteType(events: ResolvedBmsLongNoteEvent[]): 1 | 2 {
  for (const channelEvents of groupResolvedLongNoteEventsBySourceChannel(events).values()) {
    let previous: BeMusicEvent | undefined;
    let previousValue: string | undefined;
    let continuationCount = 0;
    for (const item of channelEvents) {
      if (previous && previousValue === item.normalizedValue && isBmsLongNoteType2Continuation(previous, item.event)) {
        // A single same-value continuation is ambiguous because legacy LNTYPE=1 charts also use same-value pairs for
        // their start/end markers.
        continuationCount += 1;
        if (continuationCount >= 2) {
          return 2;
        }
      } else {
        continuationCount = 0;
      }
      previous = item.event;
      previousValue = item.normalizedValue;
    }
  }

  return 1;
}

function groupResolvedLongNoteEventsBySourceChannel(
  events: ReadonlyArray<ResolvedBmsLongNoteEvent>,
): Map<string, ResolvedBmsLongNoteEvent[]> {
  const grouped = new Map<string, ResolvedBmsLongNoteEvent[]>();
  for (const item of events) {
    const bucket = grouped.get(item.sourceChannel);
    if (bucket) {
      bucket.push(item);
      continue;
    }
    grouped.set(item.sourceChannel, [item]);
  }
  return grouped;
}

function isBmsLongNoteType2Continuation(previous: BeMusicEvent, current: BeMusicEvent): boolean {
  if (current.measure === previous.measure) {
    return (
      current.position[1] === previous.position[1] &&
      normalizePositionNumerator(current.position[0], normalizePositionDenominator(current.position[1])) ===
        normalizePositionNumerator(previous.position[0], normalizePositionDenominator(previous.position[1])) + 1
    );
  }

  if (current.measure !== previous.measure + 1) {
    return false;
  }

  const previousDenominator = normalizePositionDenominator(previous.position[1]);
  const previousNumerator = normalizePositionNumerator(previous.position[0], previousDenominator);
  const currentDenominator = normalizePositionDenominator(current.position[1]);
  const currentNumerator = normalizePositionNumerator(current.position[0], currentDenominator);

  return previousNumerator + 1 === previousDenominator && currentNumerator === 0;
}

function resolveBmsLongNoteType2SegmentEndBeat(event: BeMusicEvent, beatResolver: BeatResolver): number {
  const measure = Math.max(0, Math.floor(event.measure));
  const denominator = normalizePositionDenominator(event.position[1]);
  const numerator = normalizePositionNumerator(event.position[0], denominator);
  const nextNumerator = numerator + 1;
  if (nextNumerator >= denominator) {
    return beatResolver.measureToBeat(measure + 1, 0);
  }
  return beatResolver.measureToBeat(measure, nextNumerator / denominator);
}

function createExactMeasureLengthRecord(json: BeMusicJson): Record<number, number> {
  const measureLengths: number[] = [];
  for (const measure of json.measures) {
    measureLengths[measure.index] = measure.length;
  }
  return measureLengths;
}

function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value >= 1) {
    return 0.999999999;
  }
  return value;
}

function getEventPosition(event: BeMusicEvent): number {
  const denominator = normalizePositionDenominator(event.position[1]);
  const numerator = normalizePositionNumerator(event.position[0], denominator);
  return numerator / denominator;
}

function normalizePositionDenominator(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
  return Math.max(1, Math.floor(value));
}

function normalizePositionNumerator(value: number, denominator: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const normalized = Math.floor(value);
  return Math.max(0, Math.min(denominator - 1, normalized));
}

function parseHexDigitFast(code: number): number {
  if (code >= 0x30 && code <= 0x39) {
    return code - 0x30;
  }
  const uppercase = code & 0xdf;
  if (uppercase >= 0x41 && uppercase <= 0x46) {
    return uppercase - 0x41 + 10;
  }
  return -1;
}

function resolveNormalizedChannelForPredicate(channel: string): string {
  if (channel.length === 2) {
    const code0 = channel.charCodeAt(0);
    const code1 = channel.charCodeAt(1);
    if (isNormalizedBase36Code(code0) && isNormalizedBase36Code(code1)) {
      return channel;
    }
  }
  return normalizeChannel(channel);
}

function matchesPackedOrNormalizedChannel(
  channel: string,
  packedMatcher: (packed: number) => boolean,
  normalizedMatcher: (normalized: string) => boolean,
): boolean {
  const packed = tryPackChannel(channel);
  if (packed >= 0) {
    return packedMatcher(packed);
  }
  return normalizedMatcher(resolveNormalizedChannelForPredicate(channel));
}

function isNormalizedBase36Code(code: number): boolean {
  return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a);
}

function tryPackChannel(channel: string): number {
  if (channel.length !== 2) {
    return -1;
  }
  const sourceHigh = channel.charCodeAt(0);
  const sourceLow = channel.charCodeAt(1);
  if (isNormalizedBase36Code(sourceHigh) && isNormalizedBase36Code(sourceLow)) {
    return (sourceHigh << 8) | sourceLow;
  }
  const high = normalizeAsciiBase36CodeFast(sourceHigh);
  const low = normalizeAsciiBase36CodeFast(sourceLow);
  if (high < 0 || low < 0) {
    return -1;
  }
  return (high << 8) | low;
}

function normalizeAsciiBase36CodeFast(code: number): number {
  if (code >= 0x30 && code <= 0x39) {
    return code;
  }
  const uppercase = code & 0xdf;
  if (uppercase >= 0x41 && uppercase <= 0x5a) {
    return uppercase;
  }
  return -1;
}

function isPmsExtension(chartPath: string | undefined): boolean {
  if (typeof chartPath !== 'string' || chartPath.length === 0) {
    return false;
  }
  const dotIndex = chartPath.lastIndexOf('.');
  if (dotIndex < 0) return false;
  return chartPath.slice(dotIndex).toLowerCase() === '.pms';
}

function isTempoNormalizedChannel(normalized: string): boolean {
  return normalized === '03' || normalized === '08';
}

function isPackedTempoChannel(packed: number): boolean {
  return packed === PACKED_CHANNEL_03 || packed === PACKED_CHANNEL_08;
}

function isStopNormalizedChannel(normalized: string): boolean {
  return normalized === '09';
}

function isPackedStopChannel(packed: number): boolean {
  return packed === PACKED_CHANNEL_09;
}

function isScrollNormalizedChannel(normalized: string): boolean {
  return normalized === 'SC';
}

function isPackedScrollChannel(packed: number): boolean {
  return packed === PACKED_CHANNEL_SC;
}

function isLandmineNormalizedChannel(normalized: string): boolean {
  return /^[DE][1-9]$/.test(normalized);
}

function isSampleTriggerNormalizedChannel(normalized: string): boolean {
  if (/^0[0-9A-Z]$/.test(normalized)) {
    return normalized === '01';
  }
  return (
    normalized !== '97' && normalized !== '98' && normalized !== 'A0' && normalized !== 'SC' && normalized !== 'SP'
  );
}

function isPlayableNormalizedChannel(normalized: string): boolean {
  return /^[12][1-9]$/.test(normalized);
}

function isBmsLongNoteNormalizedChannel(normalized: string): boolean {
  return /^[56][1-9]$/.test(normalized);
}

function isPlayLaneSoundNormalizedChannel(normalized: string): boolean {
  return /^[1-6][1-9]$/.test(normalized);
}

function isBmsBgmVolumeChangeNormalizedChannel(normalized: string): boolean {
  return normalized === '97';
}

function isBmsKeyVolumeChangeNormalizedChannel(normalized: string): boolean {
  return normalized === '98';
}

function isBmsDynamicVolumeChangeNormalizedChannel(normalized: string): boolean {
  return isBmsBgmVolumeChangeNormalizedChannel(normalized) || isBmsKeyVolumeChangeNormalizedChannel(normalized);
}

function mapBmsLongNoteNormalizedChannelToPlayable(normalized: string): string | undefined {
  if (!isBmsLongNoteNormalizedChannel(normalized)) {
    return undefined;
  }
  const laneIndex = normalized.charCodeAt(1) - 0x31;
  return normalized.charCodeAt(0) === 0x35
    ? BMS_LONG_NOTE_PLAYABLE_1P[laneIndex]
    : BMS_LONG_NOTE_PLAYABLE_2P[laneIndex];
}

function isPackedLaneRange(packed: number, highStart: number, highEnd: number): boolean {
  const high = (packed >> 8) & 0xff;
  const low = packed & 0xff;
  return high >= highStart && high <= highEnd && low >= 0x31 && low <= 0x39;
}

function isPackedLandmineChannel(packed: number): boolean {
  return isPackedLaneRange(packed, 0x44, 0x45);
}

function isPackedSampleTriggerChannel(packed: number): boolean {
  if (((packed >> 8) & 0xff) === 0x30) {
    return (packed & 0xff) === 0x31;
  }
  if (
    packed === PACKED_CHANNEL_97 ||
    packed === PACKED_CHANNEL_98 ||
    packed === PACKED_CHANNEL_SC ||
    packed === PACKED_CHANNEL_SP
  ) {
    return false;
  }
  return packed !== 0x4130;
}

function isPackedPlayableChannel(packed: number): boolean {
  return isPackedLaneRange(packed, 0x31, 0x32);
}

function isPackedBmsLongNoteChannel(packed: number): boolean {
  return isPackedLaneRange(packed, 0x35, 0x36);
}

function isPackedPlayLaneSoundChannel(packed: number): boolean {
  return isPackedLaneRange(packed, 0x31, 0x36);
}

function isPackedBmsBgmVolumeChangeChannel(packed: number): boolean {
  return packed === PACKED_CHANNEL_97;
}

function isPackedBmsKeyVolumeChangeChannel(packed: number): boolean {
  return packed === PACKED_CHANNEL_98;
}

function isPackedBmsDynamicVolumeChangeChannel(packed: number): boolean {
  return isPackedBmsBgmVolumeChangeChannel(packed) || isPackedBmsKeyVolumeChangeChannel(packed);
}
