import { normalizeChannel, normalizeObjectKey, type BeMusicEvent, type BeMusicJSON } from '@be-music/chart-source';
import { resolveBMSLongNotes, resolveLNOBJLongNotes, type BeatResolver, type ChartPlayVariant } from './index.ts';
import { DEFAULT_LONG_NOTE_MODE, resolveLandmineDamage, type LongNoteMode } from './note-rules.ts';
import type { TimingResolver } from './timing.ts';

/** What a resolved note is: a judged tap, a judged long note, a landmine, or an invisible (keysound-only) object. */
export type ResolvedNoteKind = 'tap' | 'ln' | 'mine' | 'invisible';

/**
 * One note of a resolved chart, with every format rule already applied: the lane is the playable `1x` / `2x` channel
 * (invisible `3x` / `4x`, `#LNTYPE` `5x` / `6x` and mine `Dx` / `Ex` objects are mapped onto it), times are in beats and
 * seconds after BPM / STOP / `#STP`, and a long note carries its end and its LN / CN / HCN mode.
 */
export interface ResolvedNote {
  readonly kind: ResolvedNoteKind;
  /** The playable lane channel (`11`..`1Z`, `21`..`2Z`), normalized. */
  readonly channel: string;
  readonly beat: number;
  readonly seconds: number;
  /** `ln` only: where the long note ends. */
  readonly endBeat?: number;
  readonly endSeconds?: number;
  /** `ln` only: the long-note mode (bmson per-note `t` > `info.ln_type` > `#LNMODE` > LN). */
  readonly lnMode?: LongNoteMode;
  /** `ln` only: the note sits on a FREE ZONE column (`17` / `27` in the That-Which-Must-Not-Be-Named families), which has a fixed one-beat tail. */
  readonly freeZone?: true;
  /** The keysound slot (the object value normalized under the chart's `#BASE`). For a mine, its object value. */
  readonly sampleKey: string;
  /** `mine` only: the gauge damage in percent (`resolveLandmineDamage`). */
  readonly damage?: number;
  /** The source event the note was resolved from, for keysound lookup and diagnostics. */
  readonly event: BeMusicEvent;
  /** bmson layered note: every constituent source event, including `event`, triggered by one press. */
  readonly soundEvents?: readonly BeMusicEvent[];
  /** bmson `up`: source slice played when this long note's tail is resolved. */
  readonly endSoundEvent?: BeMusicEvent;
}

export interface ResolvedNoteLists {
  /** Judged notes (`tap` / `ln`): at most one per lane and position, sorted by beat, then lane, then object value. */
  notes: ResolvedNote[];
  /**
   * Notes that lost their lane and position to a note in `notes` and carry a different keysound: not judged or drawn,
   * but their keysound still belongs to the chart. BMS hosts sound them as background audio; bmson keeps
   * them on the judged note in `soundEvents`.
   */
  shadowedNotes: ResolvedNote[];
}

export interface ResolvedNoteContext {
  json: BeMusicJSON;
  timing: TimingResolver;
  beatResolver: BeatResolver;
  sortedEvents: ReadonlyArray<BeMusicEvent>;
  idBase: 36 | 62;
  /** The play variant (only judged notes need it, for FREE ZONE), resolved on demand. */
  resolvePlayVariant: () => ChartPlayVariant;
  inferBmsLNTypeWhenMissing: boolean;
  /**
   * Overrides whether `17` / `27` are FREE ZONE instead of reading it from the play variant. The chart fingerprint
   * resolves with `false` and applies FREE ZONE itself once an outcome's lane mode is known.
   */
  freeZone?: boolean;
}

/**
 * Where a judged long note's tail comes from, exactly: the `#LNOBJ` end object or the closing `#LNTYPE 1` object
 * (`event`), one cell after the last object of an `#LNTYPE 2` run (`after-event`), a bmson length in pulses
 * (`pulses`), or the fixed one-beat FREE ZONE tail (`free-zone`).
 */
export type JudgedNoteTail =
  | { readonly kind: 'event'; readonly event: BeMusicEvent }
  | { readonly kind: 'after-event'; readonly event: BeMusicEvent }
  | { readonly kind: 'pulses'; readonly pulses: number }
  | { readonly kind: 'free-zone' };

