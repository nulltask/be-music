import { normalizeAsciiBase36Code, normalizeAsciiBase62Code } from '@be-music/utils/core';

export const BMS_JSON_FORMAT = 'be-music-json/0.1.0' as const;

export type BeMusicSourceFormat = 'bms' | 'bmson' | 'json';

export type BeMusicPlayLevel = number | string;

export interface BeMusicMetadata {
  title?: string;
  subtitle?: string;
  artist?: string;
  genre?: string;
  comment?: string;
  /** `#STAGEFILE`: full-size loading screen image. */
  stageFile?: string;
  /** `#BACKBMP`: select-screen banner / preview image (typically 256×256). */
  backBmp?: string;
  /** `#BANNER`: small banner image (typically 300×80). */
  banner?: string;
  playLevel?: BeMusicPlayLevel;
  rank?: number;
  total?: number;
  difficulty?: number;
  bpm: number;
  extras: Record<string, string>;
}

export interface BmsResources {
  wav: Record<string, string>;
  bmp: Record<string, string>;
  bpm: Record<string, number>;
  stop: Record<string, number>;
  text: Record<string, string>;
}

export interface BeMusicMeasure {
  index: number;
  length: number;
}

export type BeMusicPosition = readonly [numerator: number, denominator: number];

export interface BmsonEventExtensions {
  l?: number;
  c?: boolean;
  /**
   * Per-mine gauge damage in 0..100, sourced from a bmson `key_channels[].notes[].damage` entry. Only set on mine
   * events emitted from `key_channels`; absent on regular `sound_channels`-derived note events. Consumers that don't
   * read this field fall through to the BMS-side default (`<value>/2` in base-36, floor 4).
   */
  damage?: number;
}

export interface BeMusicEvent {
  measure: number;
  channel: string;
  position: BeMusicPosition;
  value: string;
  bmson?: BmsonEventExtensions;
}

export interface BmsonInfoExtensions {
  title?: string;
  subtitle?: string;
  artist?: string;
  genre?: string;
  /**
   * Contributor list per the bmson 1.0.0 spec — entries are authored as `"key:value"` strings (e.g. `"illust:foo"`,
   * `"obj:bar"`). Stored verbatim; consumers that want the structured `{ role, name }` form can run each entry through
   * {@link parseBmsonSubartist}.
   */
  subartists?: string[];
  chartName?: string;
  level?: number;
  initBpm?: number;
  resolution?: number;
  modeHint?: string;
  judgeRank?: number;
  total?: number;
  backImage?: string;
  eyecatchImage?: string;
  bannerImage?: string;
  previewMusic?: string;
}

export interface BmsonBgaHeaderEntry {
  id: number;
  name: string;
}

export interface BmsonBgaEvent {
  y: number;
  id: number;
}

export interface BmsonBgaExtensions {
  header: BmsonBgaHeaderEntry[];
  events: BmsonBgaEvent[];
  layerEvents: BmsonBgaEvent[];
  poorEvents: BmsonBgaEvent[];
}

export interface BmsonBpmEventEntry {
  y: number;
  bpm: number;
}

export interface BmsonStopEventEntry {
  y: number;
  duration: number;
}

export interface BmsonSoundNoteEntry {
  x?: number;
  y: number;
  l?: number;
  c?: boolean;
}

export interface BmsonSoundChannelEntry {
  name: string;
  notes: BmsonSoundNoteEntry[];
}

/**
 * beatoraja extension — `key_channels[].notes[]` shape. Same timing / lane / continuation fields as a regular
 * sound-channel note, plus a `damage` value (0..100 gauge percent) that carries the per-mine damage authoring intent.
 */
export interface BmsonKeyNoteEntry {
  x?: number;
  y: number;
  l?: number;
  c?: boolean;
  damage?: number;
}

export interface BmsonKeyChannelEntry {
  name: string;
  notes: BmsonKeyNoteEntry[];
}

export interface BmsonExtensions {
  version?: string;
  info: BmsonInfoExtensions;
  bga: BmsonBgaExtensions;
  /**
   * `true` when the bmson source authored an explicit `lines: []` (intentionally barline-less, the bmson 1.0.0 spec's
   * "100 % minimoo-G effect"). Distinct from "lines missing" (`undefined` / not present), which the spec treats as
   * "assume 4/4 and generate a barline every 4 quarter notes".
   *
   * Only ever `true` for bmson charts; BMS / json sources leave the field undefined and the renderer falls back to its
   * derive-from-events default.
   */
  barlinesSuppressed?: boolean;
}

