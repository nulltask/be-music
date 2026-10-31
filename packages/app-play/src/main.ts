import {
  configureBGAVideoWorkers,
  configureBrowserWorkers,
  setBrowserWorkerCount,
  disposeBrowserWorkers,
} from '@be-music/player-browser/compute';
import { migratePlayerStorage } from './debug-menu-storage.ts';
import { readWorkerCount } from './worker-settings.ts';
import { debugMenuSettingsSync } from './debug-menu-settings-sync.ts';
// The player's bootstrap: the page's markup, the browser check, the device classes and the Help modal, then the app
// (`app/app.ts`) once the UI fonts are ready, with the test hook installed over it before it starts.
import { checkBrowserCompat } from '@be-music/player-browser/collection';
import { PlayerWebApp } from './app/app.ts';
import { wireHelpModal } from './help-modal.ts';
import { PLAYER_APP_HTML } from './dom-template.ts';
import { renderBrowserCompatPanel } from './compat-panel.ts';
import { readDeviceSignals, resolveDeviceProfile } from './device-profile.ts';
import { waitForDefaultUIFonts } from './services/built-in-skins.ts';
import { isTestHookEnabled, TestHookRecorder } from './test-hook.ts';
import { liveTestHookState } from './services/test-hook.ts';
import './styles.css';

let workerStorage: Storage | undefined;
try {
  workerStorage = globalThis.localStorage;
} catch {
  /* Storage can be disabled. */
}
migratePlayerStorage(workerStorage);
setBrowserWorkerCount(readWorkerCount(workerStorage, navigator.hardwareConcurrency));
configureBrowserWorkers(() => new Worker(new URL('./compute-worker.ts', import.meta.url), { type: 'module' }));
// A BGA video the browser can't play streams through these while ffmpeg.wasm transcodes it.
configureBGAVideoWorkers({
  createDecodeWorker: () => new Worker(new URL('./bga-decode-worker.ts', import.meta.url), { type: 'module' }),
  createEncodeWorker: () => new Worker(new URL('./bga-encode-worker.ts', import.meta.url), { type: 'module' }),
});
window.addEventListener('pagehide', (event) => {
  void debugMenuSettingsSync.flush();
  if (!event.persisted) disposeBrowserWorkers();
});

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('missing #app');
}

app.innerHTML = PLAYER_APP_HTML;

// Browser compatibility probe runs first so the drop card paints the readiness verdict immediately on first render. We
// do this BEFORE constructing the player app so that even a hard-fail (Pixi `Application.init()` throwing on a no-WebGL2
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

void waitForDefaultUIFonts()
  .then(() => debugMenuSettingsSync.reconcile())
  .finally(() => {
    setBrowserWorkerCount(readWorkerCount(workerStorage, navigator.hardwareConcurrency));
    // `window.__beMusicTest` for the end-to-end suite (`?e2e=1` or a development build; `test-hook.ts`).
    const testHook = isTestHookEnabled(window.location.href, import.meta.env.DEV) ? new TestHookRecorder() : undefined;
    const player = new PlayerWebApp({
      elements: {
        stage: document.querySelector<HTMLDivElement>('#stage')!,
        shell: document.querySelector<HTMLDivElement>('.shell')!,
        chartInput: document.querySelector<HTMLInputElement>('#songs')!,
        filesInput: document.querySelector<HTMLInputElement>('#files')!,
        searchInput: document.querySelector<HTMLInputElement>('#search')!,
        loadingOverlay: document.querySelector<HTMLDivElement>('#loading-overlay')!,
        loadingLabel: document.querySelector<HTMLDivElement>('#loading-label')!,
        loadingBarFill: document.querySelector<HTMLElement>('#loading-bar-fill')!,
        loadingCounter: document.querySelector<HTMLDivElement>('#loading-counter')!,
      },
      deviceProfile,
      testHook,
    });
    // Installed before the app starts, so the hook sees the first select screen come up.
    if (testHook !== undefined) {
      const testHookDeps = player.testHookDeps();
      testHook.install(window, () => liveTestHookState(testHookDeps));
    }
    player.start();
  });
