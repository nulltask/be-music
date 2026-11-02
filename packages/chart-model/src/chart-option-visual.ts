/**
 * Chart-authored display families beyond HI-SPEED (#843, #931): HIDDEN, CHANGE-HS and the visual CRAZY subfamilies.
 * The nanasigroove sources name these options but give no thresholds, curves, periods or distributions, so every number
 * here is Be-Music's own documented formula (docs/adr/0032-chart-authored-visual-families.md and
 * docs/adr/0034-chart-authored-skin-level-options.md), not a native parity claim.
 *
 * Runtime-neutral and deterministic: "random" values come from a stable hash of the lane channel, the note's beat and
 * the chart clock, never from `Math.random`, so a seek, a replay and every host draw the same picture.
 */

import { chartChannelHash, chartNoteSeed, chartVisualHash01 } from './chart-option-hash.ts';
import {
  CHART_CRAZY_V3_FIELD_VALUES,
  CHART_CRAZY_V3_FIELDS,
  CHART_CRAZY_WAVE_V3_OPTIONS,
  resolveChartCrazyClones,
  resolveChartCrazyField,
  resolveChartCrazyRotation,
  resolveChartCrazyTint,
  resolveChartCrazyWaveScale,
  resolveChartCrazyYProgress,
  type ChartCrazyOptionField,
  type ChartCrazyOptionFields,
  type ChartNoteClone,
} from './chart-option-crazy.ts';

export const CHART_HIDDEN_OPTIONS = [
  'HIDDEN',
  'HIDDEN2',
  'HIDDEN3',
  'SUDDEN',
  'SUDDEN2',
  'SUDDEN3',
  'HID-SUD',
  'HID-SUD2',
  'HID-SUD3',
  'MIST',
  'DEEPMIST',
  'BLINK',
  'BLINK2',
  'STEALTH',
  // Version 3 (#931): the player's own SUDDEN+ cover, shown and moved by the player.
  'M-SUDDEN',
] as const;
export type ChartHiddenOption = (typeof CHART_HIDDEN_OPTIONS)[number];

export const CHART_CHANGE_HS_OPTIONS = [
  'ACCEL',
  'BRAKE',
  'LINE',
  'NAZO',
  'NAZO2',
  'RANDOM',
  'COMBO-UP',
  'COMBO-DN',
  'COMBO-RD',
  'LINENAZO',
  'WARP',
  'S-WARP',
  'LINE2',
  'LINEACCEL',
  'CHAOS',
  'RANDOM2',
] as const;
export type ChartChangeHSOption = (typeof CHART_CHANGE_HS_OPTIONS)[number];

/** CRAZY size subfamily: at most one is active; a later one replaces an earlier one. */
export const CHART_CRAZY_SIZE_OPTIONS = ['SMALL', 'BIG', 'FADEIN', 'FADEOUT', 'RD-SIZE'] as const;
export type ChartCrazySizeOption = (typeof CHART_CRAZY_SIZE_OPTIONS)[number];
/** CRAZY wave subfamily: the X waves of version 2 and the Y / XY / 3D waves of version 3. */
export const CHART_CRAZY_WAVE_OPTIONS = [
  'XWAVE',
  'XWAVE2',
  'YWAVE',
  'YWAVE2',
  'XYWAVE',
  'XYWAVE2',
  '3DWAVE',
  '3DWAVE2',
] as const;
export type ChartCrazyWaveOption = (typeof CHART_CRAZY_WAVE_OPTIONS)[number];

/** The effective display fields these families add to a chart option state. */
export interface ChartVisualOptionFields extends ChartCrazyOptionFields {
  hidden?: ChartHiddenOption;
  changeHS?: ChartChangeHSOption;
  crazySize?: ChartCrazySizeOption;
  crazyWave?: ChartCrazyWaveOption;
}
export type ChartVisualOptionField = keyof ChartVisualOptionFields;

/** Values of the version-2 fields that only version 3 may hold. */
const VERSION_3_VALUES: ReadonlySet<string> = new Set(['M-SUDDEN', ...CHART_CRAZY_WAVE_V3_OPTIONS]);

/**
 * How one modern `774:` declaration of these families changes the effective state: the fields it sets, the fields it
 * clears (`*_OFF`, `CRAZY_OFF`), or `undefined` when it is not one of the executed families.
 */
export interface ChartVisualOptionPatch {
  set: ChartVisualOptionFields;
  clear: ChartVisualOptionField[];
}

function includes<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

