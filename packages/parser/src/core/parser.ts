import {
  BMS_JSON_FORMAT,
  type BmsControlFlowCommand,
  type BmsControlFlowEntry,
  type BmsObjectLineEntry,
  type BmsSourceLineEntry,
  type BeMusicEvent,
  type BeMusicJson,
  createEmptyJson,
  intToBase36,
  normalizeChannel,
  normalizeObjectKey,
  resolveBmsBase,
} from '@be-music/json';
import { normalizeAsciiBase36Code } from '@be-music/utils/core';
import {
  collectNonZeroObjectTokens,
  normalizeBmsonNoteLength,
  sortAndNormalizeEvents,
  upsertMeasureLength,
} from './event-utils.ts';
import {
  bmsPlayableChannelToLandmineChannel,
  buildBmsonLaneMap,
  createBmsonPositionResolver,
  createMeasureLengthsFromBmsonLines,
  type BmsonDocument,
  normalizeBmsonBpmEvents,
  normalizeBmsonBgaForIr,
  normalizeBmsonExtensions,
  normalizeBmsonInfoForIr,
  normalizeBmsonKeyChannels,
  normalizeBmsonLines,
  normalizeBmsonSoundChannels,
  normalizeBmsonStopEvents,
  resolveBmsonResolution,
} from './bmson.ts';
import {
  createControlFlowObjectEntry,
  normalizeControlFlowCommand,
  resolveControlFlow,
  type ControlFlowCaptureFrameType,
  updateControlFlowCaptureStack,
} from './control-flow.ts';

const INDEXED_HEADER_COMMAND =
  /^(WAV|BMP|BPM|STOP|TEXT|EXRANK|ARGB|CHANGEOPTION|EXWAV|EXBMP|BGA|SCROLL|SPEED|SWBGA)([0-9A-Za-z]{2})$/;
/**
 * Pre-scans for the BMS `#BASE` directive (the beatoraja base-62
 * extension switch). Default base is 36; only `#BASE 62` or
 * `#BASE 36` are recognised. We do a one-pass forward scan and
 * stop at the first object data line, mirroring real implementations
 * that require `#BASE` to come before any objects.
 */
const BASE_DIRECTIVE_REGEX = /^#BASE\s+(36|62)\b/i;
const CONTROL_FLOW_COMMANDS: ReadonlySet<BmsControlFlowCommand> = new Set([
  'RANDOM',
  'SETRANDOM',
  'IF',
  'ELSEIF',
  'ELSE',
  'ENDIF',
  'ENDRANDOM',
  'SWITCH',
  'SETSWITCH',
  'CASE',
  'SKIP',
  'DEF',
  'ENDSW',
]);
type IndexedHeaderDirective =
  | 'WAV'
  | 'BMP'
  | 'BPM'
  | 'STOP'
  | 'TEXT'
  | 'EXRANK'
  | 'ARGB'
  | 'CHANGEOPTION'
  | 'EXWAV'
  | 'EXBMP'
  | 'BGA'
  | 'SCROLL'
  | 'SPEED'
  | 'SWBGA';

type MeasureLengthEntry = BeMusicJson['measures'][number];

