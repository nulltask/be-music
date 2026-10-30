import {
  compareEvents,
  resolveGenericBmsonKeyCount,
  createBeatResolver,
  isLandmineChannel,
  isPlayableChannel,
  sortEvents,
} from '@be-music/chart-model';
import { parseBMS } from '@be-music/chart-parser';
import {
  intToBase36,
  normalizeChannel,
  normalizeObjectKey,
  resolveBMSBase,
  type BMSObjectLineEntry,
  type BMSSourceLineEntry,
  type BeMusicEvent,
  type BeMusicJSON,
} from '@be-music/chart-source';
import {
  gcd,
  lcm,
  normalizeFractionNumerator,
  normalizeNonNegativeInt,
  normalizePositiveInt,
} from '@be-music/shared-utils/core';
import { BMS_MINE_SAMPLE_KEY, BMSON_LONG_NOTE_TYPES } from './bmson.ts';
import { areBMSChartsEquivalent, areEventBmsonExtensionsEqual } from './equivalence.ts';
import type { BMSStringifyOptions } from './options.ts';
import { applyIntrinsicWAVGainForBMS } from './wav-gain.ts';

export function stringifyBMS(json: BeMusicJSON, options: BMSStringifyOptions = {}): string {
  json = applyIntrinsicWAVGainForBMS(json);
  if (resolveGenericBmsonKeyCount(json.bmson.info.modeHint) !== undefined)
    throw new RangeError('Generic bmson layouts cannot be represented by BMS; export bmson or Be-Music JSON.');
  assertBmsonKeysFitBMS(json);
  const eol = options.eol ?? '\n';
  const maxResolution = options.maxResolution;
  const skipValidation = options.skipPreservationValidation === true;
  const preservedSourceLines =
    maxResolution === undefined ? resolvePreservedBMSSourceLinesForOutput(json, skipValidation) : undefined;
  if (preservedSourceLines) {
    return preservedSourceLines.join(eol);
  }
  const preservedObjectLines =
    maxResolution === undefined ? resolvePreservedObjectLinesForOutput(json, skipValidation) : undefined;
  if (!preservedObjectLines) {
    json = convertChartForBMSOutput(json);
  }
  const lines: string[] = [];

  pushBMSSectionComment(lines, 'METADATA');
  pushMetadataLines(lines, json);
  pushBMSSectionComment(lines, 'EXTENDED HEADER');
  pushBMSExtensionLines(lines, json);
  pushBMSSectionComment(lines, 'RESOURCES');
  pushResourceLines(lines, json);
  pushBMSSectionComment(lines, 'MEASURE LENGTH');
  pushMeasureLines(lines, json, preservedObjectLines);
  pushBMSSectionComment(lines, 'OBJECT DATA');
  pushEventLines(lines, json, maxResolution, preservedObjectLines);
  pushBMSSectionComment(lines, 'CONTROL FLOW');
  pushControlFlowLines(lines, json);

  return lines.join(eol);
}

/** BMS object IDs are exactly two characters; truncating bmson keys would alias unrelated resources. */
function assertBmsonKeysFitBMS(json: BeMusicJSON): void {
  if (json.sourceFormat !== 'bmson') {
    return;
  }
  const fail = (key: string): never => {
    throw new RangeError(
      `Cannot export bmson resource key "${key}" to two-character BMS IDs. Keep bmson or Be-Music JSON, or reduce and remap resources before exporting BMS.`,
    );
  };
  for (const table of [
    json.resources.wav,
    json.resources.bmp,
    json.resources.bpm,
    json.resources.stop,
    json.resources.text,
    json.bms.exRank,
    json.bms.argb,
    json.bms.changeOption,
    json.bms.exWAV,
    json.bms.exBMP,
    json.bms.bga,
    json.bms.scroll,
    json.bms.speed,
    json.bms.swBGA,
  ]) {
    for (const key of Object.keys(table)) {
      if (key.length > 2) {
        fail(key);
      }
    }
  }
  for (const event of json.events) {
    if (event.value.length > 2) {
      fail(event.value);
    }
  }
}

