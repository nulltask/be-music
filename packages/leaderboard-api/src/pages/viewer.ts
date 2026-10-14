import type { MiddlewareHandler } from 'hono';
import { loadAccount, type AccountSummary } from '../accounts.ts';
import type { AppEnv } from '../app.ts';
import { loadSession, passOnSetCookies } from '../auth.ts';
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
  let setCookies: string[] = [];
  if (needsViewer(c.req.path)) {
    const loaded = await loadSession(c.env, c.req.raw);
    setCookies = loaded.setCookies;
    if (loaded.session !== null) {
      const account = await loadAccount(openDatabase(c.env.DB), loaded.session.user.id);
      c.set('viewer', account === undefined ? null : { ...account, userId: loaded.session.user.id });
    }
  }
  await next();
  passOnSetCookies(c.res, setCookies);
};
