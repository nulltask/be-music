import { MAX_GENERIC_BMSON_KEYS, resolveGenericBmsonKeyCount, type GenericBmsonPlayVariant } from './generic-bmson.ts';
import type { ChartPlayVariant } from './index.ts';

/**
 * The play-mode table: the single declaration of every play mode's lanes, the BMS channels each lane owns, and the bmson
 * `mode_hint` lane tables. The parser, the stringifier, the lane-mode rule, the player's lane layout, the terminal
 * player's lane colours, and the skin SDK's lane kinds all derive from it, so adding or fixing a mode is a change to
 * this file (plus its tests) rather than to eight packages.
 */

/** What a lane is: a key, the That-Which-Must-Not-Be-Named turntable, or one direction of the 24 / 48 KEY keyboard wheel. */
export type PlayLaneKind = 'key' | 'scratch' | 'wheel-up' | 'wheel-down';

export type PlaySide = '1P' | '2P';

/**
 * Colour class of a key. The That-Which-Must-Not-Be-Named and pop'n layouts alternate by key number (odd keys white, even keys black); the
 * keyboard modes follow the piano, repeating every octave. The scratch and the wheel have none.
 */
export type PlayKeyTone = 'white' | 'black';

/** The BMS channels of one lane — one per object family, all sharing the lane code (`1A` → `3A` / `5A` / `DA`). */
export interface PlayLaneChannels {
  /** Visible notes, `1x` / `2x`. Also the lane's id. */
  readonly visible: string;
  /** Invisible objects, `3x` / `4x`. */
  readonly invisible: string;
  /** `#LNTYPE` long notes, `5x` / `6x`. */
  readonly longNote: string;
  /** Landmines, `Dx` / `Ex`. */
  readonly mine: string;
}

export interface PlayLane {
  /** The lane's visible channel (`1x` / `2x`), which identifies it. */
  readonly channel: string;
  readonly kind: PlayLaneKind;
  readonly side: PlaySide;
  /**
   * The lane's place on its side: keys are numbered from 1 left to right (That-Which-Must-Not-Be-Named `18` / `19` are keys 6 / 7, PMS-STD
   * `22..25` keys 6..9), the scratch is 0, and the keyboard wheel up / down is 25 / 26 (beatoraja's lane offsets).
   */
  readonly slot: number;
  /** Colour class of a key; absent for the scratch and the wheel. */
  readonly tone?: PlayKeyTone;
  readonly channels: PlayLaneChannels;
}

/** An That-Which-Must-Not-Be-Named FREE ZONE channel. It is not a lane of its own: it is drawn on, and played with, its side's scratch. */
export interface PlayFreeZone {
  readonly channel: string;
  readonly scratch: string;
}

/**
 * Layout ids. Every play variant has one layout except 9 KEY, which has two: `9-pms` (PMS-STD, `11..15` + `22..25`)
 * and `9-bme` (the BME-type / PMS-COMPAT layout, `11..19`).
 */
export type PlayModeLayoutId = '5' | '7' | '9-pms' | '9-bme' | '10' | '14' | '24' | '48' | GenericBmsonPlayVariant;

export interface PlayModeLayout {
  readonly id: PlayModeLayoutId;
  readonly variant: ChartPlayVariant;
  /** Display name (`'7 KEY SP'`, `'9 KEY (PMS-STD)'`, …). */
  readonly label: string;
  /**
   * Every lane of the layout, left to right as LR2 / beatoraja skins draw it: the scratch (or the keyboard wheel) sits
   * on its side's outer edge, left of the 1P keys and right of the 2P keys.
   */
  readonly lanes: readonly PlayLane[];
  /** FREE ZONE channels the layout plays on its scratch (That-Which-Must-Not-Be-Named layouts only). */
  readonly freeZones: readonly PlayFreeZone[];
  /** The bmson `mode_hint` that names this layout, when one does. */
  readonly bmsonModeHint?: BmsonModeHint;
}

/** The canonical, Keyboardmania and bounded generic bmson hints with an explicit lane table. */
export type BmsonModeHint =
  | 'beat-5k'
  | 'beat-7k'
  | 'beat-10k'
  | 'beat-14k'
  | 'popn-5k'
  | 'popn-9k'
  | 'keyboard-24k'
  | 'keyboard-24k-double'
  | `generic-${number}keys`
  | `generic-${number}key`;

export interface BmsonModeHintLayout {
  readonly modeHint: BmsonModeHint;
  /**
   * The span of `x` values the table covers (`beat-5k`: 8). An `x` inside it with no lane — `beat-5k`'s `x` 6 / 7 —
   * and every `x` past it is a BGM note, as in beatoraja.
   */
  readonly width: number;
  /** bmson `x` → lane channel. */
  readonly channelByX: ReadonlyMap<number, string>;
  /** Lane channel → bmson `x`; the inverse of {@link BmsonModeHintLayout.channelByX}. */
  readonly xByChannel: ReadonlyMap<string, number>;
}

