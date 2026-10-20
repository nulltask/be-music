import { defineWranglerConfig } from 'wrangler/experimental-config';

/** The built SPA, for `cf deploy` (cloudflare.config.ts); `@be-music/app-play`'s `build:cf` writes it. */
export default defineWranglerConfig(() => ({ assetsDirectory: '../app-play/dist' }));
