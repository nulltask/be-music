import { expect, test } from 'vite-plus/test';
import { JUDGE_AREA_ALPHA, renderJudgeArea, resolveJudgeAreaBands } from './judge-area.ts';

const reach = (ms: number) => ({ earlyMs: ms, lateMs: ms });
const windows = {
  perfect: reach(20),
  great: reach(60),
  good: reach(150),
  bad: reach(280),
  emptyPoor: reach(500),
};

test('stacks one band per judgment, each from the window inside it', () => {
  expect(resolveJudgeAreaBands(windows)).toEqual([
    { fromMs: 0, toMs: 20, color: 0x0000ff },
    { fromMs: 20, toMs: 60, color: 0x00ff00 },
    { fromMs: 60, toMs: 150, color: 0xffff00 },
    { fromMs: 150, toMs: 280, color: 0xff8000 },
    { fromMs: 280, toMs: 500, color: 0xff0000 },
  ]);
});

test('draws no band for a missing window or one no wider than the window inside it', () => {
  expect(resolveJudgeAreaBands(undefined)).toEqual([]);
  // LR2's GAMBOL LEVEL 2 gives GREAT and GOOD the same reach, and LR2 has no miss window.
  const narrow = { perfect: reach(8), great: reach(12), good: reach(12), bad: reach(200) };
  expect(resolveJudgeAreaBands(narrow).map((band) => [band.fromMs, band.toMs])).toEqual([
    [0, 8],
    [8, 12],
    [12, 200],
  ]);
});

test('draws each lane with its own window set, clipped to the lane', () => {
  const drawn: { x: number; y: number; w: number; h: number; color: number; alpha: number }[] = [];
  const pool = {
    acquireGraphics: () => ({
      rect: (x: number, y: number, w: number, h: number) => ({
        fill: (style: { color: number; alpha: number }) => drawn.push({ x, y, w, h, ...style }),
      }),
    }),
  };
  renderJudgeArea({
    lanes: [
      { x: 10, w: 30, top: 0, bottom: 400, scratch: false },
      { x: 50, w: 60, top: 300, bottom: 400, scratch: true },
    ],
    note: { perfect: reach(20), great: reach(60), good: reach(60), bad: reach(60) },
    scratch: { perfect: reach(40), great: reach(40), good: reach(40), bad: reach(300) },
    // One pixel per millisecond.
    distanceAt: (ms) => ms,
    pool,
  });
  expect(drawn).toEqual([
    { x: 10, y: 380, w: 30, h: 20, color: 0x0000ff, alpha: JUDGE_AREA_ALPHA },
    { x: 10, y: 340, w: 30, h: 40, color: 0x00ff00, alpha: JUDGE_AREA_ALPHA },
    { x: 50, y: 360, w: 60, h: 40, color: 0x0000ff, alpha: JUDGE_AREA_ALPHA },
    // BAD reaches 300 ms, past the top of a 100-pixel lane.
    { x: 50, y: 300, w: 60, h: 60, color: 0xff8000, alpha: JUDGE_AREA_ALPHA },
  ]);
});
