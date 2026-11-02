/**
 * The chart-authored CRAZY options of program profile version 3 (#931): the per-note STAR, SPIN, CLONE and Y / XY / 3D
 * wave effects, and the playfield-level LINEMOVE, HIDJUDGE, DARK and REVERSE (with HIDDEN's interactive M-SUDDEN
 * cover). nanasigroove names them and describes each in a sentence, but gives no period, amplitude, colour or layout,
 * so every number here is Be-Music's own documented formula (docs/adr/0034-chart-authored-skin-level-options.md), not
 * a native parity claim.
 *
 * Runtime-neutral and deterministic: per-note variety comes from a stable hash of the note's lane and beat, and
 * animation from the engine's display chart clock, never from `Math.random` or a wall clock.
 */

import { chartNoteSeed, chartVisualHash01 } from './chart-option-hash.ts';

/** CRAZY colour subfamily: `STAR` makes notes glitter in rainbow colours. */
export const CHART_CRAZY_COLOR_OPTIONS = ['STAR'] as const;
export type ChartCrazyColorOption = (typeof CHART_CRAZY_COLOR_OPTIONS)[number];
/** CRAZY rotation subfamily. */
export const CHART_CRAZY_SPIN_OPTIONS = ['SPIN'] as const;
export type ChartCrazySpinOption = (typeof CHART_CRAZY_SPIN_OPTIONS)[number];
/** CRAZY afterimage subfamily. */
export const CHART_CRAZY_CLONE_OPTIONS = ['CLONE', 'CLONE2', 'S-CLONE'] as const;
export type ChartCrazyCloneOption = (typeof CHART_CRAZY_CLONE_OPTIONS)[number];
/** CRAZY judgement-line subfamily. */
export const CHART_CRAZY_LINE_OPTIONS = ['LINEMOVE', 'LINEMOVE2'] as const;
export type ChartCrazyLineOption = (typeof CHART_CRAZY_LINE_OPTIONS)[number];
/** CRAZY judge-display subfamily. */
export const CHART_CRAZY_JUDGE_OPTIONS = ['HIDJUDGE'] as const;
export type ChartCrazyJudgeOption = (typeof CHART_CRAZY_JUDGE_OPTIONS)[number];
/** CRAZY screen-element subfamily. */
export const CHART_CRAZY_DARK_OPTIONS = ['DARK', 'DARK2'] as const;
export type ChartCrazyDarkOption = (typeof CHART_CRAZY_DARK_OPTIONS)[number];
/** CRAZY orientation subfamily. */
export const CHART_CRAZY_REVERSE_OPTIONS = ['REVERSE'] as const;
export type ChartCrazyReverseOption = (typeof CHART_CRAZY_REVERSE_OPTIONS)[number];
/** The wave values version 3 adds to the CRAZY wave subfamily (version 2 holds `XWAVE` / `XWAVE2`). */
export const CHART_CRAZY_WAVE_V3_OPTIONS = ['YWAVE', 'YWAVE2', 'XYWAVE', 'XYWAVE2', '3DWAVE', '3DWAVE2'] as const;

/** The version-3 CRAZY fields of a chart option state, each its own exclusive subfamily. */
export interface ChartCrazyOptionFields {
  crazyColor?: ChartCrazyColorOption;
  crazySpin?: ChartCrazySpinOption;
  crazyClone?: ChartCrazyCloneOption;
  crazyLine?: ChartCrazyLineOption;
  crazyJudge?: ChartCrazyJudgeOption;
  crazyDark?: ChartCrazyDarkOption;
  crazyReverse?: ChartCrazyReverseOption;
}
export type ChartCrazyOptionField = keyof ChartCrazyOptionFields;

/** Each version-3 CRAZY field and its values. */
export const CHART_CRAZY_V3_FIELD_VALUES: Readonly<Record<ChartCrazyOptionField, readonly string[]>> = {
  crazyColor: CHART_CRAZY_COLOR_OPTIONS,
  crazySpin: CHART_CRAZY_SPIN_OPTIONS,
  crazyClone: CHART_CRAZY_CLONE_OPTIONS,
  crazyLine: CHART_CRAZY_LINE_OPTIONS,
  crazyJudge: CHART_CRAZY_JUDGE_OPTIONS,
  crazyDark: CHART_CRAZY_DARK_OPTIONS,
  crazyReverse: CHART_CRAZY_REVERSE_OPTIONS,
};
export const CHART_CRAZY_V3_FIELDS = Object.keys(CHART_CRAZY_V3_FIELD_VALUES) as readonly ChartCrazyOptionField[];