/** Parse an exact-case modern declaration of an executed visual family. Legacy aliases are not accepted. */
export function parseChartVisualOption(declaration: string): ChartVisualOptionPatch | undefined {
  const match = /^774:(HIDDEN|CHANGE-HS|CRAZY)_(.+)$/.exec(declaration);
  if (!match) return undefined;
  const [, family, value] = match as unknown as [string, string, string];
  if (family === 'HIDDEN') {
    if (value === 'OFF') return { set: {}, clear: ['hidden'] };
    return includes(CHART_HIDDEN_OPTIONS, value) ? { set: { hidden: value }, clear: [] } : undefined;
  }
  if (family === 'CHANGE-HS') {
    if (value === 'OFF') return { set: {}, clear: ['changeHS'] };
    return includes(CHART_CHANGE_HS_OPTIONS, value) ? { set: { changeHS: value }, clear: [] } : undefined;
  }
  if (value === 'OFF') return { set: {}, clear: ['crazySize', 'crazyWave', ...CHART_CRAZY_V3_FIELDS] };
  if (includes(CHART_CRAZY_SIZE_OPTIONS, value)) return { set: { crazySize: value }, clear: [] };
  if (includes(CHART_CRAZY_WAVE_OPTIONS, value)) return { set: { crazyWave: value }, clear: [] };
  const field = resolveChartCrazyField(value);
  return field === undefined ? undefined : { set: { [field]: value }, clear: [] };
}

/**
 * Validates one recorded visual field value (replay parsing) against the program profile `version` it was recorded
 * with (default: the newest), so a version-2 recording can never carry a version-3 value.
 */
export function isChartVisualOptionValue(field: ChartVisualOptionField, value: unknown, version: 2 | 3 = 3): boolean {
  if (typeof value !== 'string') return false;
  if (version === 2 && (VERSION_3_VALUES.has(value) || !VERSION_2_FIELDS.includes(field))) return false;
  switch (field) {
    case 'hidden':
      return includes(CHART_HIDDEN_OPTIONS, value);
    case 'changeHS':
      return includes(CHART_CHANGE_HS_OPTIONS, value);
    case 'crazySize':
      return includes(CHART_CRAZY_SIZE_OPTIONS, value);
    case 'crazyWave':
      return includes(CHART_CRAZY_WAVE_OPTIONS, value);
    default:
      return CHART_CRAZY_V3_FIELD_VALUES[field as ChartCrazyOptionField].includes(value);
  }
}
const VERSION_2_FIELDS: readonly ChartVisualOptionField[] = ['hidden', 'changeHS', 'crazySize', 'crazyWave'];
/** Every visual field of the newest profile. */
export const CHART_VISUAL_OPTION_FIELDS: readonly ChartVisualOptionField[] = [
  ...VERSION_2_FIELDS,
  ...CHART_CRAZY_V3_FIELDS,
];
/** The visual fields a program of profile `version` may hold. */
export function chartVisualOptionFieldsOf(version: 1 | 2 | 3): readonly ChartVisualOptionField[] {
  return version === 1 ? [] : version === 2 ? VERSION_2_FIELDS : CHART_VISUAL_OPTION_FIELDS;
}

/**
 * True when `state` changes how each note draws (HIDDEN other than M-SUDDEN, CHANGE-HS, CRAZY size, wave, STAR, SPIN,
 * CLONE). The playfield-level families are `hasChartPlayfieldVisual`'s.
 */
export function hasChartVisualOptions(state: ChartVisualOptionFields | undefined): boolean {
  return (
    state !== undefined &&
    ((state.hidden !== undefined && state.hidden !== 'M-SUDDEN') ||
      state.changeHS !== undefined ||
      state.crazySize !== undefined ||
      state.crazyWave !== undefined ||
      state.crazyColor !== undefined ||
      state.crazySpin !== undefined ||
      state.crazyClone !== undefined)
  );
}

/** Where a note stands and the clocks the formulas read. */
export interface ChartNoteVisualInput {
  /**
   * Approach progress before CHANGE-HS: 0 on the judgement line, 1 at the lane top, past 1 above it; negative below the
   * line (a note LR2's rules hold there reads as 0).
   */
  progress: number;
  /** The note's lane channel (`11`..`29`, ...), for per-lane values. */
  channel: string;
  /** The note's chart beat, for per-note values. */
  beat: number;
  /** Display chart seconds (the engine's chart clock), for time-varying values. */
  seconds: number;
  /** The combo running now, for the COMBO-* families. */
  combo?: number;
}

/**
 * What a renderer applies to one note. Identity: `{ progress: input.progress, alpha: 1, scale: 1, xOffset: 0,
 * rotation: 0, clones: [] }` without `tint`.
 */
