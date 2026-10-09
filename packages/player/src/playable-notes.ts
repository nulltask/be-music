import {
  type ChartPlayVariant,
  createBeatResolver,
  resolveBmsLongNotes,
  resolveChartPlayVariant,
  resolveLnobjLongNotes,
  sortEvents,
} from '@be-music/chart';
import { type BeMusicEvent, type BeMusicJson, normalizeChannel } from '@be-music/json';
import { createTimingResolver } from '@be-music/audio-renderer/triggers';
const FREE_ZONE_BEAT_LENGTH = 1;
const DEFAULT_BMS_LONG_NOTE_MODE = 1;
// beatoraja's bmson extension leaves an unspecified `info.ln_type` to the player's default LN mode. This project's
// LR2-aligned default is LN (no tail release judgment) — the same default the BMS side uses for a missing #LNMODE.
const DEFAULT_BMSON_LONG_NOTE_MODE = 1;

export type LongNoteMode = 1 | 2 | 3;

export interface TimedPlayableNote {
  event: BeMusicEvent;
  channel: string;
  beat: number;
  endBeat?: number;
  endSeconds?: number;
  longNoteMode?: LongNoteMode;
  visibleUntilBeat?: number;
  seconds: number;
  judged: boolean;
  invisible?: true;
}

export interface TimedLandmineNote {
  event: BeMusicEvent;
  channel: string;
  beat: number;
  seconds: number;
  judged: boolean;
  mine: true;
}

export interface ExtractTimedNotesOptions {
  includeLandmine?: boolean;
  includeInvisible?: boolean;
  inferBmsLnTypeWhenMissing?: boolean;
  /**
   * Host-resolved play variant. Only consulted to decide whether channels `17` / `27` are FREE ZONE — they're real key
   * columns under POPN-9 and the 24-key keyboard modes. Omit it and the chart is classified on demand, the first time
   * a `17` / `27` object shows up.
   */
  playVariant?: ChartPlayVariant;
}

export interface ExtractTimedNotesResult {
  playableNotes: TimedPlayableNote[];
  landmineNotes: TimedLandmineNote[];
  invisibleNotes: TimedPlayableNote[];
}

export interface ExtractPlayableNotesOptions {
  inferBmsLnTypeWhenMissing?: boolean;
  /** See {@link ExtractTimedNotesOptions.playVariant}. */
  playVariant?: ChartPlayVariant;
}

interface TimedExtractionContext {
  resolver: ReturnType<typeof createTimingResolver>;
  beatResolver: ReturnType<typeof createBeatResolver>;
  sortedEvents: BeMusicEvent[];
  bmsonResolution?: number;
  /** Chart-level bmson `info.ln_type` (1: LN, 2: CN, 3: HCN), already validated; per-note `t` overrides it. */
  chartLongNoteType?: LongNoteMode;
  /** `true` when the normalized channel is an active FREE ZONE column for this chart. */
  isFreeZoneChannel: (normalizedChannel: string) => boolean;
}

interface TimedEventChannels {
  playable?: string;
  landmine?: string;
  invisible?: string;
}

export function extractTimedNotes(json: BeMusicJson, options: ExtractTimedNotesOptions = {}): ExtractTimedNotesResult {
  const context = createTimedExtractionContext(json, options.playVariant);
  const { playableNotes, landmineNotes, invisibleNotes } = collectTimedNotes(context, {
    includePlayable: true,
    includeLandmine: options.includeLandmine !== false,
    includeInvisible: Boolean(options.includeInvisible),
  });

  finalizePlayableNotes(json, playableNotes, context.resolver, options);
  return {
    playableNotes,
    landmineNotes,
    invisibleNotes,
  };
}

export function extractPlayableNotes(
  json: BeMusicJson,
  options: ExtractPlayableNotesOptions = {},
): TimedPlayableNote[] {
  const context = createTimedExtractionContext(json, options.playVariant);
  const { playableNotes } = collectTimedNotes(context, { includePlayable: true });
  finalizePlayableNotes(json, playableNotes, context.resolver, options);
  return playableNotes;
}

export function extractLandmineNotes(json: BeMusicJson): TimedLandmineNote[] {
  return collectTimedNotes(createTimedExtractionContext(json), {
    includePlayable: false,
    includeLandmine: true,
  }).landmineNotes;
}

export function extractInvisiblePlayableNotes(json: BeMusicJson): TimedPlayableNote[] {
  return collectTimedNotes(createTimedExtractionContext(json), {
    includePlayable: false,
    includeInvisible: true,
  }).invisibleNotes;
}

