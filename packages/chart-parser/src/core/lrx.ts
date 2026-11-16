import {
  createEmptyJSON,
  DEFAULT_BPM,
  LRX_TICKS_PER_BEAT,
  type BeMusicEvent,
  type BeMusicJSON,
  type ChartDiagnostic,
  type LRXEventExtensions,
  type LRXExtensions,
} from '@be-music/chart-source';
import { countDistinctValues, createBmsonValueKeyTable, encodeBmsonKey, resolveBmsonKeyBase } from './bmson-keys.ts';
import { createBmsonPositionResolver, createMeasureLengthsFromBmsonLines } from './bmson.ts';
import { sortAndNormalizeEvents } from './event-utils.ts';
import { decodeLRXText, readLRXElements, type LRXElement } from './lrx-xml.ts';

/**
 * LRX, the chart format of plugout4 -ARCADE EDITION- (lavalse, 2012): a chart is `NN.lrs` (notes and sounds), the
 * header `NN.lrh` beside it, and the BGA file the header names (`_movie.lrm` by default), all UTF-16 XML. See
 * docs/format-compat.md, "LRX".
 */
export interface LRXSourceFiles<T> {
  /** The `.lrs` file: `information`, `sound` and `n` elements. */
  lrs: T;
  /** The `.lrh` file beside it, when there is one. */
  lrh?: T;
  /** The BGA file named by {@link resolveLRXMoviePath}, when there is one. */
  lrm?: T;
}

const DEFAULT_MOVIE_PATH = '_movie.lrm';
/** plugout's note constructor leaves `c` at 999 (no effect) when the attribute is missing. */
const MISSING_CHANNEL = 999;
const DEFAULT_RANK = 2;

/** Lane channel → BMS lane, for every lane type but 9 keys: scratches `0` / `10`, keys `1`–`7` / `11`–`17`. */
const BEAT_LANES: ReadonlyMap<number, string> = new Map([
  [0, '16'],
  [1, '11'],
  [2, '12'],
  [3, '13'],
  [4, '14'],
  [5, '15'],
  [6, '18'],
  [7, '19'],
  [10, '26'],
  [11, '21'],
  [12, '22'],
  [13, '23'],
  [14, '24'],
  [15, '25'],
  [16, '28'],
  [17, '29'],
]);
/** 9 keys (`lanetype` 4): keys `1`–`9` on the PMS-STD lanes. */
const NINE_KEY_LANES: ReadonlyMap<number, string> = new Map([
  [1, '11'],
  [2, '12'],
  [3, '13'],
  [4, '14'],
  [5, '15'],
  [6, '22'],
  [7, '23'],
  [8, '24'],
  [9, '25'],
]);
const KNOWN_LANE_TYPES = new Set([0, 1, 2, 3, 4]);
/** `lanetype` 5 / 6 add the 2P scratch to a single-play chart; Be-Music plays them as double play. */
const DOUBLE_SCRATCH_LANE_TYPES = new Set([5, 6]);
/** BGA channel → BMS BGA channel: base, two layers, POOR. */
const BGA_CHANNELS: ReadonlyMap<number, string> = new Map([
  [200, '04'],
  [201, '07'],
  [202, '0A'],
  [299, '06'],
]);

