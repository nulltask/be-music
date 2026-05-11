/**
 * Sentinel paths used in `Lr2ImageRect.imagePath` for LR2's runtime-bound textures (`#SRC_IMAGE,gr=...`).
 */
export const LR2_SPECIAL_GRAPHIC = {
  STAGEFILE: '__lr2_special:stagefile',
  BACKBMP: '__lr2_special:backbmp',
  BANNER: '__lr2_special:banner',
  SKIN_THUMBNAIL: '__lr2_special:skin_thumbnail',
  BLACK: '__lr2_special:black',
  WHITE: '__lr2_special:white',
} as const;

export type Lr2SpecialGraphic = (typeof LR2_SPECIAL_GRAPHIC)[keyof typeof LR2_SPECIAL_GRAPHIC];

export function isLr2SpecialGraphic(path: string): path is Lr2SpecialGraphic {
  return (
    path === LR2_SPECIAL_GRAPHIC.STAGEFILE ||
    path === LR2_SPECIAL_GRAPHIC.BACKBMP ||
    path === LR2_SPECIAL_GRAPHIC.BANNER ||
    path === LR2_SPECIAL_GRAPHIC.SKIN_THUMBNAIL ||
    path === LR2_SPECIAL_GRAPHIC.BLACK ||
    path === LR2_SPECIAL_GRAPHIC.WHITE
  );
}
