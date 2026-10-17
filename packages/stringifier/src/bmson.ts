import {
  createBeatResolver,
  isLandmineChannel,
  isSampleTriggerChannel,
  mapBmsLongNoteChannelToPlayable,
  parseBpmFrom03Token,
  resolveBmsLongNotes,
  resolveChartPlayVariant,
  BMSON_MODE_HINT_LAYOUTS,
  getPlayModeLayouts,
  resolveBmsonModeHintLayout,
  resolveLnobjLongNotes,
  sortEvents,
} from '@be-music/chart';
import { parseBmson } from '@be-music/parser';
import {
  normalizeChannel,
  normalizeObjectKey,
  resolveBmsBase,
  type BmsonBpmEventEntry,
  type BmsonScrollEventEntry,
  type BmsonSoundChannelEntry,
  type BmsonStopEventEntry,
  type BeMusicEvent,
  type BeMusicJson,
} from '@be-music/json';
import { normalizeSortedUniqueNonNegativeIntegers } from '@be-music/utils/core';
import { areBmsonChartsEquivalent } from './equivalence.ts';
import type { BmsonStringifyOptions } from './options.ts';

export function stringifyBmson(json: BeMusicJson, options: BmsonStringifyOptions = {}): string {
  const resolution = resolveBmsonResolutionForOutput(json, options);
  const indent = options.indent ?? 2;
  const skipValidation = options.skipPreservationValidation === true;
  const preservedDocument =
    options.resolution === undefined
      ? resolvePreservedBmsonDocumentForOutput(json, resolution, skipValidation)
      : undefined;
  if (preservedDocument) {
    return `${JSON.stringify(preservedDocument, null, indent)}\n`;
  }
  const sortedEvents = sortEvents(json.events);
  const beatResolver = createBeatResolver(json);
  const bmsLongNotes = resolveBmsLongNotesForBmsonOutput(json);

  // Lanes get bmson `x` numbers from every playable channel in use, plus the lanes mines and invisible objects sit on (a
  // mine on `D3` or a hidden note on `33` sits on lane `13`), so they keep their lane even where no playable note
  // shares it.
  const playableChannelSet = new Set<string>();
  for (const event of sortedEvents) {
    const channel = normalizeChannel(event.channel);
    if (channel === '01' || !isSampleTriggerChannel(channel)) {
      continue;
    }
    const lane = laneExtensionChannelToPlayableChannel(channel) ?? mapBmsLongNoteChannelToPlayable(channel) ?? channel;
    playableChannelSet.add(lane);
  }
  const playableChannels = [...playableChannelSet].sort();

  const modeHint = resolveBmsonModeHintForOutput(json, playableChannels);
  const xMap = createBmsonXMap(playableChannels, modeHint);

  const soundChannels = new Map<
    string,
    { name: string; notes: Array<{ x: number; y: number; l: number; c: boolean; t?: number }> }
  >();
  // beatoraja's lane extensions, grouped by sample like `sound_channels`: `key_channels` hold hidden notes (BMS
  // invisible objects) and `mine_channels` hold mines, each keeping its `damage`.
  const keyChannels = new Map<string, { name: string; notes: Array<{ x: number; y: number }> }>();
  const mineChannels = new Map<string, { name: string; notes: Array<{ x: number; y: number; damage?: number }> }>();
  const bpmEvents: Array<{ y: number; bpm: number }> = [];
  const stopEvents: Array<{ y: number; duration: number }> = [];
  const scrollEvents: Array<{ y: number; rate: number }> = [];
  // Honor `#BASE 62` so a chart whose `event.value` is a case-sensitive lowercase ID resolves to the right sample /
  // BPM / STOP slot when re-emitted as bmson.
  const idBase = resolveBmsBase(json);

  for (const event of sortedEvents) {
    const channel = normalizeChannel(event.channel);
    const isSampleChannel = isSampleTriggerChannel(channel);
    if (!isSampleChannel && channel !== '03' && channel !== '08' && channel !== '09' && channel !== 'SC') {
      continue;
    }

    const y = Math.round(beatResolver.eventToBeat(event) * resolution);
    if (isSampleChannel && isLandmineChannel(channel)) {
      const lane = landmineChannelToPlayableChannel(channel);
      const x = lane ? xMap.get(lane) : undefined;
      if (x !== undefined) {
        const damage = resolveMineDamageForBmsonOutput(json, event, idBase);
        // A BMS mine's value is its damage, not a WAV slot: every BMS mine explodes with `#WAV00`, so they share one
        // channel named after it (no sample when the chart has none). bmson-sourced mines keep their WAV slot.
        const key = json.sourceFormat === 'bmson' ? normalizeObjectKey(event.value, idBase) : BMS_MINE_SAMPLE_KEY;
        const name = json.resources.wav[key] ?? (json.sourceFormat === 'bmson' ? key : '');
        const slot = mineChannels.get(key) ?? { name, notes: [] };
        slot.notes.push({ x, y, ...(damage !== undefined ? { damage } : {}) });
        mineChannels.set(key, slot);
      }
      continue;
    }
    if (isSampleChannel && isInvisibleChannel(channel)) {
      const lane = invisibleChannelToPlayableChannel(channel);
      const x = lane ? xMap.get(lane) : undefined;
      if (x !== undefined) {
        const key = normalizeObjectKey(event.value, idBase);
        const slot = keyChannels.get(key) ?? { name: json.resources.wav[key] ?? key, notes: [] };
        slot.notes.push({ x, y });
        keyChannels.set(key, slot);
      }
      continue;
    }
    if (isSampleChannel) {
      // The end of a BMS long note (`#LNOBJ` end object, `5x` / `6x` end or continuation) is part of the note that
      // starts it, which carries the length as `l`.
      if (bmsLongNotes.endEvents.has(event)) {
        continue;
      }
      const key = normalizeObjectKey(event.value, idBase);
      const fileName = json.resources.wav[key] ?? key;
      const lane = mapBmsLongNoteChannelToPlayable(channel) ?? channel;
      const x = channel === '01' ? 0 : (xMap.get(lane) ?? 0);
      const longNoteEndBeat = bmsLongNotes.startToEndBeat.get(event);
      const length =
        longNoteEndBeat !== undefined
          ? Math.max(0, Math.round(longNoteEndBeat * resolution) - y)
          : typeof event.bmson?.l === 'number' && Number.isFinite(event.bmson.l) && event.bmson.l >= 0
            ? Math.floor(event.bmson.l)
            : 0;
      const continuation = event.bmson?.c === true;
      // beatoraja bmson extension — per-note long-note type rides along only on actual long notes.
      const longNoteType =
        length > 0 && (event.bmson?.t === 1 || event.bmson?.t === 2 || event.bmson?.t === 3)
          ? event.bmson.t
          : undefined;

      const slot = soundChannels.get(key) ?? { name: fileName, notes: [] };
      slot.notes.push({ x, y, l: length, c: continuation, ...(longNoteType !== undefined ? { t: longNoteType } : {}) });
      soundChannels.set(key, slot);
    }

    if (channel === '03') {
      const bpm = parseBpmFrom03Token(event.value);
      if (bpm > 0) {
        bpmEvents.push({ y, bpm });
      }
      continue;
    }
    if (channel === '08') {
      const bpm = json.resources.bpm[normalizeObjectKey(event.value, idBase)];
      if (typeof bpm === 'number' && bpm > 0) {
        bpmEvents.push({ y, bpm });
      }
      continue;
    }
    if (channel === '09') {
      // `#STOPxx` counts 1/192 of a 4/4 measure (48 per beat); bmson `duration` counts pulses at `resolution`.
      const stopUnits = json.resources.stop[normalizeObjectKey(event.value, idBase)];
      if (typeof stopUnits === 'number' && stopUnits > 0) {
        stopEvents.push({ y, duration: Math.round((stopUnits * resolution) / 48) });
      }
      continue;
    }
    if (channel === 'SC') {
      // beatoraja's `scroll_events` extension carries `#SCROLLxx` rates as they are.
      const rate = json.bms.scroll[normalizeObjectKey(event.value, idBase)];
      if (typeof rate === 'number' && Number.isFinite(rate)) {
        scrollEvents.push({ y, rate });
      }
    }
  }

  const bmson: Record<string, unknown> = {
    version: resolveBmsonVersionForOutput(json),
    info: createBmsonInfoForOutput(json, resolution, modeHint),
    lines: mapBmsonLineValues(resolveBmsonLinesForOutput(json, resolution)),
    bpm_events: bpmEvents,
    stop_events: stopEvents,
    ...(scrollEvents.length > 0 ? { scroll_events: scrollEvents } : {}),
    sound_channels: [...soundChannels.values()],
  };
  if (keyChannels.size > 0) {
    bmson.key_channels = [...keyChannels.values()];
  }
  if (mineChannels.size > 0) {
    bmson.mine_channels = [...mineChannels.values()];
  }
  const bga = createBmsonBgaForOutput(json);
  if (bga) {
    bmson.bga = bga;
  }

  return `${JSON.stringify(bmson, null, indent)}\n`;
}

