import { defineBeMusicElements } from '@be-music/player-ui';
import type { BeMusicDOMScreen } from '@be-music/player-skin-sdk';
import { NATIVE_EYEBROW, adoptNativeTheme } from './theme.ts';

/** Native only adapts scene frames and intents to the reusable presentation elements. */
export function mountElement<Frame>(
  container: HTMLElement,
  tag:
    | 'be-music-select-screen'
    | 'be-music-gameplay-hud'
    | 'be-music-playfield'
    | 'be-music-result-screen'
    | 'be-music-decide-screen',
  listeners: Readonly<Record<string, EventListener>>,
  shouldUpdate?: (frame: Frame) => boolean,
): BeMusicDOMScreen<Frame> {
  const registry = container.ownerDocument.defaultView?.customElements;
  if (!registry) throw new Error('Native skin requires a window with Custom Elements support.');
  defineBeMusicElements(registry);
  const element = container.ownerDocument.createElement(tag) as HTMLElement & {
    frame: Frame | undefined;
    focusSearch?: () => void;
  };
  element.dataset.nativeScreen =
    tag === 'be-music-gameplay-hud' ? 'gameplay' : tag.slice('be-music-'.length).replace('-screen', '');
  Object.assign(element.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
  if (tag === 'be-music-select-screen') {
    const eyebrow = container.ownerDocument.createElement('span');
    eyebrow.slot = 'eyebrow';
    eyebrow.textContent = NATIVE_EYEBROW;
    element.append(eyebrow);
  }
  const releaseTheme = adoptNativeTheme(container);
  const entries = Object.entries(listeners);
  for (const [name, listener] of entries) element.addEventListener(name, listener);
  container.append(element);
  let disposed = false;
  return {
    update(frame) {
      if (!disposed && (!shouldUpdate || shouldUpdate(frame))) element.frame = frame;
    },
    ...(tag === 'be-music-select-screen' ? { focusSearch: () => element.focusSearch?.() } : {}),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const [name, listener] of entries) element.removeEventListener(name, listener);
      element.remove();
      releaseTheme();
    },
  };
}
