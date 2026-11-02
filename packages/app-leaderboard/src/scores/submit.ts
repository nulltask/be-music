import { eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import {
  checkReplayEligibility,
  findReplayNotSimulatedReason,
  rejudgeReplay,
  REPLAY_ENGINE_VERSION,
  resolveRulesetResultLamp,
  resolveRulesetResultMissCount,
  type BeMusicReplay,
  type ReplayNotSimulatedReason,
  type RulesetId,
  type ReplayRulesetResult,
  type ReplayUnrankedReason,
} from '@be-music/player-engine/replay';
import { refreshChartListing } from '../charts.ts';
import type { Database } from '../db/client.ts';
import { bestScore, score, scoreResult } from '../db/schema.ts';
import { rankOfExScore, countPlayers } from '../ranking.ts';
import { mergeBestScores } from '../scoring/best.ts';
import { applyRecordPolicyLamp, resolveReplayRecordPolicy } from '@be-music/player-engine/records';
import { clearLampRank } from '@be-music/player-engine/ruleset';
import { sha256HexAsync as sha256Hex } from '@be-music/shared-utils/hash';
import { playedFileOf } from './played-file.ts';
import { checkPlayedChart, gzipText, playedChartStatements, putChartDocument } from './played-chart.ts';
import { byRulesetOrder, RULESET_IDS } from '../rulesets.ts';
import { loadBestScores, toBestScoreRow } from './bests.ts';

export interface SubmissionInput {
  userId: string;
  replay: BeMusicReplay;
  /** The replay as stored (canonical JSON text). */
  replayText: string;
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
  ruleset: RulesetId;
  rulesetRevision: string;
  exScore: number;
  noteCount: number;
  /** The clear lamp, by its rank (`clearLampRank`). */
  clearLamp: number;
  missCount: number;
  rank: number;
  players: number;
  improved: { exScore: boolean; lamp: boolean; missCount: boolean };
  /**
   * `truncated` when the play stopped where its played gauge emptied and this ruleset's would have carried on: its
   * figures go only up to that point, unranked (ADR 0019). Absent for a play simulated in full.
   */
  outcome?: 'truncated';
}

/** A ruleset a play cannot be judged under, with the reason (ADR 0019): it has no figures. */
export interface NotSimulatedOutcome {
  ruleset: RulesetId;
  reason: ReplayNotSimulatedReason;
}

export type SubmissionOutcome =
  | {
      status: 'accepted' | 'duplicate';
      scoreId: string;
      chartFingerprint: string;
      results: RulesetOutcome[];
      /** The rulesets the play cannot be judged under; absent when it is judged under every one. */
      notSimulated?: NotSimulatedOutcome[];
      /** Why the play was stored without ranking it; its results then carry rank and players 0. */
      unranked?: ReplayUnrankedReason;
    }
  | { status: 'rejected'; httpStatus: 409 | 422; reason: string };

/**
 * Accepts one play (docs/leaderboard.md section 5). Rejections never write anything; an accepted play writes its
 * replay to R2 before the D1 batch, so a failed batch leaves only an unreferenced object. A play that does not rank
 * (another tempo, a course stage: `checkReplayEligibility`'s `unranked`) is stored and simulated all the same, but
 * moves no personal best and takes no place in a ranking (docs/leaderboard.md section 6).
 */
export async function submitScore(deps: SubmissionDeps, input: SubmissionInput): Promise<SubmissionOutcome> {
  const { db, blobs } = deps;
  const eligibility = checkReplayEligibility(input.replay);
  if (!eligibility.eligible) {
    return { status: 'rejected', httpStatus: 422, reason: eligibility.reason };
  }
  const { chartFingerprint, playFingerprint, assistFlags, assistClass, unranked } = eligibility;
  // A light or assist play ranks on the assisted board; a no-save play is stored unranked (#602).
  const assisted = assistClass !== 'none';

  const submissionId = await sha256Hex(identifyPlay(input.replay, playFingerprint));
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
      results: await loadOutcomes(db, existing.id, existing.chartFingerprint, existing.assisted, existing.unranked),
      ...notSimulatedOf(
        RULESET_IDS.flatMap((ruleset) => {
          const reason = findReplayNotSimulatedReason(input.replay, ruleset);
          return reason === undefined ? [] : [{ ruleset, reason }];
        }),
      ),
      ...(existing.unranked !== null ? { unranked: existing.unranked } : {}),
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

  // A play given up with ESC did not clear, whatever its gauge stood at: it is ranked as a failed play, as LR2 and
  // beatoraja save one, its BP counting the notes it never reached.
  const givenUp = input.replay.play.aborted === true;
  // Each ruleset re-judges the play by ADR 0019's rules: one that cannot read it stores nothing, and one under which a
  // run that ended on failure would have survived stores its truncated figures, unranked.
  const notSimulated: NotSimulatedOutcome[] = [];
  const simulated = RULESET_IDS.flatMap((ruleset) => {
    const outcome = rejudgeReplay(input.replay, { ruleset });
    if (outcome.status === 'not-simulated') {
      notSimulated.push({ ruleset, reason: outcome.reason });
      return [];
    }
    const { result } = outcome;
    return [
      {
        ruleset,
        truncated: outcome.status === 'truncated',
        result: givenUp ? { ...result, gauge: { ...result.gauge, cleared: false } } : result,
      },
    ];
  });

  const now = deps.now();
  const scoreId = deps.newId();
  const replayKey = `replays/${scoreId}.bmplay.json.gz`;
  // The stored files and the current bests do not depend on each other: one wait for all of them. The play's rows are
  // written only once every file is stored, as before.
  const [currentBests] = await Promise.all([
    unranked === undefined ? loadBestScores(db, input.userId, chartFingerprint, assisted) : new Map(),
    gzipText(input.replayText).then((compressed) =>
      blobs.put(replayKey, compressed, {
        httpMetadata: { contentType: 'application/json', contentEncoding: 'gzip' },
      }),
    ),
    putChartDocument(blobs, played),
  ]);
  const playedRuleset = input.replay.play.judgeRuleset ?? 'lr2';
  const figures = simulated.map(({ ruleset, truncated, result }) => {
    // The lamp each ruleset gives the play, limited by its assisted options under that ruleset's rules (#602).
    const lamp = clearLampRank(
      applyRecordPolicyLamp(
        resolveRulesetResultLamp(result, ruleset),
        resolveReplayRecordPolicy(input.replay, ruleset),
      ),
    );
    const missCount = resolveRulesetResultMissCount(result);
    const current = currentBests.get(ruleset);
    const update = mergeBestScores(current, { scoreId, playedAt: now, exScore: result.exScore, lamp, missCount });
    const playedHere = (current?.playedHere ?? false) || playedRuleset === ruleset;
    return { ruleset, truncated, result, lamp, missCount, update, playedHere };
  });
  // A truncated result moves no personal best and takes no place in a ranking.
  const ranked = figures.filter(({ truncated }) => !truncated);

  const statements: BatchItem<'sqlite'>[] = [
    ...playedChartStatements(db, input.replay, played, now),
    db.insert(score).values({
      id: scoreId,
      submissionId,
      userId: input.userId,
      chartFingerprint,
      playFingerprint,
      ...playedFileOf(input.replay),
      playedRuleset,
      gauge: input.replay.play.gauge,
      assisted,
      assistFlags,
      verification,
      recordedBy: input.replay.recorder !== undefined ? { ...input.replay.recorder } : null,
      submittedBy: input.submittedBy ?? null,
      serverEngine: REPLAY_ENGINE_VERSION,
      replayKey,
      unranked: unranked ?? null,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    }),
    ...figures.map(({ ruleset, truncated, result, lamp, missCount }) =>
      db.insert(scoreResult).values(toScoreResultRow(scoreId, ruleset, result, lamp, missCount, truncated)),
    ),
    // An unranked play moves no personal best.
    ...(unranked !== undefined ? [] : ranked).map(({ ruleset, update, playedHere }) => {
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
  // The results that take no place in a ranking: every one of an unranked play, and the truncated ones.
  const unrankedOutcomes = figures.flatMap(({ ruleset, truncated, result, lamp, missCount }) =>
    truncated || unranked !== undefined
      ? [{ ...unrankedOutcome(ruleset, result.ruleset, result, lamp, missCount), ...outcomeOf(truncated) }]
      : [],
  );
  if (unranked !== undefined) {
    return {
      status: 'accepted',
      scoreId,
      chartFingerprint,
      results: unrankedOutcomes,
      ...notSimulatedOf(notSimulated),
      unranked,
    };
  }

  // The listing and each ruleset's rank and player count read the rows just written and not each other: asked at once.
  const [, rankedOutcomes] = await Promise.all([
    refreshChartListing(db, chartFingerprint),
    Promise.all(
      ranked.map(async ({ ruleset, result, lamp, missCount, update }): Promise<RulesetOutcome> => {
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
  const results = [...rankedOutcomes, ...unrankedOutcomes].sort(byRulesetOrder);
  return { status: 'accepted', scoreId, chartFingerprint, results, ...notSimulatedOf(notSimulated) };
}

/** The `notSimulated` field of an outcome: absent when every ruleset judged the play. */
function notSimulatedOf(notSimulated: NotSimulatedOutcome[]): { notSimulated?: NotSimulatedOutcome[] } {
  return notSimulated.length > 0 ? { notSimulated } : {};
}

/** The `outcome` field of a result: absent for a play simulated in full. */
function outcomeOf(truncated: boolean): { outcome?: 'truncated' } {
  return truncated ? { outcome: 'truncated' } : {};
}

/** The outcome of an unranked play under one ruleset: its figures, with no rank, players or best moved. */
function unrankedOutcome(
  ruleset: RulesetId,
  rulesetRevision: string,
  figures: { exScore: number; noteCount: number },
  clearLamp: number,
  missCount: number,
): RulesetOutcome {
  return {
    ruleset,
    rulesetRevision,
    exScore: figures.exScore,
    noteCount: figures.noteCount,
    clearLamp,
    missCount,
    rank: 0,
    players: 0,
    improved: { exScore: false, lamp: false, missCount: false },
  };
}

/**
 * What identifies a play regardless of who recorded it or when: the chart that was played, the play settings that
 * affect scoring, and the input stream. Its hash is the submission id, so a retry of the same play is recognised, and
 * the same play submitted from a second account (a downloaded replay) is refused. Recording time, the recorder and the
 * host's `native` extras are left out.
 */
export function identifyPlay(replay: BeMusicReplay, playFingerprint: string): string {
  const { native: _native, ...play } = replay.play;
  return JSON.stringify({ playFingerprint, play, inputs: replay.inputs });
}

function toScoreResultRow(
  scoreId: string,
  ruleset: RulesetId,
  result: ReplayRulesetResult,
  lamp: number,
  missCount: number,
  truncated: boolean,
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
    outcome: truncated ? 'truncated' : null,
  };
}

/** The outcome of an already stored play, for a resubmission. Ranks reflect the current standings. */
async function loadOutcomes(
  db: Database,
  scoreId: string,
  chartFingerprint: string,
  assisted: boolean,
  unranked: string | null,
): Promise<RulesetOutcome[]> {
  const rows = await db.select().from(scoreResult).where(eq(scoreResult.scoreId, scoreId));
  const outcomes = await Promise.all(
    rows.map(async (row): Promise<RulesetOutcome> => {
      if (unranked !== null || row.outcome !== null) {
        return {
          ...unrankedOutcome(row.ruleset, row.rulesetRevision, row, row.clearLamp, row.missCount),
          ...outcomeOf(row.outcome === 'truncated'),
        };
      }
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
        clearLamp: row.clearLamp,
        missCount: row.missCount,
        rank,
        players,
        improved: { exScore: false, lamp: false, missCount: false },
      };
    }),
  );
  return outcomes.sort(byRulesetOrder);
}