export type BmsControlFlowCommand =
  | 'RANDOM'
  | 'SETRANDOM'
  | 'IF'
  | 'ELSEIF'
  | 'ELSE'
  | 'ENDIF'
  | 'ENDRANDOM'
  | 'SWITCH'
  | 'SETSWITCH'
  | 'CASE'
  | 'SKIP'
  | 'DEF'
  | 'ENDSW';

export interface BmsControlFlowDirectiveEntry {
  kind: 'directive';
  command: BmsControlFlowCommand;
  value?: string;
}

export interface BmsControlFlowHeaderEntry {
  kind: 'header';
  command: string;
  value: string;
  /**
   * Case-preserved command. Only set when the original source line had a case that differs from the uppercased
   * `command` — most commonly because the chart opted into the `#BASE 62` extension and the captured directive carries
   * a lowercase ID (e.g. `#WAV0a` inside a `#RANDOM` block). Replay paths use this to reconstruct the lowercase key; if
   * absent, callers fall back to `command` (= upper-cased) for case-insensitive base-36 charts.
   */
  commandRaw?: string;
}

export interface BmsControlFlowObjectEntry {
  kind: 'object';
  measure: number;
  channel: string;
  events: BeMusicEvent[];
  measureLength?: number;
}

export type BmsControlFlowEntry = BmsControlFlowDirectiveEntry | BmsControlFlowHeaderEntry | BmsControlFlowObjectEntry;

export interface BmsObjectLineEntry {
  measure: number;
  channel: string;
  events: BeMusicEvent[];
  measureLength?: number;
}

export type BmsSourceLineEntry = BmsControlFlowEntry;

export interface BmsExtensions {
  controlFlow: BmsControlFlowEntry[];
  preview?: string;
  lnType?: number;
  lnMode?: number;
  lnObjs?: string[];
  volWav?: number;
  defExRank?: number;
  exRank: Record<string, string>;
  argb: Record<string, string>;
  player?: number;
  pathWav?: string;
  baseBpm?: number;
  stp: string[];
  option?: string;
  changeOption: Record<string, string>;
  wavCmd?: string;
  /**
   * Every `#WAVCMD pp xx vv` line as the raw post-directive text (one entry per source line, in declaration order). The
   * legacy `wavCmd` field above retains the FIRST value only for backward compatibility — `wavCmds` is the
   * spec-faithful representation, since real-world charts emit one line per `(parameter, slot)` pair. Consumers should
   * iterate `wavCmds` and parse via `@be-music/chart`'s `parseBmsWavCmd` helper.
   */
  wavCmds: string[];
  exWav: Record<string, string>;
  exBmp: Record<string, string>;
  bga: Record<string, string>;
  scroll: Record<string, number>;
  speed: Record<string, number>;
  poorBga?: string;
  swBga: Record<string, string>;
  videoFile?: string;
  midiFile?: string;
  materials?: string;
  divideProp?: string;
  charset?: string;
  /**
   * `#BASE` directive — the radix used for object IDs (`#WAVxx`, `#BMPxx`, `#BPMxx`, channel object tokens, …). Default
   * is base 36 (case-insensitive `0-9A-Z`). The value `62` opts into the beatoraja-style base-62 extension where
   * lowercase `a-z` is a separate ID space (so `#WAV0a` and `#WAV0A` reference different sounds). Only `36` and `62`
   * are recognised; the field is omitted for the default base-36 case.
   */
  base?: 62;
}

export interface BmsPreservation {
  sourceLines: BmsSourceLineEntry[];
  objectLines: BmsObjectLineEntry[];
}

export interface BmsonPreservation {
  lines: number[];
  bpmEvents: BmsonBpmEventEntry[];
  stopEvents: BmsonStopEventEntry[];
  soundChannels: BmsonSoundChannelEntry[];
}

export interface BeMusicPreservation {
  bms: BmsPreservation;
  bmson: BmsonPreservation;
}

export interface BeMusicJson {
  format: typeof BMS_JSON_FORMAT;
  sourceFormat: BeMusicSourceFormat;
  metadata: BeMusicMetadata;
  resources: BmsResources;
  measures: BeMusicMeasure[];
  events: BeMusicEvent[];
  bms: BmsExtensions;
  bmson: BmsonExtensions;
  preservation: BeMusicPreservation;
}

