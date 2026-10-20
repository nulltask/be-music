import { resolveChart, type ResolvedChart } from '@be-music/chart-model';
import {
  createEmptyJSON,
  normalizeChannel,
  normalizeObjectKey,
  type BeMusicEvent,
  type BeMusicJSON,
} from '@be-music/chart-source';
import type { NonstopConnection } from '../definition.ts';
import { NonstopKeyAllocator } from './ids.ts';
import {
  planNonstopCourse,
  resolveNonstopLastMeasure,
  type NonstopPlanOptions,
  type NonstopStagePlacement,
} from './plan.ts';
import {
  resolveNonstopStageRanks,
  resolveNonstopTempo,
  type NonstopStageRank,
  type NonstopTempoPoint,
} from './readouts.ts';
import { createNonstopStageTiming } from './stage.ts';

/** One stage to stitch: its BMS chart with control flow resolved, and whether it is a `.pms` chart. */
export interface NonstopStageInput {
  chart: BeMusicJSON;
  pms?: boolean;
}

/**
 * The version of the stitching rules {@link stitchNonstopCourse} follows. A NONSTOP replay records it
 * (`ReplayNonstopRun.stitch`), so a stitched chart is rebuilt by the rules it was played on. Raise it whenever a change
 * moves a stitched note, sound, rank or timing, and keep the earlier rules reachable through `options.stitch`.
 */
export const NONSTOP_STITCH_VERSION = 1;

/** The stitching rule versions {@link stitchNonstopCourse} can follow. */
export const NONSTOP_STITCH_VERSIONS: readonly number[] = [1];

export interface StitchNonstopOptions extends NonstopPlanOptions {
  /** The stitching rules to follow ({@link NONSTOP_STITCH_VERSION} by default); one it does not know is refused. */
  stitch?: number;
  /** The connection after each stage but the last (`CourseDefinition.connections`); missing ones read as `fade`. */
  connections: readonly NonstopConnection[];
  /** The stitched chart's title, e.g. the course name. */
  title?: string;
  /**
   * The path a stitched resource is loaded from: a stage's WAV / BMP path as its chart names it. Hosts put each
   * stage's files under their own prefix (stage charts can come from different folders); defaults to the path itself.
   */
  assetPath?: (stage: number, kind: 'wav' | 'bmp', path: string) => string;
}

/** A sound or BGA fade, in stitched seconds: the level ramps from one end to the other over `[start, end]`. */
export interface NonstopFade {
  start: number;
  end: number;
}

/** What the host needs about one stage of a stitched chart. */
export interface NonstopStitchStage {
  placement: NonstopStagePlacement;
  /** The stitched seconds the stage owns: its notes, bar lines and STOPs fall in `[windowStart, windowEnd)`. */
  windowStart: number;
  windowEnd: number;
  /**
   * The stitched WAV / BMP keys that belong to this stage (those without a file included), for its sound bus and BGA
   * layer, and to tell which stage a note comes from.
   */
  wavKeys: string[];
  bmpKeys: string[];
  /** Fades of the stage's background sound (LR2 fades the stage BGM channel; keysounds play at full level). */
  soundFadeIn?: NonstopFade;
  soundFadeOut?: NonstopFade;
  /** Crossfade of the stage's BGA layers (3 s at every boundary). */
  bgaFadeIn?: NonstopFade;
  bgaFadeOut?: NonstopFade;
  /** Whether LR2 announces the stage when it starts (ops 280-289, title text): only after a BLANK connection. */
  lr2StageMarker: boolean;
}

export interface NonstopStitchMap {
  stages: NonstopStitchStage[];
  /**
   * What the BPM readouts show over the play ({@link resolveNonstopTempo}, look it up with `nonstopBPMAt`): each
   * stage's own BPM, scaled by its FIT rate, where the stitched chart itself runs at 150 BPM.
   */
  tempo: NonstopTempoPoint[];
  /**
   * The judge rank changes after the first stage ({@link resolveNonstopStageRanks}), for the engine's `stageRanks`
   * option; the stitched chart's `#RANK` is the first stage's.
   */
  stageRanks: NonstopStageRank[];
}

export type StitchNonstopResult =
  | { ok: true; chart: BeMusicJSON; map: NonstopStitchMap }
  | { ok: false; reason: 'bmson' | 'id-space' | 'no-stage' | 'stitch-version'; stage?: number };

