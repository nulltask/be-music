import { normalizeAsciiBase36Code } from '@be-music/utils';

export const BMS_JSON_FORMAT = 'be-music-json/0.1.0' as const;

export type BeMusicSourceFormat = 'bms' | 'bmson' | 'json';

export interface BeMusicMetadata {
  title?: string;
  subtitle?: string;
  artist?: string;
  genre?: string;
  comment?: string;
  stageFile?: string;
  playLevel?: number;
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

export interface BmsonExtensions {
  version?: string;
  lines: number[];
  info: BmsonInfoExtensions;
  bga: BmsonBgaExtensions;
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

export interface BmsExtensions {
  controlFlow: BmsControlFlowEntry[];
  objectLines: BmsObjectLineEntry[];
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
  exWav: Record<string, string>;
  exBmp: Record<string, string>;
  bga: Record<string, string>;
  scroll: Record<string, number>;
  poorBga?: string;
  swBga: Record<string, string>;
  videoFile?: string;
  midiFile?: string;
  materials?: string;
  divideProp?: string;
  charset?: string;
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
}

export interface BeatResolver {
  measureToBeat: (measure: number, position?: number) => number;
  eventToBeat: (event: BeMusicEvent) => number;
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
const BMS_LONG_NOTE_PLAYABLE_1P = ['11', '12', '13', '14', '15', '16', '17', '18', '19'] as const;
const BMS_LONG_NOTE_PLAYABLE_2P = ['21', '22', '23', '24', '25', '26', '27', '28', '29'] as const;
const PACKED_CHANNEL_01 = 0x3031;
const PACKED_CHANNEL_03 = 0x3033;
const PACKED_CHANNEL_08 = 0x3038;
const PACKED_CHANNEL_09 = 0x3039;
const PACKED_CHANNEL_SC = 0x5343;

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
      objectLines: [],
      lnObjs: [],
      exRank: {},
      argb: {},
      stp: [],
      changeOption: {},
      exWav: {},
      exBmp: {},
      bga: {},
      scroll: {},
      swBga: {},
    },
    bmson: {
      lines: [],
      info: {},
      bga: {
        header: [],
        events: [],
        layerEvents: [],
        poorEvents: [],
      },
    },
  };
}

export function cloneJson(json: BeMusicJson): BeMusicJson {
  const sourceMeasures = json.measures;
  const measures = new Array<BeMusicMeasure>(sourceMeasures.length);
  for (let index = 0; index < sourceMeasures.length; index += 1) {
    const measure = sourceMeasures[index]!;
    measures[index] = { index: measure.index, length: measure.length };
  }

  const sourceEvents = json.events;
  const events = new Array<BeMusicEvent>(sourceEvents.length);
  for (let index = 0; index < sourceEvents.length; index += 1) {
    events[index] = cloneEvent(sourceEvents[index]!);
  }

  const sourceControlFlow = json.bms.controlFlow;
  const controlFlow = new Array<BmsControlFlowEntry>(sourceControlFlow.length);
  for (let index = 0; index < sourceControlFlow.length; index += 1) {
    controlFlow[index] = cloneControlFlowEntry(sourceControlFlow[index]!);
  }

  const sourceObjectLines = json.bms.objectLines;
  const objectLines = new Array<BmsObjectLineEntry>(sourceObjectLines.length);
  for (let index = 0; index < sourceObjectLines.length; index += 1) {
    objectLines[index] = cloneBmsObjectLineEntry(sourceObjectLines[index]!);
  }

  const sourceLines = json.bmson.lines;
  const lines = new Array<number>(sourceLines.length);
  for (let index = 0; index < sourceLines.length; index += 1) {
    lines[index] = sourceLines[index]!;
  }

  const sourceHeader = json.bmson.bga.header;
  const header = new Array<BmsonBgaHeaderEntry>(sourceHeader.length);
  for (let index = 0; index < sourceHeader.length; index += 1) {
    const entry = sourceHeader[index]!;
    header[index] = { id: entry.id, name: entry.name };
  }

  const sourceBgaEvents = json.bmson.bga.events;
  const bgaEvents = new Array<BmsonBgaEvent>(sourceBgaEvents.length);
  for (let index = 0; index < sourceBgaEvents.length; index += 1) {
    const event = sourceBgaEvents[index]!;
    bgaEvents[index] = { y: event.y, id: event.id };
  }

  const sourceLayerEvents = json.bmson.bga.layerEvents;
  const layerEvents = new Array<BmsonBgaEvent>(sourceLayerEvents.length);
  for (let index = 0; index < sourceLayerEvents.length; index += 1) {
    const event = sourceLayerEvents[index]!;
    layerEvents[index] = { y: event.y, id: event.id };
  }

  const sourcePoorEvents = json.bmson.bga.poorEvents;
  const poorEvents = new Array<BmsonBgaEvent>(sourcePoorEvents.length);
  for (let index = 0; index < sourcePoorEvents.length; index += 1) {
    const event = sourcePoorEvents[index]!;
    poorEvents[index] = { y: event.y, id: event.id };
  }

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
      objectLines,
      lnObjs: json.bms.lnObjs ? [...json.bms.lnObjs] : undefined,
      exRank: { ...json.bms.exRank },
      argb: { ...json.bms.argb },
      stp: [...json.bms.stp],
      changeOption: { ...json.bms.changeOption },
      exWav: { ...json.bms.exWav },
      exBmp: { ...json.bms.exBmp },
      bga: { ...json.bms.bga },
      scroll: { ...json.bms.scroll },
      swBga: { ...json.bms.swBga },
    },
    bmson: {
      ...json.bmson,
      lines,
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
  };
}

