import { parseBms, parseBmson } from '@be-music/parser';
import {
  compareEvents,
  createBeatResolver,
  isSampleTriggerChannel,
  normalizeChannel,
  normalizeObjectKey,
  parseBpmFrom03Token,
  sortEvents,
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
} from '@be-music/utils';
export interface BmsStringifyOptions {
  eol?: '\n' | '\r\n';
  maxResolution?: number;
}

export interface BmsonStringifyOptions {
  resolution?: number;
  indent?: number;
}

export function stringifyBms(json: BeMusicJson, options: BmsStringifyOptions = {}): string {
  const eol = options.eol ?? '\n';
  const maxResolution = options.maxResolution;
  const preservedSourceLines = maxResolution === undefined ? resolvePreservedBmsSourceLinesForOutput(json) : undefined;
  if (preservedSourceLines) {
    return preservedSourceLines.join(eol);
  }
  const preservedObjectLines = maxResolution === undefined ? resolvePreservedObjectLinesForOutput(json) : undefined;
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
  const preservedDocument = options.resolution === undefined ? resolvePreservedBmsonDocumentForOutput(json, resolution) : undefined;
  if (preservedDocument) {
    return `${JSON.stringify(preservedDocument, null, indent)}\n`;
  }
  const sortedEvents = sortEvents(json.events);
  const beatResolver = createBeatResolver(json);

  const playableChannelSet = new Set<string>();
  for (const event of sortedEvents) {
    const channel = normalizeChannel(event.channel);
    if (channel === '01' || !isSampleTriggerChannel(channel)) {
      continue;
    }
    playableChannelSet.add(channel);
  }
  const playableChannels = [...playableChannelSet].sort();

  const xMap = new Map<string, number>();
  playableChannels.forEach((channel, index) => xMap.set(channel, index + 1));

  const soundChannels = new Map<
    string,
    { name: string; notes: Array<{ x: number; y: number; l: number; c: boolean }> }
  >();
  const bpmEvents: Array<{ y: number; bpm: number }> = [];
  const stopEvents: Array<{ y: number; duration: number }> = [];

  for (const event of sortedEvents) {
    const channel = normalizeChannel(event.channel);
    const isSampleChannel = isSampleTriggerChannel(channel);
    if (!isSampleChannel && channel !== '03' && channel !== '08' && channel !== '09') {
      continue;
    }

    const y = Math.round(beatResolver.eventToBeat(event) * resolution);
    if (isSampleChannel) {
      const key = normalizeObjectKey(event.value);
      const fileName = json.resources.wav[key] ?? key;
      const x = channel === '01' ? 0 : (xMap.get(channel) ?? 0);
      const length =
        typeof event.bmson?.l === 'number' && Number.isFinite(event.bmson.l) && event.bmson.l >= 0
          ? Math.floor(event.bmson.l)
          : 0;
      const continuation = event.bmson?.c === true;

      const slot = soundChannels.get(key) ?? { name: fileName, notes: [] };
      slot.notes.push({ x, y, l: length, c: continuation });
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
      const bpm = json.resources.bpm[normalizeObjectKey(event.value)];
      if (typeof bpm === 'number' && bpm > 0) {
        bpmEvents.push({ y, bpm });
      }
      continue;
    }
    if (channel === '09') {
      const duration = json.resources.stop[normalizeObjectKey(event.value)];
      if (typeof duration === 'number' && duration > 0) {
        stopEvents.push({ y, duration });
      }
    }
  }

  const bmson: Record<string, unknown> = {
    version: resolveBmsonVersionForOutput(json),
    info: createBmsonInfoForOutput(json, resolution, playableChannels.length),
    lines: mapBmsonLineValues(resolveBmsonLinesForOutput(json, resolution)),
    bpm_events: bpmEvents,
    stop_events: stopEvents,
    sound_channels: [...soundChannels.values()],
  };
  const bga = createBmsonBgaForOutput(json);
  if (bga) {
    bmson.bga = bga;
  }

  return `${JSON.stringify(bmson, null, indent)}\n`;
}