/** The stitched chart's tempo: LR2 scrolls a NONSTOP play at `realtime × 1.2` per 1920-unit measure, 150 BPM. */
const STITCHED_BPM = 150;
const MEASURE_SECONDS = 240 / STITCHED_BPM;
/** Positions are placed on a grid this fine per 150-BPM measure (~0.17 ms). */
const GRID_PER_MEASURE = 9600;
/** A note of the next stage this close to the previous stage's last note becomes background sound (OpenLR2 L26988). */
const OVERLAP_SECONDS = 0.1;
const BGA_CHANNELS = new Set(['04', '06', '07', '0A']);
const FADES: Readonly<Record<NonstopConnection, { out?: number; in?: number }>> = {
  fade: { out: 10, in: 5 },
  'fade-fit': { in: 5 },
  cut: { out: 0.2, in: 0.2 },
  'cut-fit': { out: 0.2, in: 0.2 },
  blank1: { in: 5 },
  blank2: {},
};
const BGA_FADE_SECONDS = 3;

/** One object of the stitched chart before it is laid on the grid. */
interface StitchedObject {
  seconds: number;
  channel: string;
  value: string;
  stage: number;
}

interface StitchedStop {
  seconds: number;
  duration: number;
}

/**
 * Stitches the stages of an LR2 NONSTOP course into one BMS chart, placed by {@link planNonstopCourse}.
 *
 * LR2 scrolls a NONSTOP play by time (a constant 150-BPM scroll, OpenLR2 `LR2f.cpp` L26529 / L27067), so the stitched
 * chart runs at 150 BPM and each object sits where its stage's own timing puts it: notes keep their judge times
 * exactly (to the 9600th of a measure). Each stage owns a window from the previous boundary to its own:
 *
 * - its bar lines in the window become the stitched chart's measures (`#xxx02` lengths), so they show where they did;
 * - its STOPs in the window freeze the scroll there; STOPs outside it are dropped;
 * - its notes, invisible notes, mines, BGM and BGA keep their place wherever they fall.
 *
 * A note of a later stage that lands before the previous stage's last note, or within 0.1 s of it on a lane that
 * note's stage also used there, becomes background sound, as LR2 does at the seam. Keysound and BGA keys are renumbered
 * into one base-62 space (`#BASE 62`); a course needing more than 3843 of either is refused (`id-space`). The chart's
 * judge rank is the first stage's (the map's `stageRanks` change it for later stages) and TOTAL the last stage's, as LR2
 * overwrites it. A stitching rule version it does not know (`options.stitch`) is refused (`stitch-version`).
 */
