import { compareFractions } from '@be-music/utils';

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

export interface BmsExtensions {
  controlFlow: BmsControlFlowEntry[];
  preview?: string;
  lnType?: number;
  lnMode?: number;
  lnObj?: string;
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

export interface MeasurePosition {
  measure: number;
  position: number;
}

export interface BeatResolver {
  measureToBeat: (measure: number, position?: number) => number;
  eventToBeat: (event: BeMusicEvent) => number;
}

export const DEFAULT_BPM = 120;

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
  return structuredClone(json);
}

export function normalizeObjectKey(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (normalized.length === 0) {
    return '00';
  }
  if (normalized.length === 1) {
    return `0${normalized}`;
  }
  return normalized.slice(0, 2);
}

export function normalizeChannel(value: string): string {
  return normalizeObjectKey(value);
}

export function intToBase36(value: number, pad = 2): string {
  if (!Number.isFinite(value) || value < 0) {
    return '0'.repeat(pad);
  }
  const encoded = Math.floor(value).toString(36).toUpperCase();
  return encoded.padStart(pad, '0').slice(-pad);
}

export function base36ToInt(value: string): number {
  const parsed = Number.parseInt(value, 36);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseBpmFrom03Token(value: string): number {
  const parsed = Number.parseInt(value, 16);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function ensureMeasure(json: BeMusicJson, index: number): BeMusicMeasure {
  const found = json.measures.find((measure) => measure.index === index);
  if (found) {
    return found;
  }
  const created: BeMusicMeasure = {
    index,
    length: 1,
  };
  json.measures.push(created);
  return created;
}

export function getMeasureLength(json: BeMusicJson, index: number): number {
  const found = json.measures.find((measure) => measure.index === index);
  return found?.length ?? 1;
}

export function getMeasureBeats(length: number): number {
  return 4 * length;
}

export function measureToBeat(json: BeMusicJson, measure: number, position = 0): number {
  const safePosition = clamp01(position);
  const measureLengths = createExactMeasureLengthMap(json);
  let beats = 0;
  for (let current = 0; current < measure; current += 1) {
    beats += getMeasureBeats(measureLengths.get(current) ?? 1);
  }
  beats += getMeasureBeats(measureLengths.get(measure) ?? 1) * safePosition;
  return beats;
}

export function eventToBeat(json: BeMusicJson, event: BeMusicEvent): number {
  return measureToBeat(json, event.measure, getEventPosition(event));
}

export function createBeatResolver(json: BeMusicJson): BeatResolver {
  const measureLengths = new Map<number, number>();
  let maxDefinedMeasure = -1;
  for (const measure of json.measures) {
    const normalizedIndex = Math.max(0, Math.floor(measure.index));
    const normalizedLength = Number.isFinite(measure.length) && measure.length > 0 ? measure.length : 1;
    measureLengths.set(normalizedIndex, normalizedLength);
    if (normalizedIndex > maxDefinedMeasure) {
      maxDefinedMeasure = normalizedIndex;
    }
  }

  const measureStartBeats: number[] = [];
  let cumulativeBeats = 0;
  for (let measure = 0; measure <= maxDefinedMeasure; measure += 1) {
    measureStartBeats[measure] = cumulativeBeats;
    cumulativeBeats += getMeasureBeats(measureLengths.get(measure) ?? 1);
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

  const resolveMeasureLength = (measure: number): number => measureLengths.get(measure) ?? 1;

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

export function beatToMeasurePosition(json: BeMusicJson, beat: number): MeasurePosition {
  if (beat <= 0) {
    return { measure: 0, position: 0 };
  }

  const measureLengths = createExactMeasureLengthMap(json);
  let remaining = beat;
  let measure = 0;
  while (remaining > 0) {
    const measureBeats = getMeasureBeats(measureLengths.get(measure) ?? 1);
    if (remaining < measureBeats) {
      return {
        measure,
        position: remaining / measureBeats,
      };
    }
    remaining -= measureBeats;
    measure += 1;
  }

  return { measure, position: 0 };
}

export function sortEvents(events: BeMusicEvent[]): BeMusicEvent[] {
  return [...events].sort((left, right) => {
    if (left.measure !== right.measure) {
      return left.measure - right.measure;
    }
    const positionDelta = compareEventPosition(left, right);
    if (positionDelta !== 0) {
      return positionDelta;
    }
    if (left.channel !== right.channel) {
      return left.channel < right.channel ? -1 : 1;
    }
    if (left.value !== right.value) {
      return left.value < right.value ? -1 : 1;
    }
    return 0;
  });
}

export function isMeasureLengthChannel(channel: string): boolean {
  return normalizeChannel(channel) === '02';
}

export function isTempoChannel(channel: string): boolean {
  const normalized = normalizeChannel(channel);
  return normalized === '03' || normalized === '08';
}

export function isStopChannel(channel: string): boolean {
  return normalizeChannel(channel) === '09';
}

export function isScrollChannel(channel: string): boolean {
  return normalizeChannel(channel) === 'SC';
}

export function isLandmineChannel(channel: string): boolean {
  const normalized = normalizeChannel(channel);
  if (normalized.length !== 2) {
    return false;
  }
  const side = normalized[0];
  const lane = normalized[1];
  if (side !== 'D' && side !== 'E') {
    return false;
  }
  return lane >= '1' && lane <= '9';
}

export function isSampleTriggerChannel(channel: string): boolean {
  const normalized = normalizeChannel(channel);
  if (normalized === '01') {
    return true;
  }
  if (normalized.startsWith('0')) {
    return false;
  }
  if (isTempoChannel(normalized) || isStopChannel(normalized) || isScrollChannel(normalized)) {
    return false;
  }
  return true;
}

export function isPlayableChannel(channel: string): boolean {
  const normalized = normalizeChannel(channel);
  if (!isSampleTriggerChannel(normalized)) {
    return false;
  }
  return normalized.startsWith('1') || normalized.startsWith('2');
}

export function listPlayableChannels(json: BeMusicJson): string[] {
  const channels = new Set<string>();
  for (const event of json.events) {
    const channel = normalizeChannel(event.channel);
    if (!isPlayableChannel(channel)) {
      continue;
    }
    channels.add(channel);
  }
  return [...channels].sort();
}

function createExactMeasureLengthMap(json: BeMusicJson): Map<number, number> {
  const measureLengths = new Map<number, number>();
  for (const measure of json.measures) {
    measureLengths.set(measure.index, measure.length);
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

function compareEventPosition(left: BeMusicEvent, right: BeMusicEvent): number {
  const leftDenominator = normalizePositionDenominator(left.position[1]);
  const leftNumerator = normalizePositionNumerator(left.position[0], leftDenominator);
  const rightDenominator = normalizePositionDenominator(right.position[1]);
  const rightNumerator = normalizePositionNumerator(right.position[0], rightDenominator);
  return compareFractions(leftNumerator, leftDenominator, rightNumerator, rightDenominator);
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
