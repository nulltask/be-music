// Strict-typed normalization for beatoraja `timingvisualizer[]` declarations.
//
// The timingvisualizer plots the player's recent judgement timing offsets on a horizontal scale
// (early on the left, late on the right, perfect at center). Each judgement adds one mark; older
// samples fade upward. Authors point this at a destination strip on the play screen so the
// player can read their timing pattern at a glance during the run.
//
// Beatoraja's `SkinTimingVisualizer` (java) takes:
//   - `judgeWidthMillis` — horizontal half-range in ms (e.g. 100 = ±100ms span across the box)
//   - `lineWidth` — thickness of each sample line
//   - `lineColor` / `centerColor` / `PGColor` / `GRColor` / `GDColor` / `BDColor` / `PRColor` —
//     judgement-band colors (RRGGBB or RRGGBBAA hex strings)
//   - `transparent` — base alpha for sample lines
//   - `drawDecay` — speed at which older samples fade
//
// The reference theme (`play7main.lua`) authors the element as just `{id = "timing"}` and relies
// on engine-side defaults for everything else. We preserve every authored field verbatim so the
// renderer can either honor them when supplied or pick its own defaults — most skins won't
// supply them.

import { flattenBeatorajaElements, type NormalizedElement } from './beatoraja-skin-element.ts';
import type { BeatorajaImageId } from './beatoraja-skin-image.ts';

export interface BeatorajaTimingVisualizerElement {
  /** Destination id this visualizer targets. Same id space as `image[]` / `graph[]` / `text[]`. */
  id: BeatorajaImageId;
  /**
   * Horizontal half-range in ms. The destination box represents `[-judgeWidthMillis,
   * +judgeWidthMillis]`. Default `0` means "use renderer fallback" (≈ ±100ms covers the GOOD
   * window in most judges).
   */
  judgeWidthMillis: number;
  /** Pixel thickness of each sample line. `0` falls back to the renderer's default (~1px). */
  lineWidth: number;
  /** Base alpha (0..255) for sample lines. `0` means "fully opaque" (fallback). */
  transparent: number;
  /**
   * Sample fade decay rate. Higher values fade older samples faster. `0` falls back to the
   * renderer's default. Beatoraja uses this to scale the alpha-step between consecutive lines.
   */
  drawDecay: number;
  /** Base color of the sample line strokes (RRGGBB or RRGGBBAA hex; no `#`). */
  lineColor: string;
  /** Center / "perfect timing" guide line color. */
  centerColor: string;
  /** Per-judgement-band colors (RRGGBB[AA] hex). Empty string = renderer fallback. */
  pgColor: string;
  grColor: string;
  gdColor: string;
  bdColor: string;
  prColor: string;
  /** `if` codes that gate visibility (AND-merged with the destination's `op[]`). */
  ifCodes: ReadonlyArray<number>;
}

export function normalizeBeatorajaTimingVisualizers(input: unknown): BeatorajaTimingVisualizerElement[] {
  const flattened = flattenBeatorajaElements(input);
  const out: BeatorajaTimingVisualizerElement[] = [];
  for (const entry of flattened) {
    const normalized = normalizeOne(entry);
    if (normalized !== undefined) out.push(normalized);
  }
  return out;
}

function normalizeOne(entry: NormalizedElement): BeatorajaTimingVisualizerElement | undefined {
  const f = entry.fields;
  const id = f.id;
  if (typeof id !== 'string' && typeof id !== 'number') return undefined;
  return {
    id,
    judgeWidthMillis: numberField(f, 'judgeWidthMillis', 0),
    lineWidth: numberField(f, 'lineWidth', 0),
    transparent: numberField(f, 'transparent', 0),
    drawDecay: numberField(f, 'drawDecay', 0),
    lineColor: stringField(f, 'lineColor', ''),
    centerColor: stringField(f, 'centerColor', ''),
    // Beatoraja's java field naming uses uppercase abbreviations (`PGColor` etc.); we
    // case-insensitively pick whichever the author supplied.
    pgColor: pickHex(f, ['pgColor', 'PGColor']),
    grColor: pickHex(f, ['grColor', 'GRColor']),
    gdColor: pickHex(f, ['gdColor', 'GDColor']),
    bdColor: pickHex(f, ['bdColor', 'BDColor']),
    prColor: pickHex(f, ['prColor', 'PRColor']),
    ifCodes: entry.ifCodes,
  };
}

function numberField(record: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const v = record[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function stringField(record: Readonly<Record<string, unknown>>, key: string, fallback: string): string {
  const v = record[key];
  return typeof v === 'string' ? v : fallback;
}

function pickHex(record: Readonly<Record<string, unknown>>, keys: ReadonlyArray<string>): string {
  for (const key of keys) {
    const v = record[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '';
}
