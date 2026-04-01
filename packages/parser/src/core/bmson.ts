import type {
  BeMusicJson,
  BeMusicPosition,
  BmsonBpmEventEntry,
  BmsonSoundChannelEntry,
  BmsonSoundNoteEntry,
  BmsonStopEventEntry,
} from '@be-music/json';
import { normalizeSortedUniqueNonNegativeIntegers } from '@be-music/utils';

export interface BmsonInfo {
  title?: string;
  subtitle?: string;
  artist?: string;
  genre?: string;
  subartists?: unknown;
  chart_name?: string;
  level?: number;
  init_bpm?: number;
  resolution?: number;
  mode_hint?: string;
  judge_rank?: number;
  total?: number;
  back_image?: string;
  eyecatch_image?: string;
  banner_image?: string;
  preview_music?: string;
}

interface BmsonLine {
  y: number;
}

export interface BmsonBpmEvent {
  y: number;
  bpm: number;
}

export interface BmsonStopEvent {
  y: number;
  duration: number;
}

export interface BmsonSoundNote {
  x?: number;
  y: number;
  l?: number;
  c?: boolean;
}

export interface BmsonSoundChannel {
  name: string;
  notes?: BmsonSoundNote[];
}

export interface BmsonDocument {
  version?: string;
  info?: BmsonInfo;
  lines?: Array<number | BmsonLine>;
  resolution?: number;
  bpm_events?: BmsonBpmEvent[];
  stop_events?: BmsonStopEvent[];
  sound_channels?: BmsonSoundChannel[];
  bga?: {
    bga_header?: Array<{ id: number; name: string }>;
    bga_events?: Array<{ y: number; id: number }>;
    layer_events?: Array<{ y: number; id: number }>;
    poor_events?: Array<{ y: number; id: number }>;
  };
}

interface MeasurePositionWithFraction {
  measure: number;
  position: BeMusicPosition;
}

export function buildBmsonLaneMap(soundChannels: BmsonSoundChannel[]): Map<number, string> {
  const xValues = new Set<number>();
  for (const soundChannel of soundChannels) {
    for (const note of soundChannel.notes ?? []) {
      if (Number.isFinite(note.x)) {
        const lane = Math.floor(note.x!);
        if (lane > 0) {
          xValues.add(lane);
        }
      }
    }
  }

  const sorted = [...xValues].sort((left, right) => left - right);
  const map = new Map<number, string>();
  for (let index = 0; index < sorted.length; index += 1) {
    map.set(sorted[index], laneIndexToChannel(index));
  }
  return map;
}

export function resolveBmsonResolution(document: BmsonDocument): number {
  const infoResolution =
    typeof document.info?.resolution === 'number' && Number.isFinite(document.info.resolution)
      ? Math.floor(document.info.resolution)
      : undefined;
  if (infoResolution && infoResolution > 0) {
    return infoResolution;
  }

  const rootResolution =
    typeof document.resolution === 'number' && Number.isFinite(document.resolution)
      ? Math.floor(document.resolution)
      : undefined;
  if (rootResolution && rootResolution > 0) {
    return rootResolution;
  }

  return 240;
}

export function normalizeBmsonLines(lines: unknown): number[] {
  if (!Array.isArray(lines)) {
    return [];
  }

  const values: number[] = [];
  for (const line of lines) {
    if (typeof line === 'number' && Number.isFinite(line)) {
      values.push(Math.max(0, Math.floor(line)));
      continue;
    }
    if (!line || typeof line !== 'object') {
      continue;
    }
    const y = (line as Record<string, unknown>).y;
    if (typeof y === 'number' && Number.isFinite(y)) {
      values.push(Math.max(0, Math.floor(y)));
    }
  }

  const sorted = normalizeSortedUniqueNonNegativeIntegers(values);
  if (sorted.length === 0) {
    return [];
  }
  if (sorted[0] !== 0) {
    sorted.unshift(0);
  }
  return sorted;
}

