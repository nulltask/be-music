import { defineWranglerConfig } from 'wrangler/experimental-config';

/** The built SPA, for `cf deploy` (cloudflare.config.ts); `@be-music/player-web-demo`'s `build:cf` writes it. */
export default defineWranglerConfig(() => ({ assetsDirectory: '../player-web-demo/dist' }));
