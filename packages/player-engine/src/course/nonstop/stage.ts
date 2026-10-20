import { resolveChart } from '@be-music/chart-model';
import type { BeMusicEvent, BeMusicJSON } from '@be-music/chart-source';
import type { NonstopStageTiming } from './plan.ts';

/**
 * LR2's `channelConvert` (OpenLR2 `LR2f.cpp` L25684): object channel → conversion case, `0` dropping the channel and
 * `0x3c` keeping it. Only whether a channel survives, and whether it becomes a visible note, matters here.
 */
const CHANNEL_CONVERT = [
  0x00, 0x3c, 0x3c, 0x3c, 0x3c, 0x3c, 0x3c, 0x3c, 0x3c, 0x3c, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
  0x09, 0x00, 0x3c, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x00, 0x0f, 0x10, 0x00, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
  0x18, 0x19, 0x00, 0x3c, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x00, 0x1f, 0x20, 0x00, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26,
  0x27, 0x28, 0x29, 0x00, 0x3c, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x00, 0x2f, 0x30,
];
/** Conversion cases that drop the channel outside PMS: the free zones `17` / `37` / `57` and the mine `D7`. */
const NON_PMS_DROPPED_CASES = new Set([7, 23, 39, 50]);
const MINE_DROPPED = new Set([130, 140, 147]);

/**
 * How LR2's loader reads a two-character object channel: its number (`hex(first) × 10 + digit(second)`, so `D1` is
 * 131), or `undefined` when LR2 skips the line (a second character that is not a digit, or a first one that is not hex).
 */
function lr2ChannelNumber(channel: string): number | undefined {
  const upper = channel.toUpperCase();
  const first = Number.parseInt(upper[0] ?? '', 16);
  const second = upper.charCodeAt(1) - 0x30;
  if (upper.length !== 2 || !Number.isInteger(first) || second < 0 || second > 9) return undefined;
  return first * 10 + second;
}

/** Whether LR2 keeps an object on `channel` (its converted channel is above 0); `02` / `03` are read apart. */
function isLR2Object(number: number, pms: boolean): boolean {
  if (number === 2 || number === 3) return false;
  if (number >= 150) return true;
  if (MINE_DROPPED.has(number)) return false;
  if (number >= 130) return pms || number !== 137;
  const convert = CHANNEL_CONVERT[number];
  if (convert === undefined) return true;
  if (convert === 0) return false;
  return pms || !NON_PMS_DROPPED_CASES.has(convert);
}

/** Whether an object becomes a visible note (LR2 ops 10-29 / 50-69): the 1P / 2P key lanes and their long notes. */
function isLR2VisibleNote(number: number, pms: boolean): boolean {
  const lane = number % 10;
  const bank = Math.floor(number / 10);
  if (!(bank === 1 || bank === 2 || bank === 5 || bank === 6) || lane === 0) return false;
  return isLR2Object(number, pms);
}

function eventPosition(event: BeMusicEvent): number {
  const [numerator, denominator] = event.position;
  return event.measure + (denominator > 0 ? numerator / denominator : 0);
}

/**
 * The NONSTOP placement inputs of one stage chart ({@link NonstopStageTiming}): BMS only, with its control flow
 * already resolved. `pms` is a `.pms` chart, which LR2 reads with the PMS channel table.
 *
 * `lr2FirstNote` follows LR2's file order when the chart keeps its object lines (`preservation.bms.objectLines`) for
 * every event; otherwise it reads the events in chart order, which is the same unless a line repeats an earlier measure.
 */
export function createNonstopStageTiming(json: BeMusicJSON, options: { pms?: boolean } = {}): NonstopStageTiming {
  const pms = options.pms === true;
  const resolved = resolveChart(json);
  const { timing, beatResolver } = resolved;
  const secondsAt = (position: number): number => {
    const measure = Math.floor(position);
    return timing.beatToSeconds(beatResolver.measureToBeat(measure, position - measure));
  };

  let firstNote = Number.POSITIVE_INFINITY;
  let lastNote = 0;
  for (const event of json.events) {
    const number = lr2ChannelNumber(event.channel);
    if (number === undefined || !isLR2VisibleNote(number, pms)) continue;
    const position = eventPosition(event);
    firstNote = Math.min(firstNote, position);
    lastNote = Math.max(lastNote, position);
  }
  if (!Number.isFinite(firstNote)) firstNote = 0;

  const objectLines = json.preservation.bms.objectLines;
  const lineEvents = objectLines.reduce((count, line) => count + line.events.length, 0);
  const fileOrder =
    objectLines.length > 0 && lineEvents === json.events.length
      ? objectLines.flatMap((line) => line.events)
      : json.events;
  let lr2FirstNote = -1;
  for (const event of fileOrder) {
    const number = lr2ChannelNumber(event.channel);
    if (number === undefined || !isLR2Object(number, pms)) continue;
    const position = eventPosition(event);
    if (isLR2VisibleNote(number, pms) && lr2FirstNote === -1) lr2FirstNote = position;
    else if (position < lr2FirstNote) lr2FirstNote = position;
  }

  const lastTempo = timing.tempoPoints.at(-1);
  return {
    secondsAt,
    firstNote,
    ...(lr2FirstNote >= 0 ? { lr2FirstNote } : {}),
    lastNote,
    headerBPM: json.metadata.bpm,
    finalBPM: Math.abs(lastTempo?.bpm ?? json.metadata.bpm),
    firstMeasureLength: (beatResolver.measureToBeat(1) - beatResolver.measureToBeat(0)) / 4,
  };
}