/** A judged note before freezing: what {@link resolveJudgedNotes} keeps, plus the exact source of its tail. */
export interface JudgedNoteEntry {
  readonly event: BeMusicEvent;
  readonly channel: string;
  readonly beat: number;
  readonly lnMode?: LongNoteMode;
  /** A FREE ZONE note (`17` / `27` under a variant that has FREE ZONE): judged by nobody, so not scored. */
  readonly freeZone?: true;
  /** Set exactly when the note is a long note. */
  readonly tail?: JudgedNoteTail;
}

/** A FREE ZONE note's fixed tail, in beats. */
const FREE_ZONE_BEAT_LENGTH = 1;

interface MutableNote {
  event: BeMusicEvent;
  channel: string;
  beat: number;
  seconds: number;
  endBeat?: number;
  endSeconds?: number;
  lnMode?: LongNoteMode;
  freeZone?: true;
  tail?: JudgedNoteTail;
  soundEvents?: BeMusicEvent[];
  endSoundEvent?: BeMusicEvent;
}

/**
 * Resolves the judged notes.
 *
 * Each lane and position holds at most one judged note, as in beatoraja, whose timeline keeps one note per lane: a
 * long note wins over a tap, and otherwise the first note in event order (lowest object ID; for bmson, the first sound
 * channel) is kept. The others are returned in `shadowedNotes` when their keysound differs from the kept note's.
 */
export function resolveJudgedNotes(context: ResolvedNoteContext): ResolvedNoteLists {
  const { notes, shadowed } = resolveMutableJudgedNotes(context);
  return {
    notes: notes.map((note) => freezeJudgedNote(note, context.idBase, context.json.sourceFormat === 'bmson')),
    shadowedNotes: shadowed.map((note) =>
      freezeJudgedNote(note, context.idBase, context.json.sourceFormat === 'bmson'),
    ),
  };
}

/**
 * {@link resolveJudgedNotes} before freezing: the judged and shadowed notes with the exact source of each long note's
 * tail. Not part of the package API; the chart fingerprint reads exact positions from it.
 */
export function resolveJudgedNoteEntries(context: ResolvedNoteContext): {
  notes: JudgedNoteEntry[];
  shadowed: JudgedNoteEntry[];
} {
  return resolveMutableJudgedNotes(context);
}

function resolveMutableJudgedNotes(context: ResolvedNoteContext): { notes: MutableNote[]; shadowed: MutableNote[] } {
  const { json, timing, beatResolver } = context;
  const freeZoneActive = context.freeZone ?? variantUsesFreeZone(context.resolvePlayVariant());
  const bmsonResolution = json.sourceFormat === 'bmson' ? Math.max(1, json.bmson.info.resolution || 240) : undefined;
  const lnType = json.bmson.info.lnType;
  const chartLongNoteType: LongNoteMode | undefined = lnType === 1 || lnType === 2 || lnType === 3 ? lnType : undefined;
  const notes: MutableNote[] = [];

  for (const event of context.sortedEvents) {
    const channel = normalizeChannel(event.channel);
    if (!isLaneChannel(channel) || (channel.charCodeAt(0) !== 0x31 && channel.charCodeAt(0) !== 0x32)) {
      continue;
    }
    if (json.sourceFormat === 'bmson' && event.bmson?.up === true) continue;
    const beat = beatResolver.eventToBeat(event);
    const note: MutableNote = { event, channel, beat, seconds: timing.beatToSeconds(beat) };
    if (freeZoneActive && (channel === '17' || channel === '27')) {
      note.endBeat = beat + FREE_ZONE_BEAT_LENGTH;
      note.freeZone = true;
      note.tail = { kind: 'free-zone' };
    } else if (event.bmson?.l && event.bmson.l > 0 && bmsonResolution !== undefined) {
      note.endBeat = beat + event.bmson.l / bmsonResolution;
      note.tail = { kind: 'pulses', pulses: event.bmson.l };
    }
    if (note.endBeat !== undefined) {
      note.endSeconds = timing.beatToSeconds(note.endBeat);
      note.lnMode = resolveBmsonLongNoteMode(event, chartLongNoteType);
    }
    notes.push(note);
  }

  const bmsLongNoteMode = resolveBMSLongNoteMode(json);
  const withLNOBJ = applyLNOBJLongNotes(json, notes, timing, bmsLongNoteMode);
  appendLNTypeLongNotes(context, withLNOBJ, bmsLongNoteMode);
  withLNOBJ.sort(compareNotes);
  const shadowed = collapseSamePositionNotes(withLNOBJ, json.sourceFormat === 'bmson');
  if (json.sourceFormat === 'bmson') {
    const endSounds = new Map<string, BeMusicEvent>();
    const endKey = (channel: string, beat: number): string => `${channel}:${Math.round(beat * bmsonResolution!)}`;
    // Source-channel order is retained by the parser's slot keys: later definitions replace earlier ones.
    for (const event of context.sortedEvents) {
      if (event.bmson?.up === true)
        endSounds.set(endKey(normalizeChannel(event.channel), beatResolver.eventToBeat(event)), event);
    }
    for (const note of withLNOBJ) {
      if (note.endBeat !== undefined) note.endSoundEvent = endSounds.get(endKey(note.channel, note.endBeat));
    }
  }
  return { notes: withLNOBJ, shadowed };
}