/** Lane codes of a `<side><lane>` channel, left to right: the classic `1`..`9` columns, then the extended `A`..`Z`. */
const LANE_CODES = '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Keys per side of the keyboard (Keyboardmania) modes: `11..19` + `1A..1O`. */
const KEYBOARD_SIDE_KEYS = 24;
/** Chromatic offsets of the black keys within an octave (C# D# F# G# A#). */
const KEYBOARD_BLACK_KEY_SEMITONES: ReadonlySet<number> = new Set([1, 3, 6, 8, 10]);

/**
 * The BMS channels of a lane, from its visible channel (`1x` / `2x`, `x` in `1`..`9` / `A`..`Z`, either case):
 * `'1A'` → `{ visible: '1A', invisible: '3A', longNote: '5A', mine: 'DA' }`. `undefined` for anything that is not a
 * lane channel.
 */
export function resolvePlayLaneChannels(channel: string): PlayLaneChannels | undefined {
  if (channel.length !== 2) return undefined;
  const side = channel[0];
  const lane = channel[1]!.toUpperCase();
  if ((side !== '1' && side !== '2') || !LANE_CODES.includes(lane)) return undefined;
  const p2 = side === '2';
  return {
    visible: `${side}${lane}`,
    invisible: `${p2 ? '4' : '3'}${lane}`,
    longNote: `${p2 ? '6' : '5'}${lane}`,
    mine: `${p2 ? 'E' : 'D'}${lane}`,
  };
}

/** `side` is the player the lane belongs to; `channel` defaults to that side's bank (`1x` / `2x`). */
function lane(
  side: PlaySide,
  laneCode: string,
  kind: PlayLaneKind,
  slot: number,
  tone?: PlayKeyTone,
  channel = `${side === '1P' ? '1' : '2'}${laneCode}`,
): PlayLane {
  const entry: PlayLane = { channel, kind, side, slot, channels: resolvePlayLaneChannels(channel)! };
  return tone === undefined ? entry : { ...entry, tone };
}

/** A key whose colour alternates by key number (That-Which-Must-Not-Be-Named / pop'n): odd keys white, even keys black. */
function alternatingKey(side: PlaySide, laneCode: string, slot: number, channel?: string): PlayLane {
  return lane(side, laneCode, 'key', slot, slot % 2 === 1 ? 'white' : 'black', channel);
}

/** That-Which-Must-Not-Be-Named keys of one side: `x1..x5`, then `x8` / `x9` as keys 6 / 7 for the 7-key layouts. */
function ____Keys(side: PlaySide, keys: 5 | 7): PlayLane[] {
  const codes = keys === 7 ? '1234589' : '12345';
  return Array.from(codes, (code, index) => alternatingKey(side, code, index + 1));
}

/** One That-Which-Must-Not-Be-Named side, in drawing order: the scratch (`x6`) on the outer edge. */
function ____Side(side: PlaySide, keys: 5 | 7): PlayLane[] {
  const scratch = lane(side, '6', 'scratch', 0);
  return side === '1P' ? [scratch, ...____Keys(side, keys)] : [...____Keys(side, keys), scratch];
}

const _____FREE_ZONES: Record<PlaySide, PlayFreeZone> = {
  '1P': { channel: '17', scratch: '16' },
  '2P': { channel: '27', scratch: '26' },
};

/** One keyboard side, in drawing order: 24 piano keys, the wheel (up, then down) on the outer edge. */
function keyboardSide(side: PlaySide): PlayLane[] {
  const keys = Array.from(LANE_CODES.slice(0, KEYBOARD_SIDE_KEYS), (code, index) =>
    lane(side, code, 'key', index + 1, KEYBOARD_BLACK_KEY_SEMITONES.has(index % 12) ? 'black' : 'white'),
  );
  const wheel = [
    lane(side, LANE_CODES[KEYBOARD_SIDE_KEYS]!, 'wheel-up', KEYBOARD_SIDE_KEYS + 1),
    lane(side, LANE_CODES[KEYBOARD_SIDE_KEYS + 1]!, 'wheel-down', KEYBOARD_SIDE_KEYS + 2),
  ];
  return side === '1P' ? [...wheel, ...keys] : [...keys, ...wheel];
}

/**
 * Every play-mode layout. The 9 KEY layouts are pop'n's: PMS-STD takes keys 6..9 from the 2P-side `22..25` (what
 * `.pms` files and `play_9.lr2skin` use), the BME type keeps all nine keys on `11..19`.
 */