function resolvePreservedBmsonDocumentForOutput(
  json: BeMusicJson,
  resolution: number,
  skipValidation: boolean,
): Record<string, unknown> | undefined {
  if (
    json.preservation.bmson.soundChannels.length === 0 &&
    json.preservation.bmson.bpmEvents.length === 0 &&
    json.preservation.bmson.stopEvents.length === 0 &&
    (json.preservation.bmson.scrollEvents?.length ?? 0) === 0
  ) {
    return undefined;
  }
  // The preserved arrays hold no `key_channels` / `mine_channels`, so a chart with hidden notes or mines always takes
  // the canonical path; otherwise a trusted (unvalidated) re-output would silently drop them.
  if (
    json.events.some((event) => laneExtensionChannelToPlayableChannel(normalizeChannel(event.channel)) !== undefined)
  ) {
    return undefined;
  }
  // Likewise SCROLL objects without a preserved `scroll_events` list (added after parsing, or from an older IR).
  if (
    (json.preservation.bmson.scrollEvents?.length ?? 0) === 0 &&
    json.events.some((event) => normalizeChannel(event.channel) === 'SC')
  ) {
    return undefined;
  }

  const document = createPreservedBmsonDocumentForOutput(json, resolution);
  if (skipValidation) {
    return document;
  }
  return doPreservedBmsonDocumentMatchChart(json, document) ? document : undefined;
}

