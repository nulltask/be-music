import { normalizeAsciiBase36Code } from '@be-music/utils';

export const BMS_JSON_FORMAT = 'be-music-json/0.1.0' as const;

export type BeMusicSourceFormat = 'bms' | 'bmson' | 'json';

export type BeMusicPlayLevel = number | string;

export interface BeMusicMetadata {
  title?: string;
  subtitle?: string;
  artist?: string;
  genre?: string;
  comment?: string;
  stageFile?: string;
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

export interface BmsonExtensions {
  version?: string;
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
  events?: BeMusicEvent[];
  data?: string;
  measureLength?: number;
}

export type BmsControlFlowEntry = BmsControlFlowDirectiveEntry | BmsControlFlowHeaderEntry | BmsControlFlowObjectEntry;

export interface BmsObjectLineEntry {
  measure: number;
  channel: string;
  events?: BeMusicEvent[];
  data?: string;
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
      events: entry.events?.map(cloneEvent),
    };
  }
  return { ...entry };
}

function cloneBmsObjectLineEntry(entry: BmsObjectLineEntry): BmsObjectLineEntry {
  return {
    ...entry,
    events: entry.events?.map(cloneEvent),
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
