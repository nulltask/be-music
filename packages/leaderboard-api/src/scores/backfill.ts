import { eq, isNull, or } from 'drizzle-orm';
import { parseReplay } from '@be-music/player/replay';
import type { Database } from '../db/client.ts';
import { score } from '../db/schema.ts';
import { playedFileOf, type PlayedFile } from './played-file.ts';

/** How many plays one run fills in; the hourly cron gets through older plays a batch at a time. */
const BACKFILL_BATCH = 50;

/**
 * Fills in the chart file, length and lane option of plays stored before they were recorded (`duration_ms` or
 * `lane_option` is null), from their replays in R2. A play whose log is gone or unreadable gets a length of 0, no
 * file and an unknown (`-`) lane option, so it is not retried. Returns how many plays it filled in.
 */
export async function backfillPlayedFiles(db: Database, blobs: R2Bucket, limit = BACKFILL_BATCH): Promise<number> {
  const pending = await db
    .select({ id: score.id, replayKey: score.replayKey })
    .from(score)
    .where(or(isNull(score.durationMs), isNull(score.laneOption)))
    .limit(limit);
  for (const play of pending) {
    const filled = await readPlayedFile(blobs, play.replayKey).catch(() => undefined);
    await db
      .update(score)
      .set(filled ?? { fileSha256: null, fileMd5: null, durationMs: 0, laneOption: '-' })
      .where(eq(score.id, play.id));
  }
  return pending.length;
}

async function readPlayedFile(blobs: R2Bucket, key: string): Promise<PlayedFile | undefined> {
  const object = await blobs.get(key);
  if (object === null) return undefined;
  // Replays are stored gzipped (src/scores/submit.ts).
  const text = await new Response(object.body.pipeThrough(new DecompressionStream('gzip'))).text();
  return playedFileOf(parseReplay(text));
}
