import { Hono } from 'hono';
import { claimAccount } from './accounts.ts';
import { createV0API } from './api/v0.ts';
import { createAuth, oidcAuth } from './auth.ts';
import { bmsSearchLookup, type ChartsetLookup } from './chartsets/refresh.ts';
import { openDatabase, type Database } from './db/client.ts';
import type { Env } from './env.ts';
import { serverTiming } from './http/server-timing.ts';
import { mountPages } from './pages/routes.tsx';
import type { Viewer } from './pages/viewer.ts';

interface Variables {
  db: Database;
  userId: string | undefined;
  /** The signed-in player on the pages (src/pages/viewer.ts); null when signed out. */
  viewer: Viewer | null;
}

export type AppEnv = { Bindings: Env; Variables: Variables };

/** The Leaderboard API (docs/leaderboard.md section 8). */
export function createApp(options: { now?: () => number; newId?: () => string; chartsetLookup?: ChartsetLookup } = {}) {
  const now = options.now ?? Date.now;
  const newId = options.newId ?? (() => crypto.randomUUID());
  const chartsetLookup = options.chartsetLookup ?? bmsSearchLookup();

  const app = new Hono<AppEnv>();

  // Every response says how long it took and how much of that the database did.
  app.use('*', serverTiming<AppEnv>());

  app.on(['GET', 'POST'], '/api/auth/*', async (c) => {
    if (c.env.AUTH_ISSUER) return (await oidcAuth(c.req.raw, c.env)) ?? c.json({ error: 'not-found' }, 404);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(c.req.url).hostname))
      return c.json({ error: 'oidc-not-configured' }, 503);
    const auth = createAuth(c.env, new URL(c.req.url).origin);
    const response = await auth.handler(c.req.raw);
    // A registered passkey is a way back into the account, so it stops being anonymous (docs/leaderboard.md section 3).
    if (c.req.path === '/api/auth/passkey/verify-registration' && response.ok) {
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      if (session !== null) await claimAccount(openDatabase(c.env.DB), session.user.id);
    }
    return response;
  });

  app.use('/api/v0/*', async (c, next) => {
    if (
      c.env.AUTH_ISSUER &&
      !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) &&
      !c.req.header('authorization') &&
      c.req.header('origin') !== c.env.PUBLIC_ORIGIN
    )
      return c.json({ error: 'invalid-origin' }, 403);
    await next();
  });

  app.route('/api/v0', createV0API({ now, newId, chartsetLookup }));

  // Anything else under `/api`, an unknown version included, answers in JSON like the API does.
  app.all('/api/*', (c) => c.json({ error: 'not-found' }, 404));

  mountPages(app);

  return app;
}

export type AppType = ReturnType<typeof createApp>;
