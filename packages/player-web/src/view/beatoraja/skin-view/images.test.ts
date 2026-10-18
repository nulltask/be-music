import { describe, expect, it } from 'vite-plus/test';
import { makeSyntheticChartImage, SYNTHETIC_IMAGE_STAGEFILE_ID } from './images.ts';

describe('makeSyntheticChartImage', () => {
  it('spans the whole texture as one static, inert cell', () => {
    expect(makeSyntheticChartImage(SYNTHETIC_IMAGE_STAGEFILE_ID, 640, 480)).toEqual({
      id: SYNTHETIC_IMAGE_STAGEFILE_ID,
      src: 0,
      x: 0,
      y: 0,
      w: 640,
      h: 480,
      divx: 1,
      divy: 1,
      timer: 0,
      cycle: 0,
      ref: 0,
      len: 0,
      act: 0,
      click: 0,
      disapearLine: -1,
      isDisapearLineLinkLift: false,
      ifCodes: [],
    });
  });
});