function createPreservedBmsonDocumentForOutput(json: BeMusicJson, resolution: number): Record<string, unknown> {
  const document: Record<string, unknown> = {
    info: createPreservedBmsonInfoForOutput(json, resolution),
  };
  if (typeof json.bmson.version === 'string' && json.bmson.version.length > 0) {
    document.version = json.bmson.version;
  }
  if (json.preservation.bmson.lines.length > 0) {
    document.lines = mapBmsonLineValues(json.preservation.bmson.lines);
  }
  if (json.preservation.bmson.bpmEvents.length > 0) {
    document.bpm_events = json.preservation.bmson.bpmEvents.map(mapBmsonBpmEventForOutput);
  }
  if (json.preservation.bmson.stopEvents.length > 0) {
    document.stop_events = json.preservation.bmson.stopEvents.map(mapBmsonStopEventForOutput);
  }
  const scrollEvents = json.preservation.bmson.scrollEvents ?? [];
  if (scrollEvents.length > 0) {
    document.scroll_events = scrollEvents.map(mapBmsonScrollEventForOutput);
  }
  if (json.preservation.bmson.soundChannels.length > 0) {
    document.sound_channels = json.preservation.bmson.soundChannels.map(mapBmsonSoundChannelForOutput);
  }
  const bga = createBmsonBgaForOutput(json);
  if (bga) {
    document.bga = bga;
  }
  return document;
}

