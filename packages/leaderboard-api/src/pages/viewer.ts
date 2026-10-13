import type { MiddlewareHandler } from 'hono';
import { loadAccount, type AccountSummary } from '../accounts.ts';
import type { AppEnv } from '../app.ts';
import { createAuth } from '../auth.ts';
import { openDatabase } from '../db/client.ts';

/** Who is looking at a page: their account, or null when signed out. */
export type Viewer = AccountSummary;

/** Paths that never show the viewer (assets, icons, the manifest): no session lookup for them. */
function needsViewer(path: string): boolean {
  return !path.startsWith('/leaderboard/assets/') && !path.endsWith('/avatar') && !path.endsWith('.webmanifest');
}

/**
 * Reads the session cookie for the pages, so the header can show the signed-in player. The cookie is the one the
 * player and the API share (same origin); pages are private and revalidated, so showing it is safe.
 */
export const loadViewer: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('viewer', null);
  if (needsViewer(c.req.path)) {
    const session = await createAuth(c.env, new URL(c.req.url).origin).api.getSession({ headers: c.req.raw.headers });
    if (session !== null) c.set('viewer', (await loadAccount(openDatabase(c.env.DB), session.user.id)) ?? null);
  }
  await next();
};
