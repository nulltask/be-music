import type { BeMusicPlayOptions as PlayOptions } from '@be-music/player-skin-sdk';

export type BeMusicPlayOptionChange = {
  [K in keyof PlayOptions]: { key: K; value: PlayOptions[K] };
}[keyof PlayOptions];

/** Semantic requests carry data, never engine instances or callback functions. */
export interface BeMusicUIEventMap {
  'pause-request': undefined;
  'retry-request': undefined;
  'quit-request': undefined;
  'continue-request': undefined;
  'cancel-request': undefined;
  'back-request': undefined;
  'readme-request': undefined;
  'gesture-request': undefined;
  'play-request': { autoPlay: boolean };
  'selection-change': { index: number };
  'activate-request': { index: number };
  'search-change': { value: string };
  'play-option-change': BeMusicPlayOptionChange;
}
export type BeMusicUIEvent<K extends keyof BeMusicUIEventMap> = CustomEvent<BeMusicUIEventMap[K]>;
