// Strict-typed normalization for beatoraja `timingvisualizer[]` declarations.
//
// The timingvisualizer plots the player's recent judgement timing offsets on a horizontal scale
// (early on the left, late on the right, perfect at center). Each judgement adds one mark; older
// samples fade upward. Authors point this at a destination strip on the play screen so the
// player can read their timing pattern at a glance during the run.
//
// Beatoraja's `SkinTimingVisualizer` (java) takes:
//   - `width` — pixel width used for the px/ms rate (`judgeWidthRate = width / (judgeWidthMillis
//     * 2 + 1)`). Default `301` is engineered so that with the default `judgeWidthMillis = 150`
//     the rate is exactly 1 px/ms (`301 / 301 == 1`).
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
//
// Defaults match `JsonSkin.java:297-311` (`TimingVisualizer`):
//   width = 301, judgeWidthMillis = 150, lineWidth = 1, transparent = 0, drawDecay = 1.

import { flattenBeatorajaElements, type NormalizedElement } from './beatoraja-skin-element.ts';
import type { BeatorajaImageId } from './beatoraja-skin-image.ts';

export interface BeatorajaTimingVisualizerElement {
  /** Destination id this visualizer targets. Same id space as `image[]` / `graph[]` / `text[]`. */
  id: BeatorajaImageId;
  /**
   * Pixel width that drives the px/ms rate. Mirrors upstream
   * `SkinTimingVisualizer.java:63` `judgeWidthRate = width / (judgeWidthMillis * 2 + 1)`. The
   * authored `width` is INDEPENDENT of the destination's runtime `region.width` — the
   * background is stretched to `region.width` but sample-line offsets are computed against
   * this value so the px/ms scale stays constant if the dst rect animates. Default `301`
   * matches `JsonSkin.java:299`.
   */
  width: number;
  /**
   * Horizontal half-range in ms. The destination box represents `[-judgeWidthMillis,
   * +judgeWidthMillis]`. Default `150` matches `JsonSkin.java:300` (= the half-range of the
   * GOOD window in most judges, paired with `width = 301` to give exactly 1 px/ms).
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
    // Defaults follow `JsonSkin.java:297-311`. Most skins author only `id` and rely on these.
    width: numberField(f, 'width', 301),
    judgeWidthMillis: numberField(f, 'judgeWidthMillis', 150),
    lineWidth: numberField(f, 'lineWidth', 1),
    transparent: numberField(f, 'transparent', 0),
    drawDecay: numberField(f, 'drawDecay', 1),
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
