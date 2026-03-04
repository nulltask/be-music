import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import {
  BMS_JSON_FORMAT,
  type BmsControlFlowCommand,
  type BmsControlFlowEntry,
  type BeMusicEvent,
  type BeMusicJson,
  createEmptyJson,
  intToBase36,
  normalizeChannel,
  normalizeObjectKey,
} from '@be-music/json';
import { decodeBmsText, decodeUtf8Text } from './bms-text-decoder.ts';
import {
  collectNonZeroObjectTokens,
  normalizeBmsonNoteLength,
  sortAndNormalizeEvents,
  upsertMeasureLength,
} from './event-utils.ts';
import {
  buildBmsonLaneMap,
  createBmsonPositionResolver,
  createMeasureLengthsFromBmsonLines,
  type BmsonDocument,
  normalizeBmsonBgaForIr,
  normalizeBmsonExtensions,
  normalizeBmsonInfoForIr,
  normalizeBmsonLines,
  resolveBmsonResolution,
} from './bmson.ts';
import {
  createControlFlowObjectEntry,
  normalizeControlFlowCommand,
  resolveControlFlow,
  type ControlFlowCaptureFrameType,
  updateControlFlowCaptureStack,
} from './control-flow.ts';

const HEADER_LINE = /^#([A-Z][A-Z0-9_]*)(?:\s+(.+))?$/i;
const CONTROL_FLOW_LINE =
  /^#(RANDOM|SETRANDOM|IF|ELSEIF|ELSE|ENDIF|ENDRANDOM|SWITCH|SETSWITCH|CASE|SKIP|DEF|ENDSW)(?:\s+(.+))?$/i;
const INDEXED_HEADER_COMMAND =
  /^(WAV|BMP|BPM|STOP|TEXT|EXRANK|ARGB|CHANGEOPTION|EXWAV|EXBMP|BGA|SCROLL|SWBGA)([0-9A-Z]{2})$/;

type MeasureLengthEntry = BeMusicJson['measures'][number];

export function parseBms(input: string): BeMusicJson {
  const json = createEmptyJson('bms');
  const controlFlowCaptureStack: ControlFlowCaptureFrameType[] = [];
  const measureByIndex = new Map<number, MeasureLengthEntry>();

  forEachLine(input, (rawLine) => {
    const line = rawLine.trim();
    if (!line.startsWith('#')) {
      return;
    }

    const second = line.charCodeAt(1);
    const startsWithMeasure = second >= 0x30 && second <= 0x39;
    if (startsWithMeasure) {
      const objectLine = parseObjectDataLine(line);
      if (!objectLine) {
        return;
      }
      const { measure, channel, data } = objectLine;
      if (controlFlowCaptureStack.length > 0) {
        const controlFlowObject = createControlFlowObjectEntry(measure, channel, data);
        if (controlFlowObject) {
          json.bms.controlFlow.push(controlFlowObject);
        }
      } else {
        pushObjectDataLine(json, measure, channel, data, measureByIndex);
      }
      return;
    }

    const controlFlowMatch = line.match(CONTROL_FLOW_LINE);
    if (controlFlowMatch) {
      const command = controlFlowMatch[1].toUpperCase() as BmsControlFlowCommand;
      const value = controlFlowMatch[2]?.trim();
      json.bms.controlFlow.push({
        kind: 'directive',
        command,
        value,
      });
      updateControlFlowCaptureStack(controlFlowCaptureStack, command);
      return;
    }

    if (controlFlowCaptureStack.length > 0) {
      const headerMatch = line.match(HEADER_LINE);
      if (headerMatch) {
        json.bms.controlFlow.push({
          kind: 'header',
          command: headerMatch[1].toUpperCase(),
          value: headerMatch[2]?.trim() ?? '',
        });
      }
      return;
    }

    const headerMatch = line.match(HEADER_LINE);
    if (!headerMatch) {
      return;
    }

    const command = headerMatch[1].toUpperCase();
    const value = headerMatch[2]?.trim() ?? '';
    pushHeaderLine(json, command, value);
  });

  json.measures.sort((left, right) => left.index - right.index);
  json.events = sortAndNormalizeEvents(json.events);
  return json;
}

export function parseBmson(input: string): BeMusicJson {
  const document = JSON.parse(input) as BmsonDocument;
  return parseBmsonDocument(document);
}

