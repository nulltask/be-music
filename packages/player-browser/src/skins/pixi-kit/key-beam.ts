import { Color, FillGradient } from 'pixi.js';

/**
 * Key-beam gradient shared by the built-in skins: the lane's colour standing solid at the judgement line and easing out
 * toward the top along a curve, so a press reads as a clear laser at a glance while the upper lane — where the notes
 * are still on their way down — only carries a faint tint.
 */

/** Opacity stops, from the top of the beam (offset 0) to the judgement line (offset 1). */
export const KEY_BEAM_STOPS: ReadonlyArray<{ offset: number; alpha: number }> = [
  { offset: 0, alpha: 0 },
  { offset: 0.3, alpha: 0.05 },
  { offset: 0.6, alpha: 0.2 },
  { offset: 0.82, alpha: 0.48 },
  { offset: 0.94, alpha: 0.75 },
  { offset: 1, alpha: 0.9 },
];

const GRADIENTS = new Map<number, FillGradient>();

/** Vertical beam gradient in `color` (cached per colour); fill a lane-wide rect ending at the judgement line with it. */
export function keyBeamGradient(color: number): FillGradient {
  let gradient = GRADIENTS.get(color);
  if (!gradient) {
    const rgb = new Color(color);
    gradient = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      textureSpace: 'local',
      colorStops: KEY_BEAM_STOPS.map((stop) => ({
        offset: stop.offset,
        color: rgb.setAlpha(stop.alpha).toRgbaString(),
      })),
    });
    GRADIENTS.set(color, gradient);
  }
  return gradient;
}
