import { Hono } from 'hono';
import { claimAccount } from './accounts.ts';
import { createV1Api } from './api/v1.ts';
import { createAuth } from './auth.ts';
import { bmsSearchLookup, type ChartsetLookup } from './chartsets/refresh.ts';
import { openDatabase, type Database } from './db/client.ts';
import type { Env } from './env.ts';
import { mountPages } from './pages/routes.tsx';

interface Variables {
  db: Database;
  userId: string | undefined;
}

export type AppEnv = { Bindings: Env; Variables: Variables };

/** The Leaderboard API (docs/leaderboard.md section 8). */
export function createApp(options: { now?: () => number; newId?: () => string; chartsetLookup?: ChartsetLookup } = {}) {
  const now = options.now ?? Date.now;
  const newId = options.newId ?? (() => crypto.randomUUID());
  const chartsetLookup = options.chartsetLookup ?? bmsSearchLookup();

  const app = new Hono<AppEnv>();

  app.on(['GET', 'POST'], '/api/auth/*', async (c) => {
    const auth = createAuth(c.env, new URL(c.req.url).origin);
    const response = await auth.handler(c.req.raw);
    // A registered passkey is a way back into the account, so it stops being anonymous (docs/leaderboard.md section 3).
    if (c.req.path === '/api/auth/passkey/verify-registration' && response.ok) {
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      if (session !== null) await claimAccount(openDatabase(c.env.DB), session.user.id);
    }
    return response;
  });

  app.route('/api/v1', createV1Api({ now, newId, chartsetLookup }));

  // Anything else under `/api`, an unknown version included, answers in JSON like the API does.
  app.all('/api/*', (c) => c.json({ error: 'not-found' }, 404));

  mountPages(app);

  return app;
}

export type AppType = ReturnType<typeof createApp>;