function parseBmsonDocument(document: BmsonDocument): BeMusicJson {
  const json = createEmptyJson('bmson');

  const info = document.info ?? {};
  if (typeof document.version === 'string' && document.version.length > 0) {
    json.bmson.version = document.version;
  }

  const resolution = resolveBmsonResolution(document);
  json.bmson.info = normalizeBmsonInfoForIr(info, resolution);
  const lines = normalizeBmsonLines(document.lines);
  const positionResolver = createBmsonPositionResolver(resolution, lines);
  if (lines.length > 0) {
    json.bmson.lines = lines;
  }
  json.bmson.bga = normalizeBmsonBgaForIr(document.bga);

  const measureLengths = createMeasureLengthsFromBmsonLines(lines, resolution);
  if (measureLengths.length > 0) {
    json.measures = measureLengths;
  }

  json.metadata.title = json.bmson.info.title;
  json.metadata.subtitle = json.bmson.info.subtitle;
  json.metadata.artist = json.bmson.info.artist;
  json.metadata.genre = json.bmson.info.genre;
  if (Number.isFinite(json.bmson.info.level)) {
    json.metadata.playLevel = json.bmson.info.level;
  }

  if (Number.isFinite(json.bmson.info.initBpm) && (json.bmson.info.initBpm ?? 0) > 0) {
    json.metadata.bpm = json.bmson.info.initBpm!;
  }
  if (Number.isFinite(json.bmson.info.judgeRank)) {
    json.metadata.rank = json.bmson.info.judgeRank;
  }
  if (Number.isFinite(json.bmson.info.total)) {
    json.metadata.total = json.bmson.info.total;
  }

  const soundChannels = document.sound_channels ?? [];
  const laneMap = buildBmsonLaneMap(soundChannels);
  for (let index = 0; index < soundChannels.length; index += 1) {
    const soundChannel = soundChannels[index]!;
    const key = intToBase36(index + 1, 2);
    json.resources.wav[key] = soundChannel.name;
    const notes = soundChannel.notes ?? [];
    const playableTicks = new Set<number>();
    const bgmCandidates: Array<{ pulse: number; event: BeMusicEvent }> = [];

    for (const note of notes) {
      if (!Number.isFinite(note.y)) {
        continue;
      }
      const pulse = Math.round(note.y);
      const lane = Number.isFinite(note.x) ? Math.floor(note.x!) : 0;
      const isBgmNote = lane <= 0;
      if (!isBgmNote) {
        playableTicks.add(pulse);
      }

      const { measure, position } = positionResolver(note.y);
      const channel = isBgmNote ? '01' : (laneMap.get(lane) ?? '11');
      const event: BeMusicEvent = {
        measure,
        position,
        channel,
        value: key,
      };
      const noteLength = normalizeBmsonNoteLength(note.l);
      const noteContinue = typeof note.c === 'boolean' ? note.c : undefined;
      if (noteLength !== undefined || noteContinue !== undefined) {
        event.bmson = {};
        if (noteLength !== undefined) {
          event.bmson.l = noteLength;
        }
        if (noteContinue !== undefined) {
          event.bmson.c = noteContinue;
        }
      }
      if (isBgmNote) {
        bgmCandidates.push({ pulse, event });
        continue;
      }
      json.events.push(event);
    }

    for (const candidate of bgmCandidates) {
      if (playableTicks.has(candidate.pulse)) {
        continue;
      }
      json.events.push(candidate.event);
    }
  }

  const bpmEvents = document.bpm_events ?? [];
  bpmEvents.forEach((bpmEvent, index) => {
    if (!Number.isFinite(bpmEvent.y) || !Number.isFinite(bpmEvent.bpm) || bpmEvent.bpm <= 0) {
      return;
    }
    const key = intToBase36(index + 1, 2);
    json.resources.bpm[key] = bpmEvent.bpm;
    const { measure, position } = positionResolver(bpmEvent.y);
    json.events.push({
      measure,
      position,
      channel: '08',
      value: key,
    });
  });

  const stopEvents = document.stop_events ?? [];
  stopEvents.forEach((stopEvent, index) => {
    if (!Number.isFinite(stopEvent.y) || !Number.isFinite(stopEvent.duration) || stopEvent.duration <= 0) {
      return;
    }
    const key = intToBase36(index + 1, 2);
    json.resources.stop[key] = stopEvent.duration;
    const { measure, position } = positionResolver(stopEvent.y);
    json.events.push({
      measure,
      position,
      channel: '09',
      value: key,
    });
  });

  json.events = sortAndNormalizeEvents(json.events);
  return json;
}