export function parseBms(input: string): BeMusicJson {
  const json = createEmptyJson('bms');
  const controlFlowCaptureStack: ControlFlowCaptureFrameType[] = [];
  const measureByIndex = new Map<number, MeasureLengthEntry>();
  let hasValidMainBpmHeader = false;
  // Resolve the chart's object-ID radix BEFORE main parsing so that
  // every `#WAVxx` / `#BMPxx` key + every channel-stream token gets
  // normalised under the right rule. Default is base 36 (case-fold
  // lowercase to uppercase). `#BASE 62` opts into the beatoraja
  // extension where lowercase `a-z` is a separate ID space.
  const base = detectBmsBase(input);
  if (base === 62) {
    json.bms.base = 62;
  }

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
        const controlFlowObject = createControlFlowObjectEntry(measure, channel, data, base);
        if (controlFlowObject) {
          json.bms.controlFlow.push(controlFlowObject);
          json.preservation.bms.sourceLines.push(controlFlowObject);
        }
      } else {
        const objectLine = createBmsObjectLineEntry(measure, channel, data, base);
        if (objectLine) {
          json.preservation.bms.objectLines.push(objectLine);
          json.preservation.bms.sourceLines.push({
            kind: 'object',
            ...objectLine,
          });
        }
        pushObjectDataLine(json, measure, channel, data, base, measureByIndex);
      }
      return;
    }

    const headerLine = parseHeaderDirectiveLine(line);
    if (!headerLine) {
      return;
    }
    const { command, commandRaw, value } = headerLine;

    if (isControlFlowCommand(command)) {
      const directiveEntry: BmsSourceLineEntry = {
        kind: 'directive',
        command,
        value: value.length > 0 ? value : undefined,
      };
      json.bms.controlFlow.push(directiveEntry);
      json.preservation.bms.sourceLines.push(directiveEntry);
      updateControlFlowCaptureStack(controlFlowCaptureStack, command);
      return;
    }

    // Stash the case-preserved command on captured entries when it
    // differs from the uppercased canonical form. Only base-62
    // charts (`#BASE 62`) put lowercase letters in indexed-header
    // keys (e.g. `#WAV0a`), so most charts skip this entirely and
    // the JSON stays compact.
    const commandCaseDiffers = command !== commandRaw;
    if (controlFlowCaptureStack.length > 0) {
      const headerEntry: BmsSourceLineEntry = {
        kind: 'header',
        command,
        value,
        ...(commandCaseDiffers ? { commandRaw } : {}),
      };
      json.bms.controlFlow.push(headerEntry);
      json.preservation.bms.sourceLines.push(headerEntry);
      return;
    }

    json.preservation.bms.sourceLines.push({
      kind: 'header',
      command,
      value,
      ...(commandCaseDiffers ? { commandRaw } : {}),
    });
    if (command === 'BPM') {
      const parsedMainBpm = Number.parseFloat(value);
      if (Number.isFinite(parsedMainBpm) && parsedMainBpm > 0) {
        hasValidMainBpmHeader = true;
      }
    }
    pushHeaderLine(json, command, commandRaw, value, base);
  });

  if (!hasValidMainBpmHeader) {
    // BMS compatibility: if #BPM is not declared, treat 130 as the default base BPM.
    json.metadata.bpm = 130;
  }
  json.measures.sort((left, right) => left.index - right.index);
  json.events = sortAndNormalizeEvents(json.events, base);
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
  // Per spec, the difference between "lines missing" and
  // "lines: []" matters: missing → assume 4/4 and generate a
  // barline every 4 quarter notes (the renderer's default
  // derive-from-events path); explicit empty → no barlines at
  // all (the "100 % minimoo-G effect"). Detect the explicit-
  // empty case here so the IR carries the suppress flag, since
  // both shapes collapse to `[]` after `normalizeBmsonLines`.
  const linesAuthoredEmpty = Array.isArray(document.lines) && document.lines.length === 0;
  if (linesAuthoredEmpty) {
    json.bmson.barlinesSuppressed = true;
  }
  const lines = normalizeBmsonLines(document.lines);
  const positionResolver = createBmsonPositionResolver(resolution, lines);
  if (lines.length > 0) {
    json.preservation.bmson.lines = lines;
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
  } else {
    // bmson 1.0.0 spec — "It is a fatal error if `info.init_bpm`
    // is unspecified." A chart that omits / zeroes / negates
    // `init_bpm` has no anchor for tempo-driven timing, so
    // every downstream calculation (note seconds, BGA cues,
    // gauge timing) silently falls back to whatever
    // `metadata.bpm` was seeded with — typically the
    // `DEFAULT_BPM = 130` placeholder, which produces visibly
    // wrong playback for any chart that wasn't authored at 130.
    // Surface the violation as a parse error so the loader
    // surfaces a clear "broken chart" diagnostic rather than
    // playing the chart back at the wrong tempo.
    throw new Error(
      'bmson: info.init_bpm is required (spec: "It is a fatal error if info.init_bpm is unspecified")',
    );
  }
  if (Number.isFinite(json.bmson.info.judgeRank)) {
    json.metadata.rank = json.bmson.info.judgeRank;
  }
  if (Number.isFinite(json.bmson.info.total)) {
    json.metadata.total = json.bmson.info.total;
  } else {
    // bmson 1.0.0 spec — `info.total` default is 100. We pin
    // that here (rather than letting the BMS-flavoured
    // `LR2_GROOVE_GAUGE_DEFAULT_TOTAL = 160` fallback take
    // over) so a bmson chart that omits `total` runs with the
    // gauge curve its author / the spec assumed.
    json.metadata.total = 100;
  }
  // Mirror bmson's `info.backImage` / `bannerImage` / `eyecatchImage`
  // onto the unified `metadata` slots so consumers (the select view's
  // BACKBMP loader, rendered banner, etc.) don't need to branch on
  // chart format.
  if (json.bmson.info.backImage) {
    json.metadata.backBmp = json.bmson.info.backImage;
  }
  if (json.bmson.info.bannerImage) {
    json.metadata.banner = json.bmson.info.bannerImage;
  }
  if (json.bmson.info.eyecatchImage && !json.metadata.stageFile) {
    json.metadata.stageFile = json.bmson.info.eyecatchImage;
  }

  const soundChannels = normalizeBmsonSoundChannels(document.sound_channels);
  json.preservation.bmson.soundChannels = soundChannels;
  // Lane mapping honours `mode_hint` so canonical IIDX / Pop'n
  // bmson dialects route the right keys onto the right BMS
  // channels — the legacy positional fallback would mis-route
  // `beat-7k` x=6/7 onto scratch (`16`) / FREE ZONE (`17`)
  // because those channel digits come next in numeric order.
  const laneMap = buildBmsonLaneMap(soundChannels, json.bmson.info.modeHint);
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

  // beatoraja `key_channels` extension — mine notes. Each channel
  // is a WAV bound to one or more `(x, y, damage)` entries; the
  // sample plays on contact and `damage` (0..100 gauge percent)
  // bleeds the gauge. We register the WAV after the
  // sound-channels block so the WAV ID space stays contiguous,
  // route notes through the same `mode_hint`-aware lane map, and
  // emit them on BMS landmine channels (`Dx` / `Ex`) so the
  // downstream `extractTimedNotes` landmine extractor sees them.
  // The bmson per-mine `damage` is preserved on
  // `event.bmson.damage` so consumers can opt into custom
  // damage; players that don't read it fall through to the
  // BMS-side default.
  const keyChannels = normalizeBmsonKeyChannels(document.key_channels);
  for (let index = 0; index < keyChannels.length; index += 1) {
    const keyChannel = keyChannels[index]!;
    const wavKey = intToBase36(soundChannels.length + index + 1, 2);
    json.resources.wav[wavKey] = keyChannel.name;
    for (const note of keyChannel.notes) {
      if (!Number.isFinite(note.y)) {
        continue;
      }
      const lane = Number.isFinite(note.x) ? Math.floor(note.x!) : 0;
      if (lane <= 0) {
        // Lane 0 / missing `x` would map onto a BGM channel which
        // makes no sense for a mine — skip rather than silently
        // emit a malformed event.
        continue;
      }
      const playableChannel = laneMap.get(lane);
      if (!playableChannel) {
        continue;
      }
      const landmineChannel = bmsPlayableChannelToLandmineChannel(playableChannel);
      if (!landmineChannel) {
        continue;
      }
      const { measure, position } = positionResolver(note.y);
      const event: BeMusicEvent = {
        measure,
        position,
        channel: landmineChannel,
        value: wavKey,
      };
      const noteContinue = typeof note.c === 'boolean' ? note.c : undefined;
      const noteLength = typeof note.l === 'number' && Number.isFinite(note.l) && note.l >= 0 ? Math.floor(note.l) : undefined;
      if (noteLength !== undefined || noteContinue !== undefined || note.damage !== undefined) {
        event.bmson = {};
        if (noteLength !== undefined) event.bmson.l = noteLength;
        if (noteContinue !== undefined) event.bmson.c = noteContinue;
        if (note.damage !== undefined) event.bmson.damage = note.damage;
      }
      json.events.push(event);
    }
  }

  const bpmEvents = normalizeBmsonBpmEvents(document.bpm_events);
  json.preservation.bmson.bpmEvents = bpmEvents;
  bpmEvents.forEach((bpmEvent, index) => {
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

  const stopEvents = normalizeBmsonStopEvents(document.stop_events);
  json.preservation.bmson.stopEvents = stopEvents;
  stopEvents.forEach((stopEvent, index) => {
    const key = intToBase36(index + 1, 2);
    // Spec: `stop_events.duration` is measured in **pulses** at
    // the chart's `resolution`. The downstream timing resolver
    // reads `resources.stop[key]` through the BMS-style
    // `(value / 192) × (240/bpm)` formula, which expects the
    // value in "1/192-of-a-measure" units (1 measure = 4 beats
    // = 192 BMS-spec STOP units, so 1 beat = 48 BMS units). To
    // keep the BMS / bmson paths sharing one formula, convert
    // bmson pulses into the equivalent 1/192-measure units at
    // parse time:
    //
    //   bms_units = pulses × 48 / resolution
    //
    // Default `resolution = 240` → 1 beat (`duration = 240`)
    // becomes `48` BMS units, which the formula evaluates to
    // `(48 / 192) × (240/bpm) = 60/bpm` seconds — exactly one
    // beat. Without this conversion bmson stops were ~5×
    // longer than authored at the default resolution.
    json.resources.stop[key] = (stopEvent.duration * 48) / resolution;
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
  const structured = raw as Record<string, unknown>;
  const rawBms = structured.bms;
  const rawBmson = structured.bmson;
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
  // When re-parsing a previously-emitted BMS-JSON, honour the
  // chart's recorded base so case-sensitive base-62 IDs don't get
  // folded back to uppercase. The full `bms` extension is normalised
  // a few lines below; we only need the `base` hint here.
  const rawBmsBase = (rawBms as { base?: unknown } | undefined)?.base;
  const reparseBase: 36 | 62 = rawBmsBase === 62 ? 62 : 36;
  json.events = sortAndNormalizeEvents(rawEvents as Array<BeMusicEvent | Record<string, unknown>>, reparseBase);
  if (json.events.length !== rawEvents.length) {
    throw new Error('Invalid bms-json event: position [numerator, denominator] is required.');
  }
  json.bms = normalizeBmsExtensions(rawBms);
  json.bmson = normalizeBmsonExtensions(rawBmson);
  json.preservation = normalizePreservation(structured.preservation, rawBms, rawBmson);
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
  if (formatHint === undefined) {
    const firstCode = input.charCodeAt(0);
    if (firstCode === 0x23) {
      return parseBms(input);
    }
  }

  const hint = formatHint?.toLowerCase();
  if (hint === 'bmson') {
    return parseBmson(input);
  }
  if (hint === 'json') {
    const parsed = JSON.parse(input.trim()) as Record<string, unknown>;
    return parseStructuredChartObject(parsed);
  }

  let startIndex = 0;
  while (startIndex < input.length) {
    const code = input.charCodeAt(startIndex);
    if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      break;
    }
    startIndex += 1;
  }
  if (input.charCodeAt(startIndex) === 0x7b) {
    const parsed = JSON.parse(input.slice(startIndex)) as Record<string, unknown>;
    return parseStructuredChartObject(parsed);
  }

  return parseBms(input);
}

export interface ParseChartFileOptions {
  signal?: AbortSignal;
}

export async function parseChartFile(filePath: string, options: ParseChartFileOptions = {}): Promise<BeMusicJson> {
  const [{ readFile }, { extname }] = await Promise.all([import('node:fs/promises'), import('node:path')]);
  const buffer = await readFile(filePath, {
    signal: options.signal,
  });
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
    applyHeader: (json, command, commandRaw, value) => {
      // Replay path: prefer the case-preserved `commandRaw` when
      // available so a `#WAV0a` captured inside a `#RANDOM` /
      // `#IF` block on a `#BASE 62` chart still registers under
      // the lowercase key. Falls back to the uppercased `command`
      // for the common base-36 case-insensitive path.
      pushHeaderLine(json, command, commandRaw ?? command, value, json.bms.base === 62 ? 62 : 36);
    },
  });
}

