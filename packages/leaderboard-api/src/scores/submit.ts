import { eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import {
  checkPlaylogEligibility,
  PLAYLOG_ENGINE_VERSION,
  simulatePlaylog,
  type BeMusicPlaylog,
  type PlaylogRulesetId,
  type PlaylogRulesetResult,
} from '@be-music/player/playlog';
import { refreshChartListing } from '../charts.ts';
import type { Database } from '../db/client.ts';
import { bestScore, score, scoreResult } from '../db/schema.ts';
import { rankOfExScore, countPlayers } from '../ranking.ts';
import { mergeBestScores } from '../scoring/best.ts';
import { resolveClearLamp, resolveMissCount, type ClearLamp } from '../scoring/lamp.ts';
import { sha256Hex } from '../hash.ts';
import { playedFileOf } from './played-file.ts';
import { checkPlayedChart, gzipText, playedChartStatements, putChartDocument } from './played-chart.ts';
import { byRulesetOrder, RULESET_IDS } from '../rulesets.ts';
import { loadBestScores, toBestScoreRow } from './bests.ts';

export interface SubmissionInput {
  userId: string;
  playlog: BeMusicPlaylog;
  /** The play log as stored (canonical JSON text). */
  playlogText: string;
  playDocument: unknown;
  chartDocument?: unknown;
  /** The `Be-Music-Client` header of the request, if any. */
  submittedBy?: string;
}

export interface SubmissionDeps {
  db: Database;
  blobs: R2Bucket;
  now: () => number;
  newId: () => string;
}

export interface RulesetOutcome {
  ruleset: PlaylogRulesetId;
  rulesetRevision: string;
  exScore: number;
  noteCount: number;
  clearLamp: ClearLamp;
  missCount: number;
  rank: number;
  players: number;
  improved: { exScore: boolean; lamp: boolean; missCount: boolean };
}

export type SubmissionOutcome =
  | { status: 'accepted' | 'duplicate'; scoreId: string; chartFingerprint: string; results: RulesetOutcome[] }
  | { status: 'rejected'; httpStatus: 409 | 422; reason: string };

/**
 * Accepts one play (docs/leaderboard.md section 5). Rejections never write anything; an accepted play writes its
 * play log to R2 before the D1 batch, so a failed batch leaves only an unreferenced object.
 */
export async function submitScore(deps: SubmissionDeps, input: SubmissionInput): Promise<SubmissionOutcome> {
  const { db, blobs } = deps;
  const eligibility = checkPlaylogEligibility(input.playlog);
  if (!eligibility.eligible) {
    return { status: 'rejected', httpStatus: 422, reason: eligibility.reason };
  }
  const { chartFingerprint, playFingerprint, assistFlags } = eligibility;
  const assisted = assistFlags.length > 0;

  const submissionId = await sha256Hex(identifyPlay(input.playlog, playFingerprint));
  const existing = await db.query.score.findFirst({ where: eq(score.submissionId, submissionId) });
  if (existing !== undefined && existing.userId !== input.userId) {
    // The same inputs on the same chart from another account: a copied replay, not a play.
    return { status: 'rejected', httpStatus: 409, reason: 'play-already-submitted' };
  }
  if (existing !== undefined) {
    return {
      status: 'duplicate',
      scoreId: existing.id,
      chartFingerprint: existing.chartFingerprint,
      results: await loadOutcomes(db, existing.id, existing.chartFingerprint, existing.assisted),
    };
  }

  const played = await checkPlayedChart(db, {
    chartFingerprint,
    playFingerprint,
    playDocument: input.playDocument,
    chartDocument: input.chartDocument,
  });
  if (!played.ok) {
    return { status: 'rejected', httpStatus: played.httpStatus, reason: played.reason };
  }
  const { verification } = played;

  const simulated = RULESET_IDS.map((ruleset) => ({ ruleset, result: simulatePlaylog(input.playlog, { ruleset }) }));

  const now = deps.now();
  const scoreId = deps.newId();
  const playlogKey = `playlogs/${scoreId}.bmplay.json.gz`;
  // The stored files and the current bests do not depend on each other: one wait for all of them. The play's rows are
  // written only once every file is stored, as before.
  const [currentBests] = await Promise.all([
    loadBestScores(db, input.userId, chartFingerprint, assisted),
    gzipText(input.playlogText).then((compressed) =>
      blobs.put(playlogKey, compressed, {
        httpMetadata: { contentType: 'application/json', contentEncoding: 'gzip' },
      }),
    ),
    putChartDocument(blobs, played),
  ]);
  const playedRuleset = input.playlog.play.judgeRuleset ?? 'lr2';
  const figures = simulated.map(({ ruleset, result }) => {
    const lamp = resolveClearLamp(result, ruleset);
    const missCount = resolveMissCount(result);
    const current = currentBests.get(ruleset);
    const update = mergeBestScores(current, { scoreId, playedAt: now, exScore: result.exScore, lamp, missCount });
    const playedHere = (current?.playedHere ?? false) || playedRuleset === ruleset;
    return { ruleset, result, lamp, missCount, update, playedHere };
  });

  const statements: BatchItem<'sqlite'>[] = [
    ...playedChartStatements(db, input.playlog, played, now),
    db.insert(score).values({
      id: scoreId,
      submissionId,
      userId: input.userId,
      chartFingerprint,
      playFingerprint,
      ...playedFileOf(input.playlog),
      playedRuleset,
      gauge: input.playlog.play.gauge,
      assisted,
      assistFlags,
      verification,
      recordedBy: input.playlog.recorder !== undefined ? { ...input.playlog.recorder } : null,
      submittedBy: input.submittedBy ?? null,
      serverEngine: PLAYLOG_ENGINE_VERSION,
      playlogKey,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    }),
    ...figures.map(({ ruleset, result, lamp, missCount }) =>
      db.insert(scoreResult).values(toScoreResultRow(scoreId, ruleset, result, lamp, missCount)),
    ),
    ...figures.map(({ ruleset, update, playedHere }) => {
      const row = toBestScoreRow(
        { userId: input.userId, chartFingerprint, ruleset, assisted },
        update.next,
        playedHere,
        now,
      );
      return db
        .insert(bestScore)
        .values(row)
        .onConflictDoUpdate({
          target: [bestScore.userId, bestScore.chartFingerprint, bestScore.ruleset, bestScore.assisted],
          set: row,
        });
    }),
  ];
  await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);

  // The listing and each ruleset's rank and player count read the rows just written and not each other: asked at once.
  const [, results] = await Promise.all([
    refreshChartListing(db, chartFingerprint),
    Promise.all(
      figures.map(async ({ ruleset, result, lamp, missCount, update }): Promise<RulesetOutcome> => {
        const filter = { chartFingerprint, ruleset, assisted, includeAnonymous: true, playedHereOnly: false };
        const [rank, players] = await Promise.all([
          rankOfExScore(db, filter, update.next.bestEx),
          countPlayers(db, filter),
        ]);
        return {
          ruleset,
          rulesetRevision: result.ruleset,
          exScore: result.exScore,
          noteCount: result.noteCount,
          clearLamp: lamp,
          missCount,
          rank,
          players,
          improved: update.improved,
        };
      }),
    ),
  ]);
  return { status: 'accepted', scoreId, chartFingerprint, results };
}

