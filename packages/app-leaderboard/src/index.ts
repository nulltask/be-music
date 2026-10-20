import { createApp } from './app.ts';
import { bmsSearchLookup, refreshStaleChartsets } from './chartsets/refresh.ts';
import { openDatabase } from './db/client.ts';
import type { Env } from './env.ts';
import { backfillPlayedFiles } from './scores/backfill.ts';

export type { AppType } from './app.ts';

const app = createApp();

export default {
  fetch: app.fetch,
  /**
   * The Cron Trigger (`cloudflare.config.ts`): files charts under their chartsets and re-checks old answers, and fills
   * in the chart file and length of plays stored before those were recorded.
   */
  async scheduled(_controller, env, context) {
    const db = openDatabase(env.DB);
    context.waitUntil(
      Promise.all([refreshStaleChartsets(db, bmsSearchLookup(), Date.now()), backfillPlayedFiles(db, env.BLOBS)]),
    );
  },
} satisfies ExportedHandler<Env>;
