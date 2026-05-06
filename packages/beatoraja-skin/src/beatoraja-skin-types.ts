// Plain-TS shapes for beatoraja skins. The structure mirrors the JSON tree shipped with the reference theme; the
// Lua evaluator and the JSON loader both produce values matching these types so downstream code never has to know
// which entry format the skin came from.
//
// Field documentation references the Java side of beatoraja
// (`src/bms/player/beatoraja/skin/json/JSONSkin.java`) where the canonical semantics live.

/**
 * Numeric `SkinType` enum values used by the `type` field on every skin's top-level. Names mirror the Java enum so
 * cross-referencing the upstream source stays cheap. We keep the literal numbers because skin authors author against
 * the integers; we only export labels for the variants the player needs to switch on.
 */
export const BEATORAJA_SKIN_TYPE = {
  PLAY_7KEYS: 0,
  PLAY_5KEYS: 1,
  PLAY_14KEYS: 2,
  PLAY_10KEYS: 3,
  PLAY_9KEYS: 4,
  MUSIC_SELECT: 5,
  DECIDE: 6,
  RESULT: 7,
  KEY_CONFIG: 8,
  SKIN_SELECT: 9,
  COURSE_RESULT: 10,
  GRADE_RESULT: 15,
  PLAY_24KEYS: 16,
  PLAY_24KEYS_DOUBLE: 17,
} as const;

export type BeatorajaSkinTypeName = keyof typeof BEATORAJA_SKIN_TYPE;
export type BeatorajaSkinTypeCode = (typeof BEATORAJA_SKIN_TYPE)[BeatorajaSkinTypeName];

/** Variants the play scene cares about. Mirrors LR2's `Lr2PlayVariant` so call sites can switch on either skin format. */
export const BEATORAJA_PLAY_VARIANTS = ['7', '5', '9', '10', '14', '24', '24d'] as const;
export type BeatorajaPlayVariant = (typeof BEATORAJA_PLAY_VARIANTS)[number];

const TYPE_TO_PLAY_VARIANT: ReadonlyMap<BeatorajaSkinTypeCode, BeatorajaPlayVariant> = new Map([
  [BEATORAJA_SKIN_TYPE.PLAY_7KEYS, '7'],
  [BEATORAJA_SKIN_TYPE.PLAY_5KEYS, '5'],
  [BEATORAJA_SKIN_TYPE.PLAY_9KEYS, '9'],
  [BEATORAJA_SKIN_TYPE.PLAY_10KEYS, '10'],
  [BEATORAJA_SKIN_TYPE.PLAY_14KEYS, '14'],
  [BEATORAJA_SKIN_TYPE.PLAY_24KEYS, '24'],
  [BEATORAJA_SKIN_TYPE.PLAY_24KEYS_DOUBLE, '24d'],
]);

export function playVariantForSkinType(typeCode: number): BeatorajaPlayVariant | undefined {
  return TYPE_TO_PLAY_VARIANT.get(typeCode as BeatorajaSkinTypeCode);
}

/** Logical scene a skin belongs to, derived from `type`. */
export type BeatorajaSkinScene = 'play' | 'select' | 'decide' | 'result' | 'course-result' | 'grade-result' | 'other';

export function sceneForSkinType(typeCode: number): BeatorajaSkinScene {
  if (TYPE_TO_PLAY_VARIANT.has(typeCode as BeatorajaSkinTypeCode)) return 'play';
  switch (typeCode) {
    case BEATORAJA_SKIN_TYPE.MUSIC_SELECT:
      return 'select';
    case BEATORAJA_SKIN_TYPE.DECIDE:
      return 'decide';
    case BEATORAJA_SKIN_TYPE.RESULT:
      return 'result';
    case BEATORAJA_SKIN_TYPE.COURSE_RESULT:
      return 'course-result';
    case BEATORAJA_SKIN_TYPE.GRADE_RESULT:
      return 'grade-result';
    default:
      return 'other';
  }
}

/**
 * Property item exposed in the skin selector UI. Maps to `SkinHeader.CustomOption.OptionItem` in upstream. Picking
 * the item activates the corresponding `op` integer used by `if`/`op` conditional evaluation throughout the skin.
 */
export interface BeatorajaSkinPropertyItem {
  name: string;
  op: number;
}

