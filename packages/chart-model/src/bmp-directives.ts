import { normalizeObjectKey, type BeMusicJSON } from '@be-music/chart-source';

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
 * Resolve Be-Music's existing per-slot tint interpretation, preferring ARGB over EXBMP. This legacy helper does not
 * implement nanasi's channel-scoped A1–A4 commands or EXBMP transparent-color keying; callers must not use its
 * presence as evidence of standard extension support.
 */
export function resolveBmsBmpARGB(chart: BeMusicJSON, slot: string): BmsARGB | undefined {
  const argbRaw = chart.bms.argb[slot];
  if (typeof argbRaw === 'string') {
    const parsed = parseBmsARGB(argbRaw);
    if (parsed) return parsed;
  }
  const exBMPRaw = chart.bms.exBMP[slot];
  if (typeof exBMPRaw === 'string') {
    const parsed = parseBMSExBMP(exBMPRaw);
    if (parsed?.argb) return parsed.argb;
  }
  return undefined;
}

/**
 * Parsed `#SWBGAxx fr:tot:lp:ARGB N1 N2 …` directive.
 *
 * `#SWBGAxx` declares a switching ("animated") BGA: while the cue is active, the player cycles through the listed
 * `#BMPxx` slots one frame at a time. The header tokens — `fr` / `tot` / `lp` / optional `ARGB` — drive how the cycle
 * progresses, the rest of the line is the per-frame slot list.
 *
 * Legacy Be-Music semantics (not nanasi A5 key-bound animation): - `fr` (frame rate): frame interval in `1/100`-second units, so `fr = 10` means
 * one frame every 100 ms. Stored here in ms. - `tot` (total frames): number of frames in the animation. The slot list
 * MAY be shorter / longer; a shorter list cycles itself, a longer one is truncated to `tot`. - `lp` (loop): `0` = play
 * once and hold the last frame, non-zero = loop. - `ARGB` (optional): AARRGGBB tint applied to every frame, same format
 * as `#ARGBxx`.
 */
export interface BMSSwitchingBGA {
  /** Frame interval in milliseconds (`fr × 10`). */
  frameIntervalMs: number;
  /** Total frames the animation should advance through. */
  totalFrames: number;
  /** Whether playback should loop after reaching `totalFrames`. */
  loop: boolean;
  /**
   * ARGB tuple as a parser-faithful raw string (AARRGGBB hex), or `undefined` when the header omitted the `:ARGB`
   * field.
   */
  argbRaw?: string;
  /**
   * Per-frame `#BMPxx` slot ids, normalized via `normalizeObjectKey`. Empty / unparseable tokens are skipped.
   * `frames.length` may differ from `totalFrames` — consumers should index modulo `frames.length` while clamping to
   * `totalFrames`.
   */
  frames: string[];
}

/**
 * Parses one `#SWBGAxx` directive value (the post-`#SWBGAxx ` text). Returns `undefined` for malformed inputs (missing
 * header, non- positive frame rate / total, empty slot list, etc.) so the consumer can fall through to "no animation"
 * rather than show a stuck or scrambled frame.
 */
export function parseBMSSwBGA(raw: string, idBase: 36 | 62 = 36): BMSSwitchingBGA | undefined {
  if (typeof raw !== 'string') return undefined;
  const tokens = raw.trim().split(/\s+/u);
  if (tokens.length < 2) return undefined;
  const headerRaw = tokens[0]!;
  const headerParts = headerRaw.split(':');
  if (headerParts.length < 3) return undefined;
  const fr = Number.parseInt(headerParts[0]!, 10);
  const totalFrames = Number.parseInt(headerParts[1]!, 10);
  const lp = Number.parseInt(headerParts[2]!, 10);
  if (![fr, totalFrames, lp].every((value) => Number.isFinite(value))) return undefined;
  if (fr <= 0 || totalFrames <= 0) return undefined;
  const argbField = headerParts[3]?.trim();
  const argbRaw = argbField && argbField.length > 0 ? argbField : undefined;
  const frames: string[] = [];
  for (const token of tokens.slice(1)) {
    const slot = normalizeObjectKey(token, idBase);
    if (slot.length > 0) frames.push(slot);
  }
  if (frames.length === 0) return undefined;
  return {
    frameIntervalMs: fr * 10,
    totalFrames,
    loop: lp !== 0,
    argbRaw,
    frames,
  };
}

/**
 * Picks the `#BMPxx` slot id that should render at `elapsedMs` milliseconds into a switching BGA's playback. Honors
 * the directive's `frameIntervalMs`, `totalFrames`, and `loop` fields — when `loop = false` and the cycle has ended,
 * the last authored frame stays on screen ("hold last").
 *
 * Returns `undefined` only when the parsed entry has an empty `frames` list (which {@link parseBMSSwBGA} already
 * filters out for us); included for safety so callers can use a single null check.
 */
export function pickSwitchingBGAFrame(swBGA: BMSSwitchingBGA, elapsedMs: number): string | undefined {
  if (swBGA.frames.length === 0) return undefined;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return swBGA.frames[0];
  }
  const rawIndex = Math.floor(elapsedMs / swBGA.frameIntervalMs);
  let index: number;
  if (swBGA.loop) {
    // Modulo against `frames.length` so a slot list shorter than `totalFrames` keeps cycling within the authored
    // frames.
    index = ((rawIndex % swBGA.totalFrames) + swBGA.totalFrames) % swBGA.totalFrames;
    index = index % swBGA.frames.length;
  } else {
    // Clamp to the last frame so post-end the BGA holds rather than disappearing.
    const clamped = Math.min(rawIndex, swBGA.totalFrames - 1);
    index = Math.min(clamped, swBGA.frames.length - 1);
  }
  return swBGA.frames[index];
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
 * Returns `undefined` for malformed lines (fewer than seven tokens, non-integer numerics, empty source slot, or a
 * degenerate rectangle where `ex <= sx` / `ey <= sy`).
 */
export function parseBmsBGA(raw: string, idBase: 36 | 62 = 36): BMSSubRegionBGA | undefined {
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
  const sourceBMP = normalizeObjectKey(sourceRaw, idBase);
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
 * Parsing only: nanasi ARGB definitions are selected through channels A1–A4 and describe transparent colors and
 * opacity, rather than assigning a multiplicative tint to the BMP slot with the same id.
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
