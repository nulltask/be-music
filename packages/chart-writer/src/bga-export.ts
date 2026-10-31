import { createBeatResolver, resolvePoorBGAMode } from '@be-music/chart-model';
import {
  intToBase36,
  normalizeChannel,
  normalizeObjectKey,
  resolveBMSBase,
  type BeMusicEvent,
  type BeMusicJSON,
} from '@be-music/chart-source';

/** Something a format conversion could not carry over; the output still loads, without that part. */
export interface ChartExportDiagnostic {
  code: 'bga-layer2' | 'bga-extended' | 'bga-layer-black-key' | 'bga-poor-mode' | 'bga-sequence';
  message: string;
}

export type ChartExportDiagnosticHandler = (diagnostic: ChartExportDiagnostic) => void;

interface BmsonBGAEventOutput {
  y: number;
  id: number;
}

/** Ordinary BMS BGA rewritten as native bmson header and event lists. */
export interface BmsBGAForBmson {
  header: Array<{ id: number; name: string }>;
  events: BmsonBGAEventOutput[];
  layerEvents: BmsonBGAEventOutput[];
  poorEvents: BmsonBGAEventOutput[];
}

const BMS_BASE_CHANNEL = '04';
const BMS_POOR_CHANNEL = '06';
const BMS_LAYER_CHANNEL = '07';
const BMS_LAYER2_CHANNEL = '0A';
/** Opacity (`0B`–`0E`), ARGB (`A1`–`A4`) and key-bound SWBGA (`A5`) controls. */
const BMS_EXTENDED_BGA_CHANNELS: ReadonlySet<string> = new Set(['0B', '0C', '0D', '0E', 'A1', 'A2', 'A3', 'A4', 'A5']);

/**
 * BMS image resources and `04` / `07` / `06` cues as bmson BGA, at `resolution` pulses per beat. Ids start after
 * `firstId - 1`, so they never collide with native bmson ids, and never use 0, which bmson reads as a clear. A cue to an
 * undefined image keeps an id without a header entry, which shows nothing as in BMS. `#BMP00` becomes the initial POOR
 * image, as Be-Music shows it until the first authored POOR cue. Parts native bmson cannot hold are reported.
 */
export function convertBmsBGAToBmson(
  json: BeMusicJSON,
  resolution: number,
  firstId: number,
  report: ChartExportDiagnosticHandler | undefined,
): BmsBGAForBmson | undefined {
  const base = resolveBMSBase(json);
  const cues = { base: [] as BeMusicEvent[], layer: [] as BeMusicEvent[], poor: [] as BeMusicEvent[] };
  let layer2Cues = 0;
  let extendedControls = 0;
  for (const event of json.events) {
    const channel = normalizeChannel(event.channel);
    if (channel === BMS_BASE_CHANNEL) cues.base.push(event);
    else if (channel === BMS_LAYER_CHANNEL) cues.layer.push(event);
    else if (channel === BMS_POOR_CHANNEL) cues.poor.push(event);
    else if (channel === BMS_LAYER2_CHANNEL) layer2Cues += 1;
    else if (BMS_EXTENDED_BGA_CHANNELS.has(channel)) extendedControls += 1;
  }
  const images = Object.entries(json.resources.bmp).filter(([, name]) => typeof name === 'string' && name.length > 0);
  const poorMode = resolvePoorBGAMode(json.bms.poorBGA);
  const fallbackPoor = poorMode !== 2 && images.some(([key]) => key === '00');
  if (cues.base.length + cues.layer.length + cues.poor.length === 0 && images.length === 0) return undefined;

  const ids = new Map<string, number>();
  let nextId = Math.max(1, firstId);
  const idOf = (key: string): number => {
    let id = ids.get(key);
    if (id === undefined) {
      id = nextId++;
      ids.set(key, id);
    }
    return id;
  };
  const header = images.map(([key, name]) => ({ id: idOf(key), name }));
  const beatResolver = createBeatResolver(json);
  const toEvents = (events: BeMusicEvent[]): BmsonBGAEventOutput[] =>
    events.map((event) => ({
      y: Math.max(0, Math.round(beatResolver.eventToBeat(event) * resolution)),
      id: idOf(normalizeObjectKey(event.value, base)),
    }));
  const poorEvents = poorMode === 2 ? [] : toEvents(cues.poor);
  if (fallbackPoor && !poorEvents.some((event) => event.y === 0)) poorEvents.unshift({ y: 0, id: idOf('00') });

  if (layer2Cues > 0)
    report?.({
      code: 'bga-layer2',
      message: `${layer2Cues} BMS layer2 (0A) cue(s) dropped: native bmson has a single layer plane.`,
    });
  const transformed = Object.keys(json.bms.bga).length + Object.keys(json.bms.exBMP).length;
  if (extendedControls > 0 || transformed > 0 || Object.keys(json.bms.swBGA).length > 0)
    report?.({
      code: 'bga-extended',
      message:
        'BMS BGA extensions (#BGAxx crops, #EXBMPxx keys, #ARGBxx / #SWBGAxx, channels 0B–0E / A1–A5) have no native bmson form and were not converted.',
    });
  if (cues.layer.length > 0)
    report?.({
      code: 'bga-layer-black-key',
      message: 'BMS layer black is transparent; a bmson layer draws black, so layer images may need an alpha channel.',
    });
  if (poorMode === 1 && poorEvents.length > 0)
    report?.({
      code: 'bga-poor-mode',
      message: '#POORBGA 1 overlays the POOR image; bmson replaces the BGA with it on a miss.',
    });
  return { header, events: toEvents(cues.base), layerEvents: toEvents(cues.layer), poorEvents };
}