/** Resolves the landmines (`Dx` / `Ex`), on the lane they sit on, with their gauge damage. */
export function resolveMineNotes(context: ResolvedNoteContext): ResolvedNote[] {
  const mines: ResolvedNote[] = [];
  for (const event of context.sortedEvents) {
    const channel = normalizeChannel(event.channel);
    const side = channel.charCodeAt(0);
    if (!isLaneChannel(channel) || (side !== 0x44 && side !== 0x45)) {
      continue;
    }
    const beat = context.beatResolver.eventToBeat(event);
    mines.push({
      kind: 'mine',
      channel: `${side === 0x44 ? '1' : '2'}${channel[1]!}`,
      beat,
      seconds: context.timing.beatToSeconds(beat),
      sampleKey: normalizeObjectKey(event.value, context.idBase, context.json.sourceFormat === 'bmson'),
      damage: resolveLandmineDamage(event, context.idBase, context.json.sourceFormat),
      event,
    });
  }
  return mines;
}

/** Resolves the invisible objects (`3x` / `4x`): not judged, but they set the lane's keysound in manual play. */
export function resolveInvisibleNotes(context: ResolvedNoteContext): ResolvedNote[] {
  const invisible: ResolvedNote[] = [];
  for (const event of context.sortedEvents) {
    const channel = normalizeChannel(event.channel);
    const side = channel.charCodeAt(0);
    if (!isLaneChannel(channel) || (side !== 0x33 && side !== 0x34)) {
      continue;
    }
    const beat = context.beatResolver.eventToBeat(event);
    invisible.push({
      kind: 'invisible',
      channel: `${side === 0x33 ? '1' : '2'}${channel[1]!}`,
      beat,
      seconds: context.timing.beatToSeconds(beat),
      sampleKey: normalizeObjectKey(event.value, context.idBase, context.json.sourceFormat === 'bmson'),
      event,
    });
  }
  return invisible;
}

/**
 * Are channels `17` / `27` FREE ZONE under this variant?
 *
 * They're real key columns in POPN-9 (lane 7 of the nine-column bank) and in the 24-key keyboard modes (lane 7 of the
 * 24-column bank), where stamping the FREE ZONE one-beat tail would turn an ordinary tap into a phantom long note — and
 * would shadow a genuine `#LNOBJ` tail authored on the same channel. Every That-Which-Must-Not-Be-Named family keeps them as FREE ZONE.
 */
export function variantUsesFreeZone(variant: ChartPlayVariant): boolean {
  return variant !== '9' && variant !== '24' && variant !== '48';
}

/**
 * Whether `channel` places an invisible object (`3x` / `4x`) on a lane: one that sets the lane's keysound in manual
 * play but is neither judged nor sounded by auto play.
 */
