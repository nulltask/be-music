/**
 * Pure pieces of the LRX BGA compositor (`lrx-bga-compositor.ts`): where a note rotates about, and how it blends.
 */

/**
 * The point a note rotates about, from its `ctr` (plugout's numeric-keypad layout: 7 top left, 8 top, 9 top right, 4
 * left, 5 or 0 the middle, 6 right, 1 bottom left, 2 bottom, 3 bottom right) on its destination rectangle.
 */
export function resolveLRXBGAPivot(
  center: number,
  x: number,
  y: number,
  w: number,
  h: number,
): readonly [number, number] {
  const column =
    center === 1 || center === 4 || center === 7 ? 0 : center === 3 || center === 6 || center === 9 ? 1 : 0.5;
  const row = center === 7 || center === 8 || center === 9 ? 0 : center === 1 || center === 2 || center === 3 ? 1 : 0.5;
  return [x + w * column, y + h * row];
}

/** A WebGL blend state: the equation and the source and destination factors, as WebGL names them. */
export interface LRXBGABlend {
  readonly equation: 'FUNC_ADD' | 'FUNC_REVERSE_SUBTRACT';
  readonly source: 'ONE' | 'SRC_ALPHA' | 'DST_COLOR';
  readonly destination: 'ONE_MINUS_SRC_ALPHA' | 'ONE_MINUS_SRC_COLOR' | 'SRC_COLOR';
}

/**
 * The blend state a note's `bld` draws with, as plugout's Direct3D 9 driver sets it for a 2D image (`plugout4.exe`
 * 0x592c5c, `D3DRS_BLENDOP` / `SRCBLEND` / `DESTBLEND`). The source is the picture times the note's colour, alpha
 * included (texture stage 0 modulates both):
 *
 * - 1 (Add): `src + dst × (1 − src)`, the source's alpha unused.
 * - 2 (Sub): `dst × (1 − src) − src × α`, a reverse subtraction clamped at 0.
 * - 3 (Mul): `src × α + dst × src`.
 * - 4: `src × dst + dst × (1 − α)`.
 * - Anything else, 0 (Alpha) among them: `src × α + dst × (1 − α)`.
 */
export function resolveLRXBGABlend(blend: number): LRXBGABlend {
  switch (blend) {
    case 1:
      return { equation: 'FUNC_ADD', source: 'ONE', destination: 'ONE_MINUS_SRC_COLOR' };
    case 2:
      return { equation: 'FUNC_REVERSE_SUBTRACT', source: 'SRC_ALPHA', destination: 'ONE_MINUS_SRC_COLOR' };
    case 3:
      return { equation: 'FUNC_ADD', source: 'SRC_ALPHA', destination: 'SRC_COLOR' };
    case 4:
      return { equation: 'FUNC_ADD', source: 'DST_COLOR', destination: 'ONE_MINUS_SRC_ALPHA' };
    default:
      return { equation: 'FUNC_ADD', source: 'SRC_ALPHA', destination: 'ONE_MINUS_SRC_ALPHA' };
  }
}

/**
 * The four corners of a destination rectangle turned by `degrees` (clockwise on the y-down screen) about the pivot:
 * top left, top right, bottom left, bottom right.
 */
export function resolveLRXBGAQuad(
  x: number,
  y: number,
  w: number,
  h: number,
  pivot: readonly [number, number],
  degrees: number,
): readonly [number, number][] {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const [px, py] = pivot;
  return [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ].map(([cx, cy]) => {
    const dx = cx! - px;
    const dy = cy! - py;
    return [px + dx * cos - dy * sin, py + dx * sin + dy * cos] as [number, number];
  });
}
