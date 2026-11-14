import { describe, expect, test } from 'vite-plus/test';
import { blendBeatorajaMode, premultiplyBlendColor, type BeatorajaCustomBlendMode, type BlendColor } from './blend.ts';
import { blendCodeToPixi } from './render.ts';

/**
 * The oracle: beatoraja's colour written out by hand from `Skin.java` L663-L664, on straight colour (libGDX applies the
 * factor pair to every channel; only the colour is compared, since beatoraja's window alpha is never shown).
 */
function reference(code: 4 | 9, src: BlendColor, dst: BlendColor): [number, number, number] {
  const channel = (index: number) => (code === 4 ? dst[index]! * src[index]! : src[index]! * (1 - dst[index]!));
  return [channel(0), channel(1), channel(2)];
}

const MODE: Record<4 | 9, BeatorajaCustomBlendMode> = { 4: 'beatoraja-multiply', 9: 'beatoraja-invert' };

/** What Be-Music's GPU writes: the registered state on Pixi's premultiplied source. */
function beMusic(code: 4 | 9, src: BlendColor, dst: BlendColor): BlendColor {
  return blendBeatorajaMode(MODE[code], premultiplyBlendColor(src), dst);
}

const close = (actual: readonly number[], expected: readonly number[]) =>
  expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 9));

const OPAQUE_CASES: ReadonlyArray<readonly [name: string, src: BlendColor, dst: BlendColor]> = [
  ['midtones', [0.5, 0.5, 0.5, 1], [0.5, 0.5, 0.5, 1]],
  ['mixed midtones', [0.2, 0.6, 0.8, 1], [0.9, 0.4, 0.25, 1]],
  ['black on white', [0, 0, 0, 1], [1, 1, 1, 1]],
  ['white on black', [1, 1, 1, 1], [0, 0, 0, 1]],
  ['white on white', [1, 1, 1, 1], [1, 1, 1, 1]],
  ['black on black', [0, 0, 0, 1], [0, 0, 0, 1]],
];

describe('beatoraja blend codes 4 and 9', () => {
  test('map to the custom modes that carry the reference factors', () => {
    expect(blendCodeToPixi(4)).toBe('beatoraja-multiply');
    expect(blendCodeToPixi(9)).toBe('beatoraja-invert');
  });

  for (const code of [4, 9] as const) {
    test.each(OPAQUE_CASES)(
      `code ${code}: an opaque texel's colour matches beatoraja exactly (%s)`,
      (_name, src, dst) => {
        close(beMusic(code, src, dst), reference(code, src, dst));
      },
    );

    test(`code ${code}: an opaque destination stays opaque, whatever the texel's alpha`, () => {
      for (const alpha of [0, 0.25, 0.5, 1])
        expect(beMusic(code, [0.7, 0.3, 0.9, alpha], [0.5, 0.5, 0.5, 1])[3]).toBe(1);
    });

    test(`code ${code}: a fully transparent texel leaves the destination as it was`, () => {
      const dst: BlendColor = [0.3, 0.6, 0.9, 1];
      close(beMusic(code, [1, 1, 1, 0], dst), dst);
      close(beMusic(code, [0, 0, 0, 0], dst), dst);
    });
  }

  test('code 9 is src × (1 − dst), not the absolute difference: 0.25 at src = dst = 0.5', () => {
    close(beMusic(9, [0.5, 0.5, 0.5, 1], [0.5, 0.5, 0.5, 1]), [0.25, 0.25, 0.25]);
  });

  test('a translucent texel lies between beatoraja and the untouched destination, by its alpha', () => {
    const src: BlendColor = [0.8, 0.4, 0.2, 0.5];
    const dst: BlendColor = [0.6, 0.6, 0.6, 1];
    for (const code of [4, 9] as const) {
      const expected = reference(code, src, dst).map((value, index) => value * 0.5 + dst[index]! * 0.5);
      close(beMusic(code, src, dst), expected);
    }
    // At alpha 0.5: beatoraja multiplies to 0.48, Be-Music writes halfway between that and the destination's 0.6.
    close(beMusic(4, src, dst), [0.54, 0.42, 0.36, 1]);
  });

  test('over a transparent canvas a texel lays down its own coverage, as the normal blend does', () => {
    expect(beMusic(4, [0.5, 0.5, 0.5, 0.5], [0, 0, 0, 0])[3]).toBe(0.5);
    expect(beMusic(9, [0.5, 0.5, 0.5, 0.5], [0, 0, 0, 0])).toEqual([0.25, 0.25, 0.25, 0.5]);
  });
});
