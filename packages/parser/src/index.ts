import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import iconv from 'iconv-lite';
import {
  BMS_JSON_FORMAT,
  cloneJson,
  type BmsControlFlowCommand,
  type BmsControlFlowEntry,
  type BeMusicEvent,
  type BeMusicPosition,
  type BeMusicJson,
  createEmptyJson,
  intToBase36,
  normalizeChannel,
  normalizeObjectKey,
} from '@be-music/json';
import { normalizeFractionNumerator, normalizeNonNegativeInt, normalizePositiveInt } from '@be-music/utils';

const OBJECT_DATA_LINE = /^#(\d{3})([0-9A-Z]{2})\s*:\s*(.+)\s*$/i;
const HEADER_LINE = /^#([A-Z][A-Z0-9_]*)(?:\s+(.+))?$/i;
const CONTROL_FLOW_LINE =
  /^#(RANDOM|SETRANDOM|IF|ELSEIF|ELSE|ENDIF|ENDRANDOM|SWITCH|SETSWITCH|CASE|SKIP|DEF|ENDSW)(?:\s+(.+))?$/i;
const BMS_KNOWN_COMMAND_LINE =
  /^#(?:TITLE|SUBTITLE|ARTIST|GENRE|COMMENT|BPM|PLAYLEVEL|RANK|TOTAL|DIFFICULTY|STAGEFILE|LNTYPE|LNOBJ|DEFEXRANK|PLAYER|PATH_WAV|BASEBPM|STP|OPTION|WAVCMD|POORBGA|VIDEOFILE|MATERIALS|DIVIDEPROP|CHARSET|WAV[0-9A-Z]{2}|BMP[0-9A-Z]{2}|BPM[0-9A-Z]{2}|STOP[0-9A-Z]{2}|TEXT[0-9A-Z]{2}|EXRANK[0-9A-Z]{2}|ARGB[0-9A-Z]{2}|CHANGEOPTION[0-9A-Z]{2}|EXWAV[0-9A-Z]{2}|EXBMP[0-9A-Z]{2}|BGA[0-9A-Z]{2}|SWBGA[0-9A-Z]{2}|RANDOM\s+\d+|SETRANDOM\s+\d+|ENDRANDOM|IF\s+\d+|ELSEIF\s+\d+|ELSE|ENDIF|SWITCH\s+\d+|SETSWITCH\s+\d+|CASE\s+\d+|DEF|SKIP|ENDSW|[0-9]{3}[0-9A-Z]{2}\s*:)/i;
const INDEXED_HEADER_COMMAND = /^(WAV|BMP|BPM|STOP|TEXT|EXRANK|ARGB|CHANGEOPTION|EXWAV|EXBMP|BGA|SWBGA)([0-9A-Z]{2})$/;

type DetectedBmsEncoding = 'utf8' | 'shift_jis' | 'euc-jp' | 'latin1' | 'utf16le' | 'utf16be';

interface DecodedBmsText {
  encoding: DetectedBmsEncoding;
  text: string;
}

interface BmsonInfo {
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

interface BmsonBpmEvent {
  y: number;
  bpm: number;
}

interface BmsonStopEvent {
  y: number;
  duration: number;
}

interface BmsonSoundNote {
  x?: number;
  y: number;
  l?: number;
  c?: boolean;
}

interface BmsonSoundChannel {
  name: string;
  notes?: BmsonSoundNote[];
}

interface BmsonDocument {
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

type ControlFlowCommand = BmsControlFlowCommand;

type ControlFlowCaptureFrameType = 'random' | 'if' | 'switch';

interface RandomControlFrame {
  type: 'random';
  value: number;
}

interface IfControlFrame {
  type: 'if';
  active: boolean;
  matched: boolean;
  hasElse: boolean;
}

interface SwitchControlFrame {
  type: 'switch';
  value: number;
  active: boolean;
  matched: boolean;
  fallthrough: boolean;
  terminated: boolean;
}

type ControlFlowFrame = RandomControlFrame | IfControlFrame | SwitchControlFrame;
type MeasureLengthEntry = BeMusicJson['measures'][number];

export function parseBms(input: string): BeMusicJson {
  const json = createEmptyJson('bms');
  const controlFlowCaptureStack: ControlFlowCaptureFrameType[] = [];
  const measureByIndex = new Map<number, MeasureLengthEntry>();

  const lines = input.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith('#')) {
      continue;
    }