/**
 * What identifies a play regardless of who recorded it or when: the chart that was played, the play settings that
 * affect scoring, and the input stream. Its hash is the submission id, so a retry of the same play is recognised, and
 * the same play submitted from a second account (a downloaded replay) is refused. Recording time, the recorder and the
 * host's `native` extras are left out.
 */
export function identifyPlay(playlog: BeMusicPlaylog, playFingerprint: string): string {
  const { native: _native, ...play } = playlog.play;
  return JSON.stringify({ playFingerprint, play, inputs: playlog.inputs });
}

function toScoreResultRow(
  scoreId: string,
  ruleset: PlaylogRulesetId,
  result: PlaylogRulesetResult,
  lamp: ClearLamp,
  missCount: number,
): typeof scoreResult.$inferInsert {
  return {
    scoreId,
    ruleset,
    rulesetRevision: result.ruleset,
    exScore: result.exScore,
    noteCount: result.noteCount,
    clearLamp: lamp,
    missCount,
    maxCombo: result.maxCombo,
    gaugeType: result.gauge.type,
    gaugeFinal: result.gauge.final,
    judges: { ...result.judge, fast: result.fast, slow: result.slow },
  };
}

/** The outcome of an already stored play, for a resubmission. Ranks reflect the current standings. */
async function loadOutcomes(
  db: Database,
  scoreId: string,
  chartFingerprint: string,
  assisted: boolean,
): Promise<RulesetOutcome[]> {
  const rows = await db.select().from(scoreResult).where(eq(scoreResult.scoreId, scoreId));
  const outcomes = await Promise.all(
    rows.map(async (row): Promise<RulesetOutcome> => {
      const filter = {
        chartFingerprint,
        ruleset: row.ruleset,
        assisted,
        includeAnonymous: true,
        playedHereOnly: false,
      };
      const [rank, players] = await Promise.all([rankOfExScore(db, filter, row.exScore), countPlayers(db, filter)]);
      return {
        ruleset: row.ruleset,
        rulesetRevision: row.rulesetRevision,
        exScore: row.exScore,
        noteCount: row.noteCount,
        clearLamp: row.clearLamp as ClearLamp,
        missCount: row.missCount,
        rank,
        players,
        improved: { exScore: false, lamp: false, missCount: false },
      };
    }),
  );
  return outcomes.sort(byRulesetOrder);
}