function resolvePreservedBmsSourceLinesForOutput(json: BeMusicJson): string[] | undefined {
  const sourceLines = json.bms.sourceLines;
  if (!Array.isArray(sourceLines) || sourceLines.length === 0) {
    return undefined;
  }

  const lines = renderPreservedBmsSourceLines(sourceLines);
  if (lines.length === 0) {
    return undefined;
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
      lines.push(entry.value.length > 0 ? `#${entry.command} ${entry.value}` : `#${entry.command}`);
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
): Record<string, unknown> | undefined {
  if (
    json.bmson.soundChannels.length === 0 &&
    json.bmson.bpmEvents.length === 0 &&
    json.bmson.stopEvents.length === 0
  ) {
    return undefined;
  }

  const document = createPreservedBmsonDocumentForOutput(json, resolution);
  return doPreservedBmsonDocumentMatchChart(json, document) ? document : undefined;
}

function createPreservedBmsonDocumentForOutput(json: BeMusicJson, resolution: number): Record<string, unknown> {
  const document: Record<string, unknown> = {
    info: createPreservedBmsonInfoForOutput(json, resolution),
  };
  if (typeof json.bmson.version === 'string' && json.bmson.version.length > 0) {
    document.version = json.bmson.version;
  }
  if (json.bmson.lines.length > 0) {
    document.lines = mapBmsonLineValues(json.bmson.lines);
  }
  if (json.bmson.bpmEvents.length > 0) {
    document.bpm_events = json.bmson.bpmEvents.map(mapBmsonBpmEventForOutput);
  }
  if (json.bmson.stopEvents.length > 0) {
    document.stop_events = json.bmson.stopEvents.map(mapBmsonStopEventForOutput);
  }
  if (json.bmson.soundChannels.length > 0) {
    document.sound_channels = json.bmson.soundChannels.map(mapBmsonSoundChannelForOutput);
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
  for (const [key, value] of Object.entries(json.bms.changeOption ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (value.length > 0) {
      lines.push(`#CHANGEOPTION${normalizeObjectKey(key)} ${value}`);
    }
  }

  if (typeof json.bms.wavCmd === 'string' && json.bms.wavCmd.length > 0) {
    lines.push(`#WAVCMD ${json.bms.wavCmd}`);
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
        lines.push(`#LNOBJ ${normalizeObjectKey(lnObj)}`);
      }
    }
  }
  if (typeof json.bms.volWav === 'number') {
    lines.push(`#VOLWAV ${formatNumber(json.bms.volWav)}`);
  }
  if (typeof json.bms.defExRank === 'number') {
    lines.push(`#DEFEXRANK ${formatNumber(json.bms.defExRank)}`);
  }

  for (const [key, value] of Object.entries(json.bms.exRank ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (value.length > 0) {
      lines.push(`#EXRANK${normalizeObjectKey(key)} ${value}`);
    }
  }
  for (const [key, value] of Object.entries(json.bms.argb ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
    if (value.length > 0) {
      lines.push(`#ARGB${normalizeObjectKey(key)} ${value}`);
    }
  }

  for (const [key, value] of Object.entries(json.bms.exWav ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (value.length > 0) {
      lines.push(`#EXWAV${normalizeObjectKey(key)} ${value}`);
    }
  }
  for (const [key, value] of Object.entries(json.bms.exBmp ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (value.length > 0) {
      lines.push(`#EXBMP${normalizeObjectKey(key)} ${value}`);
    }
  }
  for (const [key, value] of Object.entries(json.bms.bga ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
    if (value.length > 0) {
      lines.push(`#BGA${normalizeObjectKey(key)} ${value}`);
    }
  }
  for (const [key, value] of Object.entries(json.bms.scroll ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (Number.isFinite(value)) {
      lines.push(`#SCROLL${normalizeObjectKey(key)} ${formatNumber(value)}`);
    }
  }
  if (typeof json.bms.poorBga === 'string' && json.bms.poorBga.length > 0) {
    lines.push(`#POORBGA ${json.bms.poorBga}`);
  }
  for (const [key, value] of Object.entries(json.bms.swBga ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (value.length > 0) {
      lines.push(`#SWBGA${normalizeObjectKey(key)} ${value}`);
    }
  }

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
  pushObjectResourceLines(lines, 'WAV', json.resources.wav);
  pushObjectResourceLines(lines, 'BMP', json.resources.bmp);

  const bpmEntries = Object.entries(json.resources.bpm).sort(([left], [right]) => left.localeCompare(right));
  for (const [key, value] of bpmEntries) {
    lines.push(`#BPM${normalizeObjectKey(key)} ${formatNumber(value)}`);
  }

  const stopEntries = Object.entries(json.resources.stop).sort(([left], [right]) => left.localeCompare(right));
  for (const [key, value] of stopEntries) {
    lines.push(`#STOP${normalizeObjectKey(key)} ${formatNumber(value)}`);
  }

  pushObjectResourceLines(lines, 'TEXT', json.resources.text);
}

function pushObjectResourceLines(lines: string[], command: string, values: Record<string, string>): void {
  const entries = Object.entries(values).sort(([left], [right]) => left.localeCompare(right));
  for (const [key, value] of entries) {
    lines.push(`#${command}${normalizeObjectKey(key)} ${value}`);
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
      const serialized = serializeBmsObjectLineEvents(objectLine.measure, objectLine.channel, objectLine.events);
      if (serialized) {
        lines.push(serialized);
      }
    }
    return;
  }

  const grouped = groupEvents(sortEvents(json.events));
  for (const group of grouped) {
    const { measure, channel, events } = group;
    const resolution = chooseResolution(events, maxResolution);
    const cells = Array.from({ length: resolution }, () => '00');

    for (const event of events) {
      const { numerator, denominator } = resolveEventFraction(event);
      const scaled = Math.round((numerator * resolution) / denominator);
      const index = Math.min(resolution - 1, Math.max(0, scaled));
      cells[index] = normalizeObjectKey(event.value);
    }

    lines.push(`#${toMeasure(measure)}${channel}:${cells.join('')}`);
  }
}

function resolvePreservedObjectLinesForOutput(json: BeMusicJson): BmsObjectLineEntry[] | undefined {
  const objectLines = json.bms.objectLines;
  if (!Array.isArray(objectLines) || objectLines.length === 0) {
    return undefined;
  }
  return doPreservedObjectLinesMatchChart(json, objectLines) ? objectLines : undefined;
}

function doPreservedObjectLinesMatchChart(json: BeMusicJson, objectLines: BmsObjectLineEntry[]): boolean {
  const flattenedEvents: BeMusicEvent[] = [];
  const preservedMeasureLengths = new Map<number, number>();

  for (const objectLine of objectLines) {
    if (typeof objectLine.measureLength === 'number' && objectLine.measureLength > 0) {
      preservedMeasureLengths.set(Math.max(0, Math.floor(objectLine.measure)), objectLine.measureLength);
    }
    for (const event of objectLine.events) {
      if (normalizeObjectKey(event.value) === '00') {
        continue;
      }
      flattenedEvents.push({
        measure: Math.max(0, Math.floor(objectLine.measure)),
        channel: normalizeChannel(objectLine.channel),
        position: event.position,
        value: normalizeObjectKey(event.value),
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
    areBmsExtensionsEqual(left.bms, right.bms)
  );
}

function areBmsonChartsEquivalent(left: BeMusicJson, right: BeMusicJson): boolean {
  return (
    areMetadataEqual(left.metadata, right.metadata) &&
    areResourcesEqual(left.resources, right.resources) &&
    areMeasuresEqual(left.measures, right.measures) &&
    areEventsEqual(left.events, right.events) &&
    areBmsonExtensionsEqual(left.bmson, right.bmson)
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
    if (sortedLeft[index]!.index !== sortedRight[index]!.index || sortedLeft[index]!.length !== sortedRight[index]!.length) {
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
    areBmsObjectLinesEqual(left.objectLines, right.objectLines) &&
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
    areStringMapsEqual(left.exWav, right.exWav) &&
    areStringMapsEqual(left.exBmp, right.exBmp) &&
    areStringMapsEqual(left.bga, right.bga) &&
    areNumberMapsEqual(left.scroll, right.scroll) &&
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
    left.version === right.version &&
    areNumberArraysEqual(left.lines, right.lines) &&
    areBmsonInfoEqual(left.info, right.info) &&
    areBmsonBgaEqual(left.bga, right.bga) &&
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
    if (
      leftEntries[index]![0] !== rightEntries[index]![0] ||
      leftEntries[index]![1] !== rightEntries[index]![1]
    ) {
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
    if (
      leftEntries[index]![0] !== rightEntries[index]![0] ||
      leftEntries[index]![1] !== rightEntries[index]![1]
    ) {
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
  for (const entry of json.bms.controlFlow) {
    if (entry.kind === 'directive') {
      lines.push(entry.value ? `#${entry.command} ${entry.value}` : `#${entry.command}`);
      continue;
    }
    if (entry.kind === 'header') {
      lines.push(entry.value.length > 0 ? `#${entry.command} ${entry.value}` : `#${entry.command}`);
      continue;
    }
    if (typeof entry.measureLength === 'number' && entry.measureLength > 0) {
      lines.push(`#${toMeasure(entry.measure)}${normalizeChannel(entry.channel)}:${formatNumber(entry.measureLength)}`);
      continue;
    }
    const serialized = serializeControlFlowObjectEvents(entry.measure, entry.channel, entry.events);
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

function serializeControlFlowObjectEvents(measure: number, channel: string, events: BeMusicEvent[]): string | undefined {
  return serializeBmsObjectLineEvents(measure, channel, events);
}

function serializeBmsObjectLineEvents(measure: number, channel: string, events: BeMusicEvent[]): string | undefined {
  const normalizedChannel = normalizeChannel(channel);
  const lineEvents: BeMusicEvent[] = [];
  for (const event of sortEvents(events)) {
    if (event.measure !== measure || normalizeChannel(event.channel) !== normalizedChannel) {
      continue;
    }
    const value = normalizeObjectKey(event.value);
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
    cells[index] = normalizeObjectKey(event.value);
  }

  return `#${toMeasure(measure)}${normalizedChannel}:${cells.join('')}`;
}

interface GroupedEventLine {
  measure: number;
  channel: string;
  events: BeMusicEvent[];
}

function groupEvents(events: BeMusicEvent[]): GroupedEventLine[] {
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
      value: normalizeObjectKey(event.value),
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

function createBmsonInfoForOutput(
  json: BeMusicJson,
  resolution: number,
  playableChannelCount: number,
): Record<string, unknown> {
  const info = json.bmson.info;
  const output: Record<string, unknown> = {
    title: info.title ?? json.metadata.title ?? '',
    subtitle: info.subtitle ?? json.metadata.subtitle ?? '',
    artist: info.artist ?? json.metadata.artist ?? '',
    genre: info.genre ?? json.metadata.genre ?? '',
    level: typeof info.level === 'number' ? info.level : (json.metadata.playLevel ?? 0),
    init_bpm: typeof info.initBpm === 'number' ? info.initBpm : json.metadata.bpm,
    mode_hint: info.modeHint ?? `beat-${Math.max(1, playableChannelCount)}k`,
    resolution,
  };

  const subartists = normalizeBmsonSubartistsForOutput(info.subartists);
  if (subartists !== undefined) {
    output.subartists = subartists;
  }
  if (typeof info.chartName === 'string') {
    output.chart_name = info.chartName;
  }

  const judgeRank = typeof info.judgeRank === 'number' ? info.judgeRank : json.metadata.rank;
  if (typeof judgeRank === 'number' && Number.isFinite(judgeRank)) {
    output.judge_rank = judgeRank;
  }
  const total = typeof info.total === 'number' ? info.total : json.metadata.total;
  if (typeof total === 'number' && Number.isFinite(total)) {
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
  if (json.bmson.lines.length > 0) {
    return normalizeBmsonLines(json.bmson.lines);
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

function normalizeBmsonBgaEventEntries(entries: ReadonlyArray<{ y: number; id: number }>): Array<{ y: number; id: number }> {
  const normalized: Array<{ y: number; id: number }> = [];
  for (const entry of entries) {
    normalized.push({
      y: Math.max(0, Math.floor(entry.y)),
      id: Math.max(0, Math.floor(entry.id)),
    });
  }
  return normalized;
}
