import { createApp } from './app.ts';
import { bmsSearchLookup, refreshStaleChartsets } from './chartsets/refresh.ts';
import { openDatabase } from './db/client.ts';
import type { Env } from './env.ts';

export type { AppType } from './app.ts';

const app = createApp();

export default {
  fetch: app.fetch,
  /** The Cron Trigger (`cloudflare.config.ts`): files charts under their chartsets and re-checks old answers. */
  async scheduled(_controller, env, context) {
    context.waitUntil(refreshStaleChartsets(openDatabase(env.DB), bmsSearchLookup(), Date.now()));
  },
} satisfies ExportedHandler<Env>;