export function stitchNonstopCourse(
  stages: readonly NonstopStageInput[],
  options: StitchNonstopOptions,
): StitchNonstopResult {
  if (!NONSTOP_STITCH_VERSIONS.includes(options.stitch ?? NONSTOP_STITCH_VERSION)) {
    return { ok: false, reason: 'stitch-version' };
  }
  if (stages.length === 0) return { ok: false, reason: 'no-stage' };
  const bmsonStage = stages.findIndex((stage) => stage.chart.sourceFormat !== 'bms');
  if (bmsonStage >= 0) return { ok: false, reason: 'bmson', stage: bmsonStage };
  const assetPath = options.assetPath ?? ((_stage, _kind, path) => path);
  const resolved = stages.map((stage) => resolveChart(stage.chart));
  const timings = stages.map((stage) => createNonstopStageTiming(stage.chart, { pms: stage.pms === true }));
  const placements = planNonstopCourse(timings, options.connections, options);
  const windows = placements.map((placement, index) => ({
    start: index === 0 ? Number.NEGATIVE_INFINITY : placements[index - 1]!.boundarySeconds,
    end: index === placements.length - 1 ? Number.POSITIVE_INFINITY : placement.boundarySeconds,
  }));
  const stitchedSeconds = (stage: number, seconds: number): number =>
    placements[stage]!.offsetSeconds + seconds / placements[stage]!.rate;

  const wavKeys = new NonstopKeyAllocator();
  const bmpKeys = new NonstopKeyAllocator();
  const stopKeys = new NonstopKeyAllocator();
  const chart = createEmptyJSON('bms');
  chart.bms.base = 62;
  const objects: StitchedObject[] = [];
  const stops: StitchedStop[] = [];
  const barLines: number[] = [];
  const stageWAV: string[][] = stages.map(() => []);
  const stageBMP: string[][] = stages.map(() => []);

  for (let index = 0; index < stages.length; index += 1) {
    const source = stages[index]!.chart;
    const chartIndex = resolved[index]!;
    const window = windows[index]!;
    // Every source key gets its own stitched key, even one without a file (it then stays silent), so two stages'
    // keys never meet.
    const known = new Set<string>();
    const wav = (key: string): string | undefined => {
      const stitched = wavKeys.keyFor(index, key);
      if (stitched === undefined) return undefined;
      if (!known.has(`w${stitched}`)) {
        known.add(`w${stitched}`);
        stageWAV[index]!.push(stitched);
        const path = source.resources.wav[key];
        if (path !== undefined) chart.resources.wav[stitched] = assetPath(index, 'wav', path);
      }
      return stitched;
    };
    const bmp = (key: string): string | undefined => {
      const stitched = bmpKeys.keyFor(index, key);
      if (stitched === undefined) return undefined;
      if (!known.has(`b${stitched}`)) {
        known.add(`b${stitched}`);
        stageBMP[index]!.push(stitched);
        const path = source.resources.bmp[key];
        if (path !== undefined) chart.resources.bmp[stitched] = assetPath(index, 'bmp', path);
      }
      return stitched;
    };
    const push = (seconds: number, channel: string, value: string | undefined): boolean => {
      if (value === undefined) return false;
      objects.push({ seconds: stitchedSeconds(index, seconds), channel, value, stage: index });
      return true;
    };

    if (!addStageObjects(chartIndex, push, wav, bmp)) return { ok: false, reason: 'id-space', stage: index };

    for (const stop of chartIndex.timing.stopPoints) {
      // `beatToSeconds` at a STOP's own beat is its start (the STOP counts from just after it).
      const seconds = stitchedSeconds(index, chartIndex.timing.beatToSeconds(stop.beat));
      if (seconds >= window.start && seconds < window.end) {
        stops.push({ seconds, duration: stop.seconds / placements[index]!.rate });
      }
    }
    const timing = timings[index]!;
    // A later stage shows its bar lines from the one nearest its first note (OpenLR2 L26476-L26485, L26979).
    const firstLine = index === 0 ? 0 : resolveNonstopLastMeasure(timing.firstNote);
    // Up to a measure past the last note: the grid extends itself past the last object.
    const lastLine = Math.min(999, Math.ceil(timing.lastNote) + 1);
    for (let measure = firstLine; measure <= lastLine; measure += 1) {
      const seconds = stitchedSeconds(index, timing.secondsAt(measure));
      if (seconds >= window.end) break;
      if (seconds >= window.start) barLines.push(seconds);
    }
  }

  convertSeamNotes(objects, stages.length);
  layOnGrid(chart, objects, stops, barLines, stopKeys);
  if (chart.events.length === 0 && objects.length > 0) return { ok: false, reason: 'id-space' };

  const first = stages[0]!.chart.metadata;
  const last = stages.at(-1)!.chart.metadata;
  chart.metadata.bpm = STITCHED_BPM;
  if (options.title !== undefined) chart.metadata.title = options.title;
  if (first.rank !== undefined) chart.metadata.rank = first.rank;
  if (last.total !== undefined) chart.metadata.total = last.total;

  const readouts = stages.map((stage, index) => ({
    ...stageNoteHeads(objects, index),
    tempo: resolved[index]!.timing.tempoPoints.map((point) => ({
      seconds: point.seconds,
      bpm: point.displayBPM ?? point.bpm,
    })),
    headerBPM: stage.chart.metadata.bpm,
    ...(stage.chart.metadata.rank !== undefined ? { rank: stage.chart.metadata.rank } : {}),
  }));

  return {
    ok: true,
    chart,
    map: {
      tempo: resolveNonstopTempo(readouts, placements, options),
      stageRanks: resolveNonstopStageRanks(readouts, placements, options),
      stages: placements.map((placement, index) => {
        const after = index < placements.length - 1 ? (options.connections[index] ?? 'fade') : undefined;
        const before = index > 0 ? (options.connections[index - 1] ?? 'fade') : undefined;
        const boundary = placement.boundarySeconds;
        const previousBoundary = index > 0 ? placements[index - 1]!.boundarySeconds : 0;
        const fadeOut = after !== undefined ? FADES[after].out : undefined;
        const fadeIn = before !== undefined ? FADES[before].in : undefined;
        return {
          placement,
          windowStart: Math.max(0, windows[index]!.start),
          windowEnd: windows[index]!.end,
          wavKeys: stageWAV[index]!,
          bmpKeys: stageBMP[index]!,
          ...(fadeOut !== undefined ? { soundFadeOut: { start: boundary, end: boundary + fadeOut } } : {}),
          ...(fadeIn !== undefined ? { soundFadeIn: { start: previousBoundary - fadeIn, end: previousBoundary } } : {}),
          ...(after !== undefined ? { bgaFadeOut: { start: boundary, end: boundary + BGA_FADE_SECONDS } } : {}),
          ...(before !== undefined
            ? { bgaFadeIn: { start: previousBoundary - BGA_FADE_SECONDS, end: previousBoundary } }
            : {}),
          lr2StageMarker: before === 'blank1' || before === 'blank2',
        };
      }),
    },
  };
}

