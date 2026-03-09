import { readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import {
  BMS_JSON_FORMAT,
  DEFAULT_BPM,
  cloneJson,
  compareEvents,
  ensureMeasure,
  normalizeChannel,
  normalizeObjectKey,
  sortEvents,
  type BeMusicEvent,
  type BeMusicJson,
} from '@be-music/json';
import { parseChart, parseChartFile } from '@be-music/parser';
import { stringifyBmson, stringifyBms } from '@be-music/stringifier';

export async function importChart(inputPath: string): Promise<BeMusicJson> {
  return parseChartFile(resolve(inputPath));
}

export async function loadJsonFile(filePath: string): Promise<BeMusicJson> {
  const content = await readFile(resolve(filePath), 'utf8');
  return parseChart(content, 'json');
}

export async function saveJsonFile(filePath: string, json: BeMusicJson): Promise<void> {
  const normalized = canSerializeJsonAsIs(json) ? json : normalizeJson(json);
  await writeFile(resolve(filePath), `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
}

export async function exportChart(filePath: string, json: BeMusicJson): Promise<void> {
  const outputPath = resolve(filePath);
  const extension = extname(outputPath).toLowerCase();
  const content = extension === '.bmson' ? stringifyBmson(json) : stringifyBms(json);
  await writeFile(outputPath, content, 'utf8');
}

export function setMetadata(json: BeMusicJson, key: string, value: string): BeMusicJson {
  const normalized = normalizeJson(json);
  const property = key.toLowerCase();

  switch (property) {
    case 'title':
      normalized.metadata.title = value;
      return normalized;
    case 'subtitle':
      normalized.metadata.subtitle = value;
      return normalized;
    case 'artist':
      normalized.metadata.artist = value;
      return normalized;
    case 'genre':
      normalized.metadata.genre = value;
      return normalized;
    case 'comment':
      normalized.metadata.comment = value;
      return normalized;
    case 'stagefile':
      normalized.metadata.stageFile = value;
      return normalized;
    case 'playlevel':
      normalized.metadata.playLevel = Number.parseFloat(value);
      return normalized;
    case 'rank':
      normalized.metadata.rank = Number.parseFloat(value);
      return normalized;
    case 'total':
      normalized.metadata.total = Number.parseFloat(value);
      return normalized;
    case 'difficulty':
      normalized.metadata.difficulty = Number.parseFloat(value);
      return normalized;
    case 'bpm': {
      const bpm = Number.parseFloat(value);
      if (Number.isFinite(bpm) && bpm > 0) {
        normalized.metadata.bpm = bpm;
      }
      return normalized;
    }
    default:
      normalized.metadata.extras[key.toUpperCase()] = value;
      return normalized;
  }
}

export function addNote(
  json: BeMusicJson,
  params: {
    measure: number;
    channel: string;
    positionNumerator: number;
    positionDenominator: number;
    value: string;
  },
): BeMusicJson {
  const normalized = normalizeJson(json);
  ensureMeasure(normalized, params.measure);
  const position = normalizePositionFraction(params.positionNumerator, params.positionDenominator);

  const event: BeMusicEvent = {
    measure: Math.max(0, Math.floor(params.measure)),
    channel: normalizeChannel(params.channel),
    position: [position.numerator, position.denominator],
    value: normalizeObjectKey(params.value),
  };

  insertSortedEvent(normalized.events, event);
  return normalized;
}

export function deleteNote(
  json: BeMusicJson,
  params: {
    measure: number;
    channel: string;
    positionNumerator: number;
    positionDenominator: number;
    value?: string;
  },
): BeMusicJson {
  const normalized = normalizeJson(json);
  const channel = normalizeChannel(params.channel);
  const position = normalizePositionFraction(params.positionNumerator, params.positionDenominator);

  normalized.events = normalized.events.filter((event) => {
    if (event.measure !== params.measure) {
      return true;
    }
    if (normalizeChannel(event.channel) !== channel) {
      return true;
    }
    if (!isSamePosition(event, position)) {
      return true;
    }
    if (params.value && normalizeObjectKey(event.value) !== normalizeObjectKey(params.value)) {
      return true;
    }
    return false;
  });

  return normalized;
}

export function listNotes(json: BeMusicJson, measure?: number): BeMusicEvent[] {
  const target = normalizeJson(json);
  if (measure === undefined) {
    return [...target.events];
  }
  return target.events.filter((event) => event.measure === measure);
}

export function createBlankJson(): BeMusicJson {
  return {
    format: BMS_JSON_FORMAT,
    sourceFormat: 'json',
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

function normalizeJson(json: BeMusicJson): BeMusicJson {
  const cloned = canCloneJsonFast(json) ? cloneJson(json) : structuredClone(json);
  if (!cloned.metadata) {
    cloned.metadata = {
      bpm: DEFAULT_BPM,
      extras: {},
    };
  }
  cloned.metadata.extras = cloned.metadata.extras ?? {};
  cloned.metadata.bpm =
    Number.isFinite(cloned.metadata.bpm) && cloned.metadata.bpm > 0 ? cloned.metadata.bpm : DEFAULT_BPM;
  cloned.resources = cloned.resources ?? {
    wav: {},
    bmp: {},
    bpm: {},
    stop: {},
    text: {},
  };
  cloned.resources.wav = cloned.resources.wav ?? {};
  cloned.resources.bmp = cloned.resources.bmp ?? {};
  cloned.resources.bpm = cloned.resources.bpm ?? {};
  cloned.resources.stop = cloned.resources.stop ?? {};
  cloned.resources.text = cloned.resources.text ?? {};
  if (!hasOnlyFiniteMeasures(cloned.measures)) {
    cloned.measures = (cloned.measures ?? []).filter(
      (measure) => Number.isFinite(measure.index) && Number.isFinite(measure.length),
    );
  }
  if (!areEventsSorted(cloned.events)) {
    cloned.events = sortEvents(cloned.events ?? []);
  }
  return cloned;
}

function canSerializeJsonAsIs(json: BeMusicJson): boolean {
  return (
    json.format === BMS_JSON_FORMAT &&
    json.metadata !== undefined &&
    Number.isFinite(json.metadata.bpm) &&
    json.metadata.bpm > 0 &&
    json.metadata.extras !== undefined &&
    json.resources !== undefined &&
    json.resources.wav !== undefined &&
    json.resources.bmp !== undefined &&
    json.resources.bpm !== undefined &&
    json.resources.stop !== undefined &&
    json.resources.text !== undefined &&
    Array.isArray(json.measures) &&
    hasOnlyFiniteMeasures(json.measures) &&
    Array.isArray(json.events) &&
    areEventsSorted(json.events)
  );
}

function canCloneJsonFast(json: BeMusicJson): boolean {
  return (
    json.metadata !== undefined &&
    json.metadata.extras !== undefined &&
    json.resources !== undefined &&
    json.resources.wav !== undefined &&
    json.resources.bmp !== undefined &&
    json.resources.bpm !== undefined &&
    json.resources.stop !== undefined &&
    json.resources.text !== undefined &&
    Array.isArray(json.measures) &&
    Array.isArray(json.events) &&
    json.bms !== undefined &&
    Array.isArray(json.bms.controlFlow) &&
    Array.isArray(json.bms.objectLines) &&
    (json.bms.lnObjs === undefined || Array.isArray(json.bms.lnObjs)) &&
    json.bms.exRank !== undefined &&
    json.bms.argb !== undefined &&
    Array.isArray(json.bms.stp) &&
    json.bms.changeOption !== undefined &&
    json.bms.exWav !== undefined &&
    json.bms.exBmp !== undefined &&
    json.bms.bga !== undefined &&
    json.bms.scroll !== undefined &&
    json.bms.swBga !== undefined &&
    json.bmson !== undefined &&
    Array.isArray(json.bmson.lines) &&
    json.bmson.info !== undefined &&
    json.bmson.bga !== undefined &&
    Array.isArray(json.bmson.bga.header) &&
    Array.isArray(json.bmson.bga.events) &&
    Array.isArray(json.bmson.bga.layerEvents) &&
    Array.isArray(json.bmson.bga.poorEvents)
  );
}

function hasOnlyFiniteMeasures(measures: BeMusicJson['measures'] | undefined): boolean {
  if (!Array.isArray(measures)) {
    return false;
  }
  for (let index = 0; index < measures.length; index += 1) {
    const measure = measures[index]!;
    if (!Number.isFinite(measure.index) || !Number.isFinite(measure.length)) {
      return false;
    }
  }
  return true;
}

function areEventsSorted(events: BeMusicJson['events'] | undefined): boolean {
  if (!Array.isArray(events)) {
    return false;
  }
  for (let index = 1; index < events.length; index += 1) {
    if (compareEvents(events[index - 1]!, events[index]!) > 0) {
      return false;
    }
  }
  return true;
}

function normalizePositionFraction(numerator: number, denominator: number): { numerator: number; denominator: number } {
  const safeDenominator = Number.isFinite(denominator) && denominator > 0 ? Math.max(1, Math.floor(denominator)) : 1;
  if (!Number.isFinite(numerator)) {
    return { numerator: 0, denominator: safeDenominator };
  }
  const safeNumerator = Math.floor(numerator);
  return {
    numerator: Math.max(0, Math.min(safeDenominator - 1, safeNumerator)),
    denominator: safeDenominator,
  };
}

function isSamePosition(event: BeMusicEvent, target: { numerator: number; denominator: number }): boolean {
  const left = BigInt(event.position[0]) * BigInt(target.denominator);
  const right = BigInt(target.numerator) * BigInt(event.position[1]);
  if (left !== right) {
    return false;
  }
  return true;
}

function insertSortedEvent(events: BeMusicEvent[], event: BeMusicEvent): void {
  if (events.length === 0) {
    events.push(event);
    return;
  }
  let low = 0;
  let high = events.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (compareEvents(events[mid]!, event) <= 0) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  events.splice(low, 0, event);
}