export function normalizeObjectKey(value: string): string {
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
    // Measures beyond the defined range default to length=1 (4 beats).
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

export function isTempoChannel(channel: string): boolean {
  if (channel.length === 2) {
    const high = channel.charCodeAt(0);
    const low = channel.charCodeAt(1);
    if (high === 0x30 && (low === 0x33 || low === 0x38)) {
      return true;
    }
  }
  const packed = tryPackChannel(channel);
  if (packed >= 0) {
    return packed === PACKED_CHANNEL_03 || packed === PACKED_CHANNEL_08;
  }
  return isTempoNormalizedChannel(resolveNormalizedChannelForPredicate(channel));
}

export function isStopChannel(channel: string): boolean {
  if (channel.length === 2 && channel.charCodeAt(0) === 0x30 && channel.charCodeAt(1) === 0x39) {
    return true;
  }
  const packed = tryPackChannel(channel);
  if (packed >= 0) {
    return packed === PACKED_CHANNEL_09;
  }
  return isStopNormalizedChannel(resolveNormalizedChannelForPredicate(channel));
}

export function isScrollChannel(channel: string): boolean {
  if (channel.length === 2) {
    const high = channel.charCodeAt(0) & 0xdf;
    const low = channel.charCodeAt(1) & 0xdf;
    if (high === 0x53 && low === 0x43) {
      return true;
    }
  }
  const packed = tryPackChannel(channel);
  if (packed >= 0) {
    return packed === PACKED_CHANNEL_SC;
  }
  return isScrollNormalizedChannel(resolveNormalizedChannelForPredicate(channel));
}

export function isLandmineChannel(channel: string): boolean {
  if (channel.length === 2) {
    const high = channel.charCodeAt(0) & 0xdf;
    const low = channel.charCodeAt(1);
    if ((high === 0x44 || high === 0x45) && low >= 0x31 && low <= 0x39) {
      return true;
    }
  }
  const packed = tryPackChannel(channel);
  if (packed >= 0) {
    return isPackedLandmineChannel(packed);
  }
  return isLandmineNormalizedChannel(resolveNormalizedChannelForPredicate(channel));
}

export function isSampleTriggerChannel(channel: string): boolean {
  if (channel.length === 2) {
    const highCode = channel.charCodeAt(0);
    const lowCode = channel.charCodeAt(1);
    if (highCode === 0x30) {
      return lowCode === 0x31;
    }
    if ((highCode & 0xdf) === 0x53 && (lowCode & 0xdf) === 0x43) {
      return false;
    }
    return true;
  }
  const packed = tryPackChannel(channel);
  if (packed >= 0) {
    return isPackedSampleTriggerChannel(packed);
  }
  return isSampleTriggerNormalizedChannel(resolveNormalizedChannelForPredicate(channel));
}

export function isPlayableChannel(channel: string): boolean {
  if (channel.length === 2) {
    const high = channel.charCodeAt(0);
    const low = channel.charCodeAt(1);
    if ((high === 0x31 || high === 0x32) && low >= 0x31 && low <= 0x39) {
      return true;
    }
  }
  const packed = tryPackChannel(channel);
  if (packed >= 0) {
    return isPackedPlayableChannel(packed);
  }
  return isPlayableNormalizedChannel(resolveNormalizedChannelForPredicate(channel));
}

export function isBmsLongNoteChannel(channel: string): boolean {
  if (channel.length === 2) {
    const high = channel.charCodeAt(0);
    const low = channel.charCodeAt(1);
    if ((high === 0x35 || high === 0x36) && low >= 0x31 && low <= 0x39) {
      return true;
    }
  }
  const packed = tryPackChannel(channel);
  if (packed >= 0) {
    return isPackedBmsLongNoteChannel(packed);
  }
  return isBmsLongNoteNormalizedChannel(resolveNormalizedChannelForPredicate(channel));
}

export function mapBmsLongNoteChannelToPlayable(channel: string): string | undefined {
  const packed = tryPackChannel(channel);
  if (packed >= 0) {
    if (!isPackedBmsLongNoteChannel(packed)) {
      return undefined;
    }
    const low = packed & 0xff;
    const laneIndex = low - 0x31;
    return ((packed >> 8) & 0xff) === 0x35 ? BMS_LONG_NOTE_PLAYABLE_1P[laneIndex] : BMS_LONG_NOTE_PLAYABLE_2P[laneIndex];
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

  const longNoteEvents: ResolvedBmsLongNoteEvent[] = [];
  const sortedEvents = sortEvents(json.events);
  for (const event of sortedEvents) {
    const sourceChannel = normalizeChannel(event.channel);
    const mapped = mapBmsLongNoteNormalizedChannelToPlayable(sourceChannel);
    if (!mapped) {
      continue;
    }
    longNoteEvents.push({ event, sourceChannel, channel: mapped });
  }
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

  const lnObjValues = resolveLnobjValues(json);
  if (lnObjValues.size === 0) {
    return {
      startToEndBeat: new Map(),
      endEvents: new Set(),
    };
  }

  const beatResolver = createBeatResolver(json);
  const legacyLongNoteTicks = collectLegacyLongNoteTickKeys(json);
  const pendingStartByChannel = new Map<string, { event: BeMusicEvent; beat: number }>();
  const startToEndBeat = new Map<BeMusicEvent, number>();
  const endEvents = new Set<BeMusicEvent>();

  const sortedEvents = sortEvents(json.events);
  for (const event of sortedEvents) {
    const normalizedChannel = normalizeChannel(event.channel);
    if (!isPlayableNormalizedChannel(normalizedChannel)) {
      continue;
    }
    if (legacyLongNoteTicks.has(createNormalizedChannelTickKey(normalizedChannel, event))) {
      pendingStartByChannel.delete(normalizedChannel);
      continue;
    }

    const beat = beatResolver.eventToBeat(event);
    const value = normalizeObjectKey(event.value);
    if (lnObjValues.has(value)) {
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

function resolveLnobjValues(json: BeMusicJson): Set<string> {
  const values = new Set<string>();
  for (const candidate of json.bms.lnObjs ?? []) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      values.add(normalizeObjectKey(candidate));
    }
  }
  return values;
}

function collectLegacyLongNoteTickKeys(json: BeMusicJson): Set<string> {
  const keys = new Set<string>();
  for (const event of json.events) {
    const sourceChannel = normalizeChannel(event.channel);
    const playableChannel = mapBmsLongNoteNormalizedChannelToPlayable(sourceChannel);
    if (!playableChannel) {
      continue;
    }
    keys.add(createNormalizedChannelTickKey(playableChannel, event));
  }
  return keys;
}

function createChannelTickKey(channel: string, event: BeMusicEvent): string {
  return createNormalizedChannelTickKey(normalizeChannel(channel), event);
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
  const eventsByChannel = new Map<string, ResolvedBmsLongNoteEvent[]>();

  for (const event of events) {
    const bucket = eventsByChannel.get(event.sourceChannel) ?? [];
    bucket.push(event);
    eventsByChannel.set(event.sourceChannel, bucket);
  }

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
  for (const item of events) {
    if (item.sourceChannel.startsWith('6')) {
      return 2;
    }
  }

  const eventsByChannel = new Map<string, ResolvedBmsLongNoteEvent[]>();
  for (const item of events) {
    const bucket = eventsByChannel.get(item.sourceChannel) ?? [];
    bucket.push(item);
    eventsByChannel.set(item.sourceChannel, bucket);
  }

  for (const channelEvents of eventsByChannel.values()) {
    let previous: BeMusicEvent | undefined;
    for (const item of channelEvents) {
      if (
        previous &&
        normalizeObjectKey(previous.value) === normalizeObjectKey(item.event.value) &&
        isBmsLongNoteType2Continuation(previous, item.event)
      ) {
        return 2;
      }
      previous = item.event;
    }
  }

  return 1;
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

function parseHexDigit(code: number): number {
  if (code >= 0x30 && code <= 0x39) {
    return code - 0x30;
  }
  if (code >= 0x41 && code <= 0x46) {
    return code - 0x41 + 10;
  }
  if (code >= 0x61 && code <= 0x66) {
    return code - 0x61 + 10;
  }
  return -1;
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

function isPackedLandmineChannel(packed: number): boolean {
  const high = (packed >> 8) & 0xff;
  if (high !== 0x44 && high !== 0x45) {
    return false;
  }
  const low = packed & 0xff;
  return low >= 0x31 && low <= 0x39;
}

function isPackedSampleTriggerChannel(packed: number): boolean {
  if (packed === PACKED_CHANNEL_01) {
    return true;
  }
  if (((packed >> 8) & 0xff) === 0x30) {
    return false;
  }
  return packed !== PACKED_CHANNEL_03 && packed !== PACKED_CHANNEL_08 && packed !== PACKED_CHANNEL_09 && packed !== PACKED_CHANNEL_SC;
}

function isPackedPlayableChannel(packed: number): boolean {
  if (!isPackedSampleTriggerChannel(packed)) {
    return false;
  }
  const high = (packed >> 8) & 0xff;
  return high === 0x31 || high === 0x32;
}

function isPackedBmsLongNoteChannel(packed: number): boolean {
  const low = packed & 0xff;
  if (low < 0x31 || low > 0x39) {
    return false;
  }
  const high = (packed >> 8) & 0xff;
  return high === 0x35 || high === 0x36;
}

function isTempoNormalizedChannel(normalized: string): boolean {
  return normalized === '03' || normalized === '08';
}

function isStopNormalizedChannel(normalized: string): boolean {
  return normalized === '09';
}

function isScrollNormalizedChannel(normalized: string): boolean {
  return normalized === 'SC';
}

function isLandmineNormalizedChannel(normalized: string): boolean {
  if (normalized.length !== 2) {
    return false;
  }
  const side = normalized.charCodeAt(0);
  if (side !== 0x44 && side !== 0x45) {
    return false;
  }
  const lane = normalized.charCodeAt(1);
  return lane >= 0x31 && lane <= 0x39;
}

function isSampleTriggerNormalizedChannel(normalized: string): boolean {
  if (normalized === '01') {
    return true;
  }
  if (normalized.length === 0 || normalized.charCodeAt(0) === 0x30) {
    return false;
  }
  return !isTempoNormalizedChannel(normalized) && !isStopNormalizedChannel(normalized) && !isScrollNormalizedChannel(normalized);
}

function isPlayableNormalizedChannel(normalized: string): boolean {
  if (!isSampleTriggerNormalizedChannel(normalized)) {
    return false;
  }
  const side = normalized.charCodeAt(0);
  return side === 0x31 || side === 0x32;
}

function isBmsLongNoteNormalizedChannel(normalized: string): boolean {
  if (normalized.length !== 2) {
    return false;
  }
  const lane = normalized.charCodeAt(1);
  if (lane < 0x31 || lane > 0x39) {
    return false;
  }
  const side = normalized.charCodeAt(0);
  return side === 0x35 || side === 0x36;
}

function mapBmsLongNoteNormalizedChannelToPlayable(normalized: string): string | undefined {
  if (!isBmsLongNoteNormalizedChannel(normalized)) {
    return undefined;
  }
  const laneIndex = normalized.charCodeAt(1) - 0x31;
  return normalized.charCodeAt(0) === 0x35 ? BMS_LONG_NOTE_PLAYABLE_1P[laneIndex] : BMS_LONG_NOTE_PLAYABLE_2P[laneIndex];
}