export function normalizeBmsonBpmEvents(input: unknown): BmsonBpmEventEntry[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const events: BmsonBpmEventEntry[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const raw = item as Record<string, unknown>;
    if (typeof raw.y !== 'number' || !Number.isFinite(raw.y) || typeof raw.bpm !== 'number' || !Number.isFinite(raw.bpm)) {
      continue;
    }
    if (raw.bpm <= 0) {
      continue;
    }
    events.push({
      y: Math.max(0, Math.round(raw.y)),
      bpm: raw.bpm,
    });
  }
  return events;
}

export function normalizeBmsonStopEvents(input: unknown): BmsonStopEventEntry[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const events: BmsonStopEventEntry[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const raw = item as Record<string, unknown>;
    if (
      typeof raw.y !== 'number' ||
      !Number.isFinite(raw.y) ||
      typeof raw.duration !== 'number' ||
      !Number.isFinite(raw.duration)
    ) {
      continue;
    }
    if (raw.duration <= 0) {
      continue;
    }
    events.push({
      y: Math.max(0, Math.round(raw.y)),
      duration: raw.duration,
    });
  }
  return events;
}

export function normalizeBmsonSoundChannels(input: unknown): BmsonSoundChannelEntry[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const channels: BmsonSoundChannelEntry[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const raw = item as Record<string, unknown>;
    if (typeof raw.name !== 'string') {
      continue;
    }
    channels.push({
      name: raw.name,
      notes: normalizeBmsonSoundNotes(raw.notes),
    });
  }
  return channels;
}

export function createMeasureLengthsFromBmsonLines(
  lines: number[],
  resolution: number,
): Array<{ index: number; length: number }> {
  if (lines.length < 2) {
    return [];
  }

  const ticksPerMeasure = Math.max(1, Math.floor(resolution * 4));
  const measures: Array<{ index: number; length: number }> = [];
  for (let index = 0; index + 1 < lines.length; index += 1) {
    const ticks = Math.max(1, lines[index + 1] - lines[index]);
    const length = ticks / ticksPerMeasure;
    if (Math.abs(length - 1) < 1e-9) {
      continue;
    }
    measures.push({
      index,
      length,
    });
  }
  return measures;
}

export function createBmsonPositionResolver(resolution: number, lines: number[]): (y: number) => MeasurePositionWithFraction {
  const ticksPerMeasure = Math.max(1, Math.floor(resolution * 4));
  return (y: number) => {
    const normalizedY = Math.max(0, Math.round(y));
    if (lines.length < 2) {
      const measure = Math.max(0, Math.floor(normalizedY / ticksPerMeasure));
      const positionNumerator = normalizedY % ticksPerMeasure;
      return {
        measure,
        position: [positionNumerator, ticksPerMeasure],
      };
    }

    const lineIndex = findLastLineIndex(lines, normalizedY);
    const lastIndex = lines.length - 1;
    if (lineIndex < lastIndex) {
      const start = lines[lineIndex];
      const end = lines[lineIndex + 1];
      const denominator = Math.max(1, end - start);
      const numerator = Math.max(0, Math.min(denominator - 1, normalizedY - start));
      return {
        measure: lineIndex,
        position: [numerator, denominator],
      };
    }

    const start = lines[lastIndex];
    const offset = normalizedY - start;
    const measureOffset = Math.floor(offset / ticksPerMeasure);
    const numerator = offset % ticksPerMeasure;
    return {
      measure: lastIndex + measureOffset,
      position: [numerator, ticksPerMeasure],
    };
  };
}

