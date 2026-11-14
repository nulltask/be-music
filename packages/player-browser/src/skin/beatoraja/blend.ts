/**
 * beatoraja's blend codes 4 and 9 as framebuffer blend states. beatoraja sets them with libGDX's
 * `SpriteBatch.setBlendFunction(src, dst)` (`Skin.java` L663-L664, at `83574048ba489082eb46df7fe9806b464bf1f526`):
 *
 * - `4`: `(GL_ZERO, GL_SRC_COLOR)`: the colour becomes `dst × src`.
 * - `9`: `(GL_ONE_MINUS_DST_COLOR, GL_ZERO)`: the colour becomes `src × (1 − dst)`. Not the absolute difference: at
 *   src = dst = 0.5 it gives 0.25.
 *
 * beatoraja blends straight (non-premultiplied) colour, its normal blend being `(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA)`
 * (`Skin.java` L681), into a window whose alpha is never shown. Be-Music differs in both, so it takes the reference
 * factors for the colour of an opaque texel and adapts the rest:
 *
 * - **Colour.** Pixi hands the GPU premultiplied colour `p = c × a`. Adding `dst × (1 − a)` to the reference term gives
 *   `dst × p + dst × (1 − a)` for code 4 and `p × (1 − dst) + dst × (1 − a)` for code 9: exactly beatoraja's colour for
 *   an opaque texel (`a = 1`), and the destination unchanged under a fully transparent one. beatoraja would instead
 *   blend in whatever colour a transparent texel stores, which premultiplied colour no longer holds; leaving the
 *   destination is how a skin drawn for beatoraja looks where its textures are clear. A translucent texel lies between
 *   the two, so it differs from beatoraja in proportion to its transparency.
 * - **Alpha.** The skin canvas is transparent and laid over the page, so the alpha the GPU writes is visible. The
 *   reference factors would write `srcA × dstA` (code 4) and `srcA × (1 − dstA)` (code 9), the latter punching a hole
 *   through any opaque destination. Both codes write coverage as the normal blend does (`srcA + dstA × (1 − srcA)`)
 *   instead, so an opaque destination stays opaque.
 */

/** A blend factor, named as WebGPU names them; each GL constant of the same meaning is picked from it. */
export type BeatorajaBlendFactor = 'zero' | 'one' | 'src' | 'dst' | 'one-minus-dst' | 'one-minus-src-alpha';

/** The Pixi blend modes Be-Music registers for beatoraja's codes 4 and 9. */
export type BeatorajaCustomBlendMode = 'beatoraja-multiply' | 'beatoraja-invert';

/** A blend state: the `(source, destination)` factors for the colour channels and for alpha. */
export interface BeatorajaBlendState {
  readonly color: readonly [src: BeatorajaBlendFactor, dst: BeatorajaBlendFactor];
  readonly alpha: readonly [src: BeatorajaBlendFactor, dst: BeatorajaBlendFactor];
}

/** The normal blend's coverage for premultiplied colour, which both codes write as their alpha. */
const COVERAGE = ['one', 'one-minus-src-alpha'] as const;

/** The blend state of each custom mode. */
export const BEATORAJA_BLEND_STATES: Readonly<Record<BeatorajaCustomBlendMode, BeatorajaBlendState>> = {
  'beatoraja-multiply': { color: ['dst', 'one-minus-src-alpha'], alpha: COVERAGE },
  'beatoraja-invert': { color: ['one-minus-dst', 'one-minus-src-alpha'], alpha: COVERAGE },
};

/** An RGBA colour, each channel 0..1. */
export type BlendColor = readonly [r: number, g: number, b: number, a: number];

/**
 * The colour a framebuffer holds after the GPU blends premultiplied `src` onto `dst` with `mode`'s state
 * (`src × srcFactor + dst × dstFactor`, channel by channel), as GL and WebGPU compute it.
 */
export function blendBeatorajaMode(mode: BeatorajaCustomBlendMode, src: BlendColor, dst: BlendColor): BlendColor {
  const state = BEATORAJA_BLEND_STATES[mode];
  const channel = (index: number) => {
    const [srcFactor, dstFactor] = index === 3 ? state.alpha : state.color;
    return (
      src[index]! * factorValue(srcFactor, src, dst, index) + dst[index]! * factorValue(dstFactor, src, dst, index)
    );
  };
  return [channel(0), channel(1), channel(2), channel(3)];
}

/** `color` premultiplied by its alpha, as Pixi hands a texel to the GPU. */
export function premultiplyBlendColor(color: BlendColor): BlendColor {
  const [r, g, b, a] = color;
  return [r * a, g * a, b * a, a];
}

function factorValue(factor: BeatorajaBlendFactor, src: BlendColor, dst: BlendColor, index: number): number {
  switch (factor) {
    case 'zero':
      return 0;
    case 'one':
      return 1;
    case 'src':
      return src[index]!;
    case 'dst':
      return dst[index]!;
    case 'one-minus-dst':
      return 1 - dst[index]!;
    case 'one-minus-src-alpha':
      return 1 - src[3]!;
  }
}
