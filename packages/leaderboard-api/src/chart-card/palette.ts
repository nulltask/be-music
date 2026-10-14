/**
 * The chart card's colours. The card is a palette image: the background (og-chart.svg) takes the first
 * BACKGROUND_COLORS entries, and the excerpt's colours follow. Kept apart from the excerpt so scripts/build-icons.ts
 * can read it without the chart package built.
 */

/** The colours of the excerpt, as the usual BMS lanes: white and blue keys, a red scratch. */
export type ExcerptColor =
  | 'lane-light'
  | 'lane-dark'
  | 'bar-line'
  | 'judge-line'
  | 'note-white'
  | 'note-blue'
  | 'note-red'
  | 'long-white'
  | 'long-blue'
  | 'long-red';

export const EXCERPT_COLORS: Readonly<Record<ExcerptColor, string>> = {
  'lane-light': '#1c2138',
  'lane-dark': '#0e1326',
  'bar-line': '#3a4266',
  'judge-line': '#ff3850',
  'note-white': '#ffffff',
  'note-blue': '#4ec9ff',
  'note-red': '#ff5a6e',
  'long-white': '#8f97b3',
  'long-blue': '#2c7fa8',
  'long-red': '#a83445',
};

/** The most colours the background may have, leaving the rest of the 256 to the excerpt. */
export const BACKGROUND_COLORS = 256 - Object.keys(EXCERPT_COLORS).length;
