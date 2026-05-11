/**
 * LR2 bitmap font support — `.lr2font` text-format parser, glyph map builder, and LR2 → Unicode character-code
 * conversion.
 *
 * `.lr2font` directives (per `docs/LR2SkinHelp.md` line 2099+):
 *
 * - `#S <n>` — base font size (px). Reference height for the glyph cells; DST height is divided by this to compute the
 *   render-time scale factor.
 * - `#M <n>` — character spacing (px), can be negative for tight text where successive glyphs overlap.
 * - `#T <gr> <relative-path>` — declares image #`gr` referencing a PNG / BMP. Path is RELATIVE TO THE `.lr2font` FILE
 *   (not the skin CSV like `#IMAGE`).
 * - `#R <charCode> <gr> <x> <y> <w> <h>` — glyph rect: take from image `gr` the rect `(x, y, w, h)` and treat it as the
 *   bitmap for LR2 character code `charCode`. Glyph height is the base size (`#S`); a height different from `#S` is
 *   rescaled at render time.
 *
 * LR2 character codes are NOT Unicode. They follow:
 *
 * - `0..255` — ASCII direct
 * - `256..8126` — Shift-JIS multibyte minus `32832` offset
 * - `8127..15306` — Shift-JIS multibyte minus `49281` offset
 *
 * The two SJIS branches encode the upper / lower SJIS double-byte ranges (`0x81xx..0x9Fxx` and `0xE0xx..0xFCxx`), with
 * the offset picked so the result fits in a small dense int range. We round- trip through a runtime-built UTF-16 ↔ SJIS
 * table for full Japanese coverage without bundling a static SJIS table.
 */

const SJIS_OFFSET_RANGE_1 = 32832;
const SJIS_OFFSET_RANGE_2 = 49281;
const SJIS_RANGE_1_END = 8126;
const SJIS_RANGE_2_START = 8127;
const SJIS_RANGE_2_END = 15306;

/** Glyph rect inside a font's source image. */
export interface Lr2FontGlyph {
  /** Image index (`#T <gr>` declaration order). */
  gr: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A parsed `.lr2font` file. */
export interface Lr2BitmapFont {
  /** Base reference size (`#S`). DST height ÷ this = render scale. */
  baseSize: number;
  /** Per-character spacing in source-pixel units (`#M`). Can be negative. */
  spacing: number;
  /** Image index → relative path from the `.lr2font` file. */
  images: Map<number, string>;
  /** LR2 character code → glyph rect. */
  glyphs: Map<number, Lr2FontGlyph>;
}

/**
 * Parses a `.lr2font` source text into the structured form. Lines are tokenized on whitespace; unknown directives are
 * silently skipped so future `#X` keywords don't break the parse. Unparseable numeric fields fall back to `0`.
 */
export function parseLr2Font(source: string): Lr2BitmapFont {
  const font: Lr2BitmapFont = {
    baseSize: 22,
    spacing: 0,
    images: new Map(),
    glyphs: new Map(),
  };
  const lines = source.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = stripLineComment(rawLine).trim();
    if (line.length === 0) continue;
    const tokens = line.split(/[\s,]+/).filter((token) => token.length > 0);
    const head = tokens[0];
    if (!head || !head.startsWith('#')) continue;
    const command = head.toUpperCase();
    if (command === '#S') {
      font.baseSize = toIntOrZero(tokens[1]) || font.baseSize;
    } else if (command === '#M') {
      font.spacing = toIntOrZero(tokens[1]);
    } else if (command === '#T') {
      const gr = toIntOrZero(tokens[1]);
      const path = tokens.slice(2).join(' ');
      if (path.length > 0) font.images.set(gr, path);
    } else if (command === '#R') {
      const code = toIntOrZero(tokens[1]);
      const gr = toIntOrZero(tokens[2]);
      const x = toIntOrZero(tokens[3]);
      const y = toIntOrZero(tokens[4]);
      const w = toIntOrZero(tokens[5]);
      const h = toIntOrZero(tokens[6]);
      if (w > 0 && h > 0) {
        font.glyphs.set(code, { gr, x, y, w, h });
      }
    }
  }
  return font;
}

function stripLineComment(line: string): string {
  // LR2 conventionally uses `//` (C++) line comments inside skin files. `.lr2font` follows the same convention for
  // compatibility with FontUtil-generated output.
  const slash = line.indexOf('//');
  return slash >= 0 ? line.slice(0, slash) : line;
}

