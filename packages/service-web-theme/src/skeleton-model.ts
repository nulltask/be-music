import type { Locale } from './locale.ts';

/** A line of text, an avatar's circle, or a block such as a button or a panel. */
export type SkeletonShape = 'line' | 'circle' | 'block';

/** A length in pixels, or any CSS length (`12ch`, `100%`, `1lh`). */
export type SkeletonLength = number | string;

export interface SkeletonInput {
  shape?: SkeletonShape;
  /** The width of the element the skeleton stands in for. A circle takes it as its diameter. */
  width?: SkeletonLength;
  /** The height. A circle ignores it and stays round. */
  height?: SkeletonLength;
}

/** Defaults sized like the content each shape stands in for: a line of body text, a header avatar, a small button. */
const DEFAULTS: Record<SkeletonShape, { width: string; height: string }> = {
  line: { width: '100%', height: '1em' },
  circle: { width: '24px', height: '24px' },
  block: { width: '100%', height: '2rem' },
};

const LOADING_LABEL: Record<Locale, string> = { en: 'Loading…', ja: '読み込み中…' };

/** A CSS length: a number is pixels. A negative, non-finite or empty length falls back to the shape's default. */
export function skeletonLength(value: SkeletonLength | undefined, fallback: string): string {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? `${value}px` : fallback;
  const trimmed = value?.trim() ?? '';
  // Only a length, never a declaration: the value lands in a style attribute.
  return trimmed === '' || /[;{}<>"]/.test(trimmed) ? fallback : trimmed;
}

/** The skeleton's shape and its box, the same box the loaded element will take so nothing moves when it arrives. */
export function resolveSkeleton(input: SkeletonInput = {}): { shape: SkeletonShape; style: string } {
  const shape = input.shape ?? 'line';
  const defaults = DEFAULTS[shape];
  const width = skeletonLength(input.width, defaults.width);
  const height = shape === 'circle' ? width : skeletonLength(input.height, defaults.height);
  return { shape, style: `inline-size:${width};block-size:${height}` };
}

/** What assistive technology hears while a region loads, unless the caller names what is loading. */
export function skeletonLabel(locale: Locale, label?: string): string {
  const trimmed = label?.trim() ?? '';
  return trimmed === '' ? LOADING_LABEL[locale] : trimmed;
}
