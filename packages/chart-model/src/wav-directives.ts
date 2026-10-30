import { normalizeObjectKey, type BeMusicJSON } from '@be-music/chart-source';

/**
 * Parsed `#EXWAVxx [flags] params filename` directive.
 *
 * `#EXWAVxx` declares an "extended" WAV slot whose playback should be modified by the listed parameters. The `flags`
 * token names which channels are present (in order), and whitespace-separated parameters follow those flags
 * positionally. Be-Music also accepts its earlier comma-separated parameter spelling.
 *
 * Supported flags (hitkey BMS Memo): - `p` — stereo pan (`-10000..10000`, where 0 is center). - `v` —
 * playback volume in centibels (CB), where each step is `1/100` of a dB. Negative values attenuate, `0` is unity. - `f`
 * — playback frequency in Hz. The sample is resampled (or replayed at a different rate) so its native sample rate maps
 * onto this output rate.
 *
 * Real-world charts use this most often for `v` (per-slot volume trim) and occasionally `p` for stereo placement of
 * one-shots.
 */
export interface BMSExWAV {
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
 * A flag string in declaration order (`pvf` / `vp` / `v`) is followed by one whitespace-separated integer per flag,
 * then the filename. Earlier Be-Music comma-separated parameters remain accepted. Trailing filename tokens are
 * joined back together so filenames can contain spaces.
 *
 * Returns `undefined` for malformed input — better to skip a broken `#EXWAV` than to apply nonsense to the audible
 * signal.
 */
export function parseBMSExWAV(raw: string): BMSExWAV | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const tokens = trimmed.split(/\s+/u);
  if (tokens.length < 3) return undefined;
  const flags = tokens[0]!.toLowerCase();
  const commaSeparated = tokens[1]!.includes(',');
  const params = commaSeparated ? tokens[1]!.split(',') : tokens.slice(1, 1 + flags.length);
  const filenameStart = commaSeparated ? 2 : 1 + flags.length;
  // Parameter count determines the boundary; the remaining filename may contain spaces.
  const filename = tokens.slice(filenameStart).join(' ');
  if (filename.length === 0) return undefined;
  const out: BMSExWAV = { filename };
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
export function exWAVVolumeCentibelsToLinearGain(centibels: number): number {
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
 * `entries` is the parser-produced `chart.bms.exWAV` map (raw post-`#EXWAVxx ` strings keyed by slot id). The returned
 * keys are passed through verbatim — they're already normalized to the chart's id base when the parser ingested them.
 */
export function collectBMSExWAVVolumeMultipliers(entries: Readonly<Record<string, string>>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [slot, raw] of Object.entries(entries)) {
    const parsed = parseBMSExWAV(raw);
    if (parsed === undefined) continue;
    if (parsed.volumeCentibels === undefined) continue;
    out.set(slot, exWAVVolumeCentibelsToLinearGain(parsed.volumeCentibels));
  }
  return out;
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
export type BmsWAVCmdParam = 'pitch' | 'volume' | 'loop';

export interface BmsWAVCmdEntry {
  param: BmsWAVCmdParam;
  /** Slot id (`#WAVxx`), normalized via `normalizeObjectKey`. */
  slot: string;
  /**
   * Raw integer value as written in the chart. The interpretation depends on `param` — see {@link BmsWAVCmdParam}.
   * Volume here is the literal 0..127 byte; convert to a gain multiplier via {@link wavCmdVolumeByteToLinearGain}.
   */
  value: number;
}

/**
 * Maps a BMS `#VOLWAV n` value (`bms.volWAV`) to the chart-wide linear gain: `n / 100` for `0 < n < 200`, unity for
 * anything else, including a missing value.
 *
 * This is beatoraja's range (`AbstractAudioDriver` applies `#VOLWAV` only when `0 < n < 200`). LR2 ignores `#VOLWAV`,
 * so a chart tuned for it plays at full volume there; following beatoraja keeps `#VOLWAV 0` from muting a chart and
 * keeps values of 200 and above from amplifying it into clipping.
 */
export function volWAVToLinearGain(volWAV: number | undefined): number {
  if (typeof volWAV !== 'number' || !Number.isFinite(volWAV) || volWAV <= 0 || volWAV >= 200) {
    return 1;
  }
  return volWAV / 100;
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
export function parseBmsWAVCmd(line: string, idBase: 36 | 62 = 36): BmsWAVCmdEntry | undefined {
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
  let param: BmsWAVCmdParam;
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
export function collectBmsWAVCmdVolumeMultipliers(
  lines: ReadonlyArray<string>,
  idBase: 36 | 62 = 36,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of lines) {
    const entry = parseBmsWAVCmd(line, idBase);
    if (entry?.param === 'volume') {
      out.set(entry.slot, wavCmdVolumeByteToLinearGain(entry.value));
    }
  }
  return out;
}

/**
 * Whether a chart's keysounds restart from the head when the same `#WAVxx` slot is retriggered (one voice per slot).
 *
 * BMS uses the LR2-compatible monophonic policy: a retrigger stops the still-playing instance of that slot and plays
 * it again from the start. bmson layers sample slices / `c: true` continuation instead, so its slots are polyphonic.
 * Every audio backend (Node mixer, WebAudio session, offline renderer) must consult this single predicate rather than
 * encoding the per-format rule locally.
 */
export function usesMonophonicWAVPlayback(json: Pick<BeMusicJSON, 'sourceFormat'>): boolean {
  return json.sourceFormat === 'bms';
}
