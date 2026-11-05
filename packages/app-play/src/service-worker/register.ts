// Registers the player's service worker (`service-worker.ts`, served as `/sw.js`; docs/player-web.md, "Installing the
// player"). Only a production build registers it: the dev server has no `/sw.js`. Runs under the test hook
// (`?e2e=1`) do not either, so the end-to-end suite's request routes see every request.

import { logger } from '@be-music/player-browser';

const log = logger('service-worker');

/** The worker's URL and scope: the player at the origin's root. The embed page is excluded by the worker's rules. */
export const SERVICE_WORKER_URL = '/sw.js';

/** Whether this page registers the service worker. */
export function shouldRegisterServiceWorker(options: {
  production: boolean;
  testHook: boolean;
  supported: boolean;
}): boolean {
  return options.production && !options.testHook && options.supported;
}

/**
 * Registers the worker once the page has loaded, so its install (precaching the shell) does not compete with the
 * first start. `updateViaCache: 'none'` makes every update check fetch `/sw.js` past the HTTP cache.
 */
export function registerServiceWorker(container: ServiceWorkerContainer): void {
  const register = () => {
    container.register(SERVICE_WORKER_URL, { scope: '/', updateViaCache: 'none' }).catch((error: unknown) => {
      // The player works without it; only installing and offline starts are lost.
      log.warn('registration failed', error);
    });
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