export { decodeBmsText };

export interface DecodedBmsText {
  encoding: 'utf8' | 'shift_jis';
  text: string;
}

function decodeBmsText(buffer: Uint8Array): DecodedBmsText {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return {
      encoding: 'utf8',
      text: decodeUtf8Text(buffer),
    };
  }
  try {
    return {
      encoding: 'shift_jis',
      text: new TextDecoder('shift_jis').decode(buffer),
    };
  } catch {
    return {
      encoding: 'utf8',
      text: decodeUtf8Text(buffer),
    };
  }
}

function decodeUtf8Text(buffer: Uint8Array): string {
  return new TextDecoder('utf-8').decode(buffer).replace(/^\ufeff/u, '');
}

function pushObjectDataLine(
  json: BeMusicJson,
  measure: number,
  channel: string,
  data: string,
  base: 36 | 62,
  measureByIndex?: Map<number, MeasureLengthEntry>,
): void {
  if (channel === '02') {
    const length = Number.parseFloat(data);
    if (Number.isFinite(length) && length > 0) {
      upsertMeasureLength(json, measure, length, measureByIndex);
    }
    return;
  }

  const parsed = collectNonZeroObjectTokens(data, base);
  for (const token of parsed.tokens) {
    json.events.push({
      measure,
      channel,
      position: [token.index, parsed.tokenCount],
      value: token.value,
    });
  }
}

