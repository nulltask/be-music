import { normalizeChannel, normalizeObjectKey, resolveBMSBase, type BeMusicJSON } from '@be-music/chart-source';
import type { BGATimingResolver } from './bga.ts';
import type { BmsARGB } from './bmp-directives.ts';

/** Standard nanasi SWBGA definition; separate from the older Be-Music cue-driven animation API. */
export interface BMSKeyBoundBGA {
  frameIntervalMs: number;
  /** Zero keeps the animation visible until the bound key is released. */
  durationMs: number;
  channel: string;
  loop: boolean;
  /** Authored ARGB fields, retained without applying a rendering interpretation. */
  argb: BmsARGB;
  /** Source patterns pack two-character BMP ids; hosts may remap them to longer internal ids. 00 is a real frame. */
  frames: string[];
}

export interface KeyBoundBGACue {
  seconds: number;
  /** Exclusive end of a host-owned selection/animation window, e.g. a NONSTOP stage. */
  endSeconds?: number;
  /** Source-video seconds per stitched second; omitted means 1. Animation intervals are already placed. */
  playbackRate?: number;
  definitionId: string;
  definition: BMSKeyBoundBGA;
}

/** Parse `fr:time:line:loop:a,r,g,b pattern`, with millisecond times and a packed frame stream. */
export function parseBMSKeyBoundBGA(raw: string, idBase: 36 | 62 = 36): BMSKeyBoundBGA | undefined {
  if (typeof raw !== 'string') return undefined;
  const match =
    /^\s*(\d+)\s*:\s*(\d+)\s*:\s*([12][1-9])\s*:\s*([01])\s*:\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s+([0-9a-z]+)\s*$/iu.exec(
      raw,
    );
  if (!match) return undefined;
  const frameIntervalMs = Number(match[1]);
  const durationMs = Number(match[2]);
  const color = match.slice(5, 9).map(Number);
  const pattern = match[9]!;
  if (
    !Number.isSafeInteger(frameIntervalMs) ||
    frameIntervalMs <= 0 ||
    !Number.isSafeInteger(durationMs) ||
    color.some((value) => value > 255) ||
    pattern.length % 2 !== 0
  )
    return undefined;
  const frames: string[] = [];
  for (let offset = 0; offset < pattern.length; offset += 2) {
    const key = normalizeObjectKey(pattern.slice(offset, offset + 2), idBase);
    if (key.length !== 2) return undefined;
    frames.push(key);
  }
  return {
    frameIntervalMs,
    durationMs,
    channel: match[3]!,
    loop: match[4] === '1',
    argb: { a: color[0]!, r: color[1]!, g: color[2]!, b: color[3]! },
    frames,
  };
}

/** Valid A5 selections in chart time; source event-array order breaks equal-time ties. */
export function buildKeyBoundBGATimeline(
  chart: BeMusicJSON,
  resolver: Pick<BGATimingResolver, 'eventToSeconds'>,
): KeyBoundBGACue[] {
  const base = resolveBMSBase(chart);
  const definitions = new Map<string, BMSKeyBoundBGA>();
  for (const [id, raw] of Object.entries(chart.bms.swBGA)) {
    const parsed = parseBMSKeyBoundBGA(raw, base);
    if (parsed) definitions.set(id, parsed);
  }
  if (definitions.size === 0) return [];
  const cues: KeyBoundBGACue[] = [];
  for (const event of chart.events) {
    if (normalizeChannel(event.channel) !== 'A5' || /^0+$/u.test(event.value)) continue;
    const definitionId = normalizeObjectKey(event.value, base, chart.sourceFormat === 'bmson');
    const definition = definitions.get(definitionId);
    if (!definition) continue;
    const seconds = resolver.eventToSeconds(event);
    if (Number.isFinite(seconds)) cues.push({ seconds, definitionId, definition });
  }
  return cues.sort((left, right) => left.seconds - right.seconds);
}

/** The selected image frame; held-duration definitions require the caller to enforce key release. */
export function pickKeyBoundBGAFrame(definition: BMSKeyBoundBGA, elapsedMs: number): string | undefined {
  if (
    !Number.isFinite(elapsedMs) ||
    elapsedMs < 0 ||
    definition.frames.length === 0 ||
    !Number.isFinite(definition.frameIntervalMs) ||
    definition.frameIntervalMs <= 0 ||
    (definition.durationMs > 0 && elapsedMs + 1e-6 >= definition.durationMs)
  )
    return undefined;
  const step = Math.floor((elapsedMs + 1e-6) / definition.frameIntervalMs);
  return definition.frames[
    definition.loop ? step % definition.frames.length : Math.min(step, definition.frames.length - 1)
  ];
}