/**
 * Collects a stage's objects at their stage-local seconds: judged notes (long notes as `#LNTYPE 1` pairs on `5x` /
 * `6x`), shadowed duplicates as BGM, invisible notes, mines (their value is the damage, kept as is), BGM and BGA.
 * Returns false when the stitched key space runs out.
 */
function addStageObjects(
  chart: ResolvedChart,
  push: (seconds: number, channel: string, value: string | undefined) => boolean,
  wav: (key: string) => string | undefined,
  bmp: (key: string) => string | undefined,
): boolean {
  let ok = true;
  const add = (seconds: number, channel: string, value: string | undefined): void => {
    if (!push(seconds, channel, value)) ok = false;
  };
  for (const note of chart.notes) {
    if (note.freeZone === true) continue;
    const key = wav(note.sampleKey);
    if (note.kind === 'ln' && note.endSeconds !== undefined) {
      const lane = `${note.channel[0] === '2' ? '6' : '5'}${note.channel[1]}`;
      add(note.seconds, lane, key);
      add(note.endSeconds, lane, key);
    } else {
      add(note.seconds, note.channel, key);
    }
  }
  for (const note of chart.shadowedNotes) add(note.seconds, '01', wav(note.sampleKey));
  for (const note of chart.invisibleNotes) add(note.seconds, normalizeChannel(note.event.channel), wav(note.sampleKey));
  for (const mine of chart.mines) {
    add(mine.seconds, normalizeChannel(mine.event.channel), mine.event.value.toUpperCase());
  }
  for (const event of chart.sortedEvents) {
    const channel = normalizeChannel(event.channel);
    const value = normalizeObjectKey(event.value, chart.idBase);
    if (channel === '01') add(chart.timing.eventToSeconds(event), '01', wav(value));
    else if (BGA_CHANNELS.has(channel)) add(chart.timing.eventToSeconds(event), channel, bmp(value));
  }
  return ok;
}

/** The judged lanes a seam note is compared on: a tap or long-note head on `1x` / `2x`, or `5x` / `6x` heads. */
function laneOf(object: StitchedObject): string | undefined {
  const bank = object.channel[0];
  if (bank === '1' || bank === '2') return object.channel;
  if (bank === '5') return `1${object.channel[1]}`;
  if (bank === '6') return `2${object.channel[1]}`;
  return undefined;
}

/**
 * LR2's seam rule (OpenLR2 L26988-L27010): a later stage's note before the previous stage's last note (by more than
 * 0.1 s), or within 0.1 s of it on a lane the earlier stages also used within that time, becomes background sound. A
 * long note so converted keeps only its head's sound.
 */
function convertSeamNotes(objects: StitchedObject[], stageCount: number): void {
  for (let stage = 1; stage < stageCount; stage += 1) {
    const previous = noteHeads(objects, stage - 1);
    if (previous.size === 0) continue;
    // LR2 measures from the previous stage's last note head (ops 10-29), not a long-note tail.
    const previousLast = Math.max(...[...previous.keys()].map((head) => head.seconds));
    const earlier = [...objects].filter((object) => object.stage < stage && laneOf(object) !== undefined);
    const converts = (object: StitchedObject): boolean => {
      if (object.seconds > previousLast + OVERLAP_SECONDS) return false;
      if (Math.abs(object.seconds - previousLast) >= OVERLAP_SECONDS) return object.seconds < previousLast;
      const lane = laneOf(object);
      return earlier.some((other) => laneOf(other) === lane && other.seconds >= previousLast - OVERLAP_SECONDS);
    };
    const dropped = new Set<StitchedObject>();
    for (const [head, tail] of noteHeads(objects, stage)) {
      if (!converts(head)) continue;
      head.channel = '01';
      if (tail !== undefined) dropped.add(tail);
    }
    for (let index = objects.length - 1; index >= 0; index -= 1) {
      if (dropped.has(objects[index]!)) objects.splice(index, 1);
    }
  }
}

