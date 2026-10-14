import { eq } from 'drizzle-orm';
import { openDatabase } from '../db/client.ts';
import { score } from '../db/schema.ts';
import { ICONS } from './icons.generated.ts';
import type { PageContext } from './page.tsx';

/** Card URLs carry a version, so caches keep them; a play without its own card falls back to the default one. */
const CARD_CACHE = 'public, max-age=86400';

let defaultCard: Uint8Array<ArrayBuffer> | undefined;
function defaultCardBytes(): Uint8Array<ArrayBuffer> {
  if (defaultCard === undefined) {
    const text = atob(ICONS.ogDefault.base64);
    defaultCard = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) defaultCard[i] = text.charCodeAt(i);
  }
  return defaultCard;
}

/** A play's share card (og:image): the one its player's browser drew, or the site's default card. */
export async function scoreCardImage(c: PageContext<'/leaderboard/scores/:id/card'>) {
  const found = await openDatabase(c.env.DB).query.score.findFirst({
    where: eq(score.id, c.req.param('id')),
    columns: { cardKey: true },
  });
  if (found === undefined) return c.body('Not Found', 404);
  if (found.cardKey !== null) {
    const object = await c.env.BLOBS.get(found.cardKey);
    if (object !== null) {
      return c.body(object.body, 200, {
        'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
        'cache-control': CARD_CACHE,
        'x-content-type-options': 'nosniff',
      });
    }
  }
  return c.body(defaultCardBytes(), 200, { 'content-type': 'image/png', 'cache-control': CARD_CACHE });
}