/** The version-3 CRAZY field a `774:CRAZY_<value>` sets, or `undefined` for a value outside them. */
export function resolveChartCrazyField(value: string): ChartCrazyOptionField | undefined {
  return CHART_CRAZY_V3_FIELDS.find((field) => CHART_CRAZY_V3_FIELD_VALUES[field].includes(value));
}

function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
}
function fraction(value: number): number {
  return value - Math.floor(value);
}

/** Y-wave shape: `n` stops between the lane top and the line, `a` the depth of each stop (1 = a full stop). */
const Y_WAVE: Readonly<Record<string, { n: number; a: number }>> = {
  YWAVE: { n: 3, a: 0.8 },
  XYWAVE: { n: 3, a: 0.8 },
  YWAVE2: { n: 5, a: 1 },
  XYWAVE2: { n: 5, a: 1 },
};

/**
 * Displayed progress after a Y wave (`YWAVE*`, `XYWAVE*`): `p − a · sin(2πnp) / (2πn)` for `p > 0`. Its slope
 * `1 − a · cos(2πnp)` never goes below 0, so a note stops and goes without moving back, a long note's tail stays above
 * its head, and the wave is fixed on the line and at the lane top. Identity for the other waves.
 */
export function resolveChartCrazyYProgress(option: string | undefined, progress: number): number {
  const wave = option === undefined ? undefined : Y_WAVE[option];
  if (wave === undefined || !(progress > 0)) return progress;
  const omega = 2 * Math.PI * wave.n;
  return progress - (wave.a * Math.sin(omega * progress)) / omega;
}

/** 3D-wave size multiplier at displayed progress: `1 + 0.3 sin(4πp)` / `1 + 0.5 sin(6πp)`, 1 on the line. */
export function resolveChartCrazyWaveScale(option: string | undefined, progress: number): number {
  const at = Math.max(0, progress);
  if (option === '3DWAVE') return 1 + 0.3 * Math.sin(4 * Math.PI * at);
  if (option === '3DWAVE2') return 1 + 0.5 * Math.sin(6 * Math.PI * at);
  return 1;
}

/** Seconds one STAR colour cycle takes. */
const STAR_PERIOD_SECONDS = 1.5;

