import { eq } from 'drizzle-orm';
import { generatedAvatarSvg } from '../avatars.ts';
import { openDatabase } from '../db/client.ts';
import { profile } from '../db/schema.ts';
import { resolveFormerHandle } from '../profiles.ts';
import type { PageContext } from './page.tsx';

/** Icons change rarely and their URLs carry a version, so caches keep them a day. */
const AVATAR_CACHE = 'public, max-age=86400';

/** The same URL with the player's former handle replaced by the current one (query kept). */
export function movedTo(requestUrl: string, former: string, current: string): string {
  const url = new URL(requestUrl);
  const from = `/leaderboard/players/${encodeURIComponent(former)}`;
  const to = `/leaderboard/players/${encodeURIComponent(current)}`;
  return `${url.pathname.replace(from, to)}${url.search}`;
}

/** A player's icon: the uploaded image from R2, or the one generated from the account. */
export async function avatarImage(c: PageContext<'/leaderboard/players/:handle/avatar'>) {
  const db = openDatabase(c.env.DB);
  const handle = c.req.param('handle');
  const found = await db.query.profile.findFirst({
    where: eq(profile.handle, handle.toLowerCase()),
    columns: { userId: true, avatarKey: true },
  });
  if (found === undefined) {
    const current = await resolveFormerHandle(db, handle);
    if (current !== undefined) return c.redirect(movedTo(c.req.url, handle, current), 301);
    return c.body('Not Found', 404);
  }
  if (found.avatarKey !== null) {
    const object = await c.env.BLOBS.get(found.avatarKey);
    if (object !== null) {
      return c.body(object.body, 200, {
        'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
        'cache-control': AVATAR_CACHE,
        'x-content-type-options': 'nosniff',
      });
    }
  }
  return c.body(generatedAvatarSvg(found.userId), 200, {
    'content-type': 'image/svg+xml',
    'cache-control': AVATAR_CACHE,
  });
}
