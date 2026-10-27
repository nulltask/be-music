import { describe, expect, it } from 'vite-plus/test';
import { resolvePreviewBGARect, resolvePreviewInfoBox, resolvePreviewPortrait } from './preview-layout.ts';

const stage = { width: 854, height: 480 };

describe('resolvePreviewBGARect', () => {
  it('fills the height above the controls beside narrow lanes, leaving the facts room on its right', () => {
    // 5 KEY lanes end around x 184: the BGA reaches from the top margin to the controls (480 × 0.86 = 413).
    expect(resolvePreviewBGARect(stage, 184)).toEqual({ x: 208, y: 16, w: 397, h: 397 });
  });

  it('shrinks to leave the facts their narrowest width beside it', () => {
    // 854 − 16 − 324 = 514 wide: 514 − 24 − 200 = 290 beats 397 − 140 = 257 with the facts under it.
    expect(resolvePreviewBGARect(stage, 300)).toEqual({ x: 324, y: 16, w: 290, h: 290 });
  });

  it('puts the facts under it when wide lanes leave too little room beside it', () => {
    // 214 wide: the facts cannot sit beside it, so the BGA takes the width and the facts go under it.
    expect(resolvePreviewBGARect(stage, 600)).toEqual({ x: 624, y: 16, w: 214, h: 214 });
  });

  it('never reaches over the lanes', () => {
    for (const right of [0, 100, 184, 300, 403, 600, 800]) {
      const rect = resolvePreviewBGARect(stage, right);
      expect(rect.x).toBeGreaterThanOrEqual(right + 24);
      expect(rect.x + rect.w).toBeLessThanOrEqual(854 - 16);
      expect(rect.y + rect.h).toBeLessThanOrEqual(413);
    }
  });
});

describe('resolvePreviewPortrait', () => {
  it('puts the BGA square across the top, the facts in a band under it and the lanes below both on a phone', () => {
    // 375×812: 480×1039 design px. 894 − 16 − 260 − 16 = 602 tall, less the facts' 12 + 220 leaves 370.
    const stage = { width: 480, height: 1039 };
    expect(resolvePreviewPortrait(stage)).toEqual({
      bga: { x: 55, y: 16, w: 370, h: 370 },
      info: { left: 16, top: 398, right: 464, bottom: 618 },
      laneTop: 634,
      judgementY: 858,
    });
    expect(resolvePreviewBGARect(stage, 427)).toEqual({ x: 55, y: 16, w: 370, h: 370 });
  });

  it('puts the facts beside the BGA on a stage close to square', () => {
    // 768×1024: 480×640. Under it the BGA would be 26 px; beside it, 448 − 24 − 200 = 224.
    expect(resolvePreviewPortrait({ width: 480, height: 640 })).toEqual({
      bga: { x: 16, y: 16, w: 224, h: 224 },
      info: { left: 264, top: 16, right: 464, bottom: 240 },
      laneTop: 256,
      judgementY: 514,
    });
  });

  it('keeps the BGA, the facts and the lanes apart and clear of the video controls', () => {
    for (const height of [600, 640, 854, 1039, 1200]) {
      const stage = { width: 480, height };
      const { bga, info, laneTop, judgementY } = resolvePreviewPortrait(stage)!;
      const besideBGA = info.left >= bga.x + bga.w;
      if (!besideBGA) expect(bga.y + bga.h).toBeLessThan(info.top);
      expect(Math.max(bga.y + bga.h, info.bottom)).toBeLessThan(laneTop);
      expect(laneTop).toBeLessThan(judgementY);
      expect(judgementY).toBeLessThan(Math.round(height * 0.86));
    }
  });

  it('is unused on a landscape stage', () => {
    expect(resolvePreviewPortrait({ width: 854, height: 480 })).toBeUndefined();
  });
});

describe('resolvePreviewInfoBox', () => {
  it('puts the facts beside a BGA that leaves room on its right', () => {
    const bga = resolvePreviewBGARect(stage, 184);
    expect(resolvePreviewInfoBox({ stage, bga, playfield: { right: 184 } })).toEqual({
      left: 629,
      top: 16,
      right: 838,
      bottom: 413,
    });
  });

  it('puts the facts under a BGA that takes the width', () => {
    const bga = resolvePreviewBGARect(stage, 600);
    expect(resolvePreviewInfoBox({ stage, bga, playfield: { right: 600 } })).toEqual({
      left: 624,
      top: 242,
      right: 838,
      bottom: 413,
    });
  });

  it('gives the facts their own band on a tall stage', () => {
    const stage = { width: 480, height: 1039 };
    const portrait = resolvePreviewPortrait(stage)!;
    expect(resolvePreviewInfoBox({ stage, bga: portrait.bga, playfield: { right: 427 } })).toEqual(portrait.info);
  });

  it('puts the facts right of the lanes without a BGA', () => {
    expect(resolvePreviewInfoBox({ stage, playfield: { right: 300 } })).toEqual({
      left: 324,
      top: 16,
      right: 838,
      bottom: 413,
    });
  });
});
