import {
  createBeatResolver,
  isSampleTriggerChannel,
  normalizeChannel,
  normalizeObjectKey,
  parseBpmFrom03Token,
  sortEvents,
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
  const lines: string[] = [];

  pushBmsSectionComment(lines, 'METADATA');
  pushMetadataLines(lines, json);
  pushBmsSectionComment(lines, 'EXTENDED HEADER');
  pushBmsExtensionLines(lines, json);
  pushBmsSectionComment(lines, 'RESOURCES');
  pushResourceLines(lines, json);
  pushBmsSectionComment(lines, 'MEASURE LENGTH');
  pushMeasureLines(lines, json);
  pushBmsSectionComment(lines, 'OBJECT DATA');
  pushEventLines(lines, json, maxResolution);
  pushBmsSectionComment(lines, 'CONTROL FLOW');
  pushControlFlowLines(lines, json);

  return lines.join(eol);
}

export function stringifyBmson(json: BeMusicJson, options: BmsonStringifyOptions = {}): string {
  const resolution = resolveBmsonResolutionForOutput(json, options);
  const indent = options.indent ?? 2;
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
  } else if (typeof json.bms.lnObj === 'string' && json.bms.lnObj.length > 0) {
    lines.push(`#LNOBJ ${normalizeObjectKey(json.bms.lnObj)}`);
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

function pushMeasureLines(lines: string[], json: BeMusicJson): void {
  const measures = [...json.measures]
    .filter((measure) => measure.length > 0 && Math.abs(measure.length - 1) > 1e-9)
    .sort((left, right) => left.index - right.index);

  for (const measure of measures) {
    lines.push(`#${toMeasure(measure.index)}02:${formatNumber(measure.length)}`);
  }
}

function pushEventLines(lines: string[], json: BeMusicJson, maxResolution?: number): void {
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

  const measures = [...groupedByMeasure.keys()].sort((left, right) => left - right);
  const result: GroupedEventLine[] = [];
  for (const measure of measures) {
    const groupedByChannel = groupedByMeasure.get(measure);
    if (!groupedByChannel) {
      continue;
    }
    const channels = [...groupedByChannel.keys()].sort();
    for (const channel of channels) {
      const slot = groupedByChannel.get(channel);
      if (!slot) {
        continue;
      }
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