function parseJsonDocument(raw: Partial<BeMusicJson>): BeMusicJson {
  const json = createEmptyJson(raw.sourceFormat ?? 'json');
  json.sourceFormat = raw.sourceFormat ?? 'json';
  json.metadata = {
    ...json.metadata,
    ...raw.metadata,
    extras: {
      ...json.metadata.extras,
      ...(raw.metadata as { extras?: Record<string, string> } | undefined)?.extras,
    },
  };
  json.resources = {
    ...json.resources,
    ...raw.resources,
  };
  json.measures = (raw.measures ?? [])
    .map((measure) => ({
      index: Number.isFinite(measure.index) ? Number(measure.index) : 0,
      length: Number.isFinite(measure.length) && (measure.length ?? 0) > 0 ? Number(measure.length) : 1,
    }))
    .filter((measure) => measure.length > 0)
    .sort((left, right) => left.index - right.index);
  const rawEvents = Array.isArray(raw.events) ? raw.events : [];
  json.events = sortAndNormalizeEvents(rawEvents as Array<BeMusicEvent | Record<string, unknown>>);
  if (json.events.length !== rawEvents.length) {
    throw new Error('Invalid bms-json event: position [numerator, denominator] is required.');
  }
  json.bms = normalizeBmsExtensions((raw as Record<string, unknown>).bms);
  json.bmson = normalizeBmsonExtensions((raw as Record<string, unknown>).bmson);
  migrateBmsExtensionHeadersFromExtras(json);
  return json;
}

function parseStructuredChartObject(parsed: Record<string, unknown>): BeMusicJson {
  if (parsed.format === BMS_JSON_FORMAT) {
    return parseJsonDocument(parsed as Partial<BeMusicJson>);
  }
  return parseBmsonDocument(parsed as BmsonDocument);
}

export function parseChart(input: string, formatHint?: string): BeMusicJson {
  const hint = formatHint?.toLowerCase();
  if (hint === 'bmson') {
    return parseBmson(input);
  }
  if (hint === 'json') {
    const parsed = JSON.parse(input.trim()) as Record<string, unknown>;
    return parseStructuredChartObject(parsed);
  }

  const trimmed = input.trimStart();
  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    return parseStructuredChartObject(parsed);
  }

  return parseBms(input);
}

export async function parseChartFile(filePath: string): Promise<BeMusicJson> {
  const buffer = await readFile(filePath);
  const extension = extname(filePath).toLowerCase();
  if (extension === '.bmson') {
    return parseBmson(decodeUtf8Text(buffer));
  }
  if (extension === '.json') {
    return parseChart(decodeUtf8Text(buffer), 'json');
  }
  const decoded = decodeBmsText(buffer);
  return parseBms(decoded.text);
}

export interface ResolveBmsControlFlowOptions {
  random?: () => number;
}

export function resolveBmsControlFlow(input: BeMusicJson, options: ResolveBmsControlFlowOptions = {}): BeMusicJson {
  return resolveControlFlow(input, {
    random: options.random,
    applyHeader: pushHeaderLine,
  });
}

export { decodeBmsText };

function pushObjectDataLine(
  json: BeMusicJson,
  measure: number,
  channel: string,
  data: string,
  measureByIndex?: Map<number, MeasureLengthEntry>,
): void {
  if (channel === '02') {
    const length = Number.parseFloat(data);
    if (Number.isFinite(length) && length > 0) {
      upsertMeasureLength(json, measure, length, measureByIndex);
    }
    return;
  }

  const parsed = collectNonZeroObjectTokens(data);
  for (const token of parsed.tokens) {
    json.events.push({
      measure,
      channel,
      position: [token.index, parsed.tokenCount],
      value: token.value,
    });
  }
}

interface ParsedObjectDataLine {
  measure: number;
  channel: string;
  data: string;
}