/** Native bmson BGA rewritten as BMS image resources and `04` / `07` / `06` objects. */
export interface BmsonBGAForBMS {
  bmp: Record<string, string>;
  events: BeMusicEvent[];
}

/**
 * The ordinary bmson BGA of `json` as BMS: each header image gets the next unused two-character key, and each base,
 * layer and POOR event an object at its pulse. A clear (id 0) or an id without a header points at one undefined key,
 * which shows nothing, as in bmson. Sequences, `id_set`, conditions and intervals have no BMS form and are reported and
 * skipped.
 */
export function convertBmsonBGAToBMS(
  json: BeMusicJSON,
  report: ChartExportDiagnosticHandler | undefined,
): BmsonBGAForBMS | undefined {
  const bga = json.bmson.bga;
  if (bga.header.length === 0 && bga.events.length + bga.layerEvents.length + bga.poorEvents.length === 0) {
    return undefined;
  }
  const used = new Set([...Object.keys(json.resources.bmp), '00']);
  let next = 1;
  const allocate = (): string => {
    while (used.has(intToBase36(next, 2))) next += 1;
    if (next > 36 * 36 - 1)
      throw new RangeError('Cannot export bmson BGA: it needs more than 1,295 two-character BMS image ids.');
    const key = intToBase36(next, 2);
    used.add(key);
    return key;
  };
  const bmp: Record<string, string> = {};
  const keyById = new Map<number, string>();
  for (const entry of bga.header) {
    if (keyById.has(entry.id)) continue;
    const key = allocate();
    keyById.set(entry.id, key);
    bmp[key] = entry.name;
  }
  let blankKey: string | undefined;
  const keyFor = (id: number | undefined): string =>
    (id !== undefined && id !== 0 ? keyById.get(id) : undefined) ?? (blankKey ??= allocate());

  const sequenceIds = new Set((bga.sequences ?? []).map((entry) => entry.id));
  const resolution = bmsonResolution(json);
  const position = createPulsePositionResolver(json, resolution);
  const events: BeMusicEvent[] = [];
  let skipped = 0;
  const add = (entries: typeof bga.events, channel: string, allowExtended: boolean): void => {
    for (const entry of entries) {
      const extended =
        entry.idSet !== undefined ||
        entry.condition !== undefined ||
        entry.interval !== undefined ||
        sequenceIds.has(entry.id ?? 0);
      if (extended && !allowExtended) {
        skipped += 1;
        continue;
      }
      events.push({ ...position(entry.y), channel, value: keyFor(entry.id) });
    }
  };
  add(bga.events, BMS_BASE_CHANNEL, true);
  add(bga.layerEvents, BMS_LAYER_CHANNEL, false);
  add(bga.poorEvents, BMS_POOR_CHANNEL, false);
  if (skipped > 0 || (bga.sequences?.length ?? 0) > 0)
    report?.({
      code: 'bga-sequence',
      message: `bmson BGA sequences and conditional layer events have no BMS form; ${skipped} event(s) were skipped.`,
    });
  if (bga.layerEvents.length > 0)
    report?.({
      code: 'bga-layer-black-key',
      message: 'A bmson layer draws black; BMS treats layer black as transparent.',
    });
  return { bmp, events };
}

function bmsonResolution(json: BeMusicJSON): number {
  const resolution = json.bmson.info.resolution;
  return typeof resolution === 'number' && Number.isFinite(resolution) && resolution >= 1
    ? Math.floor(resolution)
    : 240;
}

/** A pulse at the chart's bmson resolution as a measure and an exact pulse fraction of that measure. */
function createPulsePositionResolver(
  json: BeMusicJSON,
  resolution: number,
): (pulse: number) => Pick<BeMusicEvent, 'measure' | 'position'> {
  const beatResolver = createBeatResolver(json);
  const measureStartPulse = (measure: number): number => Math.round(beatResolver.measureToBeat(measure) * resolution);
  return (pulse) => {
    const target = Math.max(0, Math.round(pulse));
    let measure = 0;
    while (measureStartPulse(measure + 1) <= target) measure += 1;
    const start = measureStartPulse(measure);
    return { measure, position: [target - start, Math.max(1, measureStartPulse(measure + 1) - start)] };
  };
}
