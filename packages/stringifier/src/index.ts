import {
  compareEvents,
  createBeatResolver,
  isLandmineChannel,
  isPlayableChannel,
  isSampleTriggerChannel,
  mapBmsLongNoteChannelToPlayable,
  parseBpmFrom03Token,
  resolveBmsLongNotes,
  resolveChartPlayVariant,
  resolveLnobjLongNotes,
  sortEvents,
} from '@be-music/chart';
import { parseBms, parseBmson } from '@be-music/parser';
import {
  intToBase36,
  normalizeChannel,
  normalizeObjectKey,
  resolveBmsBase,
  type BmsObjectLineEntry,
  type BmsSourceLineEntry,
  type BmsonBpmEventEntry,
  type BmsonSoundChannelEntry,
  type BmsonStopEventEntry,
  type BeMusicEvent,
  type BeMusicJson,
} from '@be-music/json';
import {
  gcd,
  lcm,
  normalizeFractionNumerator,
  normalizeNonNegativeInt,
  normalizePositiveInt,
  normalizeSortedUniqueNonNegativeIntegers,
} from '@be-music/utils/core';
export interface BmsStringifyOptions {
  eol?: '\n' | '\r\n';
  maxResolution?: number;
  /**
   * When `true`, skip the round-trip re-parse that normally verifies the preserved source / object lines still encode
   * the same chart as `json`. The default (`false`) re-runs `parseBms` against the just-rendered output and falls back
   * to canonical sections on mismatch — the safe choice when callers may have mutated the JSON between parse and
   * stringify. Set to `true` only when you can guarantee the preservation arrays were produced by an in-process parse
   * of unchanged content (e.g. a pure round-trip in tests, a SHA-stable export pipeline); doing so halves stringify
   * time on charts large enough for the re-parse to dominate (`stringifier:200`).
   */
  skipPreservationValidation?: boolean;
}

export interface BmsonStringifyOptions {
  resolution?: number;
  indent?: number;
  /** See {@link BmsStringifyOptions.skipPreservationValidation}. */
  skipPreservationValidation?: boolean;
}