export const DEFAULT_BPM = 130;

const BASE36_UPPER_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BASE36_PAD_1_DIVISOR = 36;
const BASE36_PAD_2_DIVISOR = BASE36_PAD_1_DIVISOR * BASE36_PAD_1_DIVISOR;
const BASE36_PAD_2_TABLE = Array.from({ length: BASE36_PAD_2_DIVISOR }, (_value, index) => {
  const high = Math.floor(index / BASE36_PAD_1_DIVISOR);
  const low = index % BASE36_PAD_1_DIVISOR;
  return `${BASE36_UPPER_DIGITS[high]}${BASE36_UPPER_DIGITS[low]}`;
});

export function createEmptyJson(sourceFormat: BeMusicSourceFormat = 'bms'): BeMusicJson {
  return {
    format: BMS_JSON_FORMAT,
    sourceFormat,
    metadata: {
      bpm: DEFAULT_BPM,
      extras: {},
    },
    resources: {
      wav: {},
      bmp: {},
      bpm: {},
      stop: {},
      text: {},
    },
    measures: [],
    events: [],
    bms: {
      controlFlow: [],
      lnObjs: [],
      exRank: {},
      argb: {},
      stp: [],
      wavCmds: [],
      changeOption: {},
      exWav: {},
      exBmp: {},
      bga: {},
      scroll: {},
      speed: {},
      swBga: {},
    },
    bmson: {
      info: {},
      bga: {
        header: [],
        events: [],
        layerEvents: [],
        poorEvents: [],
      },
    },
    preservation: {
      bms: {
        sourceLines: [],
        objectLines: [],
      },
      bmson: {
        lines: [],
        bpmEvents: [],
        stopEvents: [],
        soundChannels: [],
      },
    },
  };
}

export function cloneJson(json: BeMusicJson): BeMusicJson {
  const measures = json.measures.map((measure) => ({ index: measure.index, length: measure.length }));
  const events = json.events.map(cloneEvent);
  const controlFlow = json.bms.controlFlow.map(cloneControlFlowEntry);
  const bmsSourceLines = json.preservation.bms.sourceLines.map(cloneControlFlowEntry);
  const objectLines = json.preservation.bms.objectLines.map(cloneBmsObjectLineEntry);
  const lines = [...json.preservation.bmson.lines];
  const bpmEvents = json.preservation.bmson.bpmEvents.map((event) => ({ y: event.y, bpm: event.bpm }));
  const stopEvents = json.preservation.bmson.stopEvents.map((event) => ({ y: event.y, duration: event.duration }));
  const soundChannels = json.preservation.bmson.soundChannels.map((channel) => ({
    name: channel.name,
    notes: channel.notes.map((note) => ({ ...note })),
  }));
  const header = json.bmson.bga.header.map((entry) => ({ id: entry.id, name: entry.name }));
  const bgaEvents = json.bmson.bga.events.map((event) => ({ y: event.y, id: event.id }));
  const layerEvents = json.bmson.bga.layerEvents.map((event) => ({ y: event.y, id: event.id }));
  const poorEvents = json.bmson.bga.poorEvents.map((event) => ({ y: event.y, id: event.id }));

  return {
    format: json.format,
    sourceFormat: json.sourceFormat,
    metadata: {
      ...json.metadata,
      extras: { ...json.metadata.extras },
    },
    resources: {
      wav: { ...json.resources.wav },
      bmp: { ...json.resources.bmp },
      bpm: { ...json.resources.bpm },
      stop: { ...json.resources.stop },
      text: { ...json.resources.text },
    },
    measures,
    events,
    bms: {
      ...json.bms,
      controlFlow,
      lnObjs: json.bms.lnObjs ? [...json.bms.lnObjs] : undefined,
      exRank: { ...json.bms.exRank },
      argb: { ...json.bms.argb },
      stp: [...json.bms.stp],
      wavCmds: [...json.bms.wavCmds],
      changeOption: { ...json.bms.changeOption },
      exWav: { ...json.bms.exWav },
      exBmp: { ...json.bms.exBmp },
      bga: { ...json.bms.bga },
      scroll: { ...json.bms.scroll },
      speed: { ...json.bms.speed },
      swBga: { ...json.bms.swBga },
    },
    bmson: {
      ...json.bmson,
      info: {
        ...json.bmson.info,
        subartists: json.bmson.info.subartists ? [...json.bmson.info.subartists] : undefined,
      },
      bga: {
        header,
        events: bgaEvents,
        layerEvents,
        poorEvents,
      },
    },
    preservation: {
      bms: {
        sourceLines: bmsSourceLines,
        objectLines,
      },
      bmson: {
        lines,
        bpmEvents,
        stopEvents,
        soundChannels,
      },
    },
  };
}

