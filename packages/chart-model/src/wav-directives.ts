import { normalizeObjectKey, type BeMusicJSON } from '@be-music/chart-source';

/**
 * Parsed `#EXWAVxx [flags] params filename` directive.
 *
 * `#EXWAVxx` declares an "extended" WAV slot whose playback should be modified by the listed parameters. The `flags`
 * token names which channels are present (in order), and whitespace-separated parameters follow those flags
 * positionally. Be-Music also accepts its earlier comma-separated parameter spelling.
 *
 * Supported flags (hitkey BMS Memo): - `p` — stereo pan (`-10000..10000`, where 0 is center). - `v` —
 * playback attenuation in millibels (hundredths of a dB). Negative values attenuate, `0` is unity. - `f`
 * — playback frequency in Hz. The sample is resampled (or replayed at a different rate) so its native sample rate maps
 * onto this output rate.
 *
 */
export interface BMSExWAV {
  /** Raw filename token, joined back together if it contained spaces. */
  filename: string;
  /** Pan, when the `p` flag was present. */
  pan?: number;
  /** Volume in millibels (1/100 dB), when the `v` flag was present. */
  volumeMillibels?: number;
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
  if (!/^[pvf]+$/u.test(flags) || new Set(flags).size !== flags.length) return undefined;
  const commaSeparated = tokens[1]!.includes(',');
  const params = commaSeparated ? tokens[1]!.split(',') : tokens.slice(1, 1 + flags.length);
  const filenameStart = commaSeparated ? 2 : 1 + flags.length;
  if (params.length !== flags.length || params.some((value) => !/^[+-]?\d+$/u.test(value))) return undefined;
  // Parameter count determines the boundary; the remaining filename may contain spaces.
  const filename = tokens.slice(filenameStart).join(' ');
  if (filename.length === 0) return undefined;
  const out: BMSExWAV = { filename };
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    const valueRaw = params[index];
    if (valueRaw === undefined) break;
    const value = Number.parseInt(valueRaw.trim(), 10);
    if (!Number.isSafeInteger(value)) return undefined;
    if (flag === 'p') out.pan = value;
    else if (flag === 'v') out.volumeMillibels = value;
    else if (flag === 'f') out.frequencyHz = value;
  }
  return out;
}

/**
 * Maps a millibel volume value (`#EXWAVxx v` parameter, `1/100 dB`) to a 0..N linear gain multiplier. `0 mB`
 * round-trips to `1.0` (unity); negative values attenuate; positive values boost. We clamp the output below `8.0` (≈
 * +18 dB) so a malformed chart can't blow the bus, and at `0` so very-negative inputs collapse to silence rather than
 * producing a denormal.
 *
 * The unit is the millibel (a hundredth of a decibel), as in DirectSound.
 * `v -200` is −2 dB and `v -600` is −6 dB. Playback collectors enforce the dialect's attenuation-only bounds.
 */
export function exWAVVolumeMillibelsToLinearGain(millibels: number): number {
  if (!Number.isFinite(millibels)) return 1;
  const dB = millibels / 100;
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
    if (parsed.volumeMillibels === undefined) continue;
    // nanasigroove defines attenuation only; its minimum is explicitly silent.
    const volume = Math.max(-10000, Math.min(0, parsed.volumeMillibels));
    out.set(slot, volume === -10000 ? 0 : exWAVVolumeMillibelsToLinearGain(volume));
  }
  return out;
}

/**
 * Effective sample filenames. A valid EXWAV definition owns its shared WAV slot, including when WAV is also present.
 * This is Be-Music's explicit cross-dialect precedence; invalid EXWAV leaves the ordinary WAV definition intact.
 * Neither the authored resource map nor the raw EXWAV declarations are mutated.
 */
export function resolveBmsWAVResources(json: Pick<BeMusicJSON, 'resources' | 'bms'>): Record<string, string> {
  const resources = { ...json.resources.wav };
  for (const [key, raw] of Object.entries(json.bms.exWAV)) {
    const parsed = parseBMSExWAV(raw);
    if (parsed) resources[key] = parsed.filename;
  }
  return resources;
}

/**
 * Parameter byte for a `#WAVCMD pp xx vv` entry.
 *
 * - `'pitch'` (`pp = 00`) — relative chromatic pitch, `0..127`, with 60 as unity.
 * - `'volume'` (`pp = 01`) — percentage volume, with 100 as unity; values above 100 amplify.
 * - `'duration'` (`pp = 02`) — playback time in 0.5 ms units; zero plays to the original end.
 *
 * Source: http://harinezumi.s14.xrea.com/download/mbm.txt (MacBeat MOD specification, 2000-04-19).
 */
export type BmsWAVCmdParam = 'pitch' | 'volume' | 'duration';

export interface BmsWAVCmdEntry {
  param: BmsWAVCmdParam;
  /** Slot id (`#WAVxx`), normalized via `normalizeObjectKey`. */
  slot: string;
  /**
   * Raw integer value as written in the chart. The interpretation depends on `param` — see {@link BmsWAVCmdParam}.
   * Volume is a percentage; convert to a gain multiplier via {@link wavCmdVolumePercentToLinearGain}.
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

/** Convert MacBeat percentage volume to linear gain. Values above 100 amplify; negative inputs mute. */
export function wavCmdVolumePercentToLinearGain(percent: number): number {
  return Number.isFinite(percent) ? Math.max(0, percent) / 100 : 1;
}

/**
 * Parses one `#WAVCMD pp xx vv` line. Whitespace-separated tokens: - `pp` (parameter byte): `00`/`01`/`02`
 * (pitch/volume/duration). - `xx` (slot id): two-character base-36 (or base-62) id matching a `#WAVxx` declaration.
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
      param = 'duration';
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
 * the same slot the LAST one wins. This is Be-Music's policy; MacBeat leaves duplication undefined.
 *
 * Pitch / duration lines are intentionally skipped — they require sample-graph wiring that
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
      out.set(entry.slot, wavCmdVolumePercentToLinearGain(entry.value));
    }
  }
  return out;
}

/** Per-slot authored volume, including exact intrinsic gain retained by composed Be-Music JSON charts. */
export function collectBmsWAVVolumeMultipliers(json: Pick<BeMusicJSON, 'bms' | 'resources'>): Map<string, number> {
  const result = collectBmsWAVCmdVolumeMultipliers(json.bms.wavCmds, json.bms.base ?? 36);
  for (const [key, gain] of collectBMSExWAVVolumeMultipliers(json.bms.exWAV))
    result.set(key, (result.get(key) ?? 1) * gain);
  for (const [key, gain] of Object.entries(json.resources.wavGain ?? {})) {
    if (!Number.isFinite(gain) || gain < 0) throw new RangeError(`Invalid intrinsic WAV gain for slot ${key}`);
    const combined = (result.get(key) ?? 1) * gain;
    if (!Number.isFinite(combined)) throw new RangeError(`Combined WAV gain overflow for slot ${key}`);
    result.set(key, combined);
  }
  return result;
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