export function stringifyBms(json: BeMusicJson, options: BmsStringifyOptions = {}): string {
  const eol = options.eol ?? '\n';
  const maxResolution = options.maxResolution;
  const skipValidation = options.skipPreservationValidation === true;
  const preservedSourceLines =
    maxResolution === undefined ? resolvePreservedBmsSourceLinesForOutput(json, skipValidation) : undefined;
  if (preservedSourceLines) {
    return preservedSourceLines.join(eol);
  }
  const preservedObjectLines =
    maxResolution === undefined ? resolvePreservedObjectLinesForOutput(json, skipValidation) : undefined;
  if (!preservedObjectLines) {
    json = convertChartForBmsOutput(json);
  }
  const lines: string[] = [];

  pushBmsSectionComment(lines, 'METADATA');
  pushMetadataLines(lines, json);
  pushBmsSectionComment(lines, 'EXTENDED HEADER');
  pushBmsExtensionLines(lines, json);
  pushBmsSectionComment(lines, 'RESOURCES');
  pushResourceLines(lines, json);
  pushBmsSectionComment(lines, 'MEASURE LENGTH');
  pushMeasureLines(lines, json, preservedObjectLines);
  pushBmsSectionComment(lines, 'OBJECT DATA');
  pushEventLines(lines, json, maxResolution, preservedObjectLines);
  pushBmsSectionComment(lines, 'CONTROL FLOW');
  pushControlFlowLines(lines, json);

  return lines.join(eol);
}

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

  const modeHint = resolveBmsonModeHintForOutput(json, playableChannels.length);
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
  // Honor `#BASE 62` so a chart whose `event.value` is a case-sensitive lowercase ID resolves to the right sample /
  // BPM / STOP slot when re-emitted as bmson.
  const idBase = resolveBmsBase(json);

  for (const event of sortedEvents) {
    const channel = normalizeChannel(event.channel);
    const isSampleChannel = isSampleTriggerChannel(channel);
    if (!isSampleChannel && channel !== '03' && channel !== '08' && channel !== '09') {
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
    }
  }

  const bmson: Record<string, unknown> = {
    version: resolveBmsonVersionForOutput(json),
    info: createBmsonInfoForOutput(json, resolution, modeHint),
    lines: mapBmsonLineValues(resolveBmsonLinesForOutput(json, resolution)),
    bpm_events: bpmEvents,
    stop_events: stopEvents,
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

function resolvePreservedBmsSourceLinesForOutput(json: BeMusicJson, skipValidation: boolean): string[] | undefined {
  const sourceLines = json.preservation.bms.sourceLines;
  if (!Array.isArray(sourceLines) || sourceLines.length === 0) {
    return undefined;
  }

  const lines = renderPreservedBmsSourceLines(sourceLines);
  if (lines.length === 0) {
    return undefined;
  }
  // `skipValidation` halves stringify time on large charts (the re-parse below dominates), but trusts the caller to
  // have left the JSON untouched between parse and stringify. See `BmsStringifyOptions.skipPreservationValidation`.
  if (skipValidation) {
    return lines;
  }
  return doPreservedBmsSourceLinesMatchChart(json, lines) ? lines : undefined;
}

function renderPreservedBmsSourceLines(sourceLines: BmsSourceLineEntry[]): string[] {
  const lines: string[] = [];
  for (const entry of sourceLines) {
    if (entry.kind === 'directive') {
      lines.push(entry.value ? `#${entry.command} ${entry.value}` : `#${entry.command}`);
      continue;
    }
    if (entry.kind === 'header') {
      // Use the case-preserved `commandRaw` when present so e.g. `#WAV0a` survives the round-trip on a `#BASE 62`
      // chart.
      const commandText = entry.commandRaw ?? entry.command;
      lines.push(entry.value.length > 0 ? `#${commandText} ${entry.value}` : `#${commandText}`);
      continue;
    }
    if (typeof entry.measureLength === 'number' && entry.measureLength > 0) {
      lines.push(`#${toMeasure(entry.measure)}${normalizeChannel(entry.channel)}:${formatNumber(entry.measureLength)}`);
      continue;
    }
    const serialized = serializeBmsObjectLineEvents(entry.measure, entry.channel, entry.events);
    if (serialized) {
      lines.push(serialized);
    }
  }
  return lines;
}

function doPreservedBmsSourceLinesMatchChart(json: BeMusicJson, lines: string[]): boolean {
  const reparsed = parseBms(lines.join('\n'));
  return areBmsChartsEquivalent(json, reparsed);
}

function resolvePreservedBmsonDocumentForOutput(
  json: BeMusicJson,
  resolution: number,
  skipValidation: boolean,
): Record<string, unknown> | undefined {
  if (
    json.preservation.bmson.soundChannels.length === 0 &&
    json.preservation.bmson.bpmEvents.length === 0 &&
    json.preservation.bmson.stopEvents.length === 0
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

function pushMetadataLines(lines: string[], json: BeMusicJson): void {
  lines.push(`#TITLE ${json.metadata.title ?? ''}`);
  if (json.metadata.subtitle) {
    lines.push(`#SUBTITLE ${json.metadata.subtitle}`);
  }
  lines.push(`#ARTIST ${json.metadata.artist ?? ''}`);
  if (json.metadata.genre) {
    lines.push(`#GENRE ${json.metadata.genre}`);
  }
  lines.push(`#BPM ${formatNumber(json.metadata.bpm)}`);
  if (typeof json.metadata.playLevel === 'number') {
    lines.push(`#PLAYLEVEL ${formatNumber(json.metadata.playLevel)}`);
  } else if (typeof json.metadata.playLevel === 'string' && json.metadata.playLevel.length > 0) {
    lines.push(`#PLAYLEVEL ${json.metadata.playLevel}`);
  }
  if (typeof json.metadata.rank === 'number') {
    lines.push(`#RANK ${formatNumber(json.metadata.rank)}`);
  }
  if (typeof json.metadata.total === 'number') {
    lines.push(`#TOTAL ${formatNumber(json.metadata.total)}`);
  }
  if (typeof json.metadata.difficulty === 'number') {
    lines.push(`#DIFFICULTY ${formatNumber(json.metadata.difficulty)}`);
  }
  if (json.metadata.comment) {
    lines.push(`#COMMENT ${json.metadata.comment}`);
  }
  if (json.metadata.stageFile) {
    lines.push(`#STAGEFILE ${json.metadata.stageFile}`);
  }

  const extras = Object.entries(json.metadata.extras ?? {})
    .filter(([command]) => !isDedicatedBmsExtensionCommand(command))
    .sort(([left], [right]) => left.localeCompare(right));
  for (const [command, value] of extras) {
    lines.push(`#${command} ${value}`);
  }
}

function pushBmsExtensionLines(lines: string[], json: BeMusicJson): void {
  const base = resolveJsonBase(json);
  // `#BASE 62` opts the whole chart into the beatoraja base-62 ID extension, which affects every subsequent
  // indexed-header / channel-stream token's case-sensitivity. Emit it FIRST so it takes effect before any `#WAVxx` /
  // `#BMPxx` etc. lines below.
  if (base === 62) {
    lines.push('#BASE 62');
  }
  if (typeof json.bms.preview === 'string' && json.bms.preview.length > 0) {
    lines.push(`#PREVIEW ${json.bms.preview}`);
  }
  if (typeof json.bms.player === 'number') {
    lines.push(`#PLAYER ${formatNumber(json.bms.player)}`);
  }
  if (typeof json.bms.pathWav === 'string' && json.bms.pathWav.length > 0) {
    lines.push(`#PATH_WAV ${json.bms.pathWav}`);
  }
  if (typeof json.bms.baseBpm === 'number') {
    lines.push(`#BASEBPM ${formatNumber(json.bms.baseBpm)}`);
  }

  for (const stp of json.bms.stp ?? []) {
    if (typeof stp === 'string' && stp.length > 0) {
      lines.push(`#STP ${stp}`);
    }
  }

  if (typeof json.bms.option === 'string' && json.bms.option.length > 0) {
    lines.push(`#OPTION ${json.bms.option}`);
  }
  pushIndexedStringLines(lines, 'CHANGEOPTION', json.bms.changeOption, base);

  // Charts declare one `#WAVCMD` line per (parameter, slot) pair, so write every line; the legacy `wavCmd` only holds the
  // first, and stands in when `wavCmds` is empty.
  const wavCmds = (json.bms.wavCmds?.length ?? 0) > 0 ? json.bms.wavCmds : [json.bms.wavCmd];
  for (const wavCmd of wavCmds) {
    if (typeof wavCmd === 'string' && wavCmd.length > 0) {
      lines.push(`#WAVCMD ${wavCmd}`);
    }
  }

  if (typeof json.bms.lnType === 'number') {
    lines.push(`#LNTYPE ${formatNumber(json.bms.lnType)}`);
  }
  if (typeof json.bms.lnMode === 'number') {
    lines.push(`#LNMODE ${formatNumber(json.bms.lnMode)}`);
  }
  if ((json.bms.lnObjs?.length ?? 0) > 0) {
    for (const lnObj of json.bms.lnObjs ?? []) {
      if (typeof lnObj === 'string' && lnObj.length > 0) {
        lines.push(`#LNOBJ ${normalizeObjectKey(lnObj, base)}`);
      }
    }
  }
  if (typeof json.bms.volWav === 'number') {
    lines.push(`#VOLWAV ${formatNumber(json.bms.volWav)}`);
  }
  if (typeof json.bms.defExRank === 'number') {
    lines.push(`#DEFEXRANK ${formatNumber(json.bms.defExRank)}`);
  }

  pushIndexedStringLines(lines, 'EXRANK', json.bms.exRank, base);
  pushIndexedStringLines(lines, 'ARGB', json.bms.argb, base);
  pushIndexedStringLines(lines, 'EXWAV', json.bms.exWav, base);
  pushIndexedStringLines(lines, 'EXBMP', json.bms.exBmp, base);
  pushIndexedStringLines(lines, 'BGA', json.bms.bga, base);
  pushIndexedNumberLines(lines, 'SCROLL', json.bms.scroll, base);
  pushIndexedNumberLines(lines, 'SPEED', json.bms.speed, base);
  if (typeof json.bms.poorBga === 'string' && json.bms.poorBga.length > 0) {
    lines.push(`#POORBGA ${json.bms.poorBga}`);
  }
  pushIndexedStringLines(lines, 'SWBGA', json.bms.swBga, base);

  if (typeof json.bms.videoFile === 'string' && json.bms.videoFile.length > 0) {
    lines.push(`#VIDEOFILE ${json.bms.videoFile}`);
  }
  if (typeof json.bms.midiFile === 'string' && json.bms.midiFile.length > 0) {
    lines.push(`#MIDIFILE ${json.bms.midiFile}`);
  }
  if (typeof json.bms.materials === 'string' && json.bms.materials.length > 0) {
    lines.push(`#MATERIALS ${json.bms.materials}`);
  }
  if (typeof json.bms.divideProp === 'string' && json.bms.divideProp.length > 0) {
    lines.push(`#DIVIDEPROP ${json.bms.divideProp}`);
  }
  if (typeof json.bms.charset === 'string' && json.bms.charset.length > 0) {
    lines.push(`#CHARSET ${json.bms.charset}`);
  }
}

function pushResourceLines(lines: string[], json: BeMusicJson): void {
  const base = resolveJsonBase(json);
  pushIndexedStringLines(lines, 'WAV', json.resources.wav, base);
  pushIndexedStringLines(lines, 'BMP', json.resources.bmp, base);
  pushIndexedNumberLines(lines, 'BPM', json.resources.bpm, base);
  pushIndexedNumberLines(lines, 'STOP', json.resources.stop, base);
  pushIndexedStringLines(lines, 'TEXT', json.resources.text, base);
}

function resolveJsonBase(json: BeMusicJson): 36 | 62 {
  return json.bms.base === 62 ? 62 : 36;
}

function pushIndexedStringLines(
  lines: string[],
  command: string,
  values: Record<string, string> | undefined,
  base: 36 | 62 = 36,
): void {
  const entries = Object.entries(values ?? {}).sort(([left], [right]) => left.localeCompare(right));
  for (const [key, value] of entries) {
    if (value.length > 0) {
      lines.push(`#${command}${normalizeObjectKey(key, base)} ${value}`);
    }
  }
}

function pushIndexedNumberLines(
  lines: string[],
  command: string,
  values: Record<string, number> | undefined,
  base: 36 | 62 = 36,
): void {
  const entries = Object.entries(values ?? {}).sort(([left], [right]) => left.localeCompare(right));
  for (const [key, value] of entries) {
    if (Number.isFinite(value)) {
      lines.push(`#${command}${normalizeObjectKey(key, base)} ${formatNumber(value)}`);
    }
  }
}

function pushMeasureLines(lines: string[], json: BeMusicJson, preservedObjectLines?: BmsObjectLineEntry[]): void {
  if (preservedObjectLines) {
    for (const objectLine of preservedObjectLines) {
      if (typeof objectLine.measureLength === 'number' && objectLine.measureLength > 0) {
        lines.push(`#${toMeasure(objectLine.measure)}02:${formatNumber(objectLine.measureLength)}`);
      }
    }
    return;
  }

  const measures = [...json.measures]
    .filter((measure) => measure.length > 0 && Math.abs(measure.length - 1) > 1e-9)
    .sort((left, right) => left.index - right.index);

  for (const measure of measures) {
    lines.push(`#${toMeasure(measure.index)}02:${formatNumber(measure.length)}`);
  }
}

function pushEventLines(
  lines: string[],
  json: BeMusicJson,
  maxResolution?: number,
  preservedObjectLines?: BmsObjectLineEntry[],
): void {
  if (preservedObjectLines) {
    for (const objectLine of preservedObjectLines) {
      const serialized = serializeBmsObjectLineEvents(
        objectLine.measure,
        objectLine.channel,
        objectLine.events,
        resolveJsonBase(json),
      );
      if (serialized) {
        lines.push(serialized);
      }
    }
    return;
  }

  const base = resolveJsonBase(json);
  const grouped = groupEvents(sortEvents(json.events), base);
  for (const group of grouped) {
    const { measure, channel, events } = group;
    const resolution = chooseResolution(events, maxResolution);
    const cells = Array.from({ length: resolution }, () => '00');

    for (const event of events) {
      const { numerator, denominator } = resolveEventFraction(event);
      const scaled = Math.round((numerator * resolution) / denominator);
      const index = Math.min(resolution - 1, Math.max(0, scaled));
      cells[index] = normalizeObjectKey(event.value, base);
    }

    lines.push(`#${toMeasure(measure)}${channel}:${cells.join('')}`);
  }
}

function resolvePreservedObjectLinesForOutput(
  json: BeMusicJson,
  skipValidation: boolean,
): BmsObjectLineEntry[] | undefined {
  const objectLines = json.preservation.bms.objectLines;
  if (!Array.isArray(objectLines) || objectLines.length === 0) {
    return undefined;
  }
  if (skipValidation) {
    return objectLines;
  }
  return doPreservedObjectLinesMatchChart(json, objectLines) ? objectLines : undefined;
}

function doPreservedObjectLinesMatchChart(json: BeMusicJson, objectLines: BmsObjectLineEntry[]): boolean {
  const flattenedEvents: BeMusicEvent[] = [];
  const preservedMeasureLengths = new Map<number, number>();
  // Compare values under the chart's authored radix so a base-62 chart's lowercase IDs aren't folded to uppercase
  // before the event comparison below — that would falsely trigger a mismatch and force the stringifier to regenerate
  // object lines even when the preserved entries are still consistent.
  const idBase = resolveBmsBase(json);

  for (const objectLine of objectLines) {
    if (typeof objectLine.measureLength === 'number' && objectLine.measureLength > 0) {
      preservedMeasureLengths.set(Math.max(0, Math.floor(objectLine.measure)), objectLine.measureLength);
    }
    for (const event of objectLine.events) {
      if (normalizeObjectKey(event.value, idBase) === '00') {
        continue;
      }
      flattenedEvents.push({
        measure: Math.max(0, Math.floor(objectLine.measure)),
        channel: normalizeChannel(objectLine.channel),
        position: event.position,
        value: normalizeObjectKey(event.value, idBase),
        ...(event.bmson ? { bmson: event.bmson } : {}),
      });
    }
  }

  const sortedFlattenedEvents = sortEvents(flattenedEvents);
  const sortedCurrentEvents = sortEvents(json.events);
  if (sortedFlattenedEvents.length !== sortedCurrentEvents.length) {
    return false;
  }
  for (let index = 0; index < sortedCurrentEvents.length; index += 1) {
    if (compareEvents(sortedFlattenedEvents[index]!, sortedCurrentEvents[index]!) !== 0) {
      return false;
    }
    if (!areEventBmsonExtensionsEqual(sortedFlattenedEvents[index]!.bmson, sortedCurrentEvents[index]!.bmson)) {
      return false;
    }
  }

  const currentMeasureLengths = new Map<number, number>();
  for (const measure of json.measures) {
    currentMeasureLengths.set(Math.max(0, Math.floor(measure.index)), measure.length);
  }
  if (preservedMeasureLengths.size !== currentMeasureLengths.size) {
    return false;
  }
  for (const [measure, length] of preservedMeasureLengths) {
    if (currentMeasureLengths.get(measure) !== length) {
      return false;
    }
  }

  return true;
}

function areEventBmsonExtensionsEqual(left: BeMusicEvent['bmson'], right: BeMusicEvent['bmson']): boolean {
  return left?.l === right?.l && left?.c === right?.c;
}

function areBmsChartsEquivalent(left: BeMusicJson, right: BeMusicJson): boolean {
  return (
    areMetadataEqual(left.metadata, right.metadata) &&
    areResourcesEqual(left.resources, right.resources) &&
    areMeasuresEqual(left.measures, right.measures) &&
    areEventsEqual(left.events, right.events) &&
    areBmsExtensionsEqual(left.bms, right.bms) &&
    areBmsPreservationEqual(left.preservation.bms, right.preservation.bms)
  );
}

function areBmsonChartsEquivalent(left: BeMusicJson, right: BeMusicJson): boolean {
  return (
    areMetadataEqual(left.metadata, right.metadata) &&
    areResourcesEqual(left.resources, right.resources) &&
    areMeasuresEqual(left.measures, right.measures) &&
    areEventsEqual(left.events, right.events) &&
    areBmsonExtensionsEqual(left.bmson, right.bmson) &&
    areBmsonPreservationEqual(left.preservation.bmson, right.preservation.bmson)
  );
}

function areMetadataEqual(left: BeMusicJson['metadata'], right: BeMusicJson['metadata']): boolean {
  return (
    left.title === right.title &&
    left.subtitle === right.subtitle &&
    left.artist === right.artist &&
    left.genre === right.genre &&
    left.comment === right.comment &&
    left.stageFile === right.stageFile &&
    left.playLevel === right.playLevel &&
    left.rank === right.rank &&
    left.total === right.total &&
    left.difficulty === right.difficulty &&
    left.bpm === right.bpm &&
    areStringMapsEqual(left.extras, right.extras)
  );
}

function areResourcesEqual(left: BeMusicJson['resources'], right: BeMusicJson['resources']): boolean {
  return (
    areStringMapsEqual(left.wav, right.wav) &&
    areStringMapsEqual(left.bmp, right.bmp) &&
    areNumberMapsEqual(left.bpm, right.bpm) &&
    areNumberMapsEqual(left.stop, right.stop) &&
    areStringMapsEqual(left.text, right.text)
  );
}

function areMeasuresEqual(left: BeMusicJson['measures'], right: BeMusicJson['measures']): boolean {
  const sortedLeft = [...left].sort((a, b) => a.index - b.index);
  const sortedRight = [...right].sort((a, b) => a.index - b.index);
  if (sortedLeft.length !== sortedRight.length) {
    return false;
  }
  for (let index = 0; index < sortedLeft.length; index += 1) {
    if (
      sortedLeft[index]!.index !== sortedRight[index]!.index ||
      sortedLeft[index]!.length !== sortedRight[index]!.length
    ) {
      return false;
    }
  }
  return true;
}

function areEventsEqual(left: BeMusicEvent[], right: BeMusicEvent[]): boolean {
  const sortedLeft = sortEvents(left);
  const sortedRight = sortEvents(right);
  if (sortedLeft.length !== sortedRight.length) {
    return false;
  }
  for (let index = 0; index < sortedLeft.length; index += 1) {
    if (compareEvents(sortedLeft[index]!, sortedRight[index]!) !== 0) {
      return false;
    }
    if (!areEventBmsonExtensionsEqual(sortedLeft[index]!.bmson, sortedRight[index]!.bmson)) {
      return false;
    }
  }
  return true;
}

function areBmsExtensionsEqual(left: BeMusicJson['bms'], right: BeMusicJson['bms']): boolean {
  return (
    areControlFlowEntriesEqual(left.controlFlow, right.controlFlow) &&
    left.preview === right.preview &&
    left.lnType === right.lnType &&
    left.lnMode === right.lnMode &&
    areStringArraysEqual(left.lnObjs, right.lnObjs) &&
    left.volWav === right.volWav &&
    left.defExRank === right.defExRank &&
    areStringMapsEqual(left.exRank, right.exRank) &&
    areStringMapsEqual(left.argb, right.argb) &&
    left.player === right.player &&
    left.pathWav === right.pathWav &&
    left.baseBpm === right.baseBpm &&
    areStringArraysEqual(left.stp, right.stp) &&
    left.option === right.option &&
    areStringMapsEqual(left.changeOption, right.changeOption) &&
    left.wavCmd === right.wavCmd &&
    areStringArraysEqual(left.wavCmds, right.wavCmds) &&
    areStringMapsEqual(left.exWav, right.exWav) &&
    areStringMapsEqual(left.exBmp, right.exBmp) &&
    areStringMapsEqual(left.bga, right.bga) &&
    areNumberMapsEqual(left.scroll, right.scroll) &&
    areNumberMapsEqual(left.speed, right.speed) &&
    left.poorBga === right.poorBga &&
    areStringMapsEqual(left.swBga, right.swBga) &&
    left.videoFile === right.videoFile &&
    left.midiFile === right.midiFile &&
    left.materials === right.materials &&
    left.divideProp === right.divideProp &&
    left.charset === right.charset
  );
}

function areBmsonExtensionsEqual(left: BeMusicJson['bmson'], right: BeMusicJson['bmson']): boolean {
  return (
    left.version === right.version && areBmsonInfoEqual(left.info, right.info) && areBmsonBgaEqual(left.bga, right.bga)
  );
}

function areBmsPreservationEqual(
  left: BeMusicJson['preservation']['bms'],
  right: BeMusicJson['preservation']['bms'],
): boolean {
  return (
    areControlFlowEntriesEqual(left.sourceLines, right.sourceLines) &&
    areBmsObjectLinesEqual(left.objectLines, right.objectLines)
  );
}

function areBmsonPreservationEqual(
  left: BeMusicJson['preservation']['bmson'],
  right: BeMusicJson['preservation']['bmson'],
): boolean {
  return (
    areNumberArraysEqual(left.lines, right.lines) &&
    areBmsonBpmEventsEqual(left.bpmEvents, right.bpmEvents) &&
    areBmsonStopEventsEqual(left.stopEvents, right.stopEvents) &&
    areBmsonSoundChannelsEqual(left.soundChannels, right.soundChannels)
  );
}

function areControlFlowEntriesEqual(
  left: BeMusicJson['bms']['controlFlow'],
  right: BeMusicJson['bms']['controlFlow'],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const leftEntry = left[index]!;
    const rightEntry = right[index]!;
    if (leftEntry.kind !== rightEntry.kind) {
      return false;
    }
    if (leftEntry.kind === 'directive' && rightEntry.kind === 'directive') {
      if (leftEntry.command !== rightEntry.command || leftEntry.value !== rightEntry.value) {
        return false;
      }
      continue;
    }
    if (leftEntry.kind === 'header' && rightEntry.kind === 'header') {
      if (leftEntry.command !== rightEntry.command || leftEntry.value !== rightEntry.value) {
        return false;
      }
      continue;
    }
    if (leftEntry.kind !== 'object' || rightEntry.kind !== 'object') {
      return false;
    }
    if (!areBmsObjectLineEqual(leftEntry, rightEntry)) {
      return false;
    }
  }
  return true;
}

function areBmsObjectLinesEqual(left: BmsObjectLineEntry[], right: BmsObjectLineEntry[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (!areBmsObjectLineEqual(left[index]!, right[index]!)) {
      return false;
    }
  }
  return true;
}

function areBmsObjectLineEqual(left: BmsObjectLineEntry, right: BmsObjectLineEntry): boolean {
  return (
    left.measure === right.measure &&
    normalizeChannel(left.channel) === normalizeChannel(right.channel) &&
    left.measureLength === right.measureLength &&
    areEventsEqual(left.events, right.events)
  );
}

function areBmsonInfoEqual(left: BeMusicJson['bmson']['info'], right: BeMusicJson['bmson']['info']): boolean {
  return (
    left.title === right.title &&
    left.subtitle === right.subtitle &&
    left.artist === right.artist &&
    left.genre === right.genre &&
    areStringArraysEqual(left.subartists, right.subartists) &&
    left.chartName === right.chartName &&
    left.level === right.level &&
    left.initBpm === right.initBpm &&
    left.resolution === right.resolution &&
    left.modeHint === right.modeHint &&
    left.judgeRank === right.judgeRank &&
    left.total === right.total &&
    left.backImage === right.backImage &&
    left.eyecatchImage === right.eyecatchImage &&
    left.bannerImage === right.bannerImage &&
    left.previewMusic === right.previewMusic
  );
}

function areBmsonBgaEqual(left: BeMusicJson['bmson']['bga'], right: BeMusicJson['bmson']['bga']): boolean {
  return (
    areBmsonBgaHeadersEqual(left.header, right.header) &&
    areBmsonBgaEventsEqual(left.events, right.events) &&
    areBmsonBgaEventsEqual(left.layerEvents, right.layerEvents) &&
    areBmsonBgaEventsEqual(left.poorEvents, right.poorEvents)
  );
}

function areBmsonBgaHeadersEqual(
  left: BeMusicJson['bmson']['bga']['header'],
  right: BeMusicJson['bmson']['bga']['header'],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index]!.id !== right[index]!.id || left[index]!.name !== right[index]!.name) {
      return false;
    }
  }
  return true;
}