function parseObjectDataLine(line: string): ParsedObjectDataLine | undefined {
  if (line.length < 8 || line.charCodeAt(0) !== 0x23) {
    return undefined;
  }

  const digit0 = line.charCodeAt(1);
  const digit1 = line.charCodeAt(2);
  const digit2 = line.charCodeAt(3);
  if (
    digit0 < 0x30 ||
    digit0 > 0x39 ||
    digit1 < 0x30 ||
    digit1 > 0x39 ||
    digit2 < 0x30 ||
    digit2 > 0x39
  ) {
    return undefined;
  }

  const channel0 = normalizeBase36AsciiCode(line.charCodeAt(4));
  const channel1 = normalizeBase36AsciiCode(line.charCodeAt(5));
  if (channel0 < 0 || channel1 < 0) {
    return undefined;
  }

  let cursor = 6;
  while (cursor < line.length && isAsciiWhitespace(line.charCodeAt(cursor))) {
    cursor += 1;
  }
  if (cursor >= line.length || line.charCodeAt(cursor) !== 0x3a) {
    return undefined;
  }

  cursor += 1;
  while (cursor < line.length && isAsciiWhitespace(line.charCodeAt(cursor))) {
    cursor += 1;
  }
  if (cursor >= line.length) {
    return undefined;
  }

  const data = line.slice(cursor).trim();
  if (data.length === 0) {
    return undefined;
  }

  return {
    measure: (digit0 - 0x30) * 100 + (digit1 - 0x30) * 10 + (digit2 - 0x30),
    channel: String.fromCharCode(channel0, channel1),
    data,
  };
}

function normalizeBase36AsciiCode(code: number): number {
  if (code >= 0x30 && code <= 0x39) {
    return code;
  }
  if (code >= 0x41 && code <= 0x5a) {
    return code;
  }
  if (code >= 0x61 && code <= 0x7a) {
    return code - 0x20;
  }
  return -1;
}

function isAsciiWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0b || code === 0x0c;
}

function forEachLine(input: string, visitor: (line: string) => void): void {
  let lineStart = 0;
  for (let index = 0; index <= input.length; index += 1) {
    const isLineBreak = index === input.length || input.charCodeAt(index) === 0x0a;
    if (!isLineBreak) {
      continue;
    }
    let lineEnd = index;
    if (lineEnd > lineStart && input.charCodeAt(lineEnd - 1) === 0x0d) {
      lineEnd -= 1;
    }
    visitor(input.slice(lineStart, lineEnd));
    lineStart = index + 1;
  }
}

