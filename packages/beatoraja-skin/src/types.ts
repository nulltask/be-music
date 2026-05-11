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
  SOUND_SET: 10,
  THEME: 11,
  PLAY_7KEYS_BATTLE: 12,
  PLAY_5KEYS_BATTLE: 13,
  PLAY_9KEYS_BATTLE: 14,
  COURSE_RESULT: 15,
  PLAY_24KEYS: 16,
  PLAY_24KEYS_DOUBLE: 17,
  PLAY_24KEYS_BATTLE: 18,
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
export type BeatorajaSkinScene = 'play' | 'select' | 'decide' | 'result' | 'course-result' | 'other';

export function sceneForSkinType(typeCode: number): BeatorajaSkinScene {
  if (TYPE_TO_PLAY_VARIANT.has(typeCode as BeatorajaSkinTypeCode)) return 'play';
  switch (typeCode) {
    case BEATORAJA_SKIN_TYPE.PLAY_7KEYS_BATTLE:
    case BEATORAJA_SKIN_TYPE.PLAY_5KEYS_BATTLE:
    case BEATORAJA_SKIN_TYPE.PLAY_9KEYS_BATTLE:
    case BEATORAJA_SKIN_TYPE.PLAY_24KEYS_BATTLE:
      return 'play';
    case BEATORAJA_SKIN_TYPE.MUSIC_SELECT:
      return 'select';
    case BEATORAJA_SKIN_TYPE.DECIDE:
      return 'decide';
    case BEATORAJA_SKIN_TYPE.RESULT:
      return 'result';
    case BEATORAJA_SKIN_TYPE.COURSE_RESULT:
      return 'course-result';
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
  /** Optional default `item[].name` selected before the player changes this option. */
  def?: string;
  /**
   * Optional category id (e.g. `"main_1"`, `"play_5"`) linking this property to one of the
   * groups declared in {@link BeatorajaSkinHeader.category}. Beatoraja groups options under
   * collapsible category headers in its in-game options dialog; community skins (GdbG_Skin,
   * ModernChic) use this to keep ~20 options manageable. The host UI is responsible for
   * resolving the id back to a display name via the header's `category[]` table.
   */
  category?: string;
  item: BeatorajaSkinPropertyItem[];
}

export interface BeatorajaSkinFilepath {
  name: string;
  /** Glob pattern relative to the skin directory (e.g. `play/background/*.png`). */
  path: string;
  /** Optional default selection used when the player has not yet chosen a file. */
  def?: string;
  /** Optional category id — see {@link BeatorajaSkinProperty.category}. */
  category?: string;
}

/**
 * Category group declared in `header.category[]`. Each entry pairs a display name (e.g.
 * `"Main"`) with the list of category ids (`"main_1"`, `"main_2"`, …) that belong under it.
 * Community skins author these labels in Japanese (e.g. `メイン` for "Main", `プレイ` for
 * "Play") and the host surfaces them verbatim — the values are display strings, not
 * translation keys. `BeatorajaSkinProperty.category` / `BeatorajaSkinFilepath.category`
 * reference these ids; the host UI inverts the mapping to render category-named folders
 * containing their members.
 *
 * Reference-theme skins don't author this — only community skins (GdbG_Skin, ModernChic) do, so
 * the field is optional throughout. Skins without categories render properties / filepaths in a
 * single flat folder.
 */
export interface BeatorajaSkinCategoryGroup {
  /** Display label shown to the user (community skins typically author this in Japanese). */
  name: string;
  /** Category ids that belong under this group. Order matters: members render in this order. */
  item: string[];
}

export interface BeatorajaSkinCustomOffset {
  name: string;
  id: number;
  x: boolean;
  y: boolean;
  w: boolean;
  h: boolean;
  r: boolean;
  a: boolean;
}

export function normalizeBeatorajaSkinCustomOffsets(input: unknown): BeatorajaSkinCustomOffset[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: BeatorajaSkinCustomOffset[] = [];
  for (const entry of input) {
    if (entry === null || typeof entry !== 'object') continue;
    const obj = entry as Readonly<Record<string, unknown>>;
    const name = obj.name;
    const id = obj.id;
    if (typeof name !== 'string' || name.length === 0) continue;
    if (typeof id !== 'number' || !Number.isFinite(id)) continue;
    out.push({
      name,
      id: Math.trunc(id),
      x: boolField(obj.x),
      y: boolField(obj.y),
      w: boolField(obj.w),
      h: boolField(obj.h),
      r: boolField(obj.r),
      a: boolField(obj.a),
    });
  }
  return out;
}

function boolField(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return false;
}

/**
 * `source[]` entry — a slot that other elements reference via `src`. Beatoraja allows BOTH
 * numeric ids (the LR2-style `0`, `1`, `2`, …) AND symbolic string ids (`"bg"`, `"notes_src"`,
 * `"keybeam_src"`, …). The reference theme uses numeric ids; community skins like GdbG_Skin use
 * string ids exclusively. Both shapes are valid in beatoraja's loader.
 */
export type BeatorajaSkinSourceId = number | string;

export interface BeatorajaSkinSource {
  id: BeatorajaSkinSourceId;
  /** Path relative to the skin file. May contain a `*` glob (resolved against the actual file map at load time). */
  path: string;
}

/** `font[].id` / `text[].font` can be numeric or symbolic, matching beatoraja's string-backed JSON fields. */
export type BeatorajaSkinFontId = number | string;

export interface BeatorajaSkinFontEntry {
  id: BeatorajaSkinFontId;
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
  /** Custom offset schema exposed by the skin. Runtime note-offset belongs to `BeatorajaSkinConfig.offset`. */
  offset?: BeatorajaSkinCustomOffset[];
  /**
   * Optional category groups for the property / filepath UI — see
   * {@link BeatorajaSkinCategoryGroup}. Reference-theme skins omit this and the host renders a
   * flat options panel; GdbG_Skin and ModernChic populate it to group their ~20 options under
   * Japanese-authored headings such as "Main" / "Play" (`メイン` / `プレイ`).
   */
  category?: BeatorajaSkinCategoryGroup[];
}

/**
 * Full skin definition produced by the second evaluation pass. Includes the header fields plus the rendering
 * directives. Element arrays follow the upstream JSON keys; we keep them as flexible `unknown` arrays at this layer
 * because the consumer-facing normalization step lives in `elements/base.ts`.
 */
export interface BeatorajaSkin extends BeatorajaSkinHeader {
  source?: BeatorajaSkinSource[];
  font?: BeatorajaSkinFontEntry[];
  image?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  imageset?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  value?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /**
   * Decimal-number declarations. Mirrors `JsonSkin.FloatValue[]`. Same digit-strip layout as
   * `value[]` plus `iketa` / `fketa` / `gain` / `isSignvisible` for the formatted output. The
   * result and decide scenes use these for BPM (`123.4`), accuracy percentages (`98.76 %`),
   * and timing deltas (`+5.23 ms`). Renderer: integer half + decimal-point glyph + fractional
   * half painted side-by-side via `composeBeatorajaFloatValueCells`.
   */
  floatvalue?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  text?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  slider?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  graph?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  bargraph?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /**
   * Specialized chart-data graphs. Each plots dynamic data over its destination box rather than
   * scaling a source-image sub-rect. See `elements/bpm-graph.ts` (and its peers, when those
   * land) for the per-element shape.
   */
  bpmgraph?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  judgegraph?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  gaugegraph?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  timingvisualizer?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /**
   * Variant of `timingvisualizer` that some community skins (ModernChic) author for the
   * "hit-error" graph beneath the play area. Same shape as {@link timingvisualizer} — recent
   * judgement deltas plotted against time. Schema-compatible so the existing
   * `BeatorajaTimingVisualizerElement` normalization can consume both fields.
   */
  hiterrorvisualizer?: ReadonlyArray<Readonly<Record<string, unknown>>>;
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
  /**
   * Hidden-cover declarations. Reference theme uses the singular object form
   * (`hiddenCover = {id="...", src=N, ...}`); community skins (ModernChic) author the array
   * form (`hiddenCover = {{id="...", ...}, {id="...", ...}}`) for multiple cover layers.
   * Both shapes flow through the renderer's hidden-cover pipeline.
   */
  hiddenCover?: Readonly<Record<string, unknown>> | ReadonlyArray<Readonly<Record<string, unknown>>>;
  /**
   * Lift-cover declarations. ModernChic-pattern: covers that follow the lift slider but with
   * different artwork from the hidden-cover (lift = the bottom-edge cover, hidden = the
   * top-edge cover). Array shape mirroring `hiddenCover[]`.
   */
  liftCover?: Readonly<Record<string, unknown>> | ReadonlyArray<Readonly<Record<string, unknown>>>;
  /**
   * `pmchara[]` — POMYU character display block authored on the popn-style 9K skin
   * (`type=4` `play9.json`). Each entry pairs a destination id with a `source[]` slot that
   * supplies frame images for the dancing-character animation. Schema lives in
   * `elements/pm-chara.ts`; the renderer treats entries as static sprites for now until
   * frame-cycling animation support lands.
   */
  pmchara?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  disapearLine?: Readonly<Record<string, unknown>>;
  isDisapearLineLinkLift?: boolean | number;
  bpm?: Readonly<Record<string, unknown>>;
  mine?: Readonly<Record<string, unknown>>;
  /**
   * Skin-driven event triggers (audit 2.2). Each entry pairs a `condition` (boolean Lua
   * function or numeric op id) with an `action` (Lua function fired when condition flips
   * true) and an optional `minInterval` rate-limit. The host invokes the matching actions
   * each frame via the runtime adapter — see `evaluateBeatorajaCustomEvents` in the
   * scene-tick path. ModernChic uses these heavily for SE triggers (full-combo voice,
   * IR-rank-update notifications, panel-toggle transitions).
   */
  customEvents?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /**
   * Skin-driven timer triggers (audit 2.2). Each entry pairs a numeric `id` with a `timer`
   * Lua function — when the function returns true (or a non-off microsecond timestamp), the
   * host stamps the matching engine timer slot. Used by skins to drive per-frame keyframe
   * animations from a scripted condition the engine doesn't track natively.
   */
  customTimers?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** Anything else the skin author dropped in — preserved for forward compatibility. */
  [extra: string]: unknown;
}

/** What the host UI hands back after the user has picked their custom options & files. */
export interface BeatorajaSkinConfig {
  /**
   * Chart timing offset in ms — applied to note timing by the engine, not by the skin.
   * Lua-side `skin_config.offset[name]` does NOT read this value; it's a host-side concern.
   * Range conventionally `[-200, 200]`. Defaults to `0`.
   */
  offset?: number;
  /**
   * User picks for the skin's `header.offset[]` declared customization slots. Keyed by
   * `BeatorajaSkinCustomOffset.name`; each value carries the axis deltas the user adjusted
   * via the skin-options panel. ModernChic and other community skins author dozens of
   * `header.offset[]` entries (e.g. `"main_brightness"`, `"info_panel_x"`,
   * `"playarea_w"`) and read them at draw time via Lua closures like
   * `function() return skin_config.offset[name].a end`.
   *
   * The Lua bridge surfaces this map as `skin_config.offset` (a NAME-KEYED TABLE distinct
   * from the chart-timing number above). Hosts populate this from the GUI's per-axis
   * sliders driven by `header.offset[]`. Empty / undefined = every slot returns its
   * default zero record via the table's `__index` metatable.
   */
  customOffset?: Readonly<Record<string, Readonly<Partial<BeatorajaSkinOffsetAxes>>>>;
  /** Map of `property[].name` → chosen `op` integer. */
  option?: Readonly<Record<string, number>>;
  /** Map of `filepath[].name` → chosen relative path. */
  file?: Readonly<Record<string, string>>;
}

/**
 * Per-axis offset deltas the user authored through the skin-options panel. Same shape as
 * `BeatorajaSkinOffsetValue` (in `./elements/destination.ts`), repeated here to avoid
 * pulling that module into the types layer's import graph. Positive values shift in the
 * libGDX-positive direction (x right, y up); alpha is an additive delta in `[-255, 255]`.
 */
export interface BeatorajaSkinOffsetAxes {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  a: number;
}

/**
 * Pick the default `op` for a single `property[]` entry. Beatoraja first tries `property.def` as an
 * `item[].name` lookup, then falls back to the first authored item when `def` is missing or stale.
 */
export function defaultOpForBeatorajaSkinProperty(property: BeatorajaSkinProperty): number | undefined {
  const items = property.item;
  if (!Array.isArray(items) || items.length === 0) return undefined;
  const namedDefault =
    typeof property.def === 'string'
      ? items.find((item) => item?.name === property.def && typeof item.op === 'number' && Number.isFinite(item.op))
      : undefined;
  const selected = namedDefault ?? items[0];
  return selected && typeof selected.op === 'number' && Number.isFinite(selected.op) ? selected.op : undefined;
}

/**
 * Build a default `option` map from a skin header's `property[]`. Each property honors its `def` field when present,
 * falling back to the first item — the same behavior beatoraja takes when the player hasn't opened the option dialog.
 * This matters for skins whose Lua `main()` branches on `skin_config.option["Play Side"]` (or similar): without a
 * populated option map every branch fails and the skin returns an incomplete `source[]` / `destination[]`.
 *
 * Returns an empty record when the header has no `property[]`.
 */
export function buildDefaultSkinConfigOptions(header: Pick<BeatorajaSkinHeader, 'property'>): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(header.property)) return out;
  for (const property of header.property) {
    if (!property || typeof property.name !== 'string') continue;
    const op = defaultOpForBeatorajaSkinProperty(property);
    if (op !== undefined) out[property.name] = op;
  }
  return out;
}
