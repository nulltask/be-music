import { eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { BeMusicReplay } from '@be-music/player/replay';
import type { Database } from '../db/client.ts';
import { chart, chartAlias } from '../db/schema.ts';
import { checkFingerprintDocument } from '../submission/documents.ts';
import { nextHasLongNotes, replayHasLongNotes } from './long-notes.ts';
import { fileHashAliases } from './played-file.ts';

/** What the server makes of the chart one replay played, before anything is written. */
export interface PlayedChart {
  chartFingerprint: string;
  playFingerprint: string;
  /** The chart's row, when the server knows the chart already. */
  known: typeof chart.$inferSelect | undefined;
  /** The chart document to register, when the chart is new. */
  registration: { document: unknown } | undefined;
  /** Highest verification layer the play passed (docs/leaderboard.md section 5.3). */
  verification: 'L3' | 'L4';
}

export type PlayedChartCheck = ({ ok: true } & PlayedChart) | { ok: false; httpStatus: 409 | 422; reason: string };

/**
 * Checks the chart one replay played (verification layers L3 and L4, docs/leaderboard.md section 5.3): the play
 * document must hash to the play fingerprint, and a chart the server does not know needs its chart document, which must
 * hash to the chart fingerprint. Shared by single plays and the stages of a course run.
 */
export async function checkPlayedChart(
  db: Database,
  input: { chartFingerprint: string; playFingerprint: string; playDocument: unknown; chartDocument?: unknown },
): Promise<PlayedChartCheck> {
  const { chartFingerprint, playFingerprint } = input;
  // L3: the play document must hash to the claimed play fingerprint.
  const playCheck = checkFingerprintDocument(input.playDocument, playFingerprint);
  if (!playCheck.ok) {
    return { ok: false, httpStatus: 422, reason: `play-document-${playCheck.reason}` };
  }

  const known = await db.query.chart.findFirst({ where: eq(chart.chartFingerprint, chartFingerprint) });
  let registration: PlayedChart['registration'];
  if (known === undefined) {
    if (input.chartDocument === undefined) {
      return { ok: false, httpStatus: 409, reason: 'chart-document-required' };
    }
    const chartCheck = checkFingerprintDocument(input.chartDocument, chartFingerprint);
    if (!chartCheck.ok) {
      return { ok: false, httpStatus: 422, reason: `chart-document-${chartCheck.reason}` };
    }
    registration = { document: input.chartDocument };
  }

  // L4 holds trivially when the chart has no control flow (both fingerprints equal) or the play fingerprint was seen
  // before; composing a chart document's outcomes for a new play fingerprint is not implemented yet.
  const knownPlayFingerprints = known?.playFingerprints ?? [];
  const verification =
    chartFingerprint === playFingerprint || knownPlayFingerprints.includes(playFingerprint) ? 'L4' : 'L3';
  return { ok: true, chartFingerprint, playFingerprint, known, registration, verification };
}

export function chartDocumentKey(chartFingerprint: string): string {
  return `charts/${chartFingerprint}.json`;
}

/** Stores a new chart's document in R2 (a no-op for a known chart). */
export async function putChartDocument(blobs: R2Bucket, played: PlayedChart): Promise<void> {
  if (played.registration === undefined) return;
  await blobs.put(chartDocumentKey(played.chartFingerprint), JSON.stringify(played.registration.document), {
    httpMetadata: { contentType: 'application/json' },
  });
}

/**
 * The statements that record what one play says about its chart: a new chart's row, what a known chart learns from the
 * play (the level of charts registered before replays carried it, whether it has long notes), and the file hashes the
 * client claims as aliases.
 */
export function playedChartStatements(
  db: Database,
  replay: BeMusicReplay,
  played: PlayedChart,
  now: number,
): BatchItem<'sqlite'>[] {
  const { chartFingerprint, playFingerprint, known } = played;
  const playedLongNotes = replayHasLongNotes(replay.chart);
  const chartValues = played.registration
    ? [
        db
          .insert(chart)
          .values({
            chartFingerprint,
            title: replay.chart.title ?? null,
            artist: replay.chart.artist ?? null,
            subtitle: replay.chart.subtitle ?? null,
            genre: replay.chart.genre ?? null,
            playLevel: replay.chart.playLevel ?? null,
            difficulty: replay.chart.difficulty ?? null,
            sourceFormat: replay.chart.sourceFormat,
            laneMode: replay.chart.laneMode,
            total: replay.chart.total ?? null,
            lnMode: replay.chart.lnMode,
            hasLongNotes: playedLongNotes,
            judgeRank: chartJudgeRank(replay.chart.judgeRank),
            noteCount: replay.chart.noteCount,
            playFingerprints: played.verification === 'L4' ? [playFingerprint] : [],
            documentKey: chartDocumentKey(chartFingerprint),
            createdAt: new Date(now),
            updatedAt: new Date(now),
          })
          // A concurrent first submission of the same chart may have registered it already.
          .onConflictDoNothing(),
      ]
    : [];
  // What a known chart learns from this play, in one statement: charts registered before replays carried the level
  // take it from the first play that does, and whether the chart has long notes (see `nextHasLongNotes`).
  const learned: Partial<typeof chart.$inferInsert> = {};
  if (known !== undefined && known.playLevel === null && replay.chart.playLevel !== undefined) {
    learned.playLevel = replay.chart.playLevel;
    learned.difficulty = replay.chart.difficulty ?? null;
  }
  const hasLongNotes = known === undefined ? undefined : nextHasLongNotes(known.hasLongNotes, playedLongNotes);
  if (hasLongNotes !== undefined) learned.hasLongNotes = hasLongNotes;
  const learnedValues =
    Object.keys(learned).length > 0
      ? [db.update(chart).set(learned).where(eq(chart.chartFingerprint, chartFingerprint))]
      : [];
  // The file hashes the client claims (`chart.sha256`, `chart.md5`). The server cannot check them without the file, so
  // they only name the chart on other sites; well-formed ones are kept, lowercased.
  const aliasValues = fileHashAliases(replay.chart).map((alias) =>
    db
      .insert(chartAlias)
      .values({ ...alias, chartFingerprint })
      .onConflictDoNothing(),
  );
  return [...chartValues, ...learnedValues, ...aliasValues];
}

/** The chart's own judge rank, without the in-play changes (`timeline`). */
function chartJudgeRank(judgeRank: { percent: number; sourceRank?: number; sourceExRank?: number }) {
  return {
    percent: judgeRank.percent,
    ...(judgeRank.sourceRank !== undefined ? { sourceRank: judgeRank.sourceRank } : {}),
    ...(judgeRank.sourceExRank !== undefined ? { sourceExRank: judgeRank.sourceExRank } : {}),
  };
}

/** gzip of a text, for the replays stored in R2. */
export async function gzipText(text: string): Promise<ArrayBuffer> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return await new Response(stream).arrayBuffer();
}
