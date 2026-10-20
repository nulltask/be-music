export const IMAGE_RESIZE_ALGORITHMS = ['nearest', 'lanczos'] as const;

export type ImageResizeAlgorithm = (typeof IMAGE_RESIZE_ALGORITHMS)[number];

export const DEFAULT_IMAGE_RESIZE_ALGORITHM: ImageResizeAlgorithm = 'nearest';

export function isImageResizeAlgorithm(value: string): value is ImageResizeAlgorithm {
  return IMAGE_RESIZE_ALGORITHMS.includes(value as ImageResizeAlgorithm);
}
