import type {
  BeMusicDOMResultFrame,
  BeMusicDOMResultActions,
  BeMusicDOMDecideFrame,
  BeMusicDOMDecideActions,
  BeMusicDOMScreen,
} from '@be-music/player-skin-sdk';
import { mountElement } from './mount.ts';

export function mountResult(
  container: HTMLElement,
  actions: BeMusicDOMResultActions,
): BeMusicDOMScreen<BeMusicDOMResultFrame> {
  return mountElement(container, 'be-music-result-screen', {
    'continue-request': () => actions.continue(),
    'retry-request': () => actions.retry(),
  });
}
export function mountDecide(
  container: HTMLElement,
  actions: BeMusicDOMDecideActions,
): BeMusicDOMScreen<BeMusicDOMDecideFrame> {
  return mountElement(container, 'be-music-decide-screen', {
    'continue-request': () => actions.continue(),
    'cancel-request': () => actions.cancel(),
  });
}
