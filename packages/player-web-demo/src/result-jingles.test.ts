import { describe, expect, it } from 'vite-plus/test';
import { resolveResultSoundSet, resolveResultViewJingles } from './result-jingles.ts';

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
      clearBGM: lr2.clear,
      failBGM: lr2.fail,
      resultBGM: lr2.result,
    });
    expect(resolveResultViewJingles('default', true, { lr2, beatoraja })).toEqual({
      clearBGM: lr2.courseClear,
      failBGM: lr2.courseFail,
      resultBGM: lr2.result,
    });
  });

  it("plays the beatoraja theme's jingles on a result that falls back from a beatoraja theme", () => {
    // A NONSTOP course has no beatoraja scene: its result shows on the built-in view with the theme's sound set.
    expect(resolveResultViewJingles('beatoraja', false, { lr2, beatoraja })).toEqual({
      clearBGM: beatoraja.clear,
      failBGM: beatoraja.fail,
      resultBGM: beatoraja.result,
    });
    expect(resolveResultViewJingles('beatoraja', true, { lr2, beatoraja })).toEqual({
      clearBGM: beatoraja.courseClear,
      failBGM: beatoraja.courseFail,
      resultBGM: beatoraja.result,
    });
  });

  it("keeps the beatoraja theme's set whole, and uses the LR2 set only when it has no result jingle", () => {
    expect(resolveResultViewJingles('beatoraja', true, { lr2, beatoraja: { result: bytes(13) } })).toEqual({
      resultBGM: bytes(13),
    });
    expect(resolveResultViewJingles('beatoraja', false, { lr2, beatoraja: { decide: bytes(10) } })).toEqual({
      clearBGM: lr2.clear,
      failBGM: lr2.fail,
      resultBGM: lr2.result,
    });
  });
});

describe('resolveResultSoundSet', () => {
  it("is the LR2 theme's set on an LR2 or built-in result", () => {
    const set = resolveResultSoundSet('default', { lr2, beatoraja });
    expect(set.clear?.bytes).toBe(lr2.clear);
    expect(set.courseFail?.bytes).toBe(lr2.courseFail);
    expect(resolveResultSoundSet('lr2', { lr2, beatoraja }).fail?.bytes).toBe(lr2.fail);
  });

  it("is the beatoraja theme's set on a result that falls back from it, unless it has no result jingle", () => {
    expect(resolveResultSoundSet('beatoraja', { lr2, beatoraja }).clear?.bytes).toBe(beatoraja.clear);
    expect(resolveResultSoundSet('beatoraja', { lr2, beatoraja: { result: bytes(13) } })).toEqual({
      result: { bytes: bytes(13) },
    });
    expect(resolveResultSoundSet('beatoraja', { lr2, beatoraja: { decide: bytes(10) } }).clear?.bytes).toBe(lr2.clear);
  });

  it('is empty without any theme jingle', () => {
    expect(resolveResultSoundSet('default', { lr2: {}, beatoraja: {} })).toEqual({});
  });
});