function areBmsonBgaEventsEqual(
  left: BeMusicJson['bmson']['bga']['events'],
  right: BeMusicJson['bmson']['bga']['events'],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index]!.y !== right[index]!.y || left[index]!.id !== right[index]!.id) {
      return false;
    }
  }
  return true;
}

function areBmsonBpmEventsEqual(left: BmsonBpmEventEntry[], right: BmsonBpmEventEntry[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index]!.y !== right[index]!.y || left[index]!.bpm !== right[index]!.bpm) {
      return false;
    }
  }
  return true;
}

function areBmsonStopEventsEqual(left: BmsonStopEventEntry[], right: BmsonStopEventEntry[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index]!.y !== right[index]!.y || left[index]!.duration !== right[index]!.duration) {
      return false;
    }
  }
  return true;
}

function areBmsonSoundChannelsEqual(left: BmsonSoundChannelEntry[], right: BmsonSoundChannelEntry[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index]!.name !== right[index]!.name || !areBmsonSoundNotesEqual(left[index]!.notes, right[index]!.notes)) {
      return false;
    }
  }
  return true;
}

function areBmsonSoundNotesEqual(
  left: BmsonSoundChannelEntry['notes'],
  right: BmsonSoundChannelEntry['notes'],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (
      left[index]!.x !== right[index]!.x ||
      left[index]!.y !== right[index]!.y ||
      left[index]!.l !== right[index]!.l ||
      left[index]!.c !== right[index]!.c
    ) {
      return false;
    }
  }
  return true;
}

