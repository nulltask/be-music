/**
 * Standard LR2 / BMS skin canvas options, ordered ascending so the auto-detector picks the SMALLEST canvas that
 * still contains the bulk of authored DST coordinates. Covers 640×480 (LR2 default theme), 1280×720 (HD), 1920×1080
 * (FHD — LITONE4 lives here), and 2560×1440 (QHD — rare but cheap to support). Anything beyond falls back to QHD's
 * cap; real authored LR2 themes at 4K don't exist in the wild.
 */
const STANDARD_CANVAS_SIZES: ReadonlyArray<{ readonly width: number; readonly height: number }> = [
  { width: 640, height: 480 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
];

/**
 * Slack factor that lets a candidate canvas "absorb" the 90 %-percentile overshoot from authored animations. Set to
 * 15 % empirically against LITONE4's CSV bodies: the bulk of authored DST corners cluster at canvas edges
 * (`y+h=1080`, `x+w=1920`) but slide-in animations on Play / Select push the 90 %-percentile x+w up to ~2080 — about
 * 8.5 % beyond the 1920 canvas. A flat 15 % tolerance comfortably absorbs that overshoot while staying tight
 * enough not to mis-classify legitimately wider canvases (the next standard tier is 2560 = 33 % above 1920, well
 * outside the tolerance).
 */
const CANVAS_OVERSHOOT_TOLERANCE = 0.15;

/**
 * Picks the canvas for a `.lr2skin` that omits `#RESOLUTION`. Computes the 90 % percentile of the right-edge and
 * bottom-edge coordinates across all observed DST keyframes, then returns the smallest {@link STANDARD_CANVAS_SIZES}
 * entry that contains both percentiles within a {@link CANVAS_OVERSHOOT_TOLERANCE} slack. Returns `undefined` only
 * when there are no observed corners (= skin parsed no DSTs, in which case the caller keeps the 640×480 default).
 *
 * **Joint inclusion + plateau detection**: authored slide-in animations frequently push elements past the canvas
 * edge for a couple of keyframes (LITONE4's `AC7LEFT.csv` has Play DST corners up to `y+h=2179` and `x+w=3144` for
 * sprites that fly in from off-screen; LR2 default's `decide.lr2skin` slides bracket decorations in from x≈1500
 * against a 640×480 design — 32 % of its 62 corners are off-screen animation keyframes).
 *
 * Two-stage decision per candidate canvas tier, picking the smallest match:
 *
 * - **High inclusion (≥ 90 %)** — the candidate covers nearly all corners, so it's the design canvas. Used by skins
 *   without significant off-screen animation: LR2 default select (95 % within 640×480), LITONE4 (95 % within
 *   1920×1080).
 * - **Plateau** — the candidate already has a non-trivial fraction (> 30 %) of corners inside it AND the next
 *   bigger tier doesn't add many more (< 10 % gain). The corners outside this tier are far-off animation keyframes
 *   that the next tier doesn't catch either — they're "off-canvas slides", not on-screen elements. Used by skins
 *   with heavy slide animations: LR2 default decide (68 % inside 640×480, same 68 % inside 1280×720 because the
 *   outliers all sit at x≈1500 → 640×480 is the actual design canvas).
 *
 * Together: the 90 % rule covers cleanly-authored skins; the plateau rule rescues small skins (LR2 default decide)
 * whose animation fraction would otherwise push them over the threshold. The 15 % tolerance on each tier absorbs
 * tiny single-pixel overshoots from authoring tools.
 *
 * Exported for testability.
 */
export function autoDetectCanvasFromObservedCoordinates(
  corners: ReadonlyArray<readonly [number, number]>,
): { width: number; height: number } | undefined {
  if (corners.length === 0) return undefined;
  const total = corners.length;
  // Pre-compute inclusion counts for every candidate so the plateau check can look one tier ahead.
  const inclusion = STANDARD_CANVAS_SIZES.map((candidate) => {
    const widthAllowed = candidate.width * (1 + CANVAS_OVERSHOOT_TOLERANCE);
    const heightAllowed = candidate.height * (1 + CANVAS_OVERSHOOT_TOLERANCE);
    let cornersInside = 0;
    for (const [x, y] of corners) {
      if (x <= widthAllowed && y <= heightAllowed) cornersInside += 1;
    }
    return cornersInside;
  });
  for (let i = 0; i < STANDARD_CANVAS_SIZES.length; i += 1) {
    const cornersInside = inclusion[i]!;
    const ratio = cornersInside / total;
    if (ratio >= 0.9) return STANDARD_CANVAS_SIZES[i]!;
    // Plateau: this tier already captures a meaningful chunk (>30 %) and the next bigger tier adds few new corners
    // (<10 % of total). Those uncaught corners are far-off animation keyframes, not on-screen elements at the next
    // tier's scale — so this tier is the real design canvas.
    if (ratio > 0.3 && i + 1 < STANDARD_CANVAS_SIZES.length) {
      const nextInside = inclusion[i + 1]!;
      const increment = (nextInside - cornersInside) / total;
      if (increment < 0.1) return STANDARD_CANVAS_SIZES[i]!;
    }
  }
  // No tier reached the high-inclusion or plateau gate — cap at the largest entry. The renderer scales-to-fit at the
  // screen level anyway so the only practical effect of this cap is that DST coordinates beyond 2560×1440 get
  // clipped.
  return STANDARD_CANVAS_SIZES[STANDARD_CANVAS_SIZES.length - 1];
}