/**
 * Normalises a 2-character BMS object ID for storage. With the default `base = 36`, lowercase `a-z` is folded to
 * uppercase so `#WAV0a` and `#WAV0A` collapse to the same key. With `base = 62` (the beatoraja `#BASE 62` extension),
 * case is preserved — they become distinct IDs.
 *
 * Always returns a 2-character string. Single-character / empty / malformed inputs are padded or truncated rather than
 * raising because the parser already filters at the syntactic level; this is the post-syntactic normaliser.
 */
/**
 * Structured form of a `bmson info.subartists[]` entry. The spec authors entries as `"role:name"` strings; consumers
 * that want to group / filter contributors by role (illustrator, objet author, lyricist, …) split each entry through
 * {@link parseBmsonSubartist} and read the structured pair instead of the raw string.
 */
export interface BmsonSubartistEntry {
  /** The lower-cased role tag, or `undefined` if the entry is just a name. */
  role?: string;
  /** Contributor name with surrounding whitespace trimmed. */
  name: string;
}

/**
 * Splits a `subartists[]` entry on the first `:` per the bmson 1.0.0 convention. Whitespace around either half is
 * trimmed, and the role half is lower-cased so a downstream lookup (e.g. `byRole.get('illust')`) is case-insensitive
 * against common variants (`Illust:` / `ILLUST:` / `illust:`).
 *
 * Entries without a `:` (legacy free-form names) come back with `role` undefined and the whole string as `name`.
 */
export function parseBmsonSubartist(entry: string): BmsonSubartistEntry {
  if (typeof entry !== 'string') {
    return { name: '' };
  }
  const colon = entry.indexOf(':');
  if (colon < 0) {
    return { name: entry.trim() };
  }
  const role = entry.slice(0, colon).trim().toLowerCase();
  const name = entry.slice(colon + 1).trim();
  if (role.length === 0) {
    return { name };
  }
  return { role, name };
}

export function normalizeObjectKey(value: string, base: 36 | 62 = 36): string {
  if (base === 62) {
    return normalizeObjectKeyBase62(value);
  }
  if (value.length === 2) {
    const code0 = normalizeAsciiBase36CodeFast(value.charCodeAt(0));
    const code1 = normalizeAsciiBase36CodeFast(value.charCodeAt(1));
    if (code0 >= 0 && code1 >= 0) {
      return String.fromCharCode(code0, code1);
    }
  }
  if (value.length === 1) {
    const code = normalizeAsciiBase36CodeFast(value.charCodeAt(0));
    if (code >= 0) {
      return String.fromCharCode(0x30, code);
    }
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return '00';
  }
  if (trimmed.length === 1) {
    const sourceCode = trimmed.charCodeAt(0);
    const code = normalizeAsciiBase36Code(sourceCode);
    if (code >= 0) {
      return code === sourceCode ? `0${trimmed}` : `0${String.fromCharCode(code)}`;
    }
    return `0${trimmed.toUpperCase()}`;
  }
  if (trimmed.length === 2) {
    const sourceCode0 = trimmed.charCodeAt(0);
    const sourceCode1 = trimmed.charCodeAt(1);
    const code0 = normalizeAsciiBase36Code(sourceCode0);
    const code1 = normalizeAsciiBase36Code(sourceCode1);
    if (code0 >= 0 && code1 >= 0) {
      if (code0 === sourceCode0 && code1 === sourceCode1) {
        return trimmed;
      }
      return String.fromCharCode(code0, code1);
    }
    return trimmed.toUpperCase();
  }
  return trimmed.toUpperCase().slice(0, 2);
}