function pushHeaderLine(json: BeMusicJson, command: string, value: string): void {
  const objectCommand = command.match(INDEXED_HEADER_COMMAND);
  if (objectCommand) {
    const directive = objectCommand[1];
    const key = normalizeObjectKey(objectCommand[2]);
    if (directive === 'WAV') {
      json.resources.wav[key] = value;
      return;
    }
    if (directive === 'BMP') {
      json.resources.bmp[key] = value;
      return;
    }
    if (directive === 'TEXT') {
      json.resources.text[key] = value;
      return;
    }
    if (directive === 'EXRANK') {
      if (value.length > 0) {
        json.bms.exRank[key] = value;
      }
      return;
    }
    if (directive === 'ARGB') {
      if (value.length > 0) {
        json.bms.argb[key] = value;
      }
      return;
    }
    if (directive === 'CHANGEOPTION') {
      if (value.length > 0) {
        json.bms.changeOption[key] = value;
      }
      return;
    }
    if (directive === 'EXWAV') {
      if (value.length > 0) {
        json.bms.exWav[key] = value;
      }
      return;
    }
    if (directive === 'EXBMP') {
      if (value.length > 0) {
        json.bms.exBmp[key] = value;
      }
      return;
    }
    if (directive === 'BGA') {
      if (value.length > 0) {
        json.bms.bga[key] = value;
      }
      return;
    }
    if (directive === 'SCROLL') {
      const numeric = Number.parseFloat(value);
      if (Number.isFinite(numeric)) {
        json.bms.scroll[key] = numeric;
      }
      return;
    }
    if (directive === 'SWBGA') {
      if (value.length > 0) {
        json.bms.swBga[key] = value;
      }
      return;
    }

    const numericValue = Number.parseFloat(value);
    if (!Number.isFinite(numericValue)) {
      return;
    }
    if (directive === 'BPM') {
      json.resources.bpm[key] = numericValue;
      return;
    }
    json.resources.stop[key] = numericValue;
    return;
  }

  const numericValue = Number.parseFloat(value);
  switch (command) {
    case 'TITLE':
      json.metadata.title = value;
      return;
    case 'SUBTITLE':
      json.metadata.subtitle = value;
      return;
    case 'ARTIST':
      json.metadata.artist = value;
      return;
    case 'GENRE':
      json.metadata.genre = value;
      return;
    case 'COMMENT':
      json.metadata.comment = value;
      return;
    case 'STAGEFILE':
      json.metadata.stageFile = value;
      return;
    case 'PREVIEW':
      if (value.length > 0) {
        json.bms.preview = value;
      }
      return;
    case 'PLAYLEVEL':
      if (Number.isFinite(numericValue)) {
        json.metadata.playLevel = numericValue;
      }
      return;
    case 'RANK':
      if (Number.isFinite(numericValue)) {
        json.metadata.rank = numericValue;
      }
      return;
    case 'TOTAL':
      if (Number.isFinite(numericValue)) {
        json.metadata.total = numericValue;
      }
      return;
    case 'DIFFICULTY':
      if (Number.isFinite(numericValue)) {
        json.metadata.difficulty = numericValue;
      }
      return;
    case 'BPM':
      if (Number.isFinite(numericValue) && numericValue > 0) {
        json.metadata.bpm = numericValue;
      }
      return;
    case 'LNTYPE':
      if (Number.isFinite(numericValue) && numericValue > 0) {
        json.bms.lnType = Math.floor(numericValue);
      }
      return;
    case 'LNMODE':
      if (Number.isFinite(numericValue) && numericValue > 0) {
        json.bms.lnMode = Math.floor(numericValue);
      }
      return;
    case 'LNOBJ':
      if (value.length > 0) {
        json.bms.lnObj = normalizeObjectKey(value);
      }
      return;
    case 'VOLWAV':
      if (Number.isFinite(numericValue) && numericValue >= 0) {
        json.bms.volWav = numericValue;
      }
      return;
    case 'DEFEXRANK':
      if (Number.isFinite(numericValue)) {
        json.bms.defExRank = numericValue;
      }
      return;
    case 'PLAYER':
      if (Number.isFinite(numericValue) && numericValue > 0) {
        json.bms.player = Math.floor(numericValue);
      }
      return;
    case 'PATH_WAV':
      if (value.length > 0) {
        json.bms.pathWav = value;
      }
      return;
    case 'BASEBPM':
      if (Number.isFinite(numericValue) && numericValue > 0) {
        json.bms.baseBpm = numericValue;
      }
      return;
    case 'STP':
      if (value.length > 0) {
        json.bms.stp.push(value);
      }
      return;
    case 'OPTION':
      if (value.length > 0) {
        json.bms.option = value;
      }
      return;
    case 'WAVCMD':
      if (value.length > 0) {
        json.bms.wavCmd = value;
      }
      return;
    case 'POORBGA':
      if (value.length > 0) {
        json.bms.poorBga = value;
      }
      return;
    case 'VIDEOFILE':
      if (value.length > 0) {
        json.bms.videoFile = value;
      }
      return;
    case 'MATERIALS':
      if (value.length > 0) {
        json.bms.materials = value;
      }
      return;
    case 'DIVIDEPROP':
      if (value.length > 0) {
        json.bms.divideProp = value;
      }
      return;
    case 'CHARSET':
      if (value.length > 0) {
        json.bms.charset = value;
      }
      return;
    default:
      if (value.length > 0) {
        json.metadata.extras[command] = value;
      }
  }
}