function createTimedExtractionContext(json: BeMusicJson, playVariant?: ChartPlayVariant): TimedExtractionContext {
  // Resolved lazily so charts without a `17` / `27` object never pay for the extra classification pass.
  let freeZoneActive = playVariant === undefined ? undefined : variantUsesFreeZone(playVariant);
  return {
    resolver: createTimingResolver(json),
    beatResolver: createBeatResolver(json),
    sortedEvents: sortEvents(json.events),
    bmsonResolution: json.sourceFormat === 'bmson' ? Math.max(1, json.bmson.info.resolution || 240) : undefined,
    chartLongNoteType:
      json.bmson.info.lnType === 1 || json.bmson.info.lnType === 2 || json.bmson.info.lnType === 3
        ? json.bmson.info.lnType
        : undefined,
    isFreeZoneChannel: (normalizedChannel: string): boolean => {
      if (normalizedChannel !== '17' && normalizedChannel !== '27') {
        return false;
      }
      freeZoneActive ??= variantUsesFreeZone(resolveChartPlayVariant({ events: json.events, bms: json.bms }));
      return freeZoneActive;
    },
  };
}

/**
 * Are channels `17` / `27` FREE ZONE under this variant?
 *
 * They're real key columns in POPN-9 (lane 7 of the nine-column bank) and in the 24-key keyboard modes (lane 7 of the
 * 24-column bank), where stamping the FREE ZONE quarter-note tail would turn an ordinary tap into a phantom long note
 * — and would shadow a genuine `#LNOBJ` tail authored on the same channel. Every IIDX family keeps them as FREE ZONE.
 */
function variantUsesFreeZone(variant: ChartPlayVariant): boolean {
  return variant !== '9' && variant !== '24' && variant !== '48';
}

function collectTimedNotes(
  context: TimedExtractionContext,
  options: {
    includePlayable?: boolean;
    includeLandmine?: boolean;
    includeInvisible?: boolean;
  } = {},
): ExtractTimedNotesResult {
  const includePlayable = options.includePlayable !== false;
  const includeLandmine = Boolean(options.includeLandmine);
  const includeInvisible = Boolean(options.includeInvisible);
  const playableNotes: TimedPlayableNote[] = [];
  const landmineNotes: TimedLandmineNote[] = [];
  const invisibleNotes: TimedPlayableNote[] = [];

  for (const event of context.sortedEvents) {
    const normalizedChannel = normalizeChannel(event.channel);
    const {
      playable: playableChannel,
      landmine: landmineChannel,
      invisible: invisibleChannel,
    } = resolveTimedEventChannels(normalizedChannel, includePlayable, includeLandmine, includeInvisible);

    if (!playableChannel && !landmineChannel && !invisibleChannel) {
      continue;
    }

    const beat = context.beatResolver.eventToBeat(event);
    const seconds = context.resolver.beatToSeconds(beat);

    if (playableChannel) {
      const endBeat = resolveLongNoteEndBeat(event, beat, playableChannel, context);
      playableNotes.push({
        event,
        channel: playableChannel,
        beat,
        endBeat,
        endSeconds: endBeat !== undefined ? context.resolver.beatToSeconds(endBeat) : undefined,
        longNoteMode: endBeat !== undefined ? resolveBmsonLongNoteMode(event, context.chartLongNoteType) : undefined,
        seconds,
        judged: false,
      });
    }

    if (landmineChannel) {
      landmineNotes.push({
        event,
        channel: landmineChannel,
        beat,
        seconds,
        judged: false,
        mine: true,
      });
    }

    if (invisibleChannel) {
      invisibleNotes.push({
        event,
        channel: invisibleChannel,
        beat,
        seconds,
        judged: false,
        invisible: true,
      });
    }
  }

  return {
    playableNotes,
    landmineNotes,
    invisibleNotes,
  };
}

function resolveTimedEventChannels(
  normalizedChannel: string,
  includePlayable: boolean,
  includeLandmine: boolean,
  includeInvisible: boolean,
): TimedEventChannels {
  if (normalizedChannel.length !== 2) {
    return {};
  }

  // Lane codes span the classic `1`-`9` columns plus the extended `A`-`Z` columns the 24-key (Keyboardmania) modes
  // author lanes 10..24 on — `1A..1O` / `2A..2O` for playable notes, and the matching `3X`/`4X`, `DX`/`EX` families
  // for invisible objects and landmines.
  const laneCode = normalizedChannel.charCodeAt(1);
  const isLaneCode = (laneCode >= 0x31 && laneCode <= 0x39) || (laneCode >= 0x41 && laneCode <= 0x5a);
  if (!isLaneCode) {
    return {};
  }

  const sideCode = normalizedChannel.charCodeAt(0);
  const lane = normalizedChannel[1]!;
  const playableLane = sideCode === 0x44 || sideCode === 0x33 ? `1${lane}` : `2${lane}`;

  if (includePlayable && (sideCode === 0x31 || sideCode === 0x32)) {
    return {
      playable: normalizedChannel,
    };
  }
  if (includeLandmine && (sideCode === 0x44 || sideCode === 0x45)) {
    return {
      landmine: playableLane,
    };
  }
  if (includeInvisible && (sideCode === 0x33 || sideCode === 0x34)) {
    return {
      invisible: playableLane,
    };
  }
  return {};
}

