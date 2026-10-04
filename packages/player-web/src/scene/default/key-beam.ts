import { Color, FillGradient, type Graphics } from 'pixi.js';

/**
 * Key-beam edges shared by the built-in skins. A pressed lane lights two crisp rails along its own edges, brightest at
 * the judgement line and fading out toward the top, so the beam reads clearly at a glance while the middle of the lane
 * — where the notes fall — keeps only a faint wash and the notes keep their contrast.
 */

const EDGE_GRADIENTS = new Map<number, FillGradient>();

function edgeGradient(color: number): FillGradient {
  let gradient = EDGE_GRADIENTS.get(color);
  if (!gradient) {
    const rgb = new Color(color);
    gradient = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      textureSpace: 'local',
      colorStops: [
        { offset: 0, color: rgb.setAlpha(0).toRgbaString() },
        { offset: 0.4, color: rgb.setAlpha(0.3).toRgbaString() },
        { offset: 0.8, color: rgb.setAlpha(0.8).toRgbaString() },
        { offset: 1, color: rgb.setAlpha(1).toRgbaString() },
      ],
    });
    EDGE_GRADIENTS.set(color, gradient);
  }
  return gradient;
}

/** Edge rail width for a lane `w` px wide: 2 px once the lane is wide enough to keep a clear middle, else 1 px. */
export function keyBeamEdgeWidth(w: number): number {
  return w >= 18 ? 2 : 1;
}

/**
 * Draws the two edge rails of a key beam over `[bottom - height, bottom]` inside the lane `x..x + w` (inset by `inset`
 * px from each edge), in `color` at `alpha`.
 */
export function drawKeyBeamEdges(
  graphics: Graphics,
  x: number,
  w: number,
  bottom: number,
  height: number,
  color: number,
  alpha: number,
  inset = 1,
): void {
  if (alpha <= 0 || height <= 0) return;
  const edge = keyBeamEdgeWidth(w);
  const top = bottom - height;
  const fill = { fill: edgeGradient(color), alpha };
  graphics.rect(x + inset, top, edge, height).fill(fill);
  graphics.rect(x + w - inset - edge, top, edge, height).fill(fill);
}
