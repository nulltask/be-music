import { LRX_TICKS_PER_BEAT, resolveBMSBase, type BeMusicJSON, type LRXBGACue } from '@be-music/chart-source';

/**
 * An LRX chart's BGA as plugout4 -ARCADE EDITION- draws it (`plugout4.exe` 0x4439be, 0x4442c0): six slots (the base,
 * four layers, the POOR image), each showing its latest note, which may move between keyframes. Only charts whose BGA
 * the BMS channels cannot carry have one (`LRXExtensions.bga`).
 */
export interface LRXBGAProgram {
  /** Slot 0 the base, 1–4 the layers, 5 the POOR image: each slot's notes in chart order. */
  readonly slots: readonly (readonly LRXBGANode[])[];
  /** The BMP key of an image id. */
  readonly keyOf: (image: number) => string;
}

export interface LRXBGANode {
  readonly cue: LRXBGACue;
  readonly seconds: number;
  /** `e`, or the start when the note has none. */
  readonly endSeconds: number;
  /** The slot's note this keyframe continues (a `cn="1"` note's previous note). */
  readonly previous?: number;
  /** The keyframe that continues this note. */
  readonly next?: number;
}

/** What a slot draws: the image, which part of it, where, and how. */
export interface LRXBGASprite {
  readonly key: string;
  /** The part of the image, in its pixels; absent for all of it. */
  readonly src?: readonly [number, number, number, number];
  /**
   * Where, in the 1280×720 screen. Absent: at the image's own size from the top left for a still note, over the whole
   * screen for a keyframe chain (plugout's two defaults).
   */
  readonly dst?: readonly [number, number, number, number];
  readonly fill: 'image' | 'screen';
  /** A R G B, 0–255. */
  readonly color: readonly [number, number, number, number];
  readonly blend: number;
  readonly rotation: number;
  readonly center: number;
}

/** plugout's BGA screen. */
export const LRX_BGA_WIDTH = 1280;
export const LRX_BGA_HEIGHT = 720;

const BASE62_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * The chart's LRX BGA program, timed by `beatToSeconds` (an LRX tick is a 480th of a beat); `undefined` without one. A
 * chain note (`cn="1"`) continues the slot's previous note, as plugout links a channel's notes (0x43bbb0).
 */
export function resolveLRXBGAProgram(
  json: BeMusicJSON,
  beatToSeconds: (beat: number) => number,
): LRXBGAProgram | undefined {
  const cues = json.lrx?.bga;
  if (cues === undefined || cues.length === 0) return undefined;
  const slots: Array<{ -readonly [K in keyof LRXBGANode]: LRXBGANode[K] }[]> = Array.from({ length: 6 }, () => []);
  for (const cue of cues) {
    const slot = slots[cue.slot];
    if (slot === undefined) continue;
    const seconds = beatToSeconds(cue.tick / LRX_TICKS_PER_BEAT);
    const node: { -readonly [K in keyof LRXBGANode]: LRXBGANode[K] } = {
      cue,
      seconds,
      endSeconds: cue.endTick !== undefined ? beatToSeconds(cue.endTick / LRX_TICKS_PER_BEAT) : seconds,
    };
    if (cue.chain === true && slot.length > 0) {
      node.previous = slot.length - 1;
      slot[slot.length - 1]!.next = slot.length;
    }
    slot.push(node);
  }
  const base = resolveBMSBase(json);
  return { slots, keyOf: (image) => encodeImageKey(image, base) };
}

/** The BMP key plugout's image id has in the converted chart (`id + 1`, as the LRX parser keys it). */
function encodeImageKey(image: number, base: 36 | 62): string {
  let slot = Math.max(1, Math.trunc(image) + 1);
  if (base === 36) return slot.toString(36).toUpperCase().padStart(2, '0');
  let key = '';
  do {
    key = BASE62_DIGITS[slot % 62]! + key;
    slot = Math.floor(slot / 62);
  } while (slot > 0);
  return key.padStart(2, '0');
}

/**
 * plugout's easing (0x401b30): from `from` at `t0` to `to` at `t1`, linear (0), accelerating (1, u²) or decelerating
 * (2, 1 − (1 − u)²). Before `t0` it is `from`, after `t1` it is `to`, and equal ends give that value.
 */