function finalizePlayableNotes(
  json: BeMusicJson,
  notes: TimedPlayableNote[],
  resolver: ReturnType<typeof createTimingResolver>,
  options: Pick<ExtractTimedNotesOptions, 'inferBmsLnTypeWhenMissing'>,
): void {
  const bmsLongNoteMode = resolveBmsLongNoteMode(json);
  applyLnobjEndBeatIfNeeded(json, notes, resolver, bmsLongNoteMode);
  appendLegacyLongNotesIfNeeded(json, notes, resolver, options, bmsLongNoteMode);
  notes.sort(comparePlayableNotes);
}

function comparePlayableNotes(left: TimedPlayableNote, right: TimedPlayableNote): number {
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
}

function applyLnobjEndBeatIfNeeded(
  json: BeMusicJson,
  notes: TimedPlayableNote[],
  resolver: ReturnType<typeof createTimingResolver>,
  longNoteMode: LongNoteMode,
): void {
  if (json.sourceFormat !== 'bms') {
    return;
  }
  const resolved = resolveLnobjLongNotes(json);
  if (resolved.startToEndBeat.size === 0) {
    return;
  }
  let writeIndex = 0;
  for (const note of notes) {
    if (resolved.endEvents.has(note.event)) {
      continue;
    }
    if (typeof note.endBeat === 'number' && Number.isFinite(note.endBeat) && note.endBeat > note.beat) {
      notes[writeIndex] = note;
      writeIndex += 1;
      continue;
    }
    const endBeat = resolved.startToEndBeat.get(note.event);
    if (typeof endBeat !== 'number' || !Number.isFinite(endBeat) || endBeat <= note.beat) {
      notes[writeIndex] = note;
      writeIndex += 1;
      continue;
    }
    note.endBeat = endBeat;
    note.endSeconds = resolver.beatToSeconds(endBeat);
    note.longNoteMode = longNoteMode;
    notes[writeIndex] = note;
    writeIndex += 1;
  }
  notes.length = writeIndex;
}

function appendLegacyLongNotesIfNeeded(
  json: BeMusicJson,
  notes: TimedPlayableNote[],
  resolver: ReturnType<typeof createTimingResolver>,
  options: Pick<ExtractTimedNotesOptions, 'inferBmsLnTypeWhenMissing'>,
  longNoteMode: LongNoteMode,
): void {
  if (json.sourceFormat !== 'bms') {
    return;
  }
  const resolved = resolveBmsLongNotes(json, {
    inferLnTypeWhenMissing: Boolean(options.inferBmsLnTypeWhenMissing),
  });
  if (resolved.notes.length === 0) {
    return;
  }
  for (const longNote of resolved.notes) {
    const endBeat =
      typeof longNote.endBeat === 'number' && longNote.endBeat > longNote.beat ? longNote.endBeat : undefined;
    notes.push({
      event: longNote.event,
      channel: longNote.channel,
      beat: longNote.beat,
      endBeat,
      endSeconds: endBeat !== undefined ? resolver.beatToSeconds(endBeat) : undefined,
      longNoteMode: endBeat !== undefined ? longNoteMode : undefined,
      seconds: resolver.beatToSeconds(longNote.beat),
      judged: false,
    });
  }
}

function resolveBmsLongNoteMode(json: BeMusicJson): LongNoteMode {
  if (json.sourceFormat !== 'bms') {
    return DEFAULT_BMSON_LONG_NOTE_MODE;
  }
  if (json.bms.lnMode === 2 || json.bms.lnMode === 3) {
    return json.bms.lnMode;
  }
  return DEFAULT_BMS_LONG_NOTE_MODE;
}

/**
 * Long-note mode for a bmson-derived note, per the beatoraja bmson extension precedence: per-note `t` >
 * chart-level `info.ln_type` > default (LN).
 */
function resolveBmsonLongNoteMode(event: BeMusicEvent, chartLongNoteType: LongNoteMode | undefined): LongNoteMode {
  const noteType = event.bmson?.t;
  if (noteType === 1 || noteType === 2 || noteType === 3) {
    return noteType;
  }
  return chartLongNoteType ?? DEFAULT_BMSON_LONG_NOTE_MODE;
}

function resolveLongNoteEndBeat(
  event: BeMusicEvent,
  beat: number,
  normalizedChannel: string,
  context: TimedExtractionContext,
): number | undefined {
  if (context.isFreeZoneChannel(normalizedChannel)) {
    return beat + FREE_ZONE_BEAT_LENGTH;
  }

  const { bmsonResolution } = context;
  if (event.bmson?.l && event.bmson.l > 0 && typeof bmsonResolution === 'number') {
    return beat + event.bmson.l / bmsonResolution;
  }
  return undefined;
}