export function isInvisibleNoteChannel(channel: string): boolean {
  const normalized = normalizeChannel(channel);
  const side = normalized.charCodeAt(0);
  return isLaneChannel(normalized) && (side === 0x33 || side === 0x34);
}

/**
 * Lane codes span the classic `1`-`9` columns plus the extended `A`-`Z` columns the 24-key (Keyboardmania) modes author
 * lanes 10..24 on — `1A..1O` / `2A..2O` for playable notes, and the matching `3X` / `4X`, `DX` / `EX` families for
 * invisible objects and landmines.
 */
function isLaneChannel(normalizedChannel: string): boolean {
  if (normalizedChannel.length !== 2) {
    return false;
  }
  const laneCode = normalizedChannel.charCodeAt(1);
  return (laneCode >= 0x31 && laneCode <= 0x39) || (laneCode >= 0x41 && laneCode <= 0x5a);
}

function freezeJudgedNote(note: MutableNote, idBase: 36 | 62, allowLongKeys: boolean): ResolvedNote {
  const sampleKey = normalizeObjectKey(note.event.value, idBase, allowLongKeys);
  if (note.endBeat === undefined) {
    return {
      kind: 'tap',
      channel: note.channel,
      beat: note.beat,
      seconds: note.seconds,
      sampleKey,
      event: note.event,
      ...(note.soundEvents ? { soundEvents: note.soundEvents } : {}),
    };
  }
  const resolved: {
    -readonly [K in keyof ResolvedNote]: ResolvedNote[K];
  } = {
    kind: 'ln',
    channel: note.channel,
    beat: note.beat,
    seconds: note.seconds,
    endBeat: note.endBeat,
    endSeconds: note.endSeconds,
    lnMode: note.lnMode,
    ...(note.endSoundEvent ? { endSoundEvent: note.endSoundEvent } : {}),
    sampleKey,
    event: note.event,
    ...(note.soundEvents ? { soundEvents: note.soundEvents } : {}),
  };
  if (note.freeZone) {
    resolved.freeZone = true;
  }
  return resolved;
}

/**
 * Keeps one note per lane and position in `notes` (sorted by {@link compareNotes}) and returns the dropped notes whose
 * keysound differs from every note kept or returned before them at that position.
 *
 * Long notes are resolved first, so a `5x` / `6x` or `#LNOBJ` long note and a tap on its start compete here and the
 * long note wins — beatoraja also replaces a tap at a `5x` start with the long note. Between notes of the same kind the
 * first in sort order wins: beatoraja keeps the later line of a BMS file, but the IR no longer records line order, so
 * the lowest object ID stands in; for bmson this is the first sound channel, which is the note beatoraja judges.
 */
function collapseSamePositionNotes(notes: MutableNote[], layered: boolean): MutableNote[] {
  const shadowed: MutableNote[] = [];
  let writeIndex = 0;
  let groupStart = 0;
  while (groupStart < notes.length) {
    const first = notes[groupStart]!;
    let groupEnd = groupStart + 1;
    while (
      groupEnd < notes.length &&
      notes[groupEnd]!.beat === first.beat &&
      notes[groupEnd]!.channel === first.channel
    ) {
      groupEnd += 1;
    }
    if (groupEnd - groupStart === 1) {
      notes[writeIndex] = first;
      writeIndex += 1;
      groupStart = groupEnd;
      continue;
    }
    let keptIndex = groupStart;
    for (let index = groupStart; index < groupEnd; index += 1) {
      if (notes[index]!.endBeat !== undefined) {
        keptIndex = index;
        break;
      }
    }
    const kept = notes[keptIndex]!;
    if (layered) {
      for (let index = groupStart; index < groupEnd; index += 1) {
        if (notes[index]!.endBeat !== kept.endBeat) {
          throw new RangeError(
            `bmson layered notes must have equal lengths (lane ${kept.channel}, beat ${kept.beat}).`,
          );
        }
      }
      const events = new Map<string, BeMusicEvent>();
      for (let index = groupStart; index < groupEnd; index += 1) {
        const event = notes[index]!.event;
        if (!events.has(event.value)) events.set(event.value, event);
      }
      kept.soundEvents = [...events.values()];
    }
    const soundedValues = new Set<string>([kept.event.value]);
    for (let index = groupStart; index < groupEnd; index += 1) {
      const note = notes[index]!;
      if (index === keptIndex || soundedValues.has(note.event.value)) {
        continue;
      }
      soundedValues.add(note.event.value);
      shadowed.push(note);
    }
    notes[writeIndex] = kept;
    writeIndex += 1;
    groupStart = groupEnd;
  }
  notes.length = writeIndex;
  return shadowed;
}

