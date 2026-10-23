import {
  type BMSControlFlowEntry,
  type BMSObjectLineEntry,
  type BMSSourceLineEntry,
  type BeMusicEvent,
  type BeMusicJSON,
  createEmptyJSON,
  normalizeChannel,
  normalizeObjectKey,
  resolveBMSBase,
} from '@be-music/chart-source';
import { buildBMSObjectLineEntry, sortAndNormalizeEvents } from './event-utils.ts';
import {
  normalizeBmsonBPMEvents,
  normalizeBmsonExtensions,
  normalizeBmsonLines,
  normalizeBmsonScrollEvents,
  normalizeBmsonSoundChannels,
  normalizeBmsonStopEvents,
} from './bmson.ts';
import { normalizeControlFlowCommand } from './control-flow.ts';

export function parseJSONDocument(raw: Partial<BeMusicJSON>): BeMusicJSON {
  const json = createEmptyJSON(raw.sourceFormat ?? 'json');
  const structured = raw as Record<string, unknown>;
  const rawBMS = structured.bms;
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
  // Accept the former IR spelling on input, but emit only the canonical key.
  const metadata = raw.metadata as Record<string, unknown> | undefined;
  const backBMP = metadata?.backBMP ?? metadata?.backBmp;
  delete (json.metadata as unknown as Record<string, unknown>).backBmp;
  if (typeof backBMP === 'string') {
    json.metadata.backBMP = backBMP;
  }
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
  // When re-parsing a previously-emitted BMS-JSON, honor the chart's recorded base so case-sensitive base-62 IDs don't
  // get folded back to uppercase. The full `bms` extension is normalized a few lines below; we only need the `base`
  // hint here.
  const rawBMSBase = (rawBMS as { base?: unknown } | undefined)?.base;
  const reparseBase: 36 | 62 = rawBMSBase === 62 ? 62 : 36;
  json.events = sortAndNormalizeEvents(
    rawEvents as Array<BeMusicEvent | Record<string, unknown>>,
    reparseBase,
    json.sourceFormat === 'bmson',
  );
  if (json.events.length !== rawEvents.length) {
    throw new Error('Invalid bms-json event: position [numerator, denominator] is required.');
  }
  json.bms = normalizeBMSExtensions(rawBMS);
  json.bmson = normalizeBmsonExtensions(rawBmson);
  json.preservation = normalizePreservation(structured.preservation, rawBMS, rawBmson);
  migrateBMSExtensionHeadersFromExtras(json);
  return json;
}

