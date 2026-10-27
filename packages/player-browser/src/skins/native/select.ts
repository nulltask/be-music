import type { BeMusicDOMSelectFrame, BeMusicDOMSelectActions, BeMusicDOMScreen } from '@be-music/player-skin-sdk';
import type { BeMusicUIEvent } from '@be-music/player-ui';
import { mountElement } from './mount.ts';

export function mountSelect(
  container: HTMLElement,
  actions: BeMusicDOMSelectActions,
): BeMusicDOMScreen<BeMusicDOMSelectFrame> {
  return mountElement(container, 'be-music-select-screen', {
    'search-change': (event) => actions.search((event as BeMusicUIEvent<'search-change'>).detail.value),
    'selection-change': (event) => actions.focus((event as BeMusicUIEvent<'selection-change'>).detail.index),
    'activate-request': () => actions.activate(),
    'play-request': (event) => actions.play((event as BeMusicUIEvent<'play-request'>).detail.autoPlay),
    'back-request': () => actions.back(),
    'readme-request': () => actions.readText(),
    'gesture-request': () => actions.gesture(),
    'play-option-change': (event) => {
      const { key, value } = (event as BeMusicUIEvent<'play-option-change'>).detail;
      actions.setPlayOption(key, value);
    },
  });
}