function createPreservedBmsonInfoForOutput(json: BeMusicJson, resolution: number): Record<string, unknown> {
  const info = json.bmson.info;
  const output: Record<string, unknown> = {};

  if (typeof info.title === 'string') {
    output.title = info.title;
  }
  if (typeof info.subtitle === 'string') {
    output.subtitle = info.subtitle;
  }
  if (typeof info.artist === 'string') {
    output.artist = info.artist;
  }
  if (typeof info.genre === 'string') {
    output.genre = info.genre;
  }
  if (Array.isArray(info.subartists)) {
    output.subartists = info.subartists.filter((item) => typeof item === 'string');
  }
  if (typeof info.chartName === 'string') {
    output.chart_name = info.chartName;
  }
  if (typeof info.level === 'number') {
    output.level = info.level;
  }
  if (typeof info.initBpm === 'number') {
    output.init_bpm = info.initBpm;
  }
  if (typeof info.modeHint === 'string') {
    output.mode_hint = info.modeHint;
  }
  if (typeof info.judgeRank === 'number') {
    output.judge_rank = info.judgeRank;
  }
  if (info.lnType === 1 || info.lnType === 2 || info.lnType === 3) {
    output.ln_type = info.lnType;
  }
  if (typeof info.total === 'number') {
    output.total = info.total;
  }
  if (typeof info.backImage === 'string') {
    output.back_image = info.backImage;
  }
  if (typeof info.eyecatchImage === 'string') {
    output.eyecatch_image = info.eyecatchImage;
  }
  if (typeof info.bannerImage === 'string') {
    output.banner_image = info.bannerImage;
  }
  if (typeof info.previewMusic === 'string') {
    output.preview_music = info.previewMusic;
  }
  if (typeof info.resolution === 'number') {
    output.resolution = info.resolution;
  } else {
    output.resolution = resolution;
  }

  return output;
}

function doPreservedBmsonDocumentMatchChart(json: BeMusicJson, document: Record<string, unknown>): boolean {
  const reparsed = parseBmson(JSON.stringify(document));
  return areBmsonChartsEquivalent(json, reparsed);
}

function mapBmsonBpmEventForOutput(event: BmsonBpmEventEntry): { y: number; bpm: number } {
  return {
    y: Math.max(0, Math.floor(event.y)),
    bpm: event.bpm,
  };
}

function mapBmsonStopEventForOutput(event: BmsonStopEventEntry): { y: number; duration: number } {
  return {
    y: Math.max(0, Math.floor(event.y)),
    duration: event.duration,
  };
}

function mapBmsonScrollEventForOutput(event: BmsonScrollEventEntry): { y: number; rate: number } {
  return {
    y: Math.max(0, Math.floor(event.y)),
    rate: event.rate,
  };
}

function mapBmsonSoundChannelForOutput(channel: BmsonSoundChannelEntry): {
  name: string;
  notes: Array<{ x?: number; y: number; l?: number; c?: boolean }>;
} {
  return {
    name: channel.name,
    notes: channel.notes.map((note) => ({
      ...(typeof note.x === 'number' ? { x: Math.floor(note.x) } : {}),
      y: Math.max(0, Math.floor(note.y)),
      ...(typeof note.l === 'number' ? { l: Math.max(0, Math.floor(note.l)) } : {}),
      ...(typeof note.c === 'boolean' ? { c: note.c } : {}),
    })),
  };
}

function resolveBmsonResolutionForOutput(json: BeMusicJson, options: BmsonStringifyOptions): number {
  if (typeof options.resolution === 'number' && Number.isFinite(options.resolution) && options.resolution > 0) {
    return Math.floor(options.resolution);
  }

  const irResolution = json.bmson.info.resolution;
  if (typeof irResolution === 'number' && Number.isFinite(irResolution) && irResolution > 0) {
    return Math.floor(irResolution);
  }

  return 240;
}

function resolveBmsonVersionForOutput(json: BeMusicJson): string {
  if (typeof json.bmson.version === 'string' && json.bmson.version.length > 0) {
    return json.bmson.version;
  }
  return '1.0.0';
}