/** A hue in [0, 1) as an `0xRRGGBB` colour at saturation 0.55 and full value, so a white note keeps its highlight. */
function hueToRGB(hue: number): number {
  const saturation = 0.55;
  const sector = fraction(hue) * 6;
  const index = Math.floor(sector);
  const f = sector - index;
  const p = 1 - saturation;
  const q = 1 - saturation * f;
  const t = 1 - saturation * (1 - f);
  const [r, g, b] = (
    [
      [1, t, p],
      [q, 1, p],
      [p, 1, t],
      [p, q, 1],
      [t, p, 1],
      [1, p, q],
    ] as const
  )[index % 6]!;
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

/** The note identity the per-note CRAZY formulas read. */
export interface ChartCrazyNoteInput {
  readonly channel: string;
  readonly beat: number;
  /** Display chart seconds. */
  readonly seconds: number;
}

/**
 * STAR tint (`0xRRGGBB`, multiplied into the note): hue `frac(t / 1.5 + hash(note))`, so each note cycles through
 * the rainbow every 1.5 s from its own phase. `undefined` without STAR.
 */
export function resolveChartCrazyTint(
  option: ChartCrazyColorOption | undefined,
  note: ChartCrazyNoteInput,
): number | undefined {
  if (option === undefined) return undefined;
  return hueToRGB(note.seconds / STAR_PERIOD_SECONDS + chartVisualHash01(...chartNoteSeed(note), 8));
}

/** SPIN rotation in radians about the note's centre: one clockwise turn per second, `2π · frac(t + hash(note))`. */
export function resolveChartCrazyRotation(option: ChartCrazySpinOption | undefined, note: ChartCrazyNoteInput): number {
  if (option === undefined) return 0;
  return 2 * Math.PI * fraction(note.seconds + chartVisualHash01(...chartNoteSeed(note), 9));
}

/** One afterimage of a note: where it stands (displayed progress), its sideways offset and its opacity multiplier. */
export interface ChartNoteClone {
  /** Displayed progress of the afterimage (0 = judgement line, 1 = lane top). */
  progress: number;
  /** Horizontal offset in lane widths, added to the note's own. */
  xOffset: number;
  /** Opacity multiplier, applied on top of the note's own. */
  alpha: number;
}

/** How far behind (above) its note a CLONE afterimage trails, in progress units. */
const CLONE_TRAIL = 0.08;

/**
 * The afterimages of a note at displayed progress `progress`:
 * - `CLONE`: one trailing `0.08` behind (above) the note at opacity 0.4.
 * - `CLONE2`: also one a lane width to each side at opacity 0.3.
 * - `S-CLONE`: also one rising from the line (`1 − p`) and two closing in diagonally (`±1.5p` lane widths), each at
 *   opacity 0.25, all landing on the note at the line.
 */
export function resolveChartCrazyClones(
  option: ChartCrazyCloneOption | undefined,
  progress: number,
): readonly ChartNoteClone[] {
  if (option === undefined) return [];
  const at = Math.max(0, progress);
  const clones: ChartNoteClone[] = [{ progress: at + CLONE_TRAIL, xOffset: 0, alpha: 0.4 }];
  if (option === 'CLONE') return clones;
  clones.push({ progress: at, xOffset: -1, alpha: 0.3 }, { progress: at, xOffset: 1, alpha: 0.3 });
  if (option === 'CLONE2') return clones;
  if (at <= 1) clones.push({ progress: 1 - at, xOffset: 0, alpha: 0.25 });
  clones.push({ progress: at, xOffset: 1.5 * at, alpha: 0.25 }, { progress: at, xOffset: -1.5 * at, alpha: 0.25 });
  return clones;
}

/** LINEMOVE amplitude (fraction of the lane) and period (seconds). */
const LINE_MOVE: Readonly<Record<ChartCrazyLineOption, { amplitude: number; periodSeconds: number }>> = {
  LINEMOVE: { amplitude: 0.15, periodSeconds: 4 },
  LINEMOVE2: { amplitude: 0.35, periodSeconds: 3 },
};

/**
 * How far LINEMOVE raises the judgement line, as a fraction of the lane: `A · (1 − cos(2πt / T)) / 2`, 0 at `t = 0`,
 * with `A` = 0.15 / 0.35 and `T` = 4 s / 3 s. A renderer adds it to the player's LIFT.
 */
export function resolveChartLineLift(option: ChartCrazyLineOption | undefined, seconds: number): number {
  if (option === undefined) return 0;
  const { amplitude, periodSeconds } = LINE_MOVE[option];
  return clamp01(amplitude * 0.5 * (1 - Math.cos((2 * Math.PI * seconds) / periodSeconds)));
}

/** What a chart option state asks of the playfield as a whole, rather than of each note. */
export interface ChartPlayfieldVisual {
  /** LINEMOVE: how far the judgement line is raised, as a fraction of the lane, on top of the player's LIFT. */
  lineLift: number;
  /** REVERSE: notes rise from the bottom to a judgement line at the top of the lane. */
  reverse: boolean;
  /** HIDJUDGE: the judge display (verdict, its combo and FAST / SLOW) is not drawn. */
  hideJudge: boolean;
  /** DARK / DARK2: the BGA is not drawn. */
  hideBGA: boolean;
  /** DARK2: the judgement bombs are not drawn either. */
  hideBombs: boolean;
  /** HIDDEN_M-SUDDEN: the player's SUDDEN+ cover is shown at its own height, and the player moves it. */
  manualSudden: boolean;
}

/** The identity playfield: nothing changed. */
export const CHART_PLAYFIELD_IDENTITY: Readonly<ChartPlayfieldVisual> = Object.freeze({
  lineLift: 0,
  reverse: false,
  hideJudge: false,
  hideBGA: false,
  hideBombs: false,
  manualSudden: false,
});

/** The playfield-level effects of `state` at display chart second `seconds`. */
export function resolveChartPlayfieldVisual(
  state: (ChartCrazyOptionFields & { readonly hidden?: string }) | undefined,
  seconds: number,
): ChartPlayfieldVisual {
  if (state === undefined) return CHART_PLAYFIELD_IDENTITY;
  return {
    lineLift: resolveChartLineLift(state.crazyLine, seconds),
    reverse: state.crazyReverse === 'REVERSE',
    hideJudge: state.crazyJudge === 'HIDJUDGE',
    hideBGA: state.crazyDark !== undefined,
    hideBombs: state.crazyDark === 'DARK2',
    manualSudden: state.hidden === 'M-SUDDEN',
  };
}

/** True when `state` asks anything of the playfield as a whole. */
export function hasChartPlayfieldVisual(
  state: (ChartCrazyOptionFields & { readonly hidden?: string }) | undefined,
): boolean {
  return (
    state !== undefined &&
    (state.crazyLine !== undefined ||
      state.crazyReverse !== undefined ||
      state.crazyJudge !== undefined ||
      state.crazyDark !== undefined ||
      state.hidden === 'M-SUDDEN')
  );
}
