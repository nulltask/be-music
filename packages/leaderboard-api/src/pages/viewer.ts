import type { MiddlewareHandler } from 'hono';
import { loadAccount, type AccountSummary } from '../accounts.ts';
import type { AppEnv } from '../app.ts';
import { createAuth, hasSessionCookie } from '../auth.ts';
import { openDatabase } from '../db/client.ts';

/** Who is looking at a page: their account (and its id, to show them what only they may see), or null when signed out. */
export type Viewer = AccountSummary & { userId: string };

/** Paths that never show the viewer (assets, icons, the manifest): no session lookup for them. */
function needsViewer(path: string): boolean {
  return (
    !path.startsWith('/leaderboard/assets/') &&
    !path.endsWith('/avatar') &&
    !path.endsWith('/card') &&
    !path.endsWith('.webmanifest')
  );
}

/**
 * Reads the session cookie for the pages, so the header can show the signed-in player. The cookie is the one the
 * player and the API share (same origin); pages are private and revalidated, so showing it is safe.
 */
export const loadViewer: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('viewer', null);
  if (needsViewer(c.req.path) && hasSessionCookie(c.req.raw.headers)) {
    const session = await createAuth(c.env, new URL(c.req.url).origin).api.getSession({ headers: c.req.raw.headers });
    if (session !== null) {
      const account = await loadAccount(openDatabase(c.env.DB), session.user.id);
      c.set('viewer', account === undefined ? null : { ...account, userId: session.user.id });
    }
  }
  await next();
};