function migrateBmsExtensionHeadersFromExtras(json: BeMusicJson): void {
  const migratedExtras: Record<string, string> = {};

  for (const [command, value] of Object.entries(json.metadata.extras ?? {})) {
    const upper = command.toUpperCase();
    if (upper === 'PREVIEW') {
      if (typeof json.bms.preview !== 'string' && value.length > 0) {
        json.bms.preview = value;
      }
      continue;
    }
    if (upper === 'LNTYPE') {
      const parsed = normalizeNumericBmsExtensionValue(value);
      if (typeof json.bms.lnType !== 'number' && typeof parsed === 'number' && parsed > 0) {
        json.bms.lnType = Math.floor(parsed);
      }
      continue;
    }
    if (upper === 'LNMODE') {
      const parsed = normalizeNumericBmsExtensionValue(value);
      if (typeof json.bms.lnMode !== 'number' && typeof parsed === 'number' && parsed > 0) {
        json.bms.lnMode = Math.floor(parsed);
      }
      continue;
    }
    if (upper === 'LNOBJ') {
      if (typeof json.bms.lnObj !== 'string' && value.length > 0) {
        json.bms.lnObj = normalizeObjectKey(value);
      }
      continue;
    }
    if (upper === 'VOLWAV') {
      const parsed = normalizeNumericBmsExtensionValue(value);
      if (typeof json.bms.volWav !== 'number' && typeof parsed === 'number' && parsed >= 0) {
        json.bms.volWav = parsed;
      }
      continue;
    }
    if (upper === 'DEFEXRANK') {
      const parsed = normalizeNumericBmsExtensionValue(value);
      if (typeof json.bms.defExRank !== 'number' && typeof parsed === 'number') {
        json.bms.defExRank = parsed;
      }
      continue;
    }
    if (upper === 'PLAYER') {
      const parsed = normalizeNumericBmsExtensionValue(value);
      if (typeof json.bms.player !== 'number' && typeof parsed === 'number' && parsed > 0) {
        json.bms.player = Math.floor(parsed);
      }
      continue;
    }
    if (upper === 'PATH_WAV') {
      if (typeof json.bms.pathWav !== 'string' && value.length > 0) {
        json.bms.pathWav = value;
      }
      continue;
    }
    if (upper === 'BASEBPM') {
      const parsed = normalizeNumericBmsExtensionValue(value);
      if (typeof json.bms.baseBpm !== 'number' && typeof parsed === 'number' && parsed > 0) {
        json.bms.baseBpm = parsed;
      }
      continue;
    }
    if (upper === 'STP') {
      if (value.length > 0 && !json.bms.stp.includes(value)) {
        json.bms.stp.push(value);
      }
      continue;
    }
    if (upper === 'OPTION') {
      if (typeof json.bms.option !== 'string' && value.length > 0) {
        json.bms.option = value;
      }
      continue;
    }
    if (upper === 'WAVCMD') {
      if (typeof json.bms.wavCmd !== 'string' && value.length > 0) {
        json.bms.wavCmd = value;
      }
      continue;
    }
    if (upper === 'POORBGA') {
      if (typeof json.bms.poorBga !== 'string' && value.length > 0) {
        json.bms.poorBga = value;
      }
      continue;
    }
    if (upper === 'VIDEOFILE') {
      if (typeof json.bms.videoFile !== 'string' && value.length > 0) {
        json.bms.videoFile = value;
      }
      continue;
    }
    if (upper === 'MATERIALS') {
      if (typeof json.bms.materials !== 'string' && value.length > 0) {
        json.bms.materials = value;
      }
      continue;
    }
    if (upper === 'DIVIDEPROP') {
      if (typeof json.bms.divideProp !== 'string' && value.length > 0) {
        json.bms.divideProp = value;
      }
      continue;
    }
    if (upper === 'CHARSET') {
      if (typeof json.bms.charset !== 'string' && value.length > 0) {
        json.bms.charset = value;
      }
      continue;
    }

    const exRankMatch = upper.match(/^EXRANK([0-9A-Z]{2})$/);
    if (exRankMatch) {
      const key = normalizeObjectKey(exRankMatch[1]);
      if (!(key in json.bms.exRank) && value.length > 0) {
        json.bms.exRank[key] = value;
      }
      continue;
    }

    const argbMatch = upper.match(/^ARGB([0-9A-Z]{2})$/);
    if (argbMatch) {
      const key = normalizeObjectKey(argbMatch[1]);
      if (!(key in json.bms.argb) && value.length > 0) {
        json.bms.argb[key] = value;
      }
      continue;
    }

    const changeOptionMatch = upper.match(/^CHANGEOPTION([0-9A-Z]{2})$/);
    if (changeOptionMatch) {
      const key = normalizeObjectKey(changeOptionMatch[1]);
      if (!(key in json.bms.changeOption) && value.length > 0) {
        json.bms.changeOption[key] = value;
      }
      continue;
    }

    const exWavMatch = upper.match(/^EXWAV([0-9A-Z]{2})$/);
    if (exWavMatch) {
      const key = normalizeObjectKey(exWavMatch[1]);
      if (!(key in json.bms.exWav) && value.length > 0) {
        json.bms.exWav[key] = value;
      }
      continue;
    }

    const exBmpMatch = upper.match(/^EXBMP([0-9A-Z]{2})$/);
    if (exBmpMatch) {
      const key = normalizeObjectKey(exBmpMatch[1]);
      if (!(key in json.bms.exBmp) && value.length > 0) {
        json.bms.exBmp[key] = value;
      }
      continue;
    }

    const bgaMatch = upper.match(/^BGA([0-9A-Z]{2})$/);
    if (bgaMatch) {
      const key = normalizeObjectKey(bgaMatch[1]);
      if (!(key in json.bms.bga) && value.length > 0) {
        json.bms.bga[key] = value;
      }
      continue;
    }

    const scrollMatch = upper.match(/^SCROLL([0-9A-Z]{2})$/);
    if (scrollMatch) {
      const key = normalizeObjectKey(scrollMatch[1]);
      const parsed = normalizeNumericBmsExtensionValue(value);
      if (!(key in json.bms.scroll) && typeof parsed === 'number') {
        json.bms.scroll[key] = parsed;
      }
      continue;
    }

    const swBgaMatch = upper.match(/^SWBGA([0-9A-Z]{2})$/);
    if (swBgaMatch) {
      const key = normalizeObjectKey(swBgaMatch[1]);
      if (!(key in json.bms.swBga) && value.length > 0) {
        json.bms.swBga[key] = value;
      }
      continue;
    }

    migratedExtras[command] = value;
  }

  json.metadata.extras = migratedExtras;
}