function resolvePreservedBMSSourceLinesForOutput(json: BeMusicJSON, skipValidation: boolean): string[] | undefined {
  const sourceLines = json.preservation.bms.sourceLines;
  if (!Array.isArray(sourceLines) || sourceLines.length === 0) {
    return undefined;
  }

  const lines = renderPreservedBMSSourceLines(sourceLines);
  if (lines.length === 0) {
    return undefined;
  }
  // `skipValidation` halves stringify time on large charts (the re-parse below dominates), but trusts the caller to
  // have left the JSON untouched between parse and stringify. See `BMSStringifyOptions.skipPreservationValidation`.
  if (skipValidation) {
    return lines;
  }
  return doPreservedBMSSourceLinesMatchChart(json, lines) ? lines : undefined;
}

function renderPreservedBMSSourceLines(sourceLines: BMSSourceLineEntry[]): string[] {
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
    const serialized = serializeBMSObjectLineEvents(entry.measure, entry.channel, entry.events);
    if (serialized) {
      lines.push(serialized);
    }
  }
  return lines;
}

function doPreservedBMSSourceLinesMatchChart(json: BeMusicJSON, lines: string[]): boolean {
  const reparsed = parseBMS(lines.join('\n'));
  return areBMSChartsEquivalent(json, reparsed);
}

function pushMetadataLines(lines: string[], json: BeMusicJSON): void {
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
    .filter(([command]) => !isDedicatedBMSExtensionCommand(command))
    .sort(([left], [right]) => left.localeCompare(right));
  for (const [command, value] of extras) {
    lines.push(`#${command} ${value}`);
  }
}