function toIntOrZero(value: string | undefined): number {
  if (typeof value !== 'string') return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Converts a single Unicode code point (UTF-16 BMP) to an LR2 char code, or `undefined` when the character has no SJIS
 * encoding (so the renderer can substitute a placeholder rect).
 *
 * Lazy-built SJIS encoding table — first call costs ~5-10 ms while we walk every double-byte SJIS sequence and decode
 * it via the platform's `TextDecoder('shift-jis')`. Subsequent calls are O(1) map lookups.
 */
export function unicodeToLr2CharCode(char: string): number | undefined {
  if (char.length === 0) return undefined;
  const codePoint = char.codePointAt(0)!;
  // ASCII branch — LR2 maps `0..255` straight to ASCII.
  if (codePoint < 0x80) {
    return codePoint;
  }
  const sjis = unicodeToSjis(codePoint);
  if (sjis === undefined) return undefined;
  // SJIS double-byte: split into high/low and decimal-encode as `(high << 8) | low` (i.e. `high * 256 + low` per LR2
  // spec; the original Japanese phrasing translates to "convert the Shift-JIS character code to decimal").
  const decimal = sjis;
  if (decimal >= 33088 && decimal < 33088 + (SJIS_RANGE_1_END - 256 + 1) * 1) {
    // Range 1: `0x8140..0x9FFC` → 256..8126
    const lr2 = decimal - SJIS_OFFSET_RANGE_1;
    if (lr2 >= 256 && lr2 <= SJIS_RANGE_1_END) return lr2;
  }
  if (decimal >= 57408) {
    // Range 2: `0xE040..0xFCFC` → 8127..15306
    const lr2 = decimal - SJIS_OFFSET_RANGE_2;
    if (lr2 >= SJIS_RANGE_2_START && lr2 <= SJIS_RANGE_2_END) return lr2;
  }
  return undefined;
}

let unicodeToSjisTable: Map<number, number> | undefined;

function unicodeToSjis(codePoint: number): number | undefined {
  if (!unicodeToSjisTable) {
    unicodeToSjisTable = buildUnicodeToSjisTable();
  }
  return unicodeToSjisTable.get(codePoint);
}

/**
 * Walks every valid SJIS double-byte sequence, decodes via the platform `TextDecoder('shift-jis')`, and indexes the
 * result by the resulting Unicode code point. Skips REPLACEMENT (U+FFFD) results so unmapped sequences don't poison the
 * table.
 *
 * Built lazily on first use. The cost is bounded — about 7000 valid SJIS pairs total, decoded in two byte loops.
 */
function buildUnicodeToSjisTable(): Map<number, number> {
  const map = new Map<number, number>();
  const decoder = new TextDecoder('shift-jis', { fatal: false });
  const buffer = new Uint8Array(2);
  const ranges: Array<readonly [number, number]> = [
    [0x81, 0x9f],
    [0xe0, 0xfc],
  ];
  for (const [highStart, highEnd] of ranges) {
    for (let high = highStart; high <= highEnd; high += 1) {
      for (let low = 0x40; low <= 0xfc; low += 1) {
        if (low === 0x7f) continue; // SJIS reserves 0x7F.
        buffer[0] = high;
        buffer[1] = low;
        const decoded = decoder.decode(buffer);
        if (decoded.length === 0) continue;
        const code = decoded.codePointAt(0);
        if (code === undefined || code === 0xfffd) continue;
        // Multi-character outputs (rare — combining marks etc.) are skipped; we can't represent them as a single LR2
        // char code anyway.
        if (decoded.length > 1) continue;
        const sjis = (high << 8) | low;
        // Multiple SJIS sequences can decode to the same Unicode (very rare). Keep the FIRST mapping so range-1
        // characters take precedence over range-2 duplicates, matching the LR2 char-code allocation order.
        if (!map.has(code)) {
          map.set(code, sjis);
        }
      }
    }
  }
  return map;
}

/**
 * Converts a string (UTF-16) into an array of LR2 character codes. Characters that don't map to LR2 (no SJIS encoding)
 * are returned as `undefined` slots so the renderer can stamp a placeholder.
 */
export function stringToLr2CharCodes(value: string): Array<number | undefined> {
  const codes: Array<number | undefined> = [];
  for (const char of value) {
    codes.push(unicodeToLr2CharCode(char));
  }
  return codes;
}
