import { normalizeObjectKey } from '@be-music/chart-source';

/** A filename and optional transparent-color tuple from `#EXBMPxx a,r,g,b filename`. */
export interface BMSExBMP {
  filename: string;
  /** Authored transparent-color tuple; parsing does not apply rendering semantics. */
  argb: BmsARGB | undefined;
  /** Raw comma-separated tuple for preservation and subsequent parsing. */
  argbRaw: string;
}

/**
 * Parse the four comma-separated color fields followed by whitespace and the filename. Also accept the older
 * Be-Music comma-before-filename spelling. Preserve spaces and commas inside the filename. A missing filename is
 * invalid; malformed or omitted color fields still leave the resource available to loaders.
 */
export function parseBMSExBMP(raw: string): BMSExBMP | undefined {
  if (typeof raw !== 'string') return undefined;
  const match = /^([^,]*),([^,]*),([^,]*),\s*([^,\s]*)(?:\s+|,)([\s\S]+)$/u.exec(raw.trim());
  if (!match) return undefined;
  const [, aRaw, rRaw, gRaw, bRaw, filenameRaw] = match;
  const filename = filenameRaw!.trim();
  if (filename.length === 0) return undefined;
  const fields = [aRaw!, rRaw!, gRaw!, bRaw!];
  const argbRaw = fields.join(',');
  return {
    filename,
    argb: fields.every((field) => field.trim().length === 0) ? undefined : parseBmsARGB(argbRaw),
    argbRaw,
  };
}

/**
 * Parsed `#BGAxx YY x1 y1 x2 y2 dx dy` directive.
 *
 * `#BGAxx` declares a sub-region BGA: it pulls a rectangle out of an existing `#BMPYY` slot and exposes it as the slot
 * ID `xx` so BGA cues referencing `xx` render only that crop. The destination offset `(dx, dy)` is the position INSIDE
 * the BMS 256x256 spec canvas where the cropped rectangle should be drawn — chart authors use it to compose multiple
 * sub-regions of one source BMP into different on-screen positions, e.g. assembling a sprite-sheet animation by
 * aliasing slots `01..09` to different tiles of `#BMP10`.
 */
export interface BMSSubRegionBGA {
  /** Source BMP slot id, normalized via `normalizeObjectKey`. */
  sourceBMP: string;
  /** Top-left X of the source rectangle (pixel coordinates). */
  sx: number;
  /** Top-left Y of the source rectangle. */
  sy: number;
  /** Bottom-right X of the source rectangle (exclusive). */
  ex: number;
  /** Bottom-right Y of the source rectangle (exclusive). */
  ey: number;
  /** Destination X inside the 256x256 BGA spec canvas. */
  dx: number;
  /** Destination Y inside the 256x256 BGA spec canvas. */
  dy: number;
}

/**
 * Parses one `#BGAxx YY x1 y1 x2 y2 dx dy` directive. Whitespace- separated tokens, all integer except `YY` which is
 * the source BMP slot id (base-36 / base-62 depending on `#BASE`).
 *
 * `allowLongKeys` retains internal resource ids from mixed NONSTOP bmson output; ordinary BMS keeps two-character ids.
 *
 * Returns `undefined` for malformed lines (fewer than seven tokens, non-integer numerics, empty source slot, or a
 * degenerate rectangle where `ex <= sx` / `ey <= sy`).
 */
export function parseBmsBGA(raw: string, idBase: 36 | 62 = 36, allowLongKeys = false): BMSSubRegionBGA | undefined {
  if (typeof raw !== 'string') return undefined;
  const tokens = raw.trim().split(/\s+/u);
  if (tokens.length < 7) return undefined;
  const [sourceRaw, sxRaw, syRaw, exRaw, eyRaw, dxRaw, dyRaw] = tokens;
  if (
    sourceRaw === undefined ||
    sxRaw === undefined ||
    syRaw === undefined ||
    exRaw === undefined ||
    eyRaw === undefined ||
    dxRaw === undefined ||
    dyRaw === undefined
  ) {
    return undefined;
  }
  const sourceBMP = normalizeObjectKey(sourceRaw, idBase, allowLongKeys);
  if (sourceBMP.length === 0) return undefined;
  const sx = Number.parseInt(sxRaw, 10);
  const sy = Number.parseInt(syRaw, 10);
  const ex = Number.parseInt(exRaw, 10);
  const ey = Number.parseInt(eyRaw, 10);
  const dx = Number.parseInt(dxRaw, 10);
  const dy = Number.parseInt(dyRaw, 10);
  if (![sx, sy, ex, ey, dx, dy].every((value) => Number.isFinite(value))) return undefined;
  // Degenerate / inverted rectangles are unusable — they'd produce a zero-area frame and a runtime divide-by-zero in
  // the consumer.
  if (ex <= sx || ey <= sy) return undefined;
  return { sourceBMP, sx, sy, ex, ey, dx, dy };
}

/**
 * Parsed BMS `#ARGBxx` value — alpha + RGB channel in 0..255.
 *
 * Each component is clamped to the byte range so callers can blindly feed them into bit-shift / `/255` conversions
 * without re-validating.
 */
export interface BmsARGB {
  /** Alpha (0 = fully transparent, 255 = fully opaque). */
  a: number;
  r: number;
  g: number;
  b: number;
}

const BMS_ARGB_HEX_RE = /^[0-9A-Fa-f]{8}$/;

/**
 * Parses a BMS `#ARGBxx` raw string into A / R / G / B byte components. Recognizes both formats commonly found in the
 * wild:
 *
 * - **Hex AARRGGBB** — `'FF000000'` or `'#FF000000'` (8 hex digits, optional leading `#`). High byte = alpha.
 * - **Comma-separated decimal** — `'255,0,0,0'` (A,R,G,B with optional whitespace around each integer).
 *
 * Returns `undefined` for unrecognized / malformed input so the caller can fall back to "no tint".
 *
 * Parsing only: ARGB definitions are selected through channels A1–A4 and set a plane's RGB multipliers and alpha.
 * EXBMP transparent-color keys are a separate operation; ARGB ids do not address BMP slots.
 */
export function parseBmsARGB(raw: string): BmsARGB | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  // Comma-separated decimal: "A,R,G,B" with optional whitespace.
  if (trimmed.includes(',')) {
    const parts = trimmed.split(',');
    if (parts.length !== 4) return undefined;
    const ints: number[] = [];
    for (const part of parts) {
      const trimmedPart = part.trim();
      if (trimmedPart.length === 0) return undefined;
      const value = Number.parseInt(trimmedPart, 10);
      if (!Number.isFinite(value)) return undefined;
      // Clamp to 0..255 so `#ARGB01 300,-5,...` (clearly malformed but writeable) doesn't poison downstream alpha math.
      ints.push(Math.max(0, Math.min(255, Math.trunc(value))));
    }
    return { a: ints[0]!, r: ints[1]!, g: ints[2]!, b: ints[3]! };
  }
  // Hex AARRGGBB, optional leading '#'.
  const hex = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (!BMS_ARGB_HEX_RE.test(hex)) return undefined;
  return {
    a: Number.parseInt(hex.slice(0, 2), 16),
    r: Number.parseInt(hex.slice(2, 4), 16),
    g: Number.parseInt(hex.slice(4, 6), 16),
    b: Number.parseInt(hex.slice(6, 8), 16),
  };
}