function areStringMapsEqual(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  for (let index = 0; index < leftEntries.length; index += 1) {
    if (leftEntries[index]![0] !== rightEntries[index]![0] || leftEntries[index]![1] !== rightEntries[index]![1]) {
      return false;
    }
  }
  return true;
}

function areNumberMapsEqual(left: Record<string, number>, right: Record<string, number>): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  for (let index = 0; index < leftEntries.length; index += 1) {
    if (leftEntries[index]![0] !== rightEntries[index]![0] || leftEntries[index]![1] !== rightEntries[index]![1]) {
      return false;
    }
  }
  return true;
}

function areStringArraysEqual(left: string[] | undefined, right: string[] | undefined): boolean {
  const normalizedLeft = left ?? [];
  const normalizedRight = right ?? [];
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }
  for (let index = 0; index < normalizedLeft.length; index += 1) {
    if (normalizedLeft[index] !== normalizedRight[index]) {
      return false;
    }
  }
  return true;
}

function areNumberArraysEqual(left: number[], right: number[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
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

function pushControlFlowLines(lines: string[], json: BeMusicJson): void {
  const base = resolveJsonBase(json);
  for (const entry of json.bms.controlFlow) {
    if (entry.kind === 'directive') {
      lines.push(entry.value ? `#${entry.command} ${entry.value}` : `#${entry.command}`);
      continue;
    }
    if (entry.kind === 'header') {
      // Use the case-preserved `commandRaw` when present so e.g. `#WAV0a` survives the round-trip on a `#BASE 62`
      // chart.
      const commandText = entry.commandRaw ?? entry.command;
      lines.push(entry.value.length > 0 ? `#${commandText} ${entry.value}` : `#${commandText}`);
      continue;
    }
    if (typeof entry.measureLength === 'number' && entry.measureLength > 0) {
      lines.push(`#${toMeasure(entry.measure)}${normalizeChannel(entry.channel)}:${formatNumber(entry.measureLength)}`);
      continue;
    }
    const serialized = serializeControlFlowObjectEvents(entry.measure, entry.channel, entry.events, base);
    if (serialized) {
      lines.push(serialized);
    }
  }
}

function pushBmsSectionComment(lines: string[], section: string): void {
  if (lines.length > 0 && lines[lines.length - 1] !== '') {
    lines.push('');
  }
  lines.push(`*---------------------- ${section} FIELD`);
  lines.push('');
}

function serializeControlFlowObjectEvents(
  measure: number,
  channel: string,
  events: BeMusicEvent[],
  base: 36 | 62 = 36,
): string | undefined {
  return serializeBmsObjectLineEvents(measure, channel, events, base);
}

function serializeBmsObjectLineEvents(
  measure: number,
  channel: string,
  events: BeMusicEvent[],
  base: 36 | 62 = 36,
): string | undefined {
  const normalizedChannel = normalizeChannel(channel);
  const lineEvents: BeMusicEvent[] = [];
  for (const event of sortEvents(events)) {
    if (event.measure !== measure || normalizeChannel(event.channel) !== normalizedChannel) {
      continue;
    }
    const value = normalizeObjectKey(event.value, base);
    if (value === '00') {
      continue;
    }
    lineEvents.push({
      ...event,
      measure,
      channel: normalizedChannel,
      value,
    });
  }

  if (lineEvents.length === 0) {
    return undefined;
  }

  const resolution = chooseResolution(lineEvents);
  const cells = Array.from({ length: resolution }, () => '00');
  for (const event of lineEvents) {
    const { numerator, denominator } = resolveEventFraction(event);
    const scaled = Math.round((numerator * resolution) / denominator);
    const index = Math.min(resolution - 1, Math.max(0, scaled));
    cells[index] = normalizeObjectKey(event.value, base);
  }

  return `#${toMeasure(measure)}${normalizedChannel}:${cells.join('')}`;
}

interface GroupedEventLine {
  measure: number;
  channel: string;
  events: BeMusicEvent[];
}

function groupEvents(events: BeMusicEvent[], base: 36 | 62 = 36): GroupedEventLine[] {
  const groupedByMeasure = new Map<number, Map<string, BeMusicEvent[]>>();
  for (const event of events) {
    const measure = Math.max(0, Math.floor(event.measure));
    const channel = normalizeChannel(event.channel);
    const { numerator, denominator } = resolveEventFraction(event);
    const groupedByChannel = groupedByMeasure.get(measure) ?? new Map<string, BeMusicEvent[]>();
    if (!groupedByMeasure.has(measure)) {
      groupedByMeasure.set(measure, groupedByChannel);
    }
    const slot = groupedByChannel.get(channel) ?? [];
    slot.push({
      measure,
      channel,
      position: [numerator, denominator],
      value: normalizeObjectKey(event.value, base),
    });
    groupedByChannel.set(channel, slot);
  }

  const result: GroupedEventLine[] = [];
  for (const [measure, groupedByChannel] of groupedByMeasure) {
    for (const [channel, slot] of groupedByChannel) {
      result.push({
        measure,
        channel,
        events: slot,
      });
    }
  }
  return result;
}

function chooseResolution(events: BeMusicEvent[], maxResolution?: number): number {
  let resolution = 1;
  for (const event of events) {
    const { denominator } = resolveEventFraction(event);
    resolution = lcm(resolution, denominator);
    if (typeof maxResolution === 'number' && resolution >= maxResolution) {
      return maxResolution;
    }
  }
  return Math.max(1, resolution);
}

function resolveEventFraction(event: BeMusicEvent): { numerator: number; denominator: number } {
  const denominator = normalizePositiveInt(event.position[1], 1);
  const numerator = normalizeFractionNumerator(event.position[0], denominator, 0);
  return reduceFraction(numerator, denominator);
}

function reduceFraction(numerator: number, denominator: number): { numerator: number; denominator: number } {
  if (numerator <= 0) {
    return { numerator: 0, denominator: 1 };
  }
  const divisor = gcd(numerator, denominator);
  return {
    numerator: Math.floor(numerator / divisor),
    denominator: Math.floor(denominator / divisor),
  };
}

function toMeasure(measure: number): string {
  return normalizeNonNegativeInt(measure).toString(10).padStart(3, '0').slice(-3);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function isDedicatedBmsExtensionCommand(command: string): boolean {
  const upper = command.toUpperCase();
  if (
    upper === 'PREVIEW' ||
    upper === 'LNTYPE' ||
    upper === 'LNMODE' ||
    upper === 'LNOBJ' ||
    upper === 'VOLWAV' ||
    upper === 'DEFEXRANK' ||
    upper === 'PLAYER' ||
    upper === 'PATH_WAV' ||
    upper === 'BASEBPM' ||
    upper === 'STP' ||
    upper === 'OPTION' ||
    upper === 'WAVCMD' ||
    upper === 'POORBGA' ||
    upper === 'VIDEOFILE' ||
    upper === 'MIDIFILE' ||
    upper === 'MATERIALS' ||
    upper === 'DIVIDEPROP' ||
    upper === 'CHARSET'
  ) {
    return true;
  }
  if (/^EXRANK[0-9A-Z]{2}$/.test(upper) || /^ARGB[0-9A-Z]{2}$/.test(upper)) {
    return true;
  }
  if (
    /^CHANGEOPTION[0-9A-Z]{2}$/.test(upper) ||
    /^EXWAV[0-9A-Z]{2}$/.test(upper) ||
    /^EXBMP[0-9A-Z]{2}$/.test(upper) ||
    /^BGA[0-9A-Z]{2}$/.test(upper) ||
    /^SCROLL[0-9A-Z]{2}$/.test(upper) ||
    /^SPEED[0-9A-Z]{2}$/.test(upper) ||
    /^SWBGA[0-9A-Z]{2}$/.test(upper)
  ) {
    return true;
  }
  return false;
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
    return normalizeBmsonLines(json.preservation.bmson.lines);
  }
  return createDefaultBmsonLines(json, resolution);
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

/** The playable lane a landmine channel sits on (`D3` → `13`, `E5` → `25`), or `undefined` for anything else. */
/**
 * The `mode_hint` a bmson rendering of `json` declares: the chart's own hint when it has one, else the keyboard layout
 * for a 24 / 48 KEY chart (its wheel and extended lanes only have a home there), else `beat-<lanes>k`.
 */
function resolveBmsonModeHintForOutput(json: BeMusicJson, playableChannelCount: number): string {
  if (json.bmson.info.modeHint !== undefined) {
    return json.bmson.info.modeHint;
  }
  const variant = resolveChartPlayVariant({ events: json.events, bms: json.bms, bmson: json.bmson });
  if (variant === '24') return BMSON_KEYBOARD_24K_HINT;
  if (variant === '48') return BMSON_KEYBOARD_24K_DOUBLE_HINT;
  return `beat-${Math.max(1, playableChannelCount)}k`;
}

const BMSON_KEYBOARD_24K_HINT = 'keyboard-24k';
const BMSON_KEYBOARD_24K_DOUBLE_HINT = 'keyboard-24k-double';
/** Lane codes of a `<side><lane>` channel in a keyboard layout's `x` order: 24 keys, then the wheel up / down. */
const BMSON_KEYBOARD_LANE_CODES = '123456789ABCDEFGHIJKLMNOPQ';

/**
 * Lane channel → bmson `x`. The keyboard layouts give every lane its fixed `x` (x = side * 26 + lane, matching the
 * parser's map), so a sparse chart keeps its keys; lanes outside the layout follow after it. Other hints number the
 * lanes in use from 1.
 */
function createBmsonXMap(playableChannels: readonly string[], modeHint: string): Map<string, number> {
  const xMap = new Map<string, number>();
  const sides =
    modeHint.trim() === BMSON_KEYBOARD_24K_DOUBLE_HINT ? 2 : modeHint.trim() === BMSON_KEYBOARD_24K_HINT ? 1 : 0;
  const unmapped: string[] = [];
  for (const channel of playableChannels) {
    const side = channel.charCodeAt(0) - 0x30;
    const lane = BMSON_KEYBOARD_LANE_CODES.indexOf(channel.charAt(1).toUpperCase());
    if (channel.length === 2 && side >= 1 && side <= sides && lane >= 0) {
      xMap.set(channel, (side - 1) * BMSON_KEYBOARD_LANE_CODES.length + lane + 1);
    } else {
      unmapped.push(channel);
    }
  }
  const firstUnmappedX = sides * BMSON_KEYBOARD_LANE_CODES.length + 1;
  unmapped.forEach((channel, index) => xMap.set(channel, firstUnmappedX + index));
  return xMap;
}

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
const BMS_MINE_SAMPLE_KEY = '00';
/** Damage a mine deals when nothing gives it one — be-music's player default for BMS and bmson alike. */
const DEFAULT_MINE_DAMAGE = 4;
/** The largest damage a two-character base-36 mine value (`ZZ`) can carry. */
const MAX_BMS_MINE_DAMAGE = 36 * 36 - 1;
const BASE36_MINE_VALUE_PATTERN = /^[0-9A-Z]{2}$/;
const BMSON_LONG_NOTE_TYPES: ReadonlySet<number> = new Set([1, 2, 3]);

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

/**
 * Rewrites the parts of a chart that BMS spells differently before the canonical BMS output — a no-op for an ordinary
 * BMS chart. Mainly for a bmson-sourced chart:
 *
 * - A long note (`bmson.l > 0` on `1x` / `2x`) becomes a `#LNTYPE 1` pair on `5x` / `6x`: a start and an end object
 *   carrying the note's own WAV. Unlike `#LNOBJ`, this needs no shared end-object slot, keeps every long note on an
 *   explicit channel of its own, and pairs only with itself, so a short note just before an end can never be taken
 *   for its start. `#LNTYPE 1` is written when the chart has no `#LNTYPE`.
 * - `#LNMODE` comes from the long notes' type (`t`, else `info.ln_type`) when they all agree, else from `info.ln_type`;
 *   per-note types that disagree with it cannot be written in BMS and are lost.
 * - A mine's object value becomes its damage in base 36 (`bmson.damage`, or be-music's default 4 for a bmson mine
 *   without one), rounded to an integer and clamped to `01`..`ZZ` — `00` is no object at all, so a 0 damage mine
 *   becomes `01`. The first mine's sample becomes `#WAV00`, the BMS explosion sound, when the chart has none.
 * - bmson `judge_rank` shares `#DEFEXRANK`'s unit, so it is written as `#DEFEXRANK` (when positive) instead of an
 *   out-of-range `#RANK`.
 * - bmson `total` is a percentage of the player's default TOTAL, which depends on the note count and the player, so it
 *   is not written as an absolute `#TOTAL`; the BMS default applies, which equals bmson's default `100`.
 */
function convertChartForBmsOutput(json: BeMusicJson): BeMusicJson {
  const isBmsonSource = json.sourceFormat === 'bmson';
  const events: BeMusicEvent[] = [];
  const longNoteTypes: Array<number | undefined> = [];
  let mineSample: string | undefined;
  const chartLnType = json.bmson.info.lnType;
  const endPositionResolver = createBmsPositionResolver(json);
  let changed = false;

  for (const event of json.events) {
    const channel = normalizeChannel(event.channel);
    const length = event.bmson?.l;
    if (isPlayableChannel(channel) && typeof length === 'number' && Number.isFinite(length) && length > 0) {
      const longNoteChannel = `${channel[0] === '1' ? '5' : '6'}${channel[1]}`;
      events.push({ measure: event.measure, position: event.position, channel: longNoteChannel, value: event.value });
      events.push({ ...endPositionResolver(event, length), channel: longNoteChannel, value: event.value });
      const type = event.bmson?.t;
      longNoteTypes.push(typeof type === 'number' && BMSON_LONG_NOTE_TYPES.has(type) ? type : chartLnType);
      changed = true;
      continue;
    }
    if (isLandmineChannel(channel)) {
      const damage = event.bmson?.damage;
      const hasDamage = typeof damage === 'number' && Number.isFinite(damage) && damage >= 0;
      if (hasDamage || isBmsonSource) {
        mineSample ??= json.resources.wav[normalizeObjectKey(event.value, resolveBmsBase(json))];
        const value = Math.min(MAX_BMS_MINE_DAMAGE, Math.max(1, Math.round(hasDamage ? damage : DEFAULT_MINE_DAMAGE)));
        events.push({ measure: event.measure, position: event.position, channel, value: intToBase36(value, 2) });
        changed = true;
        continue;
      }
    }
    events.push(event);
  }

  if (!changed && !isBmsonSource) {
    return json;
  }

  const bms = { ...json.bms };
  if (longNoteTypes.length > 0 && bms.lnType === undefined) {
    bms.lnType = 1;
  }
  if (bms.lnMode === undefined) {
    const uniformType = longNoteTypes.length > 0 && longNoteTypes.every((type) => type === longNoteTypes[0]);
    const lnMode = uniformType ? longNoteTypes[0] : chartLnType;
    if (typeof lnMode === 'number' && BMSON_LONG_NOTE_TYPES.has(lnMode)) {
      bms.lnMode = lnMode;
    }
  }
  const metadata = { ...json.metadata };
  if (isBmsonSource) {
    const judgeRank = json.bmson.info.judgeRank ?? json.metadata.rank;
    if (bms.defExRank === undefined && typeof judgeRank === 'number' && Number.isFinite(judgeRank) && judgeRank > 0) {
      bms.defExRank = judgeRank;
    }
    delete metadata.rank;
    delete metadata.total;
  }
  const wav = { ...json.resources.wav };
  if (mineSample && !wav[BMS_MINE_SAMPLE_KEY]) {
    wav[BMS_MINE_SAMPLE_KEY] = mineSample;
  }

  return { ...json, metadata, bms, resources: { ...json.resources, wav }, events };
}

/**
 * Places the end of a bmson long note: `l` pulses (at the chart's bmson resolution) after `event`, as a measure and an
 * exact pulse fraction of that measure, so a long note crossing measures or uneven `lines` ends where it did.
 */
function createBmsPositionResolver(
  json: BeMusicJson,
): (event: BeMusicEvent, pulses: number) => Pick<BeMusicEvent, 'measure' | 'position'> {
  const beatResolver = createBeatResolver(json);
  const resolution = normalizePositiveInt(json.bmson.info.resolution ?? 240, 240);
  const measureStartPulse = (measure: number): number => Math.round(beatResolver.measureToBeat(measure) * resolution);
  return (event, pulses) => {
    const endPulse = Math.round(beatResolver.eventToBeat(event) * resolution) + Math.round(pulses);
    let measure = Math.max(0, Math.floor(event.measure));
    while (measureStartPulse(measure + 1) <= endPulse) {
      measure += 1;
    }
    const start = measureStartPulse(measure);
    const measurePulses = Math.max(1, measureStartPulse(measure + 1) - start);
    return { measure, position: [endPulse - start, measurePulses] };
  };
}