/** `wcstol`: leading digits with an optional sign; anything unreadable is 0. */
function readInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** `wcstod`: a leading decimal number; anything unreadable is 0. */
function readFloat(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseFloat(value.trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

/** plugout reads a flag as on when its first character is `1`. */
function readFlag(value: string | undefined): boolean {
  return value?.startsWith('1') === true;
}

function readString(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}

function informationOf(elements: readonly LRXElement[]): Map<string, string> | undefined {
  // plugout reads every `information` element in turn, so a later one overrides an earlier one field by field.
  let merged: Map<string, string> | undefined;
  for (const element of elements) {
    if (element.name !== 'information') continue;
    merged ??= new Map();
    for (const [key, value] of element.attributes) merged.set(key, value);
  }
  return merged;
}

/** The `.lrh` path of an `.lrs` path: plugout swaps the extension. */
export function resolveLRXHeaderPath(lrsPath: string): string {
  const dot = lrsPath.lastIndexOf('.');
  const slash = Math.max(lrsPath.lastIndexOf('/'), lrsPath.lastIndexOf('\\'));
  return `${dot > slash ? lrsPath.slice(0, dot) : lrsPath}.lrh`;
}

/**
 * The BGA file of a chart, relative to its folder: the `.lrh` `moviepath`, else the `.lrs` one, else `_movie.lrm`.
 * plugout reads it from the chart's folder (and tries `../` for the media it names, not for the file itself).
 */
export function resolveLRXMoviePath(lrs: Uint8Array, lrh?: Uint8Array): string {
  const fromHeader = lrh ? readString(informationOf(readLRXElements(decodeLRXText(lrh)))?.get('moviepath')) : undefined;
  const fromSequence = readString(informationOf(readLRXElements(decodeLRXText(lrs)))?.get('moviepath'));
  return fromHeader ?? fromSequence ?? DEFAULT_MOVIE_PATH;
}

/** Parses an LRX chart from its decoded files. */
export function parseLRXBytes(files: LRXSourceFiles<Uint8Array>): BeMusicJSON {
  return parseLRX({
    lrs: decodeLRXText(files.lrs),
    ...(files.lrh ? { lrh: decodeLRXText(files.lrh) } : {}),
    ...(files.lrm ? { lrm: decodeLRXText(files.lrm) } : {}),
  });
}

interface LRXNote {
  channel: number;
  start: number;
  end: number;
  value: number;
  attributes: Map<string, string>;
  order: number;
}

/** Parses an LRX chart from the text of its files. */
export function parseLRX(files: LRXSourceFiles<string>): BeMusicJSON {
  const json = createEmptyJSON('lrx');
  const diagnostics: ChartDiagnostic[] = [];
  const lrx: LRXExtensions = {};
  json.lrx = lrx;

  const sequence = readLRXElements(files.lrs);
  const header = files.lrh !== undefined ? informationOf(readLRXElements(files.lrh)) : undefined;
  const movie = files.lrm !== undefined ? readLRXElements(files.lrm) : [];
  const sequenceInformation = informationOf(sequence);
  applyHeader(json, lrx, header);
  const movieInformation = informationOf(movie);
  const movieArtist = readString(movieInformation?.get('artist_movie'));
  if (movieArtist !== undefined) lrx.movieArtist = movieArtist;
  lrx.moviePath =
    readString(header?.get('moviepath')) ?? readString(sequenceInformation?.get('moviepath')) ?? DEFAULT_MOVIE_PATH;

  // Judge rank and TOTAL come from the `.lrs` only; plugout never reads the `.lrh` copies.
  json.metadata.rank = readInt(sequenceInformation?.get('rank')) ?? DEFAULT_RANK;
  const total = readInt(sequenceInformation?.get('total'));
  if (total !== undefined && total > 0) json.metadata.total = total;

  const sounds = new Map<number, string>();
  for (const element of sequence) {
    if (element.name !== 'sound') continue;
    const id = readInt(element.attributes.get('id')) ?? 0;
    const filename = element.attributes.get('filename');
    if (id >= 0 && filename) sounds.set(id, filename);
  }
  // `image` and `movie` share one id table in plugout.
  const images = new Map<number, string>();
  for (const element of movie) {
    if (element.name !== 'image' && element.name !== 'movie') continue;
    const id = readInt(element.attributes.get('id')) ?? 0;
    const filename = element.attributes.get('filename');
    if (id >= 0 && filename) images.set(id, filename);
  }

  const notes: LRXNote[] = [];
  for (const element of [...sequence, ...movie]) {
    if (element.name !== 'n') continue;
    const channel = readInt(element.attributes.get('c')) ?? MISSING_CHANNEL;
    const start = Math.max(0, readFloat(element.attributes.get('s')) ?? 0);
    const written = readFloat(element.attributes.get('e'));
    // An end at or before the start is no length (plugout clamps `e` to `s`).
    const end = written !== undefined && written > start ? written : start;
    const value = readFloat(element.attributes.get('p')) ?? 0;
    notes.push({ channel, start, end, value, attributes: element.attributes, order: notes.length });
  }
  notes.sort((left, right) => left.start - right.start || left.order - right.order);

  const barTicks = [...new Set(notes.filter((note) => note.channel === 300).map((note) => Math.round(note.start)))];
  barTicks.sort((left, right) => left - right);
  // The measures follow the bar lines, which can sit anywhere; a measure before the first bar line starts at tick 0.
  const lines = barTicks.length > 0 && barTicks[0] !== 0 ? [0, ...barTicks] : barTicks;
  if (lines.length > 0) lrx.barTicks = lines;
  const toPosition = createBmsonPositionResolver(LRX_TICKS_PER_BEAT, lines);
  const measures = createMeasureLengthsFromBmsonLines(lines, LRX_TICKS_PER_BEAT);
  if (measures.length > 0) json.measures = measures;

  const laneMap = resolveLaneMap(lrx.laneType, notes, diagnostics);
  const events: BeMusicEvent[] = [];
  const unsupportedChannels = new Set<number>();
  const bpmTicks: number[] = [];
  const bpmValues: number[] = [];
  const stopTicks: number[] = [];
  const stopUnits: number[] = [];
  let bpm: number | undefined;
  let soundCount = 0;
  let imageCount = 0;
  const pushEvent = (note: LRXNote, channel: string, value: string, extension?: LRXEventExtensions): void => {
    const { measure, position } = toPosition(note.start);
    events.push({ measure, position, channel, value, ...(extension ? { lrx: extension } : {}) });
  };
  const soundEvents: Array<{ note: LRXNote; channel: string; extension?: LRXEventExtensions }> = [];
  const bgaEvents: Array<{ note: LRXNote; channel: string }> = [];

  for (let index = 0; index < notes.length; index++) {
    const note = notes[index]!;
    const { channel } = note;
    if (channel === 301) {
      bpmTicks.push(note.start);
      bpmValues.push(note.value);
      // A tick's last BPM note wins; plugout's first BPM note is also the chart's starting tempo.
      if (bpm === undefined) json.metadata.bpm = note.value;
      bpm = note.value;
      continue;
    }
    if (channel === 302) {
      // STOP in milliseconds, converted to BMS units (1/192 measure) at the BPM in force on its tick.
      let tempo = bpm ?? json.metadata.bpm;
      for (let ahead = index + 1; ahead < notes.length && notes[ahead]!.start === note.start; ahead++) {
        if (notes[ahead]!.channel === 301) tempo = notes[ahead]!.value;
      }
      if (note.value > 0 && tempo > 0) {
        stopTicks.push(note.start);
        stopUnits.push(((note.value / 1000) * tempo * 48) / 60);
      }
      continue;
    }
    if (channel === 309) {
      lrx.endTick = note.start;
      continue;
    }
    if (channel >= 0 && channel < 200) {
      const id = Math.trunc(note.value);
      if (id < 0) continue;
      soundCount = Math.max(soundCount, id + 1);
      const extension = readSoundExtension(note);
      const lane = channel < 20 ? laneMap.get(channel) : undefined;
      if (channel < 20 && lane === undefined) unsupportedChannels.add(channel);
      // A lane note with `dmg="0"` is an autoplayed background note; a chain note sits in the background too, and
      // follows its lane's preceding note (`chainLane`), which chart-model links it to.
      const background = lane === undefined || extension?.damage === 0 || extension?.chain === true;
      if (extension?.chain === true && lane !== undefined && extension.damage !== 0) extension.chainLane = lane;
      if (!background && note.end > note.start) {
        soundEvents.push({ note, channel: lane, extension: { ...extension, length: note.end - note.start } });
      } else {
        soundEvents.push({ note, channel: background ? '01' : lane, ...(extension ? { extension } : {}) });
      }
      continue;
    }
    if (channel >= 200 && channel < 300) {
      const bgaChannel = BGA_CHANNELS.get(channel);
      if (bgaChannel === undefined) {
        unsupportedChannels.add(channel);
        continue;
      }
      const id = Math.trunc(note.value);
      if (id < 0) continue;
      imageCount = Math.max(imageCount, id + 1);
      bgaEvents.push({ note, channel: bgaChannel });
    }
    // 300 (bar lines) became the measures; 303–308 and 310 up do nothing in plugout.
  }
  for (const id of sounds.keys()) soundCount = Math.max(soundCount, id + 1);
  for (const id of images.keys()) imageCount = Math.max(imageCount, id + 1);

  if (bpm === undefined) {
    const fallback = lrx.startBPM ?? lrx.baseBPM;
    json.metadata.bpm = fallback !== undefined && fallback > 0 ? fallback : DEFAULT_BPM;
  }

  // Keys are `id + 1`, since `00` is no object in BMS; past 1,295 ids the chart moves to base-62 keys.
  const keyBase = resolveBmsonKeyBase([
    soundCount,
    imageCount,
    countDistinctValues(bpmValues),
    countDistinctValues(stopUnits),
  ]);
  if (keyBase === 62) json.bms.base = 62;
  const keyOf = (id: number): string => encodeBmsonKey(id + 1, keyBase)!;
  for (const [id, filename] of sounds) json.resources.wav[keyOf(id)] = filename;
  for (const [id, filename] of images) json.resources.bmp[keyOf(id)] = filename;
  for (const { note, channel, extension } of soundEvents)
    pushEvent(note, channel, keyOf(Math.trunc(note.value)), extension);
  for (const { note, channel } of bgaEvents) pushEvent(note, channel, keyOf(Math.trunc(note.value)));

  const bpmKeys = createBmsonValueKeyTable(bpmValues, keyBase);
  Object.assign(json.resources.bpm, bpmKeys.table);
  bpmTicks.forEach((tick, index) => {
    const { measure, position } = toPosition(tick);
    events.push({ measure, position, channel: '08', value: bpmKeys.keys[index]! });
  });
  const stopKeys = createBmsonValueKeyTable(stopUnits, keyBase);
  Object.assign(json.resources.stop, stopKeys.table);
  stopTicks.forEach((tick, index) => {
    const { measure, position } = toPosition(tick);
    events.push({ measure, position, channel: '09', value: stopKeys.keys[index]! });
  });

  for (const channel of [...unsupportedChannels].sort((left, right) => left - right)) {
    diagnostics.push({
      code: 'unsupported-channel',
      message:
        channel < 20
          ? `LRX lane ${channel} is not a lane of this lane type; its notes play in the background`
          : `LRX BGA layer ${channel} is not supported; its images are not shown`,
      subject: String(channel),
      position: { kind: 'field', path: 'lrs.n.c' },
    });
  }
  if (diagnostics.length > 0) json.diagnostics = diagnostics;
  json.events = sortAndNormalizeEvents(events, keyBase);
  return json;
}

function applyHeader(json: BeMusicJSON, lrx: LRXExtensions, header: Map<string, string> | undefined): void {
  if (!header) return;
  const text = (key: string) => readString(header.get(key));
  const number = (key: string) => readInt(header.get(key));
  json.metadata.title = text('title');
  json.metadata.subtitle = text('subtitle');
  json.metadata.genre = text('genre');
  json.metadata.artist = text('artist_song');
  const sequenceArtist = text('artist_sequence');
  if (sequenceArtist !== undefined) json.metadata.extras.SUBARTIST = sequenceArtist;
  const titleImage = text('titleimage');
  if (titleImage !== undefined) json.metadata.titleImage = titleImage;
  const backImage = text('backimage');
  if (backImage !== undefined) json.metadata.backBMP = backImage;
  const banner = text('bannerimage');
  if (banner !== undefined) json.metadata.banner = banner;
  const level = number('lrslevel');
  if (level !== undefined) json.metadata.playLevel = level;
  const category = number('category');
  // The five official difficulties line up with BMS #DIFFICULTY 1–5; edit and remix charts have no counterpart.
  if (category !== undefined && category >= 0 && category <= 4) json.metadata.difficulty = category + 1;

  const assign = <K extends keyof LRXExtensions>(key: K, value: LRXExtensions[K] | undefined): void => {
    if (value !== undefined) lrx[key] = value;
  };
  assign('laneType', number('lanetype'));
  assign('category', category);
  assign('level', level);
  assign('bmsLevel', number('bmslevel'));
  assign('sequenceTitle', text('sequencetitle'));
  assign('sequenceArtist', sequenceArtist);
  assign('minBPM', number('minbpm'));
  assign('maxBPM', number('maxbpm'));
  assign('baseBPM', number('basebpm'));
  assign('startBPM', number('startbpm'));
  assign('labelImage', text('labelimage'));
  assign('phase', number('phase'));
  assign('unlock', number('unlock'));
  assign('songId', number('songid'));
}

/**
 * The lane table of the chart. A known `lanetype` picks it; without one (no `.lrh`, or a value plugout does not
 * define) a chart with notes on keys 8 or 9 and nothing past them reads as 9 keys, any other as the beat layout.
 */
function resolveLaneMap(
  laneType: number | undefined,
  notes: readonly LRXNote[],
  diagnostics: ChartDiagnostic[],
): ReadonlyMap<number, string> {
  if (laneType === 4) return NINE_KEY_LANES;
  if (laneType !== undefined && KNOWN_LANE_TYPES.has(laneType)) return BEAT_LANES;
  if (laneType !== undefined) {
    diagnostics.push({
      code: 'unsupported-lane-type',
      message: DOUBLE_SCRATCH_LANE_TYPES.has(laneType)
        ? `LRX lanetype ${laneType} (single play with both scratches) plays as double play`
        : `LRX lanetype ${laneType} is unknown; the lanes in use decide the mode`,
      subject: String(laneType),
      position: { kind: 'field', path: 'lrh.information.lanetype' },
    });
    if (DOUBLE_SCRATCH_LANE_TYPES.has(laneType)) return BEAT_LANES;
  }
  const lanes = new Set(notes.filter((note) => note.channel >= 0 && note.channel < 20).map((note) => note.channel));
  const nineKeys =
    (lanes.has(8) || lanes.has(9)) && [0, ...Array.from({ length: 10 }, (_, i) => 10 + i)].every((c) => !lanes.has(c));
  return nineKeys ? NINE_KEY_LANES : BEAT_LANES;
}

const SOUND_DEFAULTS = { vol: 127, pan: 64, frq: 44100, atk: 0, rls: 0, ost: 0, len: -1, dmg: 100, rcv: 100 } as const;

/** The sound and note attributes of a note on channels 0–199 that differ from plugout's defaults. */
function readSoundExtension(note: LRXNote): LRXEventExtensions | undefined {
  const extension: LRXEventExtensions = {};
  const read = (key: keyof typeof SOUND_DEFAULTS): number | undefined => {
    const value = readInt(note.attributes.get(key));
    return value === undefined || value === SOUND_DEFAULTS[key] ? undefined : value;
  };
  const volume = read('vol');
  if (volume !== undefined) extension.volume = volume;
  const pan = read('pan');
  if (pan !== undefined) extension.pan = pan;
  const frequency = read('frq');
  // `frq="0"` plays at the sample's own rate, as the default does.
  if (frequency !== undefined && frequency !== 0) extension.frequency = frequency;
  const attack = read('atk');
  if (attack !== undefined) extension.attackMs = attack;
  const release = read('rls');
  if (release !== undefined) extension.releaseMs = release;
  const offset = read('ost');
  if (offset !== undefined) extension.offsetMs = offset;
  const length = read('len');
  if (length !== undefined && length >= 0) extension.lengthMs = length;
  const damage = read('dmg');
  if (damage !== undefined) extension.damage = damage;
  const recover = read('rcv');
  if (recover !== undefined) extension.recover = recover;
  if (readFlag(note.attributes.get('rev'))) extension.reverse = true;
  if (readFlag(note.attributes.get('cn'))) extension.chain = true;
  return Object.keys(extension).length > 0 ? extension : undefined;
}
