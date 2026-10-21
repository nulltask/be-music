import type { BeMusicDOMGameplayFrame, BeMusicDOMGameplayActions, BeMusicDOMScreen } from '@be-music/player-skin-sdk';
import { mountElement } from './mount.ts';

export function mountGameplay(
  container: HTMLElement,
  actions: BeMusicDOMGameplayActions,
): BeMusicDOMScreen<BeMusicDOMGameplayFrame> {
  let previous: BeMusicDOMGameplayFrame | undefined;
  let lastUpdateMs = -Infinity;
  return mountElement(
    container,
    'be-music-gameplay-hud',
    {
      'pause-request': () => actions.pause(),
      'retry-request': () => actions.restart(),
      'quit-request': () => actions.quit(),
    },
    (frame) => {
      const nowMs = frame.runtime.nowMs ?? frame.seconds * 1000;
      if (
        previous &&
        previous.stage === frame.stage &&
        previous.layout.orientation === frame.layout.orientation &&
        previous.layout.stage.width === frame.layout.stage.width &&
        previous.layout.stage.height === frame.layout.stage.height &&
        previous.state.view === frame.state.view &&
        nowMs >= lastUpdateMs &&
        nowMs - lastUpdateMs < 80
      )
        return false;
      previous = frame;
      lastUpdateMs = nowMs;
      return true;
    },
  );
}
