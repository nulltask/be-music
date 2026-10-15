import { describe, expect, it } from 'vite-plus/test';
import { resolveResultViewJingles } from './result-jingles.ts';

const bytes = (tag: number): Uint8Array => new Uint8Array([tag]);
const lr2 = { clear: bytes(1), fail: bytes(2), result: bytes(3), courseClear: bytes(4), courseFail: bytes(5) };
const beatoraja = {
  clear: bytes(11),
  fail: bytes(12),
  result: bytes(13),
  courseClear: bytes(14),
  courseFail: bytes(15),
};

describe('resolveResultViewJingles', () => {
  it("plays the LR2 theme's jingles on an LR2 or built-in result", () => {
    expect(resolveResultViewJingles('lr2', false, { lr2, beatoraja })).toEqual({
      clearBgm: lr2.clear,
      failBgm: lr2.fail,
      resultBgm: lr2.result,
    });
    expect(resolveResultViewJingles('default', true, { lr2, beatoraja })).toEqual({
      clearBgm: lr2.courseClear,
      failBgm: lr2.courseFail,
      resultBgm: lr2.result,
    });
  });

  it("plays the beatoraja theme's jingles on a result that falls back from a beatoraja theme", () => {
    // A NONSTOP course has no beatoraja scene: its result shows on the built-in view with the theme's sound set.
    expect(resolveResultViewJingles('beatoraja', false, { lr2, beatoraja })).toEqual({
      clearBgm: beatoraja.clear,
      failBgm: beatoraja.fail,
      resultBgm: beatoraja.result,
    });
    expect(resolveResultViewJingles('beatoraja', true, { lr2, beatoraja })).toEqual({
      clearBgm: beatoraja.courseClear,
      failBgm: beatoraja.courseFail,
      resultBgm: beatoraja.result,
    });
  });

  it("keeps the beatoraja theme's set whole, and uses the LR2 set only when it has no result jingle", () => {
    expect(resolveResultViewJingles('beatoraja', true, { lr2, beatoraja: { result: bytes(13) } })).toEqual({
      resultBgm: bytes(13),
    });
    expect(resolveResultViewJingles('beatoraja', false, { lr2, beatoraja: { decide: bytes(10) } })).toEqual({
      clearBgm: lr2.clear,
      failBgm: lr2.fail,
      resultBgm: lr2.result,
    });
  });
});