function createBmsonInfoForOutput(json: BeMusicJson, resolution: number, modeHint: string): Record<string, unknown> {
  const info = json.bmson.info;
  const metadataPlayLevel = resolveBmsonCompatiblePlayLevel(json.metadata.playLevel);
  const output: Record<string, unknown> = {
    title: info.title ?? json.metadata.title ?? '',
    subtitle: info.subtitle ?? json.metadata.subtitle ?? '',
    artist: info.artist ?? json.metadata.artist ?? '',
    genre: info.genre ?? json.metadata.genre ?? '',
    level: typeof info.level === 'number' ? info.level : (metadataPlayLevel ?? 0),
    init_bpm: typeof info.initBpm === 'number' ? info.initBpm : json.metadata.bpm,
    mode_hint: modeHint,
    resolution,
  };

  const subartists = normalizeBmsonSubartistsForOutput(info.subartists);
  if (subartists !== undefined) {
    output.subartists = subartists;
  }
  if (typeof info.chartName === 'string') {
    output.chart_name = info.chartName;
  }
  const lnType = resolveBmsonLnTypeForOutput(json);
  if (lnType !== undefined) {
    output.ln_type = lnType;
  }

  const judgeRank = resolveBmsonJudgeRankForOutput(json);
  if (judgeRank !== undefined) {
    output.judge_rank = judgeRank;
  }
  const total = resolveBmsonTotalForOutput(json);
  if (total !== undefined) {
    output.total = total;
  }

  if (typeof info.backImage === 'string') {
    output.back_image = info.backImage;
  }
  if (typeof info.eyecatchImage === 'string') {
    output.eyecatch_image = info.eyecatchImage;
  }
  if (typeof info.bannerImage === 'string') {
    output.banner_image = info.bannerImage;
  }
  if (typeof info.previewMusic === 'string') {
    output.preview_music = info.previewMusic;
  }

  return output;
}

/**
 * BMS `#RANK 0..4` (VERY HARD / HARD / NORMAL / EASY / VERY EASY) expressed on bmson's `judge_rank` axis, which is
 * `#DEFEXRANK`'s unit (100 = NORMAL). Each entry is the `#DEFEXRANK` value that judges like that rank: LR2 places
 * `#RANK 0..3` at 25 / 50 / 75 / 100 % and beatoraja at judgerank 25 / 50 / 75 / 100, both with NORMAL at 75, so both
 * give 100/3, 200/3, 100 and 400/3. They disagree only on VERY EASY — LR2 plays it as NORMAL, beatoraja (bmson's native
 * player) at judgerank 125 — and beatoraja's value (500/3) is used. Values are rounded to whole percents, which moves
 * LR2's windows by at most 0.4 ms. beatoraja itself reads a bmson `judge_rank` as the judgerank directly instead of
 * scaling it like `#DEFEXRANK` (× 75 / 100), so under it any bmson — including one converted from `#DEFEXRANK` or one
 * leaving `judge_rank` at its default — judges 4/3 wider than the same value in a BMS. No value on this axis can undo
 * that without breaking NORMAL = 100 for every other reader, so the mapping stays on the `#DEFEXRANK` axis.
 */
const BMS_RANK_TO_BMSON_JUDGE_RANK = [33, 67, 100, 133, 167] as const;

/**
 * bmson `info.judge_rank` shares `#DEFEXRANK`'s unit (100 = NORMAL), while BMS `#RANK` — `metadata.rank` on any
 * non-bmson chart — is a 0..4 rank index, so writing it verbatim turned `#RANK 2` into a 2 % window. Resolution order:
 * `bmson.info.judge_rank` as authored; for a bmson source, `metadata.rank` (the parser mirrors `judge_rank` there);
 * otherwise a positive `#DEFEXRANK` verbatim, then an integer `#RANK 0..4` through
 * {@link BMS_RANK_TO_BMSON_JUDGE_RANK}. beatoraja judges any other `#RANK` (out of range or fractional) as NORMAL, so
 * the field is left out and the bmson default (100 = NORMAL) applies.
 */
function resolveBmsonJudgeRankForOutput(json: BeMusicJson): number | undefined {
  const authored = json.bmson.info.judgeRank;
  if (typeof authored === 'number' && Number.isFinite(authored)) {
    return authored;
  }
  const rank = json.metadata.rank;
  if (json.sourceFormat === 'bmson') {
    return typeof rank === 'number' && Number.isFinite(rank) ? rank : undefined;
  }
  const defExRank = json.bms.defExRank;
  if (typeof defExRank === 'number' && Number.isFinite(defExRank) && defExRank > 0) {
    return defExRank;
  }
  if (typeof rank === 'number' && Number.isInteger(rank) && rank >= 0 && rank < BMS_RANK_TO_BMSON_JUDGE_RANK.length) {
    return BMS_RANK_TO_BMSON_JUDGE_RANK[rank];
  }
  return undefined;
}