function normalizeObjectKeyBase62(value: string): string {
  // Fast path: already 2 ASCII chars in `[0-9A-Za-z]`. Returned verbatim — no case folding in base-62 mode.
  if (value.length === 2) {
    const code0 = normalizeAsciiBase62Code(value.charCodeAt(0));
    const code1 = normalizeAsciiBase62Code(value.charCodeAt(1));
    if (code0 >= 0 && code1 >= 0) {
      return value;
    }
  }
  if (value.length === 1) {
    const code = normalizeAsciiBase62Code(value.charCodeAt(0));
    if (code >= 0) {
      return `0${value}`;
    }
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return '00';
  }
  if (trimmed.length === 1) {
    const code = normalizeAsciiBase62Code(trimmed.charCodeAt(0));
    if (code >= 0) {
      return `0${trimmed}`;
    }
    // Out of base-62 range — fall back to the base-36 normaliser so callers still get a sensible 2-char key.
    return `0${trimmed.slice(0, 1).toUpperCase()}`;
  }
  if (trimmed.length === 2) {
    const code0 = normalizeAsciiBase62Code(trimmed.charCodeAt(0));
    const code1 = normalizeAsciiBase62Code(trimmed.charCodeAt(1));
    if (code0 >= 0 && code1 >= 0) {
      return trimmed;
    }
    // Mixed valid / invalid — uppercase as a deterministic fallback (matches the base-36 path's behaviour).
    return trimmed.toUpperCase();
  }
  return trimmed.slice(0, 2);
}

export function normalizeChannel(value: string): string {
  if (value.length === 2) {
    const code0 = normalizeAsciiBase36CodeFast(value.charCodeAt(0));
    const code1 = normalizeAsciiBase36CodeFast(value.charCodeAt(1));
    if (code0 >= 0 && code1 >= 0) {
      return String.fromCharCode(code0, code1);
    }
  }
  return normalizeObjectKey(value);
}

/**
 * Returns the radix the chart's object IDs should be interpreted under. `36` is the default (case-folded `0-9A-Z`);
 * `62` is the beatoraja `#BASE 62` extension (case-sensitive `0-9A-Za-z`).
 *
 * Use this everywhere an `event.value` / `#WAVxx`-style key is about to be looked up against `json.resources.wav`,
 * `json.resources.bpm`, etc. — passing the result through `normalizeObjectKey(value, base)` so the lookup honours the
 * chart's authored case-sensitivity.
 *
 * Accepts a partial (`Pick<...>`) chart so callers that only have a `bms` slice (e.g. preservation walks) can use the
 * same helper without rebuilding the full JSON.
 */
export function resolveBmsBase(json: { bms?: { base?: 36 | 62 } } | undefined): 36 | 62 {
  return json?.bms?.base === 62 ? 62 : 36;
}

export function intToBase36(value: number, pad = 2): string {
  if (!Number.isFinite(value) || value < 0) {
    return '0'.repeat(pad);
  }
  const normalized = Math.floor(value);
  if (pad === 1) {
    return BASE36_UPPER_DIGITS[normalized % BASE36_PAD_1_DIVISOR] ?? '0';
  }
  if (pad === 2) {
    return BASE36_PAD_2_TABLE[normalized % BASE36_PAD_2_DIVISOR] ?? '00';
  }
  const encoded = normalized.toString(36).toUpperCase();
  return encoded.padStart(pad, '0').slice(-pad);
}

export function ensureMeasure(json: BeMusicJson, index: number): BeMusicMeasure {
  const measureCount = json.measures.length;
  if (measureCount > 0) {
    const lastMeasure = json.measures[measureCount - 1]!;
    if (lastMeasure.index === index) {
      return lastMeasure;
    }
    if (lastMeasure.index < index) {
      const created: BeMusicMeasure = {
        index,
        length: 1,
      };
      json.measures.push(created);
      return created;
    }
  }
  for (let measureIndex = 0; measureIndex < json.measures.length; measureIndex += 1) {
    const measure = json.measures[measureIndex]!;
    if (measure.index === index) {
      return measure;
    }
  }
  const created: BeMusicMeasure = {
    index,
    length: 1,
  };
  json.measures.push(created);
  return created;
}

function cloneEvent(event: BeMusicEvent): BeMusicEvent {
  return {
    measure: event.measure,
    channel: event.channel,
    position: [event.position[0], event.position[1]],
    value: event.value,
    bmson: event.bmson ? { ...event.bmson } : undefined,
  };
}

function cloneControlFlowEntry(entry: BmsControlFlowEntry): BmsControlFlowEntry {
  if (entry.kind === 'object') {
    return {
      ...entry,
      events: entry.events.map(cloneEvent),
    };
  }
  return { ...entry };
}

function cloneBmsObjectLineEntry(entry: BmsObjectLineEntry): BmsObjectLineEntry {
  return {
    ...entry,
    events: entry.events.map(cloneEvent),
  };
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
