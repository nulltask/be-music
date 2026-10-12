/** Tabular-figure layout for numerals drawn glyph by glyph. */

export interface TabularGlyph {
  char: string;
  /** Left edge of the glyph's cell, relative to the run's start. */
  x: number;
  /** Cell width — the shared digit advance for `0-9`, the glyph's own advance otherwise. */
  w: number;
}

/**
 * Lays out a string with tabular (fixed-width) figures. Canvas 2D — which Pixi `Text` rasterizes through — exposes no
 * `font-feature-settings`, so OpenType `tnum` can't be switched on; instead every digit gets a cell as wide as the
 * widest digit, and callers centre each glyph in its cell. Other characters (`/`, `%`, `.`, `x`, spaces) keep their
 * natural advance. Returns the cells plus the run's total width.
 */
export function layoutTabularRun(
  text: string,
  measure: (char: string) => number,
): { glyphs: TabularGlyph[]; width: number } {
  let digitAdvance = 0;
  for (let digit = 0; digit <= 9; digit += 1) {
    digitAdvance = Math.max(digitAdvance, measure(String(digit)));
  }
  const glyphs: TabularGlyph[] = [];
  let x = 0;
  for (const char of text) {
    const w = char >= '0' && char <= '9' ? digitAdvance : measure(char);
    glyphs.push({ char, x, w });
    x += w;
  }
  return { glyphs, width: x };
}