export function easeLRXBGA(from: number, to: number, t0: number, t1: number, t: number, accel: number): number {
  if (from === to) return from;
  if (t <= t0 || t1 <= t0) return t1 <= t0 && t >= t1 ? to : from;
  if (t >= t1) return to;
  const u = (t - t0) / (t1 - t0);
  const w = accel === 1 ? u * u : accel === 2 ? 1 - (1 - u) * (1 - u) : u;
  return from * (1 - w) + to * w;
}

/** The latest node of `slot` started by `seconds`, as plugout keeps each slot's (0x443c70, 0x43f4ec). */
function activeNode(nodes: readonly LRXBGANode[], seconds: number): number | undefined {
  let found: number | undefined;
  for (let index = 0; index < nodes.length && nodes[index]!.seconds <= seconds; index++) found = index;
  return found;
}

const FULL_COLOR = [255, 255, 255, 255] as const;

/**
 * What `slot` draws at `seconds`. A note outside any chain draws as written. In a chain, plugout eases from the active
 * note's previous keyframe to its next one (or itself), over the previous note's start to that note's `e`, by the
 * previous note's `acc`: the image id (counting up to the later one), both rectangles, the colour and the rotation;
 * the blend and centre stay the previous note's (0x444453..0x444a4f). `imageSize` supplies an image's own size where a
 * note leaves its source rectangle out.
 */
export function sampleLRXBGA(
  program: LRXBGAProgram,
  slot: number,
  seconds: number,
  imageSize: (key: string) => readonly [number, number] | undefined,
): LRXBGASprite | undefined {
  const nodes = program.slots[slot];
  if (nodes === undefined) return undefined;
  const index = activeNode(nodes, seconds);
  if (index === undefined) return undefined;
  const current = nodes[index]!;
  if (current.previous === undefined && current.next === undefined) {
    const cue = current.cue;
    return {
      key: cue.key,
      ...(cue.src !== undefined ? { src: cue.src } : {}),
      ...(cue.dst !== undefined ? { dst: cue.dst } : {}),
      fill: 'image',
      color: cue.dst !== undefined ? (cue.color ?? FULL_COLOR) : FULL_COLOR,
      blend: cue.blend ?? 0,
      rotation: cue.rotation ?? 0,
      center: cue.center ?? 0,
    };
  }
  const to = nodes[current.next ?? index]!;
  const from = nodes[current.previous ?? index]!;
  const t0 = from.seconds;
  const t1 = to.endSeconds;
  const accel = from.cue.accel ?? 0;
  // plugout truncates every eased value to an integer (0x7008f0 after each 0x401b30).
  const ease = (a: number, b: number): number => Math.trunc(easeLRXBGA(a, b, t0, t1, seconds, accel));
  const key = program.keyOf(ease(from.cue.image, to.cue.image + 0.99));
  const sourceOf = (node: LRXBGANode): readonly [number, number, number, number] | undefined => {
    if (node.cue.src !== undefined) return node.cue.src;
    const size = imageSize(node.cue.key);
    return size === undefined ? undefined : [0, 0, size[0], size[1]];
  };
  const screen = [0, 0, LRX_BGA_WIDTH, LRX_BGA_HEIGHT] as const;
  const fromSrc = sourceOf(from);
  const toSrc = sourceOf(to);
  const fromDst = from.cue.dst ?? screen;
  const toDst = to.cue.dst ?? screen;
  const fromColor = from.cue.dst !== undefined ? (from.cue.color ?? FULL_COLOR) : FULL_COLOR;
  const toColor = to.cue.dst !== undefined ? (to.cue.color ?? FULL_COLOR) : FULL_COLOR;
  const quad = (
    a: readonly [number, number, number, number],
    b: readonly [number, number, number, number],
  ): [number, number, number, number] => [ease(a[0], b[0]), ease(a[1], b[1]), ease(a[2], b[2]), ease(a[3], b[3])];
  return {
    key,
    ...(fromSrc !== undefined && toSrc !== undefined ? { src: quad(fromSrc, toSrc) } : {}),
    dst: quad(fromDst, toDst),
    fill: 'screen',
    color: quad(fromColor, toColor),
    blend: from.cue.blend ?? 0,
    rotation: ease(from.cue.rotation ?? 0, to.cue.rotation ?? 0),
    center: from.cue.center ?? 0,
  };
}