function createBmsObjectLineEntry(
  measure: number,
  channel: string,
  data: string,
  base: 36 | 62 = 36,
): BmsObjectLineEntry | undefined {
  if (channel === '02') {
    const measureLength = Number.parseFloat(data);
    if (!Number.isFinite(measureLength) || measureLength <= 0) {
      return undefined;
    }
    return {
      measure,
      channel,
      events: [],
      measureLength,
    };
  }

  const parsed = collectNonZeroObjectTokens(data, base);
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
    measure,
    channel,
    events,
  };
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
  if (digit0 < 0x30 || digit0 > 0x39 || digit1 < 0x30 || digit1 > 0x39 || digit2 < 0x30 || digit2 > 0x39) {
    return undefined;
  }

  const channel0 = normalizeAsciiBase36Code(line.charCodeAt(4));
  const channel1 = normalizeAsciiBase36Code(line.charCodeAt(5));
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

interface ParsedHeaderDirectiveLine {
  /** Uppercased command — used for keyword matching (case-insensitive). */
  command: string;
  /**
   * Case-preserved command. For base-62 indexed-header keys, the
   * trailing 2 characters of `commandRaw` hold the lowercase-aware
   * ID — uppercasing here would collapse `#WAV0a` and `#WAV0A`
   * back into the same slot.
   */
  commandRaw: string;
  value: string;
}