/**
 * bmson `info.total` is a percentage of the player's default TOTAL (beatoraja scales it by the note-count-based
 * default), while BMS `#TOTAL` — and `metadata.total` on any non-bmson chart — is the absolute gauge TOTAL. Writing the
 * absolute value would make e.g. `#TOTAL 300` mean 300% of the default, and there is no exact conversion here: the
 * default depends on the ruleset and on how it counts long notes. So only a value already in bmson terms is written —
 * `bmson.info.total`, or `metadata.total` of a bmson source (the parser mirrors `info.total` there) — and a BMS / JSON
 * chart's absolute TOTAL is left out, letting the bmson default (100%) apply.
 */
function resolveBmsonTotalForOutput(json: BeMusicJson): number | undefined {
  const authored = json.bmson.info.total;
  if (typeof authored === 'number' && Number.isFinite(authored)) {
    return authored;
  }
  const total = json.metadata.total;
  if (json.sourceFormat === 'bmson' && typeof total === 'number' && Number.isFinite(total)) {
    return total;
  }
  return undefined;
}

function resolveBmsonCompatiblePlayLevel(value: BeMusicJson['metadata']['playLevel']): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed)) {
    return undefined;
  }
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function createBmsonBgaForOutput(json: BeMusicJson):
  | {
      bga_header: Array<{ id: number; name: string }>;
      bga_events: Array<{ y: number; id: number }>;
      layer_events: Array<{ y: number; id: number }>;
      poor_events: Array<{ y: number; id: number }>;
    }
  | undefined {
  const header: Array<{ id: number; name: string }> = [];
  for (const entry of json.bmson.bga.header ?? []) {
    header.push({
      id: Math.max(0, Math.floor(entry.id)),
      name: entry.name,
    });
  }
  const events = normalizeBmsonBgaEventEntries(json.bmson.bga.events ?? []);
  const layerEvents = normalizeBmsonBgaEventEntries(json.bmson.bga.layerEvents ?? []);
  const poorEvents = normalizeBmsonBgaEventEntries(json.bmson.bga.poorEvents ?? []);

  if (header.length === 0 && events.length === 0 && layerEvents.length === 0 && poorEvents.length === 0) {
    return undefined;
  }

  return {
    bga_header: header,
    bga_events: events,
    layer_events: layerEvents,
    poor_events: poorEvents,
  };
}

function normalizeBmsonSubartistsForOutput(value: string[] | undefined): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item) => typeof item === 'string');
}

function resolveBmsonLinesForOutput(json: BeMusicJson, resolution: number): number[] {
  if (json.preservation.bmson.lines.length > 0) {
    return normalizeBmsonLines(
      rescaleBmsonLines(json.preservation.bmson.lines, json.bmson.info.resolution, resolution),
    );
  }
  return createDefaultBmsonLines(json, resolution);
}

/**
 * Preserved `lines` are pulses at the source chart's resolution; notes are re-emitted at the output resolution, so the
 * bar lines have to follow or every note lands in the wrong measure. Without a known source resolution they are kept.
 */
function rescaleBmsonLines(lines: number[], sourceResolution: number | undefined, resolution: number): number[] {
  if (
    typeof sourceResolution !== 'number' ||
    !Number.isFinite(sourceResolution) ||
    sourceResolution <= 0 ||
    Math.floor(sourceResolution) === resolution
  ) {
    return lines;
  }
  const scale = resolution / Math.floor(sourceResolution);
  return lines.map((y) => Math.round(y * scale));
}

function normalizeBmsonLines(lines: number[]): number[] {
  const sorted = normalizeSortedUniqueNonNegativeIntegers(lines);
  if (sorted.length === 0 || sorted[0] !== 0) {
    sorted.unshift(0);
  }
  return sorted;
}

