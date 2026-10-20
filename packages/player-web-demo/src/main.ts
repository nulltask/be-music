// The demo's bootstrap: the page's markup, the browser check, the device classes and the Help modal, then the app
// (`app/app.ts`) once the UI fonts are ready, with the test hook installed over it before it starts.
import { checkBrowserCompat } from '@be-music/player-web/collection';
import { PlayerWebDemoApp } from './app/app.ts';
import { wireHelpModal } from './help-modal.ts';
import { DEMO_APP_HTML } from './dom-template.ts';
import { renderBrowserCompatPanel } from './compat-panel.ts';
import { readDeviceSignals, resolveDeviceProfile } from './device-profile.ts';
import { waitForDefaultUIFonts } from './services/built-in-skins.ts';
import { isTestHookEnabled, TestHookRecorder } from './test-hook.ts';
import { liveTestHookState } from './services/test-hook.ts';
import './styles.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('missing #app');
}

app.innerHTML = DEMO_APP_HTML;

// Browser compatibility probe runs first so the drop card paints the readiness verdict immediately on first render. We
// do this BEFORE constructing the demo app so that even a hard-fail (Pixi `Application.init()` throwing on a no-WebGL2
// browser) still leaves the user looking at the unsupported-browser message rather than a blank canvas.
renderBrowserCompatPanel(checkBrowserCompat());

// Phones and tablets: lighter chrome over the stage, touch play controls, and a rotate prompt on phones held upright
// (see the `html.touch-first` / `html.phone` rules in styles.css).
const deviceProfile = resolveDeviceProfile(readDeviceSignals());
document.documentElement.classList.toggle('touch-first', deviceProfile.touchFirst);
document.documentElement.classList.toggle('phone', deviceProfile.phone);

// Wire up the bottom-right Help button + unified Help / OSS modal. The acknowledgement list is rendered lazily on first
// open of the OSS tab, so the initial paint isn't blocked on rendering ~30 dependency cards.
wireHelpModal();

void waitForDefaultUIFonts().finally(() => {
  // `window.__beMusicTest` for the end-to-end suite (`?e2e=1` or a development build; `test-hook.ts`).
  const testHook = isTestHookEnabled(window.location.href, import.meta.env.DEV) ? new TestHookRecorder() : undefined;
  const demo = new PlayerWebDemoApp({
    elements: {
      stage: document.querySelector<HTMLDivElement>('#stage')!,
      shell: document.querySelector<HTMLDivElement>('.shell')!,
      songInput: document.querySelector<HTMLInputElement>('#songs')!,
      filesInput: document.querySelector<HTMLInputElement>('#files')!,
      searchInput: document.querySelector<HTMLInputElement>('#search')!,
      loadingOverlay: document.querySelector<HTMLDivElement>('#loading-overlay')!,
      loadingLabel: document.querySelector<HTMLDivElement>('#loading-label')!,
      loadingBarFill: document.querySelector<HTMLDivElement>('#loading-bar-fill')!,
      loadingCounter: document.querySelector<HTMLDivElement>('#loading-counter')!,
    },
    deviceProfile,
    testHook,
  });
  // Installed before the app starts, so the hook sees the first select screen come up.
  if (testHook !== undefined) {
    const testHookDeps = demo.testHookDeps();
    testHook.install(window, () => liveTestHookState(testHookDeps));
  }
  demo.start();
});
