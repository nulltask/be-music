import type {
  BeMusicDOMGameplayFrame,
  BeMusicDOMGameplayActions,
  BeMusicDOMGameplayScreen,
} from '@be-music/player-skin-sdk';
import { mountElement } from './mount.ts';

export function mountGameplay(container: HTMLElement, actions: BeMusicDOMGameplayActions): BeMusicDOMGameplayScreen {
  let previous: BeMusicDOMGameplayFrame | undefined;
  let lastUpdateMs = -Infinity;
  // Mounted first so the HUD stays above the lanes.
  const playfield = mountElement(container, 'be-music-playfield', {});
  const hud = mountElement<BeMusicDOMGameplayFrame>(
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
  return {
    update: (frame) => hud.update(frame),
    drawPlayfield: (frame) => playfield.update(frame),
    dispose() {
      hud.dispose();
      playfield.dispose();
    },
  };
}