function compareNotes(left: MutableNote, right: MutableNote): number {
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

/** Turns `#LNOBJ` starts into long notes and drops their end objects. Returns the kept notes. */
function applyLNOBJLongNotes(
  json: BeMusicJSON,
  notes: MutableNote[],
  timing: TimingResolver,
  longNoteMode: LongNoteMode,
): MutableNote[] {
  if (json.sourceFormat !== 'bms') {
    return notes;
  }
  const resolved = resolveLNOBJLongNotes(json);
  if (resolved.startToEndBeat.size === 0) {
    return notes;
  }
  const kept: MutableNote[] = [];
  for (const note of notes) {
    if (resolved.endEvents.has(note.event)) {
      continue;
    }
    if (typeof note.endBeat === 'number' && Number.isFinite(note.endBeat) && note.endBeat > note.beat) {
      kept.push(note);
      continue;
    }
    const endBeat = resolved.startToEndBeat.get(note.event);
    const endEvent = resolved.startToEndEvent.get(note.event);
    if (typeof endBeat === 'number' && Number.isFinite(endBeat) && endBeat > note.beat && endEvent !== undefined) {
      note.endBeat = endBeat;
      note.endSeconds = timing.beatToSeconds(endBeat);
      note.lnMode = longNoteMode;
      note.tail = { kind: 'event', event: endEvent };
    }
    kept.push(note);
  }
  return kept;
}

/** Appends the `#LNTYPE` long notes authored on `5x` / `6x`. */
function appendLNTypeLongNotes(context: ResolvedNoteContext, notes: MutableNote[], longNoteMode: LongNoteMode): void {
  const { json, timing } = context;
  if (json.sourceFormat !== 'bms') {
    return;
  }
  const resolved = resolveBMSLongNotes(json, { inferLNTypeWhenMissing: context.inferBmsLNTypeWhenMissing });
  for (const longNote of resolved.notes) {
    const endBeat =
      typeof longNote.endBeat === 'number' && longNote.endBeat > longNote.beat && longNote.endEvent !== undefined
        ? longNote.endBeat
        : undefined;
    notes.push({
      event: longNote.event,
      channel: longNote.channel,
      beat: longNote.beat,
      seconds: timing.beatToSeconds(longNote.beat),
      endBeat,
      endSeconds: endBeat !== undefined ? timing.beatToSeconds(endBeat) : undefined,
      lnMode: endBeat !== undefined ? longNoteMode : undefined,
      tail:
        endBeat !== undefined
          ? { kind: resolved.lnType === 2 ? 'after-event' : 'event', event: longNote.endEvent! }
          : undefined,
    });
  }
}

/** Long-note mode of a BMS `#LNOBJ` / `#LNTYPE` long note: `#LNMODE`, otherwise LN. */
function resolveBMSLongNoteMode(json: BeMusicJSON): LongNoteMode {
  if (json.sourceFormat === 'bms' && (json.bms.lnMode === 2 || json.bms.lnMode === 3)) {
    return json.bms.lnMode;
  }
  return DEFAULT_LONG_NOTE_MODE;
}

/**
 * Long-note mode for a bmson-style long note (and a FREE ZONE tail), per the beatoraja bmson extension precedence:
 * per-note `t` > chart-level `info.ln_type` > default (LN).
 */
export function resolveBmsonLongNoteMode(
  event: BeMusicEvent,
  chartLongNoteType: LongNoteMode | undefined,
): LongNoteMode {
  const noteType = event.bmson?.t;
  if (noteType === 1 || noteType === 2 || noteType === 3) {
    return noteType;
  }
  return chartLongNoteType ?? DEFAULT_LONG_NOTE_MODE;
}