function parseHeaderDirectiveLine(line: string): ParsedHeaderDirectiveLine | undefined {
  if (line.length < 2 || line.charCodeAt(0) !== 0x23) {
    return undefined;
  }
  const commandStart = line.charCodeAt(1);
  if (!isAsciiLetter(commandStart)) {
    return undefined;
  }

  let cursor = 2;
  while (cursor < line.length && isHeaderCommandChar(line.charCodeAt(cursor))) {
    cursor += 1;
  }
  if (cursor < line.length && !isAsciiWhitespace(line.charCodeAt(cursor))) {
    return undefined;
  }

  const commandRaw = line.slice(1, cursor);
  const command = commandRaw.toUpperCase();
  while (cursor < line.length && isAsciiWhitespace(line.charCodeAt(cursor))) {
    cursor += 1;
  }

  const value = cursor < line.length ? line.slice(cursor).trim() : '';
  return { command, commandRaw, value };
}

function isAsciiWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0b || code === 0x0c;
}

function isAsciiLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

function isHeaderCommandChar(code: number): boolean {
  if (isAsciiLetter(code)) {
    return true;
  }
  return (code >= 0x30 && code <= 0x39) || code === 0x5f;
}

function isControlFlowCommand(command: string): command is BmsControlFlowCommand {
  return CONTROL_FLOW_COMMANDS.has(command as BmsControlFlowCommand);
}

function forEachLine(input: string, visitor: (line: string) => void): void {
  let lineStart = 0;
  let index = 0;
  while (index < input.length) {
    const code = input.charCodeAt(index);
    if (code !== 0x0a && code !== 0x0d) {
      index += 1;
      continue;
    }

    visitor(input.slice(lineStart, index));

    if (code === 0x0d && index + 1 < input.length && input.charCodeAt(index + 1) === 0x0a) {
      index += 1;
    }
    lineStart = index + 1;
    index += 1;
  }
  visitor(input.slice(lineStart, input.length));
}

/**
 * Pre-scans the BMS source for the `#BASE` directive (the
 * beatoraja base-62 extension switch). Returns 62 if `#BASE 62`
 * appears before the first object data line, otherwise 36.
 *
 * We bail out at the first non-header (object) line because real
 * implementations require `#BASE` to come before any object
 * references — applying it retroactively would change which IDs
 * get folded vs. preserved AFTER they were already normalised in
 * earlier headers.
 */
function detectBmsBase(input: string): 36 | 62 {
  let resolved: 36 | 62 = 36;
  let stop = false;
  forEachLine(input, (rawLine) => {
    if (stop) return;
    const line = rawLine.trim();
    if (!line.startsWith('#')) return;
    const second = line.charCodeAt(1);
    if (second >= 0x30 && second <= 0x39) {
      // Hit the first `#xxxYY:...` object line — `#BASE` after this
      // point is too late to take effect.
      stop = true;
      return;
    }
    const match = line.match(BASE_DIRECTIVE_REGEX);
    if (match) {
      resolved = match[1] === '62' ? 62 : 36;
      stop = true;
    }
  });
  return resolved;
}

