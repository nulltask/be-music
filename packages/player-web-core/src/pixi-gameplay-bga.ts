import type { TimingResolver } from '@be-music/audio-renderer/triggers';
import type { BeMusicJson } from '@be-music/json';
import { normalizeChannel, normalizeObjectKey } from '@be-music/json';
import { SPEC_BGA_CANVAS_SIZE } from './pixi-gameplay-constants.ts';

export interface BgaCue {
  seconds: number;
  bmpKey: string | undefined;
}

const BGA_BASE_CHANNEL = '04';
const BGA_POOR_CHANNEL = '06';
const BGA_LAYER_CHANNEL = '07';
const BGA_LAYER2_CHANNEL = '0A';

export function buildBgaTimeline(
  chart: BeMusicJson,
  resolver: TimingResolver,
): { base: BgaCue[]; layer: BgaCue[]; poor: BgaCue[] } {
  const base: BgaCue[] = [];
  const layer: BgaCue[] = [];
  const poor: BgaCue[] = [];

  for (const event of chart.events) {
    const channel = normalizeChannel(event.channel);
    if (
      channel !== BGA_BASE_CHANNEL &&
      channel !== BGA_POOR_CHANNEL &&
      channel !== BGA_LAYER_CHANNEL &&
      channel !== BGA_LAYER2_CHANNEL
    ) {
      continue;
    }
    const seconds = resolver.eventToSeconds(event);
    const rawKey = normalizeObjectKey(event.value);
    const bmpKey = rawKey === '00' ? undefined : rawKey;
    const cue: BgaCue = { seconds, bmpKey };
    if (channel === BGA_BASE_CHANNEL) base.push(cue);
    else if (channel === BGA_POOR_CHANNEL) poor.push(cue);
    else layer.push(cue);
  }

  const bgaSection = chart.bmson.bga;
  if (bgaSection.events.length > 0 || bgaSection.layerEvents.length > 0 || bgaSection.poorEvents.length > 0) {
    const headerById = new Map(bgaSection.header.map((entry) => [entry.id, entry.name]));
    const resolution =
      chart.bmson.info?.resolution && chart.bmson.info.resolution > 0 ? chart.bmson.info.resolution : 240;
    const pulseToBeat = (y: number): number => y / resolution;
    const toCue = (entry: { y: number; id: number }): BgaCue => {
      const beat = pulseToBeat(entry.y);
      const seconds = resolver.beatToSeconds(beat);
      const name = entry.id === 0 ? undefined : headerById.get(entry.id);
      return { seconds, bmpKey: name };
    };
    for (const ev of bgaSection.events) base.push(toCue(ev));
    for (const ev of bgaSection.layerEvents) layer.push(toCue(ev));
    for (const ev of bgaSection.poorEvents) poor.push(toCue(ev));
  }

  base.sort((left, right) => left.seconds - right.seconds);
  layer.sort((left, right) => left.seconds - right.seconds);
  poor.sort((left, right) => left.seconds - right.seconds);
  return { base, layer, poor };
}

export function pickActiveBgaKey(cues: ReadonlyArray<BgaCue>, seconds: number): string | undefined {
  return pickActiveBgaCue(cues, seconds)?.bmpKey;
}

export function pickActiveBgaCue(cues: ReadonlyArray<BgaCue>, seconds: number): BgaCue | undefined {
  let active: BgaCue | undefined;
  for (const cue of cues) {
    if (cue.seconds > seconds) {
      break;
    }
    active = cue;
  }
  return active;
}

export function fitTextureWithinSpecCanvas(
  sourceWidth: number,
  sourceHeight: number,
): { offsetX: number; offsetY: number; width: number; height: number } {
  const safeW = Number.isFinite(sourceWidth) ? Math.max(1, Math.floor(sourceWidth)) : 1;
  const safeH = Number.isFinite(sourceHeight) ? Math.max(1, Math.floor(sourceHeight)) : 1;
  const widthScale = SPEC_BGA_CANVAS_SIZE / safeW;
  const heightScale = SPEC_BGA_CANVAS_SIZE / safeH;
  const scale = Math.min(1, widthScale, heightScale);
  const fittedWidth = Math.max(1, Math.floor(safeW * scale));
  const fittedHeight = Math.max(1, Math.floor(safeH * scale));
  const offsetX = Math.floor((SPEC_BGA_CANVAS_SIZE - fittedWidth) / 2);
  const offsetY = 0;
  return { offsetX, offsetY, width: fittedWidth, height: fittedHeight };
}

export function isVideoExtension(path: string): boolean {
  const lower = path.toLowerCase();
  return /\.(mpg|mpeg|mp4|m4v|avi|mov|wmv|webm|mkv)$/u.test(lower);
}