export const PLAY_MODE_LAYOUTS: Readonly<Record<PlayModeLayoutId, PlayModeLayout>> = {
  '5': {
    id: '5',
    variant: '5',
    label: '5 KEY SP',
    lanes: ____Side('1P', 5),
    freeZones: [_____FREE_ZONES['1P']],
    bmsonModeHint: 'beat-5k',
  },
  '7': {
    id: '7',
    variant: '7',
    label: '7 KEY SP',
    lanes: ____Side('1P', 7),
    freeZones: [_____FREE_ZONES['1P']],
    bmsonModeHint: 'beat-7k',
  },
  '9-pms': {
    id: '9-pms',
    variant: '9',
    label: '9 KEY (PMS-STD)',
    lanes: [
      ...Array.from('12345', (code, index) => alternatingKey('1P', code, index + 1)),
      // One player's keys 6..9, authored on the 2P bank.
      ...Array.from('2345', (code, index) => alternatingKey('1P', code, index + 6, `2${code}`)),
    ],
    freeZones: [],
    bmsonModeHint: 'popn-9k',
  },
  '9-bme': {
    id: '9-bme',
    variant: '9',
    label: '9 KEY (PMS-COMPAT)',
    lanes: Array.from('123456789', (code, index) => alternatingKey('1P', code, index + 1)),
    freeZones: [],
  },
  '10': {
    id: '10',
    variant: '10',
    label: '5 KEY DP',
    lanes: [...____Side('1P', 5), ...____Side('2P', 5)],
    freeZones: [_____FREE_ZONES['1P'], _____FREE_ZONES['2P']],
    bmsonModeHint: 'beat-10k',
  },
  '14': {
    id: '14',
    variant: '14',
    label: '14 KEY DP',
    lanes: [...____Side('1P', 7), ...____Side('2P', 7)],
    freeZones: [_____FREE_ZONES['1P'], _____FREE_ZONES['2P']],
    bmsonModeHint: 'beat-14k',
  },
  '24': {
    id: '24',
    variant: '24',
    label: '24 KEY SP',
    lanes: keyboardSide('1P'),
    freeZones: [],
    bmsonModeHint: 'keyboard-24k',
  },
  '48': {
    id: '48',
    variant: '48',
    label: '48 KEY DP',
    lanes: [...keyboardSide('1P'), ...keyboardSide('2P')],
    freeZones: [],
    bmsonModeHint: 'keyboard-24k-double',
  },
};

for (let count = 1; count <= MAX_GENERIC_BMSON_KEYS; count++) {
  const id: GenericBmsonPlayVariant = `generic-${count}`;
  const layout: PlayModeLayout = {
    id,
    variant: id,
    label: `${count} KEY GENERIC`,
    bmsonModeHint: `generic-${count}keys`,
    freeZones: [],
    lanes: Array.from({ length: count }, (_, index) => {
      const channel = `${index < LANE_CODES.length ? '1' : '2'}${LANE_CODES[index % LANE_CODES.length]}`;
      return {
        channel,
        kind: 'key',
        side: '1P',
        slot: index + 1,
        tone: 'white',
        channels: resolvePlayLaneChannels(channel)!,
      };
    }),
  };
  Object.assign(PLAY_MODE_LAYOUTS, { [id]: layout });
}

const LAYOUTS_BY_VARIANT: ReadonlyMap<ChartPlayVariant, readonly PlayModeLayout[]> = (() => {
  const map = new Map<ChartPlayVariant, PlayModeLayout[]>();
  for (const layout of Object.values(PLAY_MODE_LAYOUTS)) {
    const layouts = map.get(layout.variant) ?? [];
    layouts.push(layout);
    map.set(layout.variant, layouts);
  }
  return map;
})();

/** The layouts of a play variant: one for every variant except `'9'`, which has PMS-STD then the BME type. */
export function getPlayModeLayouts(variant: ChartPlayVariant): readonly PlayModeLayout[] {
  if (variant.startsWith('generic-')) {
    const count = resolveGenericBmsonKeyCount(`${variant}keys`);
    if (count === undefined) throw new RangeError(`Unsupported generic play variant: ${variant}`);
    return LAYOUTS_BY_VARIANT.get(`generic-${count}`)!;
  }
  return LAYOUTS_BY_VARIANT.get(variant) ?? [];
}

/**
 * The lane a visible channel is in under a play variant (either case), or `undefined` when the variant has no such
 * lane. For `'9'` the PMS-STD layout is searched first, then the BME type.
 */