export interface ChartNoteVisual {
  /** Displayed approach progress after CHANGE-HS (same scale as the input). */
  progress: number;
  /** Opacity multiplier in [0, 1] from HIDDEN; a renderer skips a note at 0. */
  alpha: number;
  /** Size multiplier from CRAZY size, about the lane's centre and the note's bottom edge. */
  scale: number;
  /** Horizontal offset from CRAZY wave, in lane widths (positive = right). */
  xOffset: number;
  /** STAR: a colour multiplied into the note (`0xRRGGBB`); absent = the note's own colour. */
  tint?: number;
  /** SPIN: rotation in radians about the note's centre. */
  rotation: number;
  /** CLONE: afterimages drawn with the note, behind it. */
  clones: readonly ChartNoteClone[];
}

/** Width of the linear fade at a HIDDEN / SUDDEN edge, in progress units. */
export const CHART_HIDDEN_FADE = 0.05;
/** HIDDEN family edges in progress units (Be-Music values). */
const HIDDEN_FLOOR: Partial<Record<ChartHiddenOption, number>> = { HIDDEN: 0.3, HIDDEN2: 0.45, HIDDEN3: 0.6 };
const SUDDEN_CEILING: Partial<Record<ChartHiddenOption, number>> = { SUDDEN: 0.7, SUDDEN2: 0.55, SUDDEN3: 0.4 };
const HID_SUD_HALF_BAND: Partial<Record<ChartHiddenOption, number>> = {
  'HID-SUD': 0.15,
  'HID-SUD2': 0.1,
  'HID-SUD3': 0.05,
};
const BLINK_PERIOD_SECONDS: Partial<Record<ChartHiddenOption, number>> = { BLINK: 2, BLINK2: 4 };

function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

/** The note's identity seed: its lane and its beat at microbeat precision. */
function noteSeed(input: ChartNoteVisualInput): [number, number] {
  return chartNoteSeed(input);
}

/** ACCEL / BRAKE shape: fixed at 0 and 1, speed 1 ± 0.5 at the line, 1 ∓ 0.5 at the top. */
function bend(progress: number, amount: number): number {
  if (progress <= 0 || progress >= 1) return progress;
  return progress + amount * progress * (1 - progress);
}

const COMBO_FULL = 200;
const WARP_STEP_SECONDS = 2;

/**
 * The CHANGE-HS speed factor `k` (always ≥ 1, so a note never pops in below the lane top) and the bend applied after
 * it. Displayed progress is `bend(progress * k)` for progress ≥ 0.
 */
function changeHSFactor(option: ChartChangeHSOption, input: ChartNoteVisualInput): { k: number; bend: number } {
  const lane = chartChannelHash(input.channel);
  const [laneSeed, beatSeed] = noteSeed(input);
  const combo = Math.max(0, input.combo ?? 0);
  const comboRatio = Math.min(1, combo / COMBO_FULL);
  const step = Math.floor(input.seconds / WARP_STEP_SECONDS);
  const line = () => 1 + chartVisualHash01(lane, 1);
  const line2 = () => 1 + chartVisualHash01(lane, step, 2);
  const nazo = (phase = 0) => 1.25 + 0.25 * Math.sin(2 * Math.PI * (input.seconds / 4 + phase));
  const random = () => 1 + chartVisualHash01(laneSeed, beatSeed, 3);
  const warp = () => 1 + chartVisualHash01(step, 4);
  switch (option) {
    case 'ACCEL':
      return { k: 1, bend: 0.5 };
    case 'BRAKE':
      return { k: 1, bend: -0.5 };
    case 'LINE':
      return { k: line(), bend: 0 };
    case 'NAZO':
      return { k: nazo(), bend: 0 };
    case 'NAZO2':
      return { k: 1.5 + 0.5 * Math.sin((2 * Math.PI * input.seconds) / 3), bend: 0 };
    case 'RANDOM':
      return { k: random(), bend: 0 };
    case 'COMBO-UP':
      return { k: 1 + comboRatio, bend: 0 };
    case 'COMBO-DN':
      return { k: 2 - comboRatio, bend: 0 };
    case 'COMBO-RD':
      return { k: 1 + comboRatio * chartVisualHash01(laneSeed, beatSeed, 3), bend: 0 };
    case 'LINENAZO':
      return { k: nazo(chartVisualHash01(lane, 5)), bend: 0 };
    case 'WARP':
      return { k: warp(), bend: 0 };
    case 'S-WARP':
      return { k: (line() + warp()) / 2, bend: 0 };
    case 'LINE2':
      return { k: line2(), bend: 0 };
    case 'LINEACCEL':
      return { k: line2(), bend: 0.5 };
    case 'CHAOS':
      return { k: (line2() + nazo() + random()) / 3, bend: 0 };
    case 'RANDOM2':
      return { k: random(), bend: chartVisualHash01(laneSeed, beatSeed, 6) < 0.5 ? 0.5 : -0.5 };
  }
}