function normalizeBmsExtensions(input: unknown): BeMusicJson['bms'] {
  const normalized: BeMusicJson['bms'] = {
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
  };
  if (!input || typeof input !== 'object') {
    return normalized;
  }

  const raw = input as Record<string, unknown>;
  if (Array.isArray(raw.controlFlow)) {
    const entries: BmsControlFlowEntry[] = [];
    for (const item of raw.controlFlow) {
      const entry = normalizeBmsControlFlowEntry(item);
      if (entry) {
        entries.push(entry);
      }
    }
    normalized.controlFlow = entries;
  }

  if (typeof raw.preview === 'string' && raw.preview.length > 0) {
    normalized.preview = raw.preview;
  }

  const lnType = normalizeNumericBmsExtensionValue(raw.lnType);
  if (typeof lnType === 'number' && lnType > 0) {
    normalized.lnType = Math.floor(lnType);
  }

  const lnMode = normalizeNumericBmsExtensionValue(raw.lnMode ?? raw.lnmode ?? raw.ln_mode);
  if (typeof lnMode === 'number' && lnMode > 0) {
    normalized.lnMode = Math.floor(lnMode);
  }

  if (typeof raw.lnObj === 'string' && raw.lnObj.length > 0) {
    normalized.lnObj = normalizeObjectKey(raw.lnObj);
  }

  const volWav = normalizeNumericBmsExtensionValue(raw.volWav ?? raw.volwav ?? raw.vol_wav);
  if (typeof volWav === 'number' && volWav >= 0) {
    normalized.volWav = volWav;
  }

  const defExRank = normalizeNumericBmsExtensionValue(raw.defExRank);
  if (typeof defExRank === 'number') {
    normalized.defExRank = defExRank;
  }

  normalized.exRank = normalizeIndexedBmsExtensionMap(raw.exRank);
  normalized.argb = normalizeIndexedBmsExtensionMap(raw.argb);

  const player = normalizeNumericBmsExtensionValue(raw.player);
  if (typeof player === 'number' && player > 0) {
    normalized.player = Math.floor(player);
  }

  const pathWav = raw.pathWav ?? raw.path_wav;
  if (typeof pathWav === 'string' && pathWav.length > 0) {
    normalized.pathWav = pathWav;
  }

  const baseBpm = normalizeNumericBmsExtensionValue(raw.baseBpm ?? raw.base_bpm);
  if (typeof baseBpm === 'number' && baseBpm > 0) {
    normalized.baseBpm = baseBpm;
  }

  normalized.stp = normalizeBmsExtensionStringList(raw.stp);

  if (typeof raw.option === 'string' && raw.option.length > 0) {
    normalized.option = raw.option;
  }

  const wavCmd = raw.wavCmd ?? raw.wavcmd ?? raw.wav_cmd;
  if (typeof wavCmd === 'string' && wavCmd.length > 0) {
    normalized.wavCmd = wavCmd;
  }

  normalized.changeOption = normalizeIndexedBmsExtensionMap(raw.changeOption ?? raw.change_option ?? raw.changeoption);
  normalized.exWav = normalizeIndexedBmsExtensionMap(raw.exWav ?? raw.ex_wav ?? raw.exwav);
  normalized.exBmp = normalizeIndexedBmsExtensionMap(raw.exBmp ?? raw.ex_bmp ?? raw.exbmp);
  normalized.bga = normalizeIndexedBmsExtensionMap(raw.bga);
  normalized.scroll = normalizeIndexedBmsExtensionNumericMap(raw.scroll);
  normalized.swBga = normalizeIndexedBmsExtensionMap(raw.swBga ?? raw.sw_bga ?? raw.swbga);

  const poorBga = raw.poorBga ?? raw.poor_bga;
  if (typeof poorBga === 'string' && poorBga.length > 0) {
    normalized.poorBga = poorBga;
  }

  const videoFile = raw.videoFile ?? raw.video_file;
  if (typeof videoFile === 'string' && videoFile.length > 0) {
    normalized.videoFile = videoFile;
  }

  if (typeof raw.materials === 'string' && raw.materials.length > 0) {
    normalized.materials = raw.materials;
  }

  const divideProp = raw.divideProp ?? raw.divide_prop;
  if (typeof divideProp === 'string' && divideProp.length > 0) {
    normalized.divideProp = divideProp;
  }

  if (typeof raw.charset === 'string' && raw.charset.length > 0) {
    normalized.charset = raw.charset;
  }

  return normalized;
}

function normalizeNumericBmsExtensionValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeIndexedBmsExtensionMap(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object') {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const key = normalizeObjectKey(rawKey);
    if (typeof rawValue === 'string' && rawValue.length > 0) {
      normalized[key] = rawValue;
      continue;
    }
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      normalized[key] = String(rawValue);
    }
  }
  return normalized;
}

function normalizeIndexedBmsExtensionNumericMap(input: unknown): Record<string, number> {
  if (!input || typeof input !== 'object') {
    return {};
  }

  const normalized: Record<string, number> = {};
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const parsed = normalizeNumericBmsExtensionValue(rawValue);
    if (typeof parsed === 'number') {
      normalized[normalizeObjectKey(rawKey)] = parsed;
    }
  }
  return normalized;
}

function normalizeBmsExtensionStringList(input: unknown): string[] {
  if (typeof input === 'string') {
    return input.length > 0 ? [input] : [];
  }
  if (!Array.isArray(input)) {
    return [];
  }

  const normalized: string[] = [];
  for (const value of input) {
    if (typeof value === 'string' && value.length > 0) {
      normalized.push(value);
    }
  }
  return normalized;
}

function normalizeBmsControlFlowEntry(input: unknown): BmsControlFlowEntry | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }
  const raw = input as Record<string, unknown>;
  const kind = raw.kind;
  if (kind === 'directive') {
    const command = normalizeControlFlowCommand(raw.command);
    if (!command) {
      return undefined;
    }
    const value =
      typeof raw.value === 'string' && raw.value.length > 0
        ? raw.value
        : typeof raw.value === 'number' && Number.isFinite(raw.value)
          ? String(Math.floor(raw.value))
          : undefined;
    return {
      kind: 'directive',
      command,
      value,
    };
  }
  if (kind === 'header') {
    if (typeof raw.command !== 'string') {
      return undefined;
    }
    return {
      kind: 'header',
      command: raw.command.toUpperCase(),
      value: typeof raw.value === 'string' ? raw.value : '',
    };
  }
  if (kind === 'object') {
    if (typeof raw.measure !== 'number' || !Number.isFinite(raw.measure) || typeof raw.channel !== 'string') {
      return undefined;
    }
    const measure = Math.max(0, Math.floor(raw.measure));
    const channel = normalizeChannel(raw.channel);

    const rawEvents = Array.isArray(raw.events) ? raw.events : [];
    const normalizedEvents = sortAndNormalizeEvents(rawEvents as Array<BeMusicEvent | Record<string, unknown>>)
      .filter((event) => event.measure === measure && normalizeChannel(event.channel) === channel)
      .map((event) => ({
        measure,
        channel,
        position: event.position,
        value: event.value,
        ...(event.bmson ? { bmson: event.bmson } : {}),
      }));

    const measureLength =
      typeof raw.measureLength === 'number' && Number.isFinite(raw.measureLength) && raw.measureLength > 0
        ? raw.measureLength
        : undefined;

    if (normalizedEvents.length === 0 && measureLength === undefined) {
      const fallbackData = typeof raw.data === 'string' ? raw.data.trim() : '';
      return createControlFlowObjectEntry(measure, channel, fallbackData);
    }

    return {
      kind: 'object',
      measure,
      channel,
      events: normalizedEvents,
      measureLength,
    };
  }
  return undefined;
}
