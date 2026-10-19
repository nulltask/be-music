import { eq } from 'drizzle-orm';
import { detectAvatarType } from './avatars.ts';
import type { Database } from './db/client.ts';
import { score } from './db/schema.ts';
import { sha256Hex } from './hash.ts';

/**
 * Share cards of plays: the 1200 x 630 picture link previews show (og:image, twitter:card). The player's browser draws
 * it (client/score-card.ts) and uploads it here; a Worker on the Free plan cannot afford to rasterize one itself.
 * Until a play has its card, the site's default card stands in.
 */

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
/** A 1200 x 630 card as PNG or WebP stays well under this. */
export const CARD_MAX_BYTES = 512 * 1024;

const EXTENSIONS = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' } as const;

/** The URL of a play's card; the version (the upload's hash, or `d` for the default card) busts caches. */
export function cardURL(scoreId: string, cardKey: string | null): string {
  const version = cardKey === null ? 'd' : (/\/([0-9a-f]{16})[0-9a-f]*\.\w+$/.exec(cardKey)?.[1] ?? 'u');
  return `/scores/${encodeURIComponent(scoreId)}/card?v=${version}`;
}

export type CardUpload =
  | { ok: true; cardKey: string }
  | {
      ok: false;
      status: 400 | 403 | 404 | 413 | 415;
      error: 'empty-body' | 'not-your-score' | 'not-found' | 'card-too-large' | 'unsupported-image';
    };

/** Stores a play's card, if `userId` played it; the previous card is deleted. */
export async function putScoreCard(
  db: Database,
  blobs: R2Bucket,
  scoreId: string,
  userId: string,
  bytes: Uint8Array,
): Promise<CardUpload> {
  const found = await db.query.score.findFirst({
    where: eq(score.id, scoreId),
    columns: { userId: true, cardKey: true },
  });
  if (found === undefined) return { ok: false, status: 404, error: 'not-found' };
  if (found.userId !== userId) return { ok: false, status: 403, error: 'not-your-score' };
  if (bytes.length === 0) return { ok: false, status: 400, error: 'empty-body' };
  if (bytes.length > CARD_MAX_BYTES) return { ok: false, status: 413, error: 'card-too-large' };
  const type = detectAvatarType(bytes);
  if (type === undefined) return { ok: false, status: 415, error: 'unsupported-image' };
  const cardKey = `cards/scores/${scoreId}/${await sha256Hex(bytes)}.${EXTENSIONS[type]}`;
  await blobs.put(cardKey, bytes, { httpMetadata: { contentType: type } });
  await db.update(score).set({ cardKey }).where(eq(score.id, scoreId));
  if (found.cardKey !== null && found.cardKey !== cardKey) await blobs.delete(found.cardKey);
  return { ok: true, cardKey };
}