export function normalizeBmsonInfoForIr(info: BmsonInfo, resolution: number): BeMusicJson['bmson']['info'] {
  const normalized: BeMusicJson['bmson']['info'] = {};
  copyIfString(normalized, 'title', info.title);
  copyIfString(normalized, 'subtitle', info.subtitle);
  copyIfString(normalized, 'artist', info.artist);
  copyIfString(normalized, 'genre', info.genre);
  copyIfString(normalized, 'chartName', info.chart_name);
  copyIfString(normalized, 'modeHint', info.mode_hint);
  copyIfString(normalized, 'backImage', info.back_image);
  copyIfString(normalized, 'eyecatchImage', info.eyecatch_image);
  copyIfString(normalized, 'bannerImage', info.banner_image);
  copyIfString(normalized, 'previewMusic', info.preview_music);

  const subartists = normalizeBmsonSubartists(info.subartists);
  if (subartists !== undefined) {
    normalized.subartists = subartists;
  }

  copyIfFiniteNumber(normalized, 'level', info.level);
  copyIfFiniteNumber(normalized, 'initBpm', info.init_bpm);
  copyIfFiniteNumber(normalized, 'judgeRank', info.judge_rank);
  copyIfFiniteNumber(normalized, 'total', info.total);

  if (resolution > 0) {
    normalized.resolution = resolution;
  }

  return normalized;
}

export function normalizeBmsonBgaForIr(input: BmsonDocument['bga'] | undefined): BeMusicJson['bmson']['bga'] {
  if (!input || typeof input !== 'object') {
    return {
      header: [],
      events: [],
      layerEvents: [],
      poorEvents: [],
    };
  }
  return {
    header: normalizeBmsonBgaHeaderEntries(input.bga_header),
    events: normalizeBmsonBgaEventEntries(input.bga_events),
    layerEvents: normalizeBmsonBgaEventEntries(input.layer_events),
    poorEvents: normalizeBmsonBgaEventEntries(input.poor_events),
  };
}

export function normalizeBmsonExtensions(input: unknown): BeMusicJson['bmson'] {
  const normalized: BeMusicJson['bmson'] = {
    info: {},
    bga: {
      header: [],
      events: [],
      layerEvents: [],
      poorEvents: [],
    },
  };
  if (!input || typeof input !== 'object') {
    return normalized;
  }

  const raw = input as Record<string, unknown>;
  if (typeof raw.version === 'string' && raw.version.length > 0) {
    normalized.version = raw.version;
  }

  normalized.info = normalizeBmsonInfoFromIr(raw.info);
  normalized.bga = normalizeBmsonBgaFromIr(raw.bga);

  return normalized;
}

function laneIndexToChannel(index: number): string {
  const digits = '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const first = digits[Math.floor(index / digits.length)] ?? '1';
  const second = digits[index % digits.length];
  return `${first}${second}`;
}

function normalizeBmsonBgaHeaderEntries(input: unknown): BeMusicJson['bmson']['bga']['header'] {
  if (!Array.isArray(input)) {
    return [];
  }
  const entries: BeMusicJson['bmson']['bga']['header'] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const raw = item as Record<string, unknown>;
    const id = normalizePositiveInteger(raw.id);
    if (id === undefined || typeof raw.name !== 'string') {
      continue;
    }
    entries.push({
      id,
      name: raw.name,
    });
  }
  return entries;
}

function normalizeBmsonBgaEventEntries(input: unknown): BeMusicJson['bmson']['bga']['events'] {
  if (!Array.isArray(input)) {
    return [];
  }
  const entries: BeMusicJson['bmson']['bga']['events'] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const raw = item as Record<string, unknown>;
    const id = normalizePositiveInteger(raw.id);
    const y = normalizePositiveInteger(raw.y);
    if (id === undefined || y === undefined) {
      continue;
    }
    entries.push({
      y,
      id,
    });
  }
  return entries;
}

function normalizeBmsonSubartists(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }

  const names: string[] = [];
  for (const item of input) {
    if (typeof item === 'string') {
      names.push(item);
      continue;
    }
    if (!item || typeof item !== 'object') {
      continue;
    }
    const raw = item as Record<string, unknown>;
    if (typeof raw.name === 'string') {
      names.push(raw.name);
    }
  }
  return names;
}