/** Displayed progress after CHANGE-HS. Monotonic in `progress` for one note, so a long note's tail stays above its head. */
export function resolveChartChangeHSProgress(
  option: ChartChangeHSOption | undefined,
  input: ChartNoteVisualInput,
): number {
  if (option === undefined || !(input.progress > 0)) return input.progress;
  const { k, bend: amount } = changeHSFactor(option, input);
  return bend(input.progress * k, amount);
}

/** HIDDEN opacity at displayed progress `progress` and chart time `seconds`. */
export function resolveChartHiddenAlpha(
  option: ChartHiddenOption | undefined,
  progress: number,
  seconds: number,
): number {
  if (option === undefined || option === 'M-SUDDEN') return 1;
  const at = Math.max(0, progress);
  const floor = HIDDEN_FLOOR[option];
  if (floor !== undefined) return clamp01((at - floor) / CHART_HIDDEN_FADE);
  const ceiling = SUDDEN_CEILING[option];
  if (ceiling !== undefined) return clamp01((ceiling - at) / CHART_HIDDEN_FADE);
  const halfBand = HID_SUD_HALF_BAND[option];
  if (halfBand !== undefined) return clamp01((halfBand - Math.abs(at - 0.5)) / CHART_HIDDEN_FADE);
  const period = BLINK_PERIOD_SECONDS[option];
  if (period !== undefined) return 0.5 + 0.5 * Math.cos((2 * Math.PI * seconds) / period);
  if (option === 'MIST') return 0.35;
  if (option === 'DEEPMIST') return 0.1;
  return 0; // STEALTH
}

/** CRAZY size multiplier at displayed progress. */
export function resolveChartCrazyScale(option: ChartCrazySizeOption | undefined, input: ChartNoteVisualInput): number {
  if (option === undefined) return 1;
  const near = 1 - clamp01(input.progress);
  switch (option) {
    case 'SMALL':
      return 0.6;
    case 'BIG':
      return 1.4;
    case 'FADEIN':
      return 0.4 + 0.6 * near;
    case 'FADEOUT':
      return 1 - 0.6 * near;
    case 'RD-SIZE':
      return 0.5 + chartVisualHash01(...noteSeed(input), 7);
  }
}

/** Triangle wave in [-1, 1] with period 1, 0 at 0. */
function triangle(x: number): number {
  const phase = x - Math.floor(x);
  return phase < 0.25 ? 4 * phase : phase < 0.75 ? 2 - 4 * phase : 4 * phase - 4;
}

/**
 * CRAZY X-wave offset in lane widths at displayed progress: a zigzag that lands centred on the line. `XYWAVE` /
 * `XYWAVE2` sway as `XWAVE` / `XWAVE2`; the other waves do not sway.
 */
export function resolveChartCrazyXOffset(option: ChartCrazyWaveOption | undefined, progress: number): number {
  const at = Math.max(0, progress);
  if (option === 'XWAVE' || option === 'XYWAVE') return 0.25 * triangle(2 * at);
  if (option === 'XWAVE2' || option === 'XYWAVE2') return 0.5 * triangle(3 * at);
  return 0;
}

/** Every family at once, for one note. */
export function resolveChartNoteVisual(
  state: ChartVisualOptionFields | undefined,
  input: ChartNoteVisualInput,
): ChartNoteVisual {
  if (!hasChartVisualOptions(state))
    return { progress: input.progress, alpha: 1, scale: 1, xOffset: 0, rotation: 0, clones: [] };
  const visual = state!;
  // CHANGE-HS first, then the Y wave on its result: both are monotonic, so a long note's tail stays above its head.
  const progress = resolveChartCrazyYProgress(visual.crazyWave, resolveChartChangeHSProgress(visual.changeHS, input));
  const displayed = { ...input, progress };
  const tint = resolveChartCrazyTint(visual.crazyColor, input);
  return {
    progress,
    alpha: resolveChartHiddenAlpha(visual.hidden, progress, input.seconds),
    scale: resolveChartCrazyScale(visual.crazySize, displayed) * resolveChartCrazyWaveScale(visual.crazyWave, progress),
    xOffset: resolveChartCrazyXOffset(visual.crazyWave, progress),
    ...(tint !== undefined ? { tint } : {}),
    rotation: resolveChartCrazyRotation(visual.crazySpin, input),
    clones: resolveChartCrazyClones(visual.crazyClone, progress),
  };
}