function createDefaultBmsonLines(json: BeMusicJson, resolution: number): number[] {
  const ticksPerMeasure = Math.max(1, Math.floor(resolution * 4));
  let lastEventMeasure = 0;
  for (const event of json.events) {
    if (event.measure > lastEventMeasure) {
      lastEventMeasure = event.measure;
    }
  }
  let lastMeasureLength = 0;
  const lengths = new Map<number, number>();
  for (const measure of json.measures) {
    if (measure.index > lastMeasureLength) {
      lastMeasureLength = measure.index;
    }
    lengths.set(measure.index, measure.length);
  }
  const measureCount = Math.max(1, Math.max(lastEventMeasure, lastMeasureLength) + 1);

  const lines = [0];
  let cursor = 0;
  for (let measure = 0; measure < measureCount; measure += 1) {
    const length = lengths.get(measure) ?? 1;
    const ticks = Math.max(1, Math.round(length * ticksPerMeasure));
    cursor += ticks;
    lines.push(cursor);
  }

  return lines;
}

function mapBmsonLineValues(lines: ReadonlyArray<number>): Array<{ y: number }> {
  const mapped: Array<{ y: number }> = [];
  for (const y of lines) {
    mapped.push({ y });
  }
  return mapped;
}

function normalizeBmsonBgaEventEntries(
  entries: ReadonlyArray<{ y: number; id: number }>,
): Array<{ y: number; id: number }> {
  const normalized: Array<{ y: number; id: number }> = [];
  for (const entry of entries) {
    normalized.push({
      y: Math.max(0, Math.floor(entry.y)),
      id: Math.max(0, Math.floor(entry.id)),
    });
  }
  return normalized;
}

/**
 * The `mode_hint` a bmson rendering of `json` declares: the chart's own hint when it has one, else the hint of the chart's
 * play-mode layout (from the play-mode table in `@be-music/chart`) — always for the 24 / 48 KEY keyboard layouts, whose
 * wheel and extended lanes only have a home there, and for the other layouts when every lane in use has a place in the
 * hint's table — else the spec's `generic-<lanes>keys`, a layout ordered left to right. (A made-up `beat-<lanes>k` would be
 * an unknown hint, which beatoraja, Qwilight, Bemuse and the be-music parser read as `beat-7k`.)
 */
function resolveBmsonModeHintForOutput(json: BeMusicJson, playableChannels: readonly string[]): string {
  if (json.bmson.info.modeHint !== undefined) {
    return json.bmson.info.modeHint;
  }
  const variant = resolveChartPlayVariant({ events: json.events, bms: json.bms, bmson: json.bmson });
  for (const layout of getPlayModeLayouts(variant)) {
    const hint = layout.bmsonModeHint;
    if (hint === undefined) continue;
    if (variant === '24' || variant === '48') return hint;
    const lanes = BMSON_MODE_HINT_LAYOUTS[hint].xByChannel;
    if (playableChannels.every((channel) => lanes.has(channel))) {
      return hint;
    }
  }
  return `generic-${Math.max(1, playableChannels.length)}keys`;
}

/**
 * Lane channel → bmson `x`. A hint with a lane table in the play-mode table (`@be-music/chart`) gives each lane the
 * fixed `x` the parser reads back from it — the keyboard layouts x = side * 26 + lane, the IIDX / Pop'n hints their
 * spec table — so a sparse chart keeps its keys; lanes outside the table follow after its last `x`. Unknown hints
 * number the lanes in use from 1.
 */
function createBmsonXMap(playableChannels: readonly string[], modeHint: string): Map<string, number> {
  const xMap = new Map<string, number>();
  const table = resolveBmsonModeHintLayout(modeHint);
  const unmapped: string[] = [];
  for (const channel of playableChannels) {
    const x = table?.xByChannel.get(channel.toUpperCase());
    if (x !== undefined) {
      xMap.set(channel, x);
    } else {
      unmapped.push(channel);
    }
  }
  const firstUnmappedX = (table?.width ?? 0) + 1;
  unmapped.forEach((channel, index) => xMap.set(channel, firstUnmappedX + index));
  return xMap;
}

/** The playable lane a landmine channel sits on (`D3` → `13`, `E5` → `25`), or `undefined` for anything else. */
function landmineChannelToPlayableChannel(channel: string): string | undefined {
  if (channel.length !== 2) return undefined;
  const side = channel[0]!.toUpperCase();
  if (side === 'D') return `1${channel[1]}`;
  if (side === 'E') return `2${channel[1]}`;
  return undefined;
}