export function findPlayModeLane(variant: ChartPlayVariant, channel: string): PlayLane | undefined {
  const normalized = channel.toUpperCase();
  for (const layout of getPlayModeLayouts(variant)) {
    const found = layout.lanes.find((entry) => entry.channel === normalized);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Builds a bmson hint's lane table from a play-mode layout. Each side spans `stride` `x` values: its keys sit at their
 * key number, the That-Which-Must-Not-Be-Named scratch at the side's last `x` (the bmson spec's `SC` column), the keyboard wheel at 25 / 26.
 * `maxKeySlot` keeps only the first keys (`popn-5k` is the first five keys of PMS-STD).
 */
function bmsonHintFromLayout(
  modeHint: BmsonModeHint,
  layoutId: PlayModeLayoutId,
  stride: number,
  maxKeySlot = Number.POSITIVE_INFINITY,
): BmsonModeHintLayout {
  const channelByX = new Map<number, string>();
  let sides = 1;
  for (const entry of PLAY_MODE_LAYOUTS[layoutId].lanes) {
    if (entry.kind === 'key' && entry.slot > maxKeySlot) continue;
    const sideIndex = entry.side === '2P' ? 1 : 0;
    sides = Math.max(sides, sideIndex + 1);
    channelByX.set(sideIndex * stride + (entry.kind === 'scratch' ? stride : entry.slot), entry.channel);
  }
  const sorted = new Map([...channelByX].sort(([left], [right]) => left - right));
  const width = Number.isFinite(maxKeySlot) ? Math.max(...sorted.keys()) : sides * stride;
  return {
    modeHint,
    width,
    channelByX: sorted,
    xByChannel: new Map([...sorted].map(([x, channel]) => [channel, x])),
  };
}

/**
 * The bmson `mode_hint` lane tables — the bmson spec's "Canonical List of Mode Hints" (`doc/index.rst` L815-838) and
 * beatoraja's keyboard hints, which agree with jbms-parser's `BMSONDecoder`:
 *
 * - `beat-5k` / `beat-7k` / `beat-10k` / `beat-14k`: each side spans 8 `x` values — keys 1..5 (1..7) on `x` 1..5
 *   (1..7), the scratch on `x` 8; the 2P side repeats from `x` 9 (scratch on `x` 16). `beat-5k` / `beat-10k` leave
 *   `x` 6 / 7 (14 / 15) without a lane.
 * - `popn-5k` / `popn-9k`: keys on `x` 1..5 / 1..9, the PMS-STD lanes (`11..15`, `22..25`).
 * - `keyboard-24k` / `keyboard-24k-double`: keys on `x` 1..24, the wheel up / down on 25 / 26; the 2P side repeats
 *   from `x` 27.
 */
export const BMSON_MODE_HINT_LAYOUTS: Readonly<Record<BmsonModeHint, BmsonModeHintLayout>> = {
  'beat-5k': bmsonHintFromLayout('beat-5k', '5', 8),
  'beat-7k': bmsonHintFromLayout('beat-7k', '7', 8),
  'beat-10k': bmsonHintFromLayout('beat-10k', '10', 8),
  'beat-14k': bmsonHintFromLayout('beat-14k', '14', 8),
  'popn-5k': bmsonHintFromLayout('popn-5k', '9-pms', 9, 5),
  'popn-9k': bmsonHintFromLayout('popn-9k', '9-pms', 9),
  'keyboard-24k': bmsonHintFromLayout('keyboard-24k', '24', 26),
  'keyboard-24k-double': bmsonHintFromLayout('keyboard-24k-double', '48', 26),
};

for (let count = 1; count <= MAX_GENERIC_BMSON_KEYS; count++) {
  const modeHint = `generic-${count}keys` as const;
  const layout = PLAY_MODE_LAYOUTS[`generic-${count}`];
  const channelByX = new Map(layout.lanes.map((lane, index) => [index + 1, lane.channel]));
  const table: BmsonModeHintLayout = {
    modeHint,
    width: count,
    channelByX,
    xByChannel: new Map([...channelByX].map(([x, channel]) => [channel, x])),
  };
  Object.assign(BMSON_MODE_HINT_LAYOUTS, { [modeHint]: table, [`generic-${count}key`]: table });
}

/** The lane table of a bmson `mode_hint` (surrounding whitespace ignored), or `undefined` for a hint without one. */
export function resolveBmsonModeHintLayout(modeHint: string | undefined): BmsonModeHintLayout | undefined {
  if (typeof modeHint !== 'string') return undefined;
  const count = resolveGenericBmsonKeyCount(modeHint);
  if (count !== undefined) return BMSON_MODE_HINT_LAYOUTS[`generic-${count}keys`];
  const trimmed = modeHint.trim();
  return Object.hasOwn(BMSON_MODE_HINT_LAYOUTS, trimmed)
    ? BMSON_MODE_HINT_LAYOUTS[trimmed as BmsonModeHint]
    : undefined;
}