function migrateBMSExtensionHeadersFromExtras(json: BeMusicJSON): void {
  const migratedExtras: Record<string, string> = {};
  // Honor `#BASE 62` so any indexed-header keys that landed in `metadata.extras` (typically from a re-parsed JSON
  // whose upstream parser didn't recognize the directive) get preserved in their authored case rather than folded to
  // uppercase. The common base-36 case-insensitive path keeps its existing behavior because `idBase` is 36 by default.
  const idBase = resolveBMSBase(json);

  for (const [command, value] of Object.entries(json.metadata.extras ?? {})) {
    const upper = command.toUpperCase();
    if (upper === 'PREVIEW') {
      if (typeof json.bms.preview !== 'string' && value.length > 0) {
        json.bms.preview = value;
      }
      continue;
    }
    if (upper === 'LNTYPE') {
      const parsed = normalizeNumericBMSExtensionValue(value);
      if (typeof json.bms.lnType !== 'number' && typeof parsed === 'number' && parsed > 0) {
        json.bms.lnType = Math.floor(parsed);
      }
      continue;
    }
    if (upper === 'LNMODE') {
      const parsed = normalizeNumericBMSExtensionValue(value);
      if (typeof json.bms.lnMode !== 'number' && typeof parsed === 'number' && parsed > 0) {
        json.bms.lnMode = Math.floor(parsed);
      }
      continue;
    }
    if (upper === 'LNOBJ') {
      if (value.length > 0) {
        // The migration's `value` is the directive payload (e.g. `AA` for `#LNOBJ AA`), so the chart-base case-rule
        // applies just like for any other indexed key.
        const normalizedValue = normalizeObjectKey(value, idBase);
        json.bms.lnObjs = [...(json.bms.lnObjs ?? []), normalizedValue];
      }
      continue;
    }
    if (upper === 'VOLWAV') {
      const parsed = normalizeNumericBMSExtensionValue(value);
      if (typeof json.bms.volWAV !== 'number' && typeof parsed === 'number' && parsed >= 0) {
        json.bms.volWAV = parsed;
      }
      continue;
    }
    if (upper === 'DEFEXRANK') {
      const parsed = normalizeNumericBMSExtensionValue(value);
      if (typeof json.bms.defExRank !== 'number' && typeof parsed === 'number') {
        json.bms.defExRank = parsed;
      }
      continue;
    }
    if (upper === 'PLAYER') {
      const parsed = normalizeNumericBMSExtensionValue(value);
      if (typeof json.bms.player !== 'number' && typeof parsed === 'number' && parsed > 0) {
        json.bms.player = Math.floor(parsed);
      }
      continue;
    }
    if (upper === 'PATH_WAV') {
      if (typeof json.bms.pathWAV !== 'string' && value.length > 0) {
        json.bms.pathWAV = value;
      }
      continue;
    }
    if (upper === 'BASEBPM') {
      const parsed = normalizeNumericBMSExtensionValue(value);
      if (typeof json.bms.baseBPM !== 'number' && typeof parsed === 'number' && parsed > 0) {
        json.bms.baseBPM = parsed;
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
      if (value.length > 0) {
        // Mirror the strict-path collection so non-strict ingestion (chart roundtrips through `metadata.extras`) also
        // retains every line of `#WAVCMD pp xx vv`.
        if (!json.bms.wavCmds.includes(value)) {
          json.bms.wavCmds.push(value);
        }
        if (typeof json.bms.wavCmd !== 'string') {
          json.bms.wavCmd = value;
        }
      }
      continue;
    }
    if (upper === 'POORBGA') {
      if (typeof json.bms.poorBGA !== 'string' && value.length > 0) {
        json.bms.poorBGA = value;
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

    const exWAVMatch = upper.match(/^EXWAV([0-9A-Z]{2})$/);
    if (exWAVMatch) {
      const key = normalizeObjectKey(exWAVMatch[1]);
      if (!(key in json.bms.exWAV) && value.length > 0) {
        json.bms.exWAV[key] = value;
      }
      continue;
    }

    const exBMPMatch = upper.match(/^EXBMP([0-9A-Z]{2})$/);
    if (exBMPMatch) {
      const key = normalizeObjectKey(exBMPMatch[1]);
      if (!(key in json.bms.exBMP) && value.length > 0) {
        json.bms.exBMP[key] = value;
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
      const parsed = normalizeNumericBMSExtensionValue(value);
      if (!(key in json.bms.scroll) && typeof parsed === 'number') {
        json.bms.scroll[key] = parsed;
      }
      continue;
    }

    const speedMatch = upper.match(/^SPEED([0-9A-Z]{2})$/);
    if (speedMatch) {
      const key = normalizeObjectKey(speedMatch[1]);
      const parsed = normalizeNumericBMSExtensionValue(value);
      if (!(key in json.bms.speed) && typeof parsed === 'number') {
        json.bms.speed[key] = parsed;
      }
      continue;
    }

    const swBGAMatch = upper.match(/^SWBGA([0-9A-Z]{2})$/);
    if (swBGAMatch) {
      const key = normalizeObjectKey(swBGAMatch[1]);
      if (!(key in json.bms.swBGA) && value.length > 0) {
        json.bms.swBGA[key] = value;
      }
      continue;
    }

    migratedExtras[command] = value;
  }

  json.metadata.extras = migratedExtras;
}

function normalizeBMSExtensions(input: unknown): BeMusicJSON['bms'] {
  const normalized: BeMusicJSON['bms'] = {
    controlFlow: [],
    lnObjs: [],
    exRank: {},
    argb: {},
    stp: [],
    wavCmds: [],
    changeOption: {},
    exWAV: {},
    exBMP: {},
    bga: {},
    scroll: {},
    speed: {},
    swBGA: {},
  };
  if (!input || typeof input !== 'object') {
    return normalized;
  }

  const raw = input as Record<string, unknown>;
  // Honor `#BASE 62` on re-parsed JSON so the indexed maps below (`exRank`, `argb`, `wav`/`bmp`/…) preserve lowercase
  // keys instead of folding them through the default base-36 path.
  if (raw.base === 62) {
    normalized.base = 62;
  }
  const idBase: 36 | 62 = normalized.base === 62 ? 62 : 36;
  if (Array.isArray(raw.controlFlow)) {
    const entries: BMSControlFlowEntry[] = [];
    for (const item of raw.controlFlow) {
      const entry = normalizeBMSControlFlowEntry(item);
      if (entry) {
        entries.push(entry);
      }
    }
    normalized.controlFlow = entries;
  }

  if (typeof raw.preview === 'string' && raw.preview.length > 0) {
    normalized.preview = raw.preview;
  }

  const lnType = normalizeNumericBMSExtensionValue(raw.lnType);
  if (typeof lnType === 'number' && lnType > 0) {
    normalized.lnType = Math.floor(lnType);
  }

  const lnMode = normalizeNumericBMSExtensionValue(raw.lnMode ?? raw.lnmode ?? raw.ln_mode);
  if (typeof lnMode === 'number' && lnMode > 0) {
    normalized.lnMode = Math.floor(lnMode);
  }

  const lnObjs = normalizeBMSExtensionStringList(raw.lnObjs ?? raw.ln_objs);
  if (lnObjs.length > 0) {
    normalized.lnObjs = lnObjs.map((value) => normalizeObjectKey(value, idBase));
  }

  const volWAV = normalizeNumericBMSExtensionValue(raw.volWAV ?? raw.volWav ?? raw.volwav ?? raw.vol_wav);
  if (typeof volWAV === 'number' && volWAV >= 0) {
    normalized.volWAV = volWAV;
  }

  const defExRank = normalizeNumericBMSExtensionValue(raw.defExRank);
  if (typeof defExRank === 'number') {
    normalized.defExRank = defExRank;
  }

  normalized.exRank = normalizeIndexedBMSExtensionMap(raw.exRank, idBase);
  normalized.argb = normalizeIndexedBMSExtensionMap(raw.argb, idBase);

  const player = normalizeNumericBMSExtensionValue(raw.player);
  if (typeof player === 'number' && player > 0) {
    normalized.player = Math.floor(player);
  }

  const pathWAV = raw.pathWAV ?? raw.pathWav ?? raw.path_wav;
  if (typeof pathWAV === 'string' && pathWAV.length > 0) {
    normalized.pathWAV = pathWAV;
  }

  const baseBPM = normalizeNumericBMSExtensionValue(raw.baseBPM ?? raw.baseBpm ?? raw.base_bpm);
  if (typeof baseBPM === 'number' && baseBPM > 0) {
    normalized.baseBPM = baseBPM;
  }

  normalized.stp = normalizeBMSExtensionStringList(raw.stp);

  if (typeof raw.option === 'string' && raw.option.length > 0) {
    normalized.option = raw.option;
  }

  const wavCmd = raw.wavCmd ?? raw.wavcmd ?? raw.wav_cmd;
  if (typeof wavCmd === 'string' && wavCmd.length > 0) {
    normalized.wavCmd = wavCmd;
  }
  // Spec-faithful per-line list. Falls back to the legacy single string when only `wavCmd` was preserved (older
  // roundtripped JSON), so older fixtures keep round-tripping.
  normalized.wavCmds = normalizeBMSExtensionStringList(raw.wavCmds ?? raw.wav_cmds);
  if (normalized.wavCmds.length === 0 && typeof normalized.wavCmd === 'string') {
    normalized.wavCmds.push(normalized.wavCmd);
  }

  normalized.changeOption = normalizeIndexedBMSExtensionMap(
    raw.changeOption ?? raw.change_option ?? raw.changeoption,
    idBase,
  );
  normalized.exWAV = normalizeIndexedBMSExtensionMap(raw.exWAV ?? raw.exWav ?? raw.ex_wav ?? raw.exwav, idBase);
  normalized.exBMP = normalizeIndexedBMSExtensionMap(raw.exBMP ?? raw.exBmp ?? raw.ex_bmp ?? raw.exbmp, idBase);
  normalized.bga = normalizeIndexedBMSExtensionMap(raw.bga, idBase);
  normalized.scroll = normalizeIndexedBMSExtensionNumericMap(raw.scroll, idBase);
  normalized.speed = normalizeIndexedBMSExtensionNumericMap(raw.speed, idBase);
  normalized.swBGA = normalizeIndexedBMSExtensionMap(raw.swBGA ?? raw.swBga ?? raw.sw_bga ?? raw.swbga, idBase);

  const poorBGA = raw.poorBGA ?? raw.poorBga ?? raw.poor_bga;
  if (typeof poorBGA === 'string' && poorBGA.length > 0) {
    normalized.poorBGA = poorBGA;
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

function normalizePreservation(input: unknown, bmsInput: unknown, bmsonInput: unknown): BeMusicJSON['preservation'] {
  const normalized = createEmptyJSON('json').preservation;

  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : undefined;
  const rawBMS =
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

  const rawSourceLines = rawBMS?.sourceLines ?? rawBMS?.source_lines;
  if (Array.isArray(rawSourceLines)) {
    const entries: BMSSourceLineEntry[] = [];
    for (const item of rawSourceLines) {
      const entry = normalizeBMSControlFlowEntry(item);
      if (entry) {
        entries.push(entry);
      }
    }
    normalized.bms.sourceLines = entries;
  }

  const rawObjectLines = rawBMS?.objectLines ?? rawBMS?.object_lines;
  if (Array.isArray(rawObjectLines)) {
    const entries: BMSObjectLineEntry[] = [];
    for (const item of rawObjectLines) {
      const entry = normalizeBMSObjectLineEntry(item);
      if (entry) {
        entries.push(entry);
      }
    }
    normalized.bms.objectLines = entries;
  }

  normalized.bmson.lines = normalizeBmsonLines(rawBmson?.lines);
  normalized.bmson.bpmEvents = normalizeBmsonBPMEvents(rawBmson?.bpmEvents ?? rawBmson?.bpm_events);
  normalized.bmson.stopEvents = normalizeBmsonStopEvents(rawBmson?.stopEvents ?? rawBmson?.stop_events);
  const scrollEvents = normalizeBmsonScrollEvents(rawBmson?.scrollEvents ?? rawBmson?.scroll_events);
  if (scrollEvents.length > 0) {
    normalized.bmson.scrollEvents = scrollEvents;
  }
  normalized.bmson.soundChannels = normalizeBmsonSoundChannels(rawBmson?.soundChannels ?? rawBmson?.sound_channels);

  return normalized;
}

function normalizeNumericBMSExtensionValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeIndexedBMSExtensionMap(input: unknown, base: 36 | 62 = 36): Record<string, string> {
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

function normalizeIndexedBMSExtensionNumericMap(input: unknown, base: 36 | 62 = 36): Record<string, number> {
  if (!input || typeof input !== 'object') {
    return {};
  }

  const normalized: Record<string, number> = {};
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const parsed = normalizeNumericBMSExtensionValue(rawValue);
    if (typeof parsed === 'number') {
      normalized[normalizeObjectKey(rawKey, base)] = parsed;
    }
  }
  return normalized;
}

function normalizeBMSExtensionStringList(input: unknown): string[] {
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

function normalizeBMSControlFlowEntry(input: unknown): BMSControlFlowEntry | undefined {
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
    // Honor `commandRaw` when present and actually case-different — that's the base-62 marker. Otherwise drop it to
    // keep the round-tripped JSON minimal.
    const rawCommandValue = typeof raw.commandRaw === 'string' ? raw.commandRaw : undefined;
    const commandRaw = rawCommandValue && rawCommandValue !== command ? rawCommandValue : undefined;
    return {
      kind: 'header',
      command,
      value: typeof raw.value === 'string' ? raw.value : '',
      ...(commandRaw ? { commandRaw } : {}),
      ...(raw.overriddenByLaterHeader === true ? { overriddenByLaterHeader: true as const } : {}),
    };
  }
  if (kind === 'object') {
    const objectLine = normalizeBMSObjectLineEntry(raw);
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

function normalizeBMSObjectLineEntry(input: unknown): BMSObjectLineEntry | undefined {
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
    return buildBMSObjectLineEntry(measure, channel, fallbackData);
  }

  return {
    measure,
    channel,
    events: normalizedEvents,
    measureLength,
  };
}
