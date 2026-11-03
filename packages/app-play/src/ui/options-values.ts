// The value rules of the Options controls (`options-controls.ts`): how a typed or dragged number lands on its slider's
// grid and range, how a choice list finds the value it shows, and the points of the FPS graph. Pure, so they are tested
// without a DOM.

/** One entry of a choice list: the text it shows and the value it stands for. */
export interface OptionChoice<T> {
  readonly text: string;
  readonly value: T;
}

/** A number control's range and grid; each is optional. */
export interface NumberLimits {
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

/** How many decimals a step has (`0.01` → 2, `1` → 0, `1e-7` → 7), so the grid prints without float noise. */
export function stepDecimals(step: number | undefined): number {
  if (step === undefined || !Number.isFinite(step) || step <= 0) return 0;
  const [mantissa = '', exponent] = String(step).split('e-');
  const dot = mantissa.indexOf('.');
  return (dot < 0 ? 0 : mantissa.length - dot - 1) + (exponent === undefined ? 0 : Number(exponent));
}

/**
 * The value a number control takes for `value`: on the grid of `step` (counted from 0, as the hi-speed grids are),
 * then inside `min` .. `max`. `undefined` for a value that is not a finite number, which the control refuses.
 */
export function constrainNumber(value: number, limits: NumberLimits): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  let next = value;
  const { min, max, step } = limits;
  if (step !== undefined && step > 0) next = Number((Math.round(next / step) * step).toFixed(stepDecimals(step)));
  if (min !== undefined) next = Math.max(min, next);
  if (max !== undefined) next = Math.min(max, next);
  return Object.is(next, -0) ? 0 : next;
}

/** A number as its control prints it: with the step's decimals, or as it is without a step. */
export function formatNumber(value: number, step: number | undefined): string {
  if (!Number.isFinite(value)) return '';
  return step === undefined ? String(value) : value.toFixed(stepDecimals(step));
}

/** A bound value as a text field or a monitor shows it: a string, number or boolean as text, anything else empty. */
export function displayText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}

/** How far along `min` .. `max` the value sits, as the CSS percentage Basecoat's range track fills to. */
export function sliderFill(value: number, min: number, max: number): string {
  if (!(max > min) || !Number.isFinite(value)) return '0%';
  const ratio = Math.min(1, Math.max(0, (value - min) / (max - min)));
  return `${Math.round(ratio * 10_000) / 100}%`;
}

/** The index of the choice standing for `value`, or -1 when none does. */
export function choiceIndex<T>(choices: readonly OptionChoice<T>[], value: unknown): number {
  return choices.findIndex((choice) => Object.is(choice.value, value));
}

/** Value presets as labelled choices: an array's values label themselves, a record's keys label its values. */
export function toChoices<T>(values: readonly T[] | Record<string, T>): OptionChoice<T>[] {
  return Array.isArray(values)
    ? values.map((value) => ({ text: String(value), value }))
    : Object.entries(values).map(([text, value]) => ({ text, value }));
}

/**
 * The SVG polyline points of a monitor graph: the `samples` from the left, `bufferSize` of them across `width`, each
 * clamped to `min` .. `max` and drawn from the bottom of `height`. A sample that is not a finite number draws at `min`.
 */
export function graphPoints(
  samples: readonly number[],
  view: { readonly min: number; readonly max: number; readonly width: number; readonly height: number },
  bufferSize: number,
): string {
  const span = view.max > view.min ? view.max - view.min : 1;
  const step = bufferSize > 1 ? view.width / (bufferSize - 1) : 0;
  return samples
    .map((sample, index) => {
      const value = Number.isFinite(sample) ? Math.min(view.max, Math.max(view.min, sample)) : view.min;
      const x = Math.round(index * step * 100) / 100;
      const y = Math.round((view.height - ((value - view.min) / span) * view.height) * 100) / 100;
      return `${x},${y}`;
    })
    .join(' ');
}