export interface BeatorajaSkinProperty {
  name: string;
  item: BeatorajaSkinPropertyItem[];
}

export interface BeatorajaSkinFilepath {
  name: string;
  /** Glob pattern relative to the skin directory (e.g. `play/background/*.png`). */
  path: string;
  /** Optional default selection used when the player has not yet chosen a file. */
  def?: string;
}

/** `source[]` entry — a numbered slot that other elements reference via `src`. */
export interface BeatorajaSkinSource {
  id: number;
  /** Path relative to the skin file. May contain a `*` glob (resolved against the actual file map at load time). */
  path: string;
}

export interface BeatorajaSkinFontEntry {
  id: number;
  path: string;
}

/**
 * Header information harvested by the first evaluation pass. The fields beatoraja exposes through
 * `SkinHeader.parse()` plus the property/filepath schemas the user picks from before the second pass runs.
 */
export interface BeatorajaSkinHeader {
  /** Numeric `SkinType` code (see {@link BEATORAJA_SKIN_TYPE}). */
  type: number;
  /** Display name shown in the skin selector. */
  name?: string;
  /** Author name. Optional; many bundled skins omit it. */
  author?: string;
  /** Native skin width in pixels. */
  w: number;
  /** Native skin height in pixels. */
  h: number;
  /**
   * Built-in scene timers (milliseconds since the scene started). The Java side reads these directly into
   * `SkinObject` time fields. Names mirror the upstream JSON keys.
   */
  playstart?: number;
  scene?: number;
  input?: number;
  close?: number;
  fadeout?: number;
  finishmargin?: number;
  property?: BeatorajaSkinProperty[];
  filepath?: BeatorajaSkinFilepath[];
  /** Default note offset in milliseconds. */
  offset?: number;
}

/**
 * Full skin definition produced by the second evaluation pass. Includes the header fields plus the rendering
 * directives. Element arrays follow the upstream JSON keys; we keep them as flexible `unknown` arrays at this layer
 * because the consumer-facing normalization step lives in `beatoraja-skin-element.ts`.
 */
export interface BeatorajaSkin extends BeatorajaSkinHeader {
  source?: BeatorajaSkinSource[];
  font?: BeatorajaSkinFontEntry[];
  image?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  imageset?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  value?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  text?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  slider?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  graph?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  bargraph?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  button?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  destination?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  bga?: Readonly<Record<string, unknown>>;
  judge?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  gauge?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  note?: Readonly<Record<string, unknown>>;
  numbers?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  images?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  nodes?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  hidden?: Readonly<Record<string, unknown>> | ReadonlyArray<Readonly<Record<string, unknown>>>;
  hiddenCover?: Readonly<Record<string, unknown>>;
  disapearLine?: Readonly<Record<string, unknown>>;
  isDisapearLineLinkLift?: boolean | number;
  bpm?: Readonly<Record<string, unknown>>;
  mine?: Readonly<Record<string, unknown>>;
  /** Anything else the skin author dropped in — preserved for forward compatibility. */
  [extra: string]: unknown;
}

/** What the host UI hands back after the user has picked their custom options & files. */
export interface BeatorajaSkinConfig {
  offset?: number;
  /** Map of `property[].name` → chosen `op` integer. */
  option?: Readonly<Record<string, number>>;
  /** Map of `filepath[].name` → chosen relative path. */
  file?: Readonly<Record<string, string>>;
}

/**
 * Build a default `option` map from a skin header's `property[]`. Each property's first item is treated as the
 * "no choice yet" pick — the same behavior beatoraja takes when the player hasn't opened the option dialog. This
 * matters for skins whose Lua `main()` branches on `skin_config.option["Play Side"]` (or similar): without a
 * populated option map every branch fails and the skin returns an incomplete `source[]` / `destination[]`.
 *
 * Returns an empty record when the header has no `property[]`.
 */
export function buildDefaultSkinConfigOptions(
  header: Pick<BeatorajaSkinHeader, 'property'>,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(header.property)) return out;
  for (const property of header.property) {
    if (!property || typeof property.name !== 'string') continue;
    const items = property.item;
    if (!Array.isArray(items) || items.length === 0) continue;
    const first = items[0];
    if (first && typeof first.op === 'number' && Number.isFinite(first.op)) {
      out[property.name] = first.op;
    }
  }
  return out;
}