/** `3x` / `4x` — BMS invisible objects, written as bmson `key_channels` (beatoraja's hidden notes). */
function isInvisibleChannel(channel: string): boolean {
  return channel.length === 2 && (channel[0] === '3' || channel[0] === '4');
}

function invisibleChannelToPlayableChannel(channel: string): string | undefined {
  if (!isInvisibleChannel(channel)) return undefined;
  return `${channel[0] === '3' ? '1' : '2'}${channel[1]}`;
}

/** The playable lane (`1x` / `2x`) a mine or invisible object sits on, or `undefined` for any other channel. */
function laneExtensionChannelToPlayableChannel(channel: string): string | undefined {
  if (isLandmineChannel(channel)) return landmineChannelToPlayableChannel(channel);
  return invisibleChannelToPlayableChannel(channel);
}

/** BMS mines explode with `#WAV00`; their object value is the damage. */
export const BMS_MINE_SAMPLE_KEY = '00';
const BASE36_MINE_VALUE_PATTERN = /^[0-9A-Z]{2}$/;
export const BMSON_LONG_NOTE_TYPES: ReadonlySet<number> = new Set([1, 2, 3]);

interface BmsLongNotesForBmsonOutput {
  /** Start event → beat of its end. */
  startToEndBeat: Map<BeMusicEvent, number>;
  /** End objects and `#LNTYPE 2` continuations, which belong to the note that starts them. */
  endEvents: Set<BeMusicEvent>;
}

/**
 * The long notes of a BMS chart as be-music plays them — `#LNOBJ` pairs and `5x` / `6x` long notes (`#LNTYPE 1` /
 * `2`, inferred like the web player when `#LNTYPE` is missing) — so bmson can write each as one note with `l`.
 */
function resolveBmsLongNotesForBmsonOutput(json: BeMusicJson): BmsLongNotesForBmsonOutput {
  const lnobj = resolveLnobjLongNotes(json);
  const startToEndBeat = new Map(lnobj.startToEndBeat);
  const endEvents = new Set(lnobj.endEvents);
  const legacy = resolveBmsLongNotes(json, { inferLnTypeWhenMissing: true });
  for (const note of legacy.notes) {
    if (note.endBeat !== undefined) {
      startToEndBeat.set(note.event, note.endBeat);
    }
  }
  for (const event of legacy.suppressedTriggerEvents) {
    endEvents.add(event);
  }
  return { startToEndBeat, endEvents };
}

/**
 * The bmson `damage` of a mine, as be-music's player resolves it: an authored `bmson.damage` wins; a BMS (or JSON)
 * mine's value is its damage read in base 36 (LR2 / beatoraja, no halving); otherwise `damage` is left out, which
 * deals the same default as an invalid BMS value.
 */
function resolveMineDamageForBmsonOutput(json: BeMusicJson, event: BeMusicEvent, idBase: 36 | 62): number | undefined {
  const authored = event.bmson?.damage;
  if (typeof authored === 'number' && Number.isFinite(authored) && authored >= 0) {
    return authored;
  }
  if (json.sourceFormat === 'bmson') {
    return undefined;
  }
  const value = normalizeObjectKey(event.value, idBase);
  if (!BASE36_MINE_VALUE_PATTERN.test(value)) {
    return undefined;
  }
  const damage = Number.parseInt(value, 36);
  return damage > 0 ? damage : undefined;
}

/**
 * bmson `info.ln_type`: the authored `bmson.info.lnType`, else BMS `#LNMODE` — both use 1 = LN, 2 = CN, 3 = HCN.
 */
function resolveBmsonLnTypeForOutput(json: BeMusicJson): number | undefined {
  const authored = json.bmson.info.lnType;
  if (typeof authored === 'number' && BMSON_LONG_NOTE_TYPES.has(authored)) {
    return authored;
  }
  const lnMode = json.bms.lnMode;
  return typeof lnMode === 'number' && BMSON_LONG_NOTE_TYPES.has(lnMode) ? lnMode : undefined;
}