/** Stitched seconds of a stage's first and last judged note heads (after the seam rule), when it has any. */
function stageNoteHeads(
  objects: readonly StitchedObject[],
  stage: number,
): { noteHeads?: { first: number; last: number } } {
  const heads = [...noteHeads(objects, stage).keys()].map((head) => head.seconds);
  return heads.length > 0 ? { noteHeads: { first: Math.min(...heads), last: Math.max(...heads) } } : {};
}

/** A stage's judged note heads (taps and long-note heads), each with its long-note tail, in time order. */
function noteHeads(objects: readonly StitchedObject[], stage: number): Map<StitchedObject, StitchedObject | undefined> {
  const heads = new Map<StitchedObject, StitchedObject | undefined>();
  const open = new Map<string, StitchedObject>();
  const own = objects
    .filter((object) => object.stage === stage && laneOf(object) !== undefined)
    .sort((left, right) => left.seconds - right.seconds);
  for (const object of own) {
    const long = object.channel[0] === '5' || object.channel[0] === '6';
    const head = long ? open.get(object.channel) : undefined;
    if (head !== undefined) {
      heads.set(head, object);
      open.delete(object.channel);
      continue;
    }
    heads.set(object, undefined);
    if (long) open.set(object.channel, object);
  }
  return heads;
}

/** Seconds of scroll at stitched `seconds`: the time with the STOPs before it (and the part of one it is in) removed. */
function scrollSeconds(seconds: number, stops: readonly StitchedStop[]): number {
  let frozen = 0;
  for (const stop of stops) {
    if (stop.seconds >= seconds) break;
    frozen += Math.min(stop.duration, seconds - stop.seconds);
  }
  return seconds - frozen;
}

/**
 * Lays the stitched objects on a 150-BPM grid: measures run between the kept bar lines, each object goes to the
 * position its scroll time gives, and each STOP becomes a `#STOP` of its exact length (in 1/192 of a 150-BPM measure).
 */
function layOnGrid(
  chart: BeMusicJSON,
  objects: readonly StitchedObject[],
  stops: StitchedStop[],
  barLineSeconds: readonly number[],
  stopKeys: NonstopKeyAllocator,
): void {
  stops.sort((left, right) => left.seconds - right.seconds);
  const toMeasures = (seconds: number): number => Math.max(0, scrollSeconds(seconds, stops)) / MEASURE_SECONDS;
  const lines = [0];
  for (const seconds of [...barLineSeconds].sort((left, right) => left - right)) {
    const at = toMeasures(seconds);
    if (at - lines.at(-1)! > 1e-6) lines.push(at);
  }
  const lastObject = Math.max(0, ...objects.map((object) => toMeasures(object.seconds)));
  while (lines.at(-1)! <= lastObject) lines.push(lines.at(-1)! + 1);
  for (let index = 0; index < lines.length - 1; index += 1) {
    const length = lines[index + 1]! - lines[index]!;
    if (Math.abs(length - 1) > 1e-9) chart.measures.push({ index, length });
  }
  const place = (seconds: number): Pick<BeMusicEvent, 'measure' | 'position'> => {
    const at = toMeasures(seconds);
    let measure = 0;
    while (measure < lines.length - 2 && lines[measure + 1]! <= at) measure += 1;
    const length = lines[measure + 1]! - lines[measure]!;
    const grid = Math.max(1, Math.round(length * GRID_PER_MEASURE));
    const step = Math.min(grid - 1, Math.round(((at - lines[measure]!) / length) * grid));
    return { measure, position: reduce(Math.max(0, step), grid) };
  };
  for (const object of objects) {
    chart.events.push({ ...place(object.seconds), channel: object.channel, value: object.value });
  }
  for (const stop of stops) {
    const key = stopKeys.fresh();
    if (key === undefined) {
      chart.events.length = 0;
      return;
    }
    chart.resources.stop[key] = (stop.duration / MEASURE_SECONDS) * 192;
    chart.events.push({ ...place(stop.seconds), channel: '09', value: key });
  }
  chart.events.sort(
    (left, right) =>
      left.measure - right.measure ||
      left.position[0] / left.position[1] - right.position[0] / right.position[1] ||
      left.channel.localeCompare(right.channel),
  );
}

function reduce(numerator: number, denominator: number): [number, number] {
  let a = numerator;
  let b = denominator;
  while (b !== 0) [a, b] = [b, a % b];
  return numerator === 0 ? [0, 1] : [numerator / a, denominator / a];
}