function normalizeBmsonSoundNotes(input: unknown): BmsonSoundNoteEntry[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const notes: BmsonSoundNoteEntry[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const raw = item as Record<string, unknown>;
    if (typeof raw.y !== 'number' || !Number.isFinite(raw.y)) {
      continue;
    }

    const note: BmsonSoundNoteEntry = {
      y: Math.max(0, Math.round(raw.y)),
    };
    if (typeof raw.x === 'number' && Number.isFinite(raw.x)) {
      note.x = Math.floor(raw.x);
    }
    if (typeof raw.l === 'number' && Number.isFinite(raw.l) && raw.l >= 0) {
      note.l = Math.floor(raw.l);
    }
    if (typeof raw.c === 'boolean') {
      note.c = raw.c;
    }
    notes.push(note);
  }
  return notes;
}

function copyIfString<T extends object>(target: T, key: keyof T & string, value: unknown): void {
  if (typeof value === 'string') {
    (target as Record<string, unknown>)[key] = value;
  }
}

function copyIfFiniteNumber<T extends object>(target: T, key: keyof T & string, value: unknown): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    (target as Record<string, unknown>)[key] = value;
  }
}

function normalizePositiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  const normalized = Math.floor(value);
  if (normalized < 0) {
    return undefined;
  }
  return normalized;
}

function normalizeBmsonInfoFromIr(input: unknown): BeMusicJson['bmson']['info'] {
  const info: BeMusicJson['bmson']['info'] = {};
  if (!input || typeof input !== 'object') {
    return info;
  }

  const raw = input as Record<string, unknown>;
  copyIfString(info, 'title', raw.title);
  copyIfString(info, 'subtitle', raw.subtitle);
  copyIfString(info, 'artist', raw.artist);
  copyIfString(info, 'genre', raw.genre);
  copyIfString(info, 'chartName', raw.chartName ?? raw.chart_name);
  copyIfString(info, 'modeHint', raw.modeHint ?? raw.mode_hint);
  copyIfString(info, 'backImage', raw.backImage ?? raw.back_image);
  copyIfString(info, 'eyecatchImage', raw.eyecatchImage ?? raw.eyecatch_image);
  copyIfString(info, 'bannerImage', raw.bannerImage ?? raw.banner_image);
  copyIfString(info, 'previewMusic', raw.previewMusic ?? raw.preview_music);

  const subartists = normalizeBmsonSubartists(raw.subartists);
  if (subartists !== undefined) {
    info.subartists = subartists;
  }

  copyIfFiniteNumber(info, 'level', raw.level);
  copyIfFiniteNumber(info, 'initBpm', raw.initBpm ?? raw.init_bpm);
  copyIfFiniteNumber(info, 'judgeRank', raw.judgeRank ?? raw.judge_rank);
  copyIfFiniteNumber(info, 'total', raw.total);

  const resolution = normalizePositiveInteger(raw.resolution);
  if (resolution !== undefined && resolution > 0) {
    info.resolution = resolution;
  }

  return info;
}

function normalizeBmsonBgaFromIr(input: unknown): BeMusicJson['bmson']['bga'] {
  if (!input || typeof input !== 'object') {
    return {
      header: [],
      events: [],
      layerEvents: [],
      poorEvents: [],
    };
  }
  const raw = input as Record<string, unknown>;
  return {
    header: normalizeBmsonBgaHeaderEntries(raw.header ?? raw.bga_header),
    events: normalizeBmsonBgaEventEntries(raw.events ?? raw.bga_events),
    layerEvents: normalizeBmsonBgaEventEntries(raw.layerEvents ?? raw.layer_events),
    poorEvents: normalizeBmsonBgaEventEntries(raw.poorEvents ?? raw.poor_events),
  };
}

function findLastLineIndex(lines: number[], y: number): number {
  let low = 0;
  let high = lines.length - 1;
  let answer = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lines[mid] <= y) {
      answer = mid;
      low = mid + 1;
      continue;
    }
    high = mid - 1;
  }

  return answer;
}