    const second = line.charCodeAt(1);
    const startsWithMeasure = second >= 0x30 && second <= 0x39;
    if (startsWithMeasure) {
      const objectMatch = line.match(OBJECT_DATA_LINE);
      if (!objectMatch) {
        continue;
      }
      const measure = Number.parseInt(objectMatch[1], 10);
      const channel = normalizeChannel(objectMatch[2]);
      const data = objectMatch[3].trim();
      if (controlFlowCaptureStack.length > 0) {
        const controlFlowObject = createControlFlowObjectEntry(measure, channel, data);
        if (controlFlowObject) {
          json.bms.controlFlow.push(controlFlowObject);
        }
      } else {
        pushObjectDataLine(json, measure, channel, data, measureByIndex);
      }
      continue;
    }

    const controlFlowMatch = line.match(CONTROL_FLOW_LINE);
    if (controlFlowMatch) {
      const command = controlFlowMatch[1].toUpperCase() as ControlFlowCommand;
      const value = controlFlowMatch[2]?.trim();
      json.bms.controlFlow.push({
        kind: 'directive',
        command,
        value,
      });
      updateControlFlowCaptureStack(controlFlowCaptureStack, command);
      continue;
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
      continue;
    }

    const headerMatch = line.match(HEADER_LINE);
    if (!headerMatch) {
      continue;
    }

    const command = headerMatch[1].toUpperCase();
    const value = headerMatch[2]?.trim() ?? '';
    pushHeaderLine(json, command, value);
  }

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
  soundChannels.forEach((soundChannel, index) => {
    const key = intToBase36(index + 1, 2);
    json.resources.wav[key] = soundChannel.name;
    const notes = soundChannel.notes ?? [];
    const playableTicks = new Set<number>();
    for (const note of notes) {
      if (!Number.isFinite(note.y) || !Number.isFinite(note.x)) {
        continue;
      }
      const lane = Math.floor(note.x!);
      if (lane > 0) {
        playableTicks.add(Math.round(note.y));
      }
    }

    for (const note of notes) {
      if (!Number.isFinite(note.y)) {
        continue;
      }

      const pulse = Math.round(note.y);
      const lane = Number.isFinite(note.x) ? Math.floor(note.x!) : 0;
      const isBgmNote = lane <= 0;
      if (isBgmNote && playableTicks.has(pulse)) {
        continue;
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
      json.events.push(event);
    }
  });

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

export function parseJson(input: string): BeMusicJson {
  const raw = JSON.parse(input) as Partial<BeMusicJson>;
  return parseJsonDocument(raw);
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
  if (input.bms.controlFlow.length === 0) {
    return cloneJson(input);
  }

  const random = options.random ?? Math.random;
  const json = cloneJson(input);
  const stack: ControlFlowFrame[] = [];
  const measureByIndex = new Map<number, MeasureLengthEntry>();
  for (const measure of json.measures) {
    measureByIndex.set(measure.index, measure);
  }

  for (const entry of json.bms.controlFlow) {
    if (entry.kind === 'directive') {
      applyControlFlowCommand(stack, entry.command, entry.value, random);
      continue;
    }
    if (!isControlFlowActive(stack)) {
      continue;
    }
    applyActiveControlFlowEntry(json, entry, measureByIndex);
  }

  json.measures.sort((left, right) => left.index - right.index);
  json.events = sortAndNormalizeEvents(json.events);
  return json;
}

export function decodeBmsText(buffer: Buffer): DecodedBmsText {
  if (hasUtf8Bom(buffer)) {
    return {
      encoding: 'utf8',
      text: decodeUtf8Text(buffer),
    };
  }
  if (hasUtf16LeBom(buffer)) {
    return {
      encoding: 'utf16le',
      text: decodeUtf16LeText(buffer),
    };
  }
  if (hasUtf16BeBom(buffer)) {
    return {
      encoding: 'utf16be',
      text: decodeUtf16BeText(buffer),
    };
  }

  const candidates: Array<{ encoding: DetectedBmsEncoding; bias: number }> = [
    { encoding: 'shift_jis', bias: 5 },
    { encoding: 'utf8', bias: 4 },
    { encoding: 'euc-jp', bias: 3 },
    { encoding: 'latin1', bias: -5 },
  ];

  let best: DecodedBmsText | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const text = iconv.decode(buffer, candidate.encoding);
    const score = scoreDecodedBmsText(text, candidate.bias);
    if (score > bestScore) {
      bestScore = score;
      best = {
        encoding: candidate.encoding,
        text,
      };
    }
  }

  return (
    best ?? {
      encoding: 'utf8',
      text: decodeUtf8Text(buffer),
    }
  );
}

function scoreDecodedBmsText(text: string, bias: number): number {
  let score = bias;
  if (text.length === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  const textStats = collectTextStatistics(text);
  score -= textStats.replacementCount * 120;
  score -= textStats.nullCount * 80;
  score -= textStats.lowControlCount * 8;

  const lines = text.split(/\r?\n/);
  let hashLines = 0;
  let objectLines = 0;
  let headerLines = 0;
  let knownCommandLines = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('#')) {
      continue;
    }

    hashLines += 1;
    if (OBJECT_DATA_LINE.test(trimmed)) {
      objectLines += 1;
    } else if (HEADER_LINE.test(trimmed)) {
      headerLines += 1;
    }
    if (BMS_KNOWN_COMMAND_LINE.test(trimmed)) {
      knownCommandLines += 1;
    }
  }