function pushHeaderLine(json: BeMusicJson, command: string, commandRaw: string, value: string, base: 36 | 62): void {
  const objectCommand = command.match(INDEXED_HEADER_COMMAND);
  if (objectCommand) {
    const directive = objectCommand[1] as IndexedHeaderDirective;
    // For base-62 charts, lift the key from the case-preserved
    // `commandRaw`; the trailing 2 chars hold the lowercase-aware
    // ID. `commandRaw[directive.length...]` falls back to the
    // uppercased form for base-36 (where case folding is intended).
    const keyRaw = base === 62 ? commandRaw.slice(directive.length) : objectCommand[2]!;
    const key = normalizeObjectKey(keyRaw, base);
    applyIndexedHeaderLine(json, directive, key, value);
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
    case 'BACKBMP':
      json.metadata.backBmp = value;
      return;
    case 'BANNER':
      json.metadata.banner = value;
      return;
    case 'PREVIEW':
      if (value.length > 0) {
        json.bms.preview = value;
      }
      return;
    case 'PLAYLEVEL':
      {
        const playLevelValue = parsePlayLevelValue(value);
        if (playLevelValue !== undefined) {
          json.metadata.playLevel = playLevelValue;
        }
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
        // `#LNOBJ` carries an object-ID payload — preserve case
        // for `#BASE 62` charts so the LN-end marker matches its
        // case-sensitive `#WAVxx` counterpart.
        const normalizedValue = normalizeObjectKey(value, base);
        json.bms.lnObjs = [...(json.bms.lnObjs ?? []), normalizedValue];
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
    case 'MIDIFILE':
      if (value.length > 0) {
        json.bms.midiFile = value;
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
    case 'BASE':
      // `#BASE 62` is the beatoraja base-62 ID extension. The base
      // was already resolved during pre-scan (`detectBmsBase`) and
      // stamped onto `json.bms.base` before this header reaches us;
      // swallow the directive here so it doesn't leak into
      // `metadata.extras`.
      return;
    default:
      if (value.length > 0) {
        json.metadata.extras[command] = value;
      }
  }
}

function parsePlayLevelValue(value: string): number | string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed)) {
    const parsed = Number.parseFloat(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return trimmed;
}

function applyIndexedHeaderLine(
  json: BeMusicJson,
  directive: IndexedHeaderDirective,
  key: string,
  value: string,
): void {
  switch (directive) {
    case 'WAV':
      applyIndexedStringValue(json.resources.wav, key, value);
      return;
    case 'BMP':
      applyIndexedStringValue(json.resources.bmp, key, value);
      return;
    case 'TEXT':
      applyIndexedStringValue(json.resources.text, key, value);
      return;
    case 'EXRANK':
      applyIndexedStringValue(json.bms.exRank, key, value);
      return;
    case 'ARGB':
      applyIndexedStringValue(json.bms.argb, key, value);
      return;
    case 'CHANGEOPTION':
      applyIndexedStringValue(json.bms.changeOption, key, value);
      return;
    case 'EXWAV':
      applyIndexedStringValue(json.bms.exWav, key, value);
      return;
    case 'EXBMP':
      applyIndexedStringValue(json.bms.exBmp, key, value);
      return;
    case 'BGA':
      applyIndexedStringValue(json.bms.bga, key, value);
      return;
    case 'SCROLL': {
      applyIndexedNumberValue(json.bms.scroll, key, value);
      return;
    }
    case 'SPEED': {
      applyIndexedNumberValue(json.bms.speed, key, value);
      return;
    }
    case 'SWBGA':
      applyIndexedStringValue(json.bms.swBga, key, value);
      return;
    case 'BPM':
    case 'STOP': {
      if (directive === 'BPM') {
        applyIndexedNumberValue(json.resources.bpm, key, value);
      } else {
        applyIndexedNumberValue(json.resources.stop, key, value);
      }
      return;
    }
  }
}

function applyIndexedStringValue(values: Record<string, string>, key: string, value: string): void {
  if (value.length > 0) {
    values[key] = value;
  }
}

function applyIndexedNumberValue(values: Record<string, number>, key: string, value: string): void {
  const numericValue = Number.parseFloat(value);
  if (Number.isFinite(numericValue)) {
    values[key] = numericValue;
  }
}

function migrateBmsExtensionHeadersFromExtras(json: BeMusicJson): void {
  const migratedExtras: Record<string, string> = {};
  // Honour `#BASE 62` so any indexed-header keys that landed in
  // `metadata.extras` (typically from a re-parsed JSON whose
  // upstream parser didn't recognise the directive) get preserved
  // in their authored case rather than folded to uppercase. The
  // common base-36 case-insensitive path keeps its existing
  // behaviour because `idBase` is 36 by default.
  const idBase = resolveBmsBase(json);

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
      if (value.length > 0) {
        // The migration's `value` is the directive payload (e.g.
        // `AA` for `#LNOBJ AA`), so the chart-base case-rule
        // applies just like for any other indexed key.
        const normalizedValue = normalizeObjectKey(value, idBase);
        json.bms.lnObjs = [...(json.bms.lnObjs ?? []), normalizedValue];
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
    if (upper === 'MIDIFILE') {
      if (typeof json.bms.midiFile !== 'string' && value.length > 0) {
        json.bms.midiFile = value;
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

    const speedMatch = upper.match(/^SPEED([0-9A-Z]{2})$/);
    if (speedMatch) {
      const key = normalizeObjectKey(speedMatch[1]);
      const parsed = normalizeNumericBmsExtensionValue(value);
      if (!(key in json.bms.speed) && typeof parsed === 'number') {
        json.bms.speed[key] = parsed;
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
  };
  if (!input || typeof input !== 'object') {
    return normalized;
  }

  const raw = input as Record<string, unknown>;
  // Honour `#BASE 62` on re-parsed JSON so the indexed maps below
  // (`exRank`, `argb`, `wav`/`bmp`/…) preserve lowercase keys
  // instead of folding them through the default base-36 path.
  if (raw.base === 62) {
    normalized.base = 62;
  }
  const idBase: 36 | 62 = normalized.base === 62 ? 62 : 36;
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

  const lnObjs = normalizeBmsExtensionStringList(raw.lnObjs ?? raw.ln_objs);
  if (lnObjs.length > 0) {
    normalized.lnObjs = lnObjs.map((value) => normalizeObjectKey(value, idBase));
  }

  const volWav = normalizeNumericBmsExtensionValue(raw.volWav ?? raw.volwav ?? raw.vol_wav);
  if (typeof volWav === 'number' && volWav >= 0) {
    normalized.volWav = volWav;
  }

  const defExRank = normalizeNumericBmsExtensionValue(raw.defExRank);
  if (typeof defExRank === 'number') {
    normalized.defExRank = defExRank;
  }

  normalized.exRank = normalizeIndexedBmsExtensionMap(raw.exRank, idBase);
  normalized.argb = normalizeIndexedBmsExtensionMap(raw.argb, idBase);

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

  normalized.changeOption = normalizeIndexedBmsExtensionMap(
    raw.changeOption ?? raw.change_option ?? raw.changeoption,
    idBase,
  );
  normalized.exWav = normalizeIndexedBmsExtensionMap(raw.exWav ?? raw.ex_wav ?? raw.exwav, idBase);
  normalized.exBmp = normalizeIndexedBmsExtensionMap(raw.exBmp ?? raw.ex_bmp ?? raw.exbmp, idBase);
  normalized.bga = normalizeIndexedBmsExtensionMap(raw.bga, idBase);
  normalized.scroll = normalizeIndexedBmsExtensionNumericMap(raw.scroll, idBase);
  normalized.speed = normalizeIndexedBmsExtensionNumericMap(raw.speed, idBase);
  normalized.swBga = normalizeIndexedBmsExtensionMap(raw.swBga ?? raw.sw_bga ?? raw.swbga, idBase);

  const poorBga = raw.poorBga ?? raw.poor_bga;
  if (typeof poorBga === 'string' && poorBga.length > 0) {
    normalized.poorBga = poorBga;
  }

  const videoFile = raw.videoFile ?? raw.video_file;
  if (typeof videoFile === 'string' && videoFile.length > 0) {
    normalized.videoFile = videoFile;
  }

  const midiFile = raw.midiFile ?? raw.midi_file;
  if (typeof midiFile === 'string' && midiFile.length > 0) {
    normalized.midiFile = midiFile;
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

function normalizePreservation(input: unknown, bmsInput: unknown, bmsonInput: unknown): BeMusicJson['preservation'] {
  const normalized = createEmptyJson('json').preservation;

  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : undefined;
  const rawBms =
    raw?.bms && typeof raw.bms === 'object'
      ? (raw.bms as Record<string, unknown>)
      : bmsInput && typeof bmsInput === 'object'
        ? (bmsInput as Record<string, unknown>)
        : undefined;
  const rawBmson =
    raw?.bmson && typeof raw.bmson === 'object'
      ? (raw.bmson as Record<string, unknown>)
      : bmsonInput && typeof bmsonInput === 'object'
        ? (bmsonInput as Record<string, unknown>)
        : undefined;

  const rawSourceLines = rawBms?.sourceLines ?? rawBms?.source_lines;
  if (Array.isArray(rawSourceLines)) {
    const entries: BmsSourceLineEntry[] = [];
    for (const item of rawSourceLines) {
      const entry = normalizeBmsControlFlowEntry(item);
      if (entry) {
        entries.push(entry);
      }
    }
    normalized.bms.sourceLines = entries;
  }

  const rawObjectLines = rawBms?.objectLines ?? rawBms?.object_lines;
  if (Array.isArray(rawObjectLines)) {
    const entries: BmsObjectLineEntry[] = [];
    for (const item of rawObjectLines) {
      const entry = normalizeBmsObjectLineEntry(item);
      if (entry) {
        entries.push(entry);
      }
    }
    normalized.bms.objectLines = entries;
  }

  normalized.bmson.lines = normalizeBmsonLines(rawBmson?.lines);
  normalized.bmson.bpmEvents = normalizeBmsonBpmEvents(rawBmson?.bpmEvents ?? rawBmson?.bpm_events);
  normalized.bmson.stopEvents = normalizeBmsonStopEvents(rawBmson?.stopEvents ?? rawBmson?.stop_events);
  normalized.bmson.soundChannels = normalizeBmsonSoundChannels(rawBmson?.soundChannels ?? rawBmson?.sound_channels);

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

function normalizeIndexedBmsExtensionMap(input: unknown, base: 36 | 62 = 36): Record<string, string> {
  if (!input || typeof input !== 'object') {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const key = normalizeObjectKey(rawKey, base);
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

function normalizeIndexedBmsExtensionNumericMap(input: unknown, base: 36 | 62 = 36): Record<string, number> {
  if (!input || typeof input !== 'object') {
    return {};
  }

  const normalized: Record<string, number> = {};
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const parsed = normalizeNumericBmsExtensionValue(rawValue);
    if (typeof parsed === 'number') {
      normalized[normalizeObjectKey(rawKey, base)] = parsed;
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
    const command = raw.command.toUpperCase();
    // Honour `commandRaw` when present and actually case-different
    // — that's the base-62 marker. Otherwise drop it to keep the
    // round-tripped JSON minimal.
    const rawCommandValue = typeof raw.commandRaw === 'string' ? raw.commandRaw : undefined;
    const commandRaw = rawCommandValue && rawCommandValue !== command ? rawCommandValue : undefined;
    return {
      kind: 'header',
      command,
      value: typeof raw.value === 'string' ? raw.value : '',
      ...(commandRaw ? { commandRaw } : {}),
    };
  }
  if (kind === 'object') {
    const objectLine = normalizeBmsObjectLineEntry(raw);
    if (!objectLine) {
      return undefined;
    }
    return {
      kind: 'object',
      ...objectLine,
    };
  }
  return undefined;
}

function normalizeBmsObjectLineEntry(input: unknown): BmsObjectLineEntry | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw.measure !== 'number' || !Number.isFinite(raw.measure) || typeof raw.channel !== 'string') {
    return undefined;
  }
  const measure = Math.max(0, Math.floor(raw.measure));
  const channel = normalizeChannel(raw.channel);

  const rawEvents = Array.isArray(raw.events) ? raw.events : [];
  const normalizedEvents = sortAndNormalizeEvents(rawEvents as Array<BeMusicEvent | Record<string, unknown>>)
    .filter(
      (event) =>
        event.measure === measure &&
        normalizeChannel(event.channel) === channel &&
        normalizeObjectKey(event.value) !== '00',
    )
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
    return createBmsObjectLineEntry(measure, channel, fallbackData);
  }

  return {
    measure,
    channel,
    events: normalizedEvents,
    measureLength,
  };
}