function pushBMSExtensionLines(lines: string[], json: BeMusicJSON): void {
  const base = resolveJSONBase(json);
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
  if (typeof json.bms.pathWAV === 'string' && json.bms.pathWAV.length > 0) {
    lines.push(`#PATH_WAV ${json.bms.pathWAV}`);
  }
  if (typeof json.bms.baseBPM === 'number') {
    lines.push(`#BASEBPM ${formatNumber(json.bms.baseBPM)}`);
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
  if (typeof json.bms.volWAV === 'number') {
    lines.push(`#VOLWAV ${formatNumber(json.bms.volWAV)}`);
  }
  if (typeof json.bms.defExRank === 'number') {
    lines.push(`#DEFEXRANK ${formatNumber(json.bms.defExRank)}`);
  }

  pushIndexedStringLines(lines, 'EXRANK', json.bms.exRank, base);
  pushIndexedStringLines(lines, 'ARGB', json.bms.argb, base);
  pushIndexedStringLines(lines, 'EXWAV', json.bms.exWAV, base);
  pushIndexedStringLines(lines, 'EXBMP', json.bms.exBMP, base);
  pushIndexedStringLines(lines, 'BGA', json.bms.bga, base);
  pushIndexedNumberLines(lines, 'SCROLL', json.bms.scroll, base);
  pushIndexedNumberLines(lines, 'SPEED', json.bms.speed, base);
  if (typeof json.bms.poorBGA === 'string' && json.bms.poorBGA.length > 0) {
    lines.push(`#POORBGA ${json.bms.poorBGA}`);
  }
  pushIndexedStringLines(lines, 'SWBGA', json.bms.swBGA, base);

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

function pushResourceLines(lines: string[], json: BeMusicJSON): void {
  const base = resolveJSONBase(json);
  pushIndexedStringLines(lines, 'WAV', json.resources.wav, base);
  pushIndexedStringLines(lines, 'BMP', json.resources.bmp, base);
  pushIndexedNumberLines(lines, 'BPM', json.resources.bpm, base);
  pushIndexedNumberLines(lines, 'STOP', json.resources.stop, base);
  pushIndexedStringLines(lines, 'TEXT', json.resources.text, base);
}

function resolveJSONBase(json: BeMusicJSON): 36 | 62 {
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

function pushMeasureLines(lines: string[], json: BeMusicJSON, preservedObjectLines?: BMSObjectLineEntry[]): void {
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
  json: BeMusicJSON,
  maxResolution?: number,
  preservedObjectLines?: BMSObjectLineEntry[],
): void {
  if (preservedObjectLines) {
    for (const objectLine of preservedObjectLines) {
      const serialized = serializeBMSObjectLineEvents(
        objectLine.measure,
        objectLine.channel,
        objectLine.events,
        resolveJSONBase(json),
      );
      if (serialized) {
        lines.push(serialized);
      }
    }
    return;
  }

  const base = resolveJSONBase(json);
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
  json: BeMusicJSON,
  skipValidation: boolean,
): BMSObjectLineEntry[] | undefined {
  const objectLines = json.preservation.bms.objectLines;
  if (!Array.isArray(objectLines) || objectLines.length === 0) {
    return undefined;
  }
  if (skipValidation) {
    return objectLines;
  }
  return doPreservedObjectLinesMatchChart(json, objectLines) ? objectLines : undefined;
}

function doPreservedObjectLinesMatchChart(json: BeMusicJSON, objectLines: BMSObjectLineEntry[]): boolean {
  const flattenedEvents: BeMusicEvent[] = [];
  const preservedMeasureLengths = new Map<number, number>();
  // Compare values under the chart's authored radix so a base-62 chart's lowercase IDs aren't folded to uppercase
  // before the event comparison below — that would falsely trigger a mismatch and force the stringifier to regenerate
  // object lines even when the preserved entries are still consistent.
  const idBase = resolveBMSBase(json);

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

function pushControlFlowLines(lines: string[], json: BeMusicJSON): void {
  const base = resolveJSONBase(json);
  for (const entry of json.bms.controlFlow) {
    if (entry.kind === 'directive') {
      lines.push(entry.value ? `#${entry.command} ${entry.value}` : `#${entry.command}`);
      continue;
    }
    if (entry.kind === 'header') {
      // This layout writes the top-level headers first, so a branch line that a later top-level line overrides would
      // win again on re-parse. It never takes effect, so it is left out.
      if (entry.overriddenByLaterHeader === true) {
        continue;
      }
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

function pushBMSSectionComment(lines: string[], section: string): void {
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
  return serializeBMSObjectLineEvents(measure, channel, events, base);
}

function serializeBMSObjectLineEvents(
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

function isDedicatedBMSExtensionCommand(command: string): boolean {
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

/** Damage a mine deals when nothing gives it one — be-music's player default for BMS and bmson alike. */
const DEFAULT_MINE_DAMAGE = 4;
/** The largest damage a two-character base-36 mine value (`ZZ`) can carry. */
const MAX_BMS_MINE_DAMAGE = 36 * 36 - 1;

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
function convertChartForBMSOutput(json: BeMusicJSON): BeMusicJSON {
  const isBmsonSource = json.sourceFormat === 'bmson';
  const events: BeMusicEvent[] = [];
  const longNoteTypes: Array<number | undefined> = [];
  let mineSample: string | undefined;
  const chartLNType = json.bmson.info.lnType;
  const endPositionResolver = createBMSPositionResolver(json);
  let changed = false;

  for (const event of json.events) {
    const channel = normalizeChannel(event.channel);
    if (isBmsonSource && event.bmson?.up === true && isPlayableChannel(channel)) {
      changed = true;
      continue;
    }
    const length = event.bmson?.l;
    if (isPlayableChannel(channel) && typeof length === 'number' && Number.isFinite(length) && length > 0) {
      const longNoteChannel = `${channel[0] === '1' ? '5' : '6'}${channel[1]}`;
      events.push({ measure: event.measure, position: event.position, channel: longNoteChannel, value: event.value });
      events.push({ ...endPositionResolver(event, length), channel: longNoteChannel, value: event.value });
      const type = event.bmson?.t;
      longNoteTypes.push(typeof type === 'number' && BMSON_LONG_NOTE_TYPES.has(type) ? type : chartLNType);
      changed = true;
      continue;
    }
    if (isLandmineChannel(channel)) {
      const damage = event.bmson?.damage;
      const hasDamage = typeof damage === 'number' && Number.isFinite(damage) && damage >= 0;
      if (hasDamage || isBmsonSource) {
        mineSample ??= json.resources.wav[normalizeObjectKey(event.value, resolveBMSBase(json))];
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
    const lnMode = uniformType ? longNoteTypes[0] : chartLNType;
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
function createBMSPositionResolver(
  json: BeMusicJSON,
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