  score += hashLines * 0.4;
  score += objectLines * 14;
  score += headerLines * 8;
  score += knownCommandLines * 3;

  const printableRatio = textStats.printableCount / Math.max(1, text.length);
  score += printableRatio * 20;

  score += Math.min(40, textStats.japaneseCount * 0.02);

  return score;
}

function collectTextStatistics(text: string): {
  replacementCount: number;
  nullCount: number;
  lowControlCount: number;
  printableCount: number;
  japaneseCount: number;
} {
  let replacementCount = 0;
  let nullCount = 0;
  let lowControlCount = 0;
  let printableCount = 0;
  let japaneseCount = 0;

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 0xfffd) {
      replacementCount += 1;
    }
    if (code === 0x0000) {
      nullCount += 1;
    }
    if (
      (code >= 0x0001 && code <= 0x0008) ||
      (code >= 0x000b && code <= 0x000c) ||
      (code >= 0x000e && code <= 0x001f)
    ) {
      lowControlCount += 1;
    }
    if (
      code === 0x000a ||
      code === 0x000d ||
      code === 0x0009 ||
      (code >= 0x0020 && code <= 0x007e) ||
      (code >= 0x00a0 && code <= 0x00ff) ||
      (code >= 0x3000 && code <= 0x30ff) ||
      (code >= 0x3400 && code <= 0x9fff)
    ) {
      printableCount += 1;
    }
    if ((code >= 0x3040 && code <= 0x30ff) || (code >= 0x3400 && code <= 0x9fff)) {
      japaneseCount += 1;
    }
  }

  return {
    replacementCount,
    nullCount,
    lowControlCount,
    printableCount,
    japaneseCount,
  };
}

function decodeUtf8Text(buffer: Buffer): string {
  let text = buffer.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  return text;
}

function decodeUtf16LeText(buffer: Buffer): string {
  const offset = hasUtf16LeBom(buffer) ? 2 : 0;
  return buffer.subarray(offset).toString('utf16le');
}

function decodeUtf16BeText(buffer: Buffer): string {
  const offset = hasUtf16BeBom(buffer) ? 2 : 0;
  const source = buffer.subarray(offset);
  const evenLength = source.length - (source.length % 2);
  const swapped = Buffer.allocUnsafe(evenLength);

  for (let index = 0; index < evenLength; index += 2) {
    swapped[index] = source[index + 1];
    swapped[index + 1] = source[index];
  }
  return swapped.toString('utf16le');
}

function hasUtf8Bom(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
}

