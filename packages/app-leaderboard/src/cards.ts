import { eq } from 'drizzle-orm';
import { detectAvatarType } from './avatars.ts';
import type { Database } from './db/client.ts';
import { courseScore, score } from './db/schema.ts';
import { sha256HexAsync as sha256Hex } from '@be-music/shared-utils/hash';

/**
 * Share cards of plays and course runs: the 1200 x 630 picture link previews show (og:image, twitter:card). The
 * player's browser draws it (client/score-card.ts, client/course-card.ts) and uploads it here. The official deployment now uses Workers Paid; browser rendering
 * describes the current implementation rather than a plan requirement.
 * Until a play has its card, the site's default card stands in.
 */

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
/** A 1200 x 630 card as PNG or WebP stays well under this. */
export const CARD_MAX_BYTES = 512 * 1024;

const EXTENSIONS = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' } as const;

/** A card URL's version: the upload's hash, or `d` for the default card; it busts caches. */
function cardVersion(cardKey: string | null): string {
  return cardKey === null ? 'd' : (/\/([0-9a-f]{16})[0-9a-f]*\.\w+$/.exec(cardKey)?.[1] ?? 'u');
}

/** The URL of a play's card. */
export function cardURL(scoreId: string, cardKey: string | null): string {
  return `/scores/${encodeURIComponent(scoreId)}/card?v=${cardVersion(cardKey)}`;
}

/** The URL of a course run's card. */
export function courseCardURL(courseScoreId: string, cardKey: string | null): string {
  return `/course-scores/${encodeURIComponent(courseScoreId)}/card?v=${cardVersion(cardKey)}`;
}

export type CardUpload =
  | { ok: true; cardKey: string }
  | {
      ok: false;
      status: 400 | 403 | 404 | 413 | 415;
      error: 'empty-body' | 'not-your-score' | 'not-found' | 'card-too-large' | 'unsupported-image';
    };

/** Checks an uploaded card and stores it at `cards/{folder}/{id}/{sha256}.{ext}`; the caller records the key. */
async function storeCard(
  blobs: R2Bucket,
  folder: string,
  id: string,
  found: { userId: string; cardKey: string | null } | undefined,
  userId: string,
  bytes: Uint8Array,
  record: (cardKey: string) => Promise<unknown>,
): Promise<CardUpload> {
  if (found === undefined) return { ok: false, status: 404, error: 'not-found' };
  if (found.userId !== userId) return { ok: false, status: 403, error: 'not-your-score' };
  if (bytes.length === 0) return { ok: false, status: 400, error: 'empty-body' };
  if (bytes.length > CARD_MAX_BYTES) return { ok: false, status: 413, error: 'card-too-large' };
  const type = detectAvatarType(bytes);
  if (type === undefined) return { ok: false, status: 415, error: 'unsupported-image' };
  const cardKey = `cards/${folder}/${id}/${await sha256Hex(bytes)}.${EXTENSIONS[type]}`;
  await blobs.put(cardKey, bytes, { httpMetadata: { contentType: type } });
  await record(cardKey);
  if (found.cardKey !== null && found.cardKey !== cardKey) await blobs.delete(found.cardKey);
  return { ok: true, cardKey };
}

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
  return storeCard(blobs, 'scores', scoreId, found, userId, bytes, (cardKey) =>
    db.update(score).set({ cardKey }).where(eq(score.id, scoreId)),
  );
}

/** Stores a course run's card, if `userId` ran it; the previous card is deleted. */
export async function putCourseScoreCard(
  db: Database,
  blobs: R2Bucket,
  courseScoreId: string,
  userId: string,
  bytes: Uint8Array,
): Promise<CardUpload> {
  const found = await db.query.courseScore.findFirst({
    where: eq(courseScore.id, courseScoreId),
    columns: { userId: true, cardKey: true },
  });
  return storeCard(blobs, 'course-scores', courseScoreId, found, userId, bytes, (cardKey) =>
    db.update(courseScore).set({ cardKey }).where(eq(courseScore.id, courseScoreId)),
  );
}