function hasUtf16LeBom(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe;
}

function hasUtf16BeBom(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff;
}

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
    case 'LNOBJ':
      if (value.length > 0) {
        json.bms.lnObj = normalizeObjectKey(value);
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
    if (upper === 'LNTYPE') {
      const parsed = normalizeNumericBmsExtensionValue(value);
      if (typeof json.bms.lnType !== 'number' && typeof parsed === 'number' && parsed > 0) {
        json.bms.lnType = Math.floor(parsed);
      }
      continue;
    }
    if (upper === 'LNOBJ') {
      if (typeof json.bms.lnObj !== 'string' && value.length > 0) {
        json.bms.lnObj = normalizeObjectKey(value);
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

function collectNonZeroObjectTokens(input: string): {
  tokenCount: number;
  tokens: Array<{ index: number; value: string }>;
} {
  // BMS object positions need the total token count (denominator), but only non-zero tokens become events.
  const tokens: Array<{ index: number; value: string }> = [];
  let tokenCount = 0;
  let high = '';
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    const normalized = normalizeAsciiTokenChar(code);
    if (!normalized) {
      continue;
    }
    if (high.length === 0) {
      high = normalized;
      continue;
    }
    const value = high + normalized;
    if (value !== '00') {
      tokens.push({ index: tokenCount, value });
    }
    tokenCount += 1;
    high = '';
  }
  return { tokenCount, tokens };
}

function sortAndNormalizeEvents(events: Array<BeMusicEvent | Record<string, unknown>>): BeMusicEvent[] {
  const normalized: BeMusicEvent[] = [];
  for (const event of events) {
    const parsed = normalizeRawEvent(event);
    if (parsed) {
      normalized.push(parsed);
    }
  }

  normalized.sort((left, right) => {
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
  return normalized;
}

function normalizeRawEvent(event: BeMusicEvent | Record<string, unknown>): BeMusicEvent | undefined {
  const raw = event as Record<string, unknown>;
  const measure = normalizeMeasure(raw.measure);
  const channel = normalizeEventChannel(raw.channel);
  const value = normalizeEventValue(raw.value);
  const position = normalizePosition(raw.position);
  if (measure === undefined || channel === undefined || value === undefined || position === undefined) {
    return undefined;
  }
  const bmson = normalizeEventBmsonExtension(raw.bmson);
  return {
    measure,
    channel,
    position,
    value,
    ...(bmson ? { bmson } : {}),
  };
}

function normalizeMeasure(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return normalizeNonNegativeInt(value);
}

function normalizeEventChannel(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  return normalizeChannel(value);
}

function normalizeEventValue(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  return normalizeObjectKey(value);
}

function normalizePosition(position: unknown): BeMusicPosition | undefined {
  if (!Array.isArray(position) || position.length < 2) {
    return undefined;
  }
  const denominator = normalizePositionDenominator(position[1]);
  if (denominator === undefined) {
    return undefined;
  }
  const numerator = normalizePositionNumerator(position[0], denominator);
  if (numerator === undefined) {
    return undefined;
  }
  return [numerator, denominator];
}

function normalizePositionDenominator(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return normalizePositiveInt(value);
}

function normalizePositionNumerator(value: unknown, denominator: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return normalizeFractionNumerator(value, denominator);
}

function normalizeEventBmsonExtension(value: unknown): BeMusicEvent['bmson'] | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const extension: NonNullable<BeMusicEvent['bmson']> = {};
  const length = normalizeBmsonNoteLength(raw.l);
  if (length !== undefined) {
    extension.l = length;
  }
  if (typeof raw.c === 'boolean') {
    extension.c = raw.c;
  }
  return Object.keys(extension).length > 0 ? extension : undefined;
}

function compareEventPosition(left: BeMusicEvent, right: BeMusicEvent): number {
  if (left.position[1] === right.position[1]) {
    return left.position[0] - right.position[0];
  }

  const leftScaled = left.position[0] * right.position[1];
  const rightScaled = right.position[0] * left.position[1];
  if (Number.isSafeInteger(leftScaled) && Number.isSafeInteger(rightScaled)) {
    if (leftScaled < rightScaled) {
      return -1;
    }
    if (leftScaled > rightScaled) {
      return 1;
    }
    return 0;
  }

  const leftScaledBigInt = BigInt(left.position[0]) * BigInt(right.position[1]);
  const rightScaledBigInt = BigInt(right.position[0]) * BigInt(left.position[1]);
  if (leftScaledBigInt < rightScaledBigInt) {
    return -1;
  }
  if (leftScaledBigInt > rightScaledBigInt) {
    return 1;
  }
  return 0;
}

function normalizeAsciiTokenChar(code: number): string | undefined {
  if (code >= 0x30 && code <= 0x39) {
    return String.fromCharCode(code);
  }
  if (code >= 0x41 && code <= 0x5a) {
    return String.fromCharCode(code);
  }
  if (code >= 0x61 && code <= 0x7a) {
    return String.fromCharCode(code - 0x20);
  }
  return undefined;
}

function upsertMeasureLength(
  json: BeMusicJson,
  measure: number,
  length: number,
  measureByIndex?: Map<number, MeasureLengthEntry>,
): void {
  const cached = measureByIndex?.get(measure);
  if (cached) {
    cached.length = length;
    return;
  }
  if (measureByIndex) {
    const created = { index: measure, length };
    json.measures.push(created);
    measureByIndex.set(measure, created);
    return;
  }
  const found = json.measures.find((item) => item.index === measure);
  if (found) {
    found.length = length;
  } else {
    json.measures.push({ index: measure, length });
  }
}

function buildBmsonLaneMap(soundChannels: BmsonSoundChannel[]): Map<number, string> {
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

function laneIndexToChannel(index: number): string {
  const digits = '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const first = digits[Math.floor(index / digits.length)] ?? '1';
  const second = digits[index % digits.length];
  return `${first}${second}`;
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

  const lnType = normalizeNumericBmsExtensionValue(raw.lnType);
  if (typeof lnType === 'number' && lnType > 0) {
    normalized.lnType = Math.floor(lnType);
  }

  if (typeof raw.lnObj === 'string' && raw.lnObj.length > 0) {
    normalized.lnObj = normalizeObjectKey(raw.lnObj);
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

function normalizeBmsonInfoForIr(info: BmsonInfo, resolution: number): BeMusicJson['bmson']['info'] {
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

function normalizeBmsonBgaForIr(input: BmsonDocument['bga'] | undefined): BeMusicJson['bmson']['bga'] {
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

function normalizeBmsonNoteLength(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.floor(value);
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

function normalizeBmsonExtensions(input: unknown): BeMusicJson['bmson'] {
  const normalized: BeMusicJson['bmson'] = {
    lines: [],
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

  normalized.lines = normalizeBmsonLines(raw.lines);
  normalized.info = normalizeBmsonInfoFromIr(raw.info);
  normalized.bga = normalizeBmsonBgaFromIr(raw.bga);

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

function normalizeControlFlowCommand(input: unknown): ControlFlowCommand | undefined {
  if (typeof input !== 'string') {
    return undefined;
  }
  const normalized = input.toUpperCase();
  if (
    normalized === 'RANDOM' ||
    normalized === 'SETRANDOM' ||
    normalized === 'IF' ||
    normalized === 'ELSEIF' ||
    normalized === 'ELSE' ||
    normalized === 'ENDIF' ||
    normalized === 'ENDRANDOM' ||
    normalized === 'SWITCH' ||
    normalized === 'SETSWITCH' ||
    normalized === 'CASE' ||
    normalized === 'SKIP' ||
    normalized === 'DEF' ||
    normalized === 'ENDSW'
  ) {
    return normalized;
  }
  return undefined;
}

function resolveBmsonResolution(document: BmsonDocument): number {
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

function normalizeBmsonLines(lines: unknown): number[] {
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

  const sorted = [...new Set(values)].sort((left, right) => left - right);
  if (sorted.length === 0) {
    return [];
  }
  if (sorted[0] !== 0) {
    sorted.unshift(0);
  }
  return sorted;
}

function createMeasureLengthsFromBmsonLines(
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

function createBmsonPositionResolver(resolution: number, lines: number[]): (y: number) => MeasurePositionWithFraction {
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

function updateControlFlowCaptureStack(stack: ControlFlowCaptureFrameType[], command: ControlFlowCommand): void {
  if (command === 'RANDOM' || command === 'SETRANDOM') {
    stack.push('random');
    return;
  }
  if (command === 'SWITCH' || command === 'SETSWITCH') {
    stack.push('switch');
    return;
  }
  if (command === 'IF') {
    stack.push('if');
    return;
  }
  if (command === 'ENDIF') {
    removeCurrentCaptureFrame(stack, 'if');
    return;
  }
  if (command === 'ENDRANDOM') {
    removeCurrentCaptureFrame(stack, 'random');
    return;
  }
  if (command === 'ENDSW') {
    removeCurrentCaptureFrame(stack, 'switch');
  }
}

function removeCurrentCaptureFrame(stack: ControlFlowCaptureFrameType[], type: ControlFlowCaptureFrameType): void {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index] === type) {
      stack.splice(index, 1);
      return;
    }
  }
}

function applyActiveControlFlowEntry(
  json: BeMusicJson,
  entry: BmsControlFlowEntry,
  measureByIndex?: Map<number, MeasureLengthEntry>,
): void {
  if (entry.kind === 'header') {
    pushHeaderLine(json, entry.command, entry.value);
    return;
  }
  if (entry.kind === 'object') {
    if (typeof entry.measureLength === 'number' && entry.measureLength > 0) {
      upsertMeasureLength(json, entry.measure, entry.measureLength, measureByIndex);
    }
    for (const event of entry.events) {
      json.events.push({
        measure: entry.measure,
        channel: normalizeChannel(entry.channel),
        position: event.position,
        value: normalizeObjectKey(event.value),
        ...(event.bmson ? { bmson: event.bmson } : {}),
      });
    }
  }
}

function createControlFlowObjectEntry(
  measure: number,
  channel: string,
  data: string,
): Extract<BmsControlFlowEntry, { kind: 'object' }> | undefined {
  if (channel === '02') {
    const measureLength = Number.parseFloat(data);
    if (!Number.isFinite(measureLength) || measureLength <= 0) {
      return undefined;
    }
    return {
      kind: 'object',
      measure,
      channel,
      events: [],
      measureLength,
    };
  }

  const parsed = collectNonZeroObjectTokens(data);
  const events: BeMusicEvent[] = [];
  for (const token of parsed.tokens) {
    events.push({
      measure,
      channel,
      position: [token.index, parsed.tokenCount],
      value: token.value,
    });
  }

  if (events.length === 0) {
    return undefined;
  }
  return {
    kind: 'object',
    measure,
    channel,
    events,
  };
}

function applyControlFlowCommand(
  stack: ControlFlowFrame[],
  command: ControlFlowCommand,
  rawValue?: string,
  random: () => number = Math.random,
): void {
  if (command === 'RANDOM') {
    const max = parsePositiveInteger(rawValue) ?? 1;
    stack.push({
      type: 'random',
      value: generateRandomValue(max, random),
    });
    return;
  }

  if (command === 'SETRANDOM') {
    stack.push({
      type: 'random',
      value: parsePositiveInteger(rawValue) ?? 1,
    });
    return;
  }

  if (command === 'IF') {
    const label = parsePositiveInteger(rawValue);
    const randomValue = getCurrentRandomValue(stack);
    const matched = label !== undefined && randomValue !== undefined && label === randomValue;
    stack.push({
      type: 'if',
      active: matched,
      matched,
      hasElse: false,
    });
    return;
  }

  if (command === 'ELSEIF') {
    const frame = getCurrentIfFrame(stack);
    if (!frame || frame.hasElse || frame.matched) {
      if (frame) {
        frame.active = false;
      }
      return;
    }

    const label = parsePositiveInteger(rawValue);
    const randomValue = getCurrentRandomValue(stack);
    const matched = label !== undefined && randomValue !== undefined && label === randomValue;
    frame.active = matched;
    if (matched) {
      frame.matched = true;
    }
    return;
  }

  if (command === 'ELSE') {
    const frame = getCurrentIfFrame(stack);
    if (!frame || frame.hasElse) {
      if (frame) {
        frame.active = false;
      }
      return;
    }

    frame.hasElse = true;
    if (frame.matched) {
      frame.active = false;
      return;
    }
    frame.active = true;
    frame.matched = true;
    return;
  }

  if (command === 'ENDIF') {
    removeCurrentFrame(stack, 'if');
    return;
  }

  if (command === 'ENDRANDOM') {
    removeCurrentFrame(stack, 'random');
    return;
  }

  if (command === 'SWITCH') {
    const max = parsePositiveInteger(rawValue) ?? 1;
    stack.push({
      type: 'switch',
      value: generateRandomValue(max, random),
      active: false,
      matched: false,
      fallthrough: false,
      terminated: false,
    });
    return;
  }

  if (command === 'SETSWITCH') {
    stack.push({
      type: 'switch',
      value: parsePositiveInteger(rawValue) ?? 1,
      active: false,
      matched: false,
      fallthrough: false,
      terminated: false,
    });
    return;
  }

  if (command === 'CASE') {
    const frame = getCurrentSwitchFrame(stack);
    if (!frame) {
      return;
    }
    if (frame.terminated) {
      frame.active = false;
      frame.fallthrough = false;
      return;
    }
    if (frame.fallthrough) {
      frame.active = true;
      return;
    }

    const label = parsePositiveInteger(rawValue);
    const matched = label !== undefined && label === frame.value;
    frame.active = matched;
    frame.fallthrough = matched;
    if (matched) {
      frame.matched = true;
    }
    return;
  }

  if (command === 'DEF') {
    const frame = getCurrentSwitchFrame(stack);
    if (!frame) {
      return;
    }
    if (frame.terminated) {
      frame.active = false;
      frame.fallthrough = false;
      return;
    }
    if (frame.fallthrough) {
      frame.active = true;
      return;
    }

    const shouldActivate = !frame.matched;
    frame.active = shouldActivate;
    frame.fallthrough = shouldActivate;
    if (shouldActivate) {
      frame.matched = true;
    }
    return;
  }

  if (command === 'SKIP') {
    const frame = getCurrentSwitchFrame(stack);
    if (!frame) {
      return;
    }
    if (!frame.active) {
      return;
    }
    frame.terminated = true;
    frame.active = false;
    frame.fallthrough = false;
    return;
  }

  if (command === 'ENDSW') {
    removeCurrentFrame(stack, 'switch');
  }
}

function parsePositiveInteger(value?: string): number | undefined {
  if (!value || value.length === 0) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  const normalized = Math.floor(parsed);
  if (normalized <= 0) {
    return undefined;
  }
  return normalized;
}

function generateRandomValue(max: number, random: () => number): number {
  const normalized = Math.max(1, Math.floor(max));
  if (normalized <= 1) {
    return 1;
  }
  const value = random();
  const clamped = Number.isFinite(value) ? Math.max(0, Math.min(0.999999999, value)) : 0;
  return Math.floor(clamped * normalized) + 1;
}

function isControlFlowActive(stack: ControlFlowFrame[]): boolean {
  for (const frame of stack) {
    if (frame.type === 'if' && !frame.active) {
      return false;
    }
    if (frame.type === 'switch' && !frame.active) {
      return false;
    }
  }
  return true;
}

function getCurrentRandomValue(stack: ControlFlowFrame[]): number | undefined {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const frame = stack[index];
    if (frame.type === 'random') {
      return frame.value;
    }
  }
  return undefined;
}

function getCurrentIfFrame(stack: ControlFlowFrame[]): IfControlFrame | undefined {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const frame = stack[index];
    if (frame.type === 'if') {
      return frame;
    }
  }
  return undefined;
}

function getCurrentSwitchFrame(stack: ControlFlowFrame[]): SwitchControlFrame | undefined {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const frame = stack[index];
    if (frame.type === 'switch') {
      return frame;
    }
  }
  return undefined;
}

function removeCurrentFrame(stack: ControlFlowFrame[], type: ControlFlowFrame['type']): void {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index].type === type) {
      stack.splice(index, 1);
      return;
    }
  }
}
