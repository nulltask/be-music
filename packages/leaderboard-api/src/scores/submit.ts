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
import { bestScore, chart, chartAlias, score, scoreResult } from '../db/schema.ts';
import { rankOfExScore, countPlayers } from '../ranking.ts';
import { mergeBestScores } from '../scoring/best.ts';
import { resolveClearLamp, resolveMissCount, type ClearLamp } from '../scoring/lamp.ts';
import { checkFingerprintDocument } from '../submission/documents.ts';
import { sha256Hex } from '../hash.ts';
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

  // L3: the play document must hash to the claimed play fingerprint.
  const playCheck = checkFingerprintDocument(input.playDocument, playFingerprint);
  if (!playCheck.ok) {
    return { status: 'rejected', httpStatus: 422, reason: `play-document-${playCheck.reason}` };
  }

  const known = await db.query.chart.findFirst({ where: eq(chart.chartFingerprint, chartFingerprint) });
  let chartRegistration: ChartRegistration | undefined;
  if (known === undefined) {
    if (input.chartDocument === undefined) {
      return { status: 'rejected', httpStatus: 409, reason: 'chart-document-required' };
    }
    const chartCheck = checkFingerprintDocument(input.chartDocument, chartFingerprint);
    if (!chartCheck.ok) {
      return { status: 'rejected', httpStatus: 422, reason: `chart-document-${chartCheck.reason}` };
    }
    chartRegistration = { document: input.chartDocument };
  }

  // L4 holds trivially when the chart has no control flow (both fingerprints equal) or the play fingerprint was seen
  // before; composing a chart document's outcomes for a new play fingerprint is not implemented yet.
  const knownPlayFingerprints = known?.playFingerprints ?? [];
  const verification =
    chartFingerprint === playFingerprint || knownPlayFingerprints.includes(playFingerprint) ? 'L4' : 'L3';

  const simulated = RULESET_IDS.map((ruleset) => ({ ruleset, result: simulatePlaylog(input.playlog, { ruleset }) }));

  const now = deps.now();
  const scoreId = deps.newId();
  const playlogKey = `playlogs/${scoreId}.bmplay.json.gz`;
  await blobs.put(playlogKey, await gzip(input.playlogText), {
    httpMetadata: { contentType: 'application/json', contentEncoding: 'gzip' },
  });
  if (chartRegistration !== undefined) {
    await blobs.put(documentKey(chartFingerprint), JSON.stringify(chartRegistration.document), {
      httpMetadata: { contentType: 'application/json' },
    });
  }

  const currentBests = await loadBestScores(db, input.userId, chartFingerprint, assisted);
  const playedRuleset = input.playlog.play.judgeRuleset ?? 'lr2';
  const figures = simulated.map(({ ruleset, result }) => {
    const lamp = resolveClearLamp(result, ruleset);
    const missCount = resolveMissCount(result);
    const current = currentBests.get(ruleset);
    const update = mergeBestScores(current, { scoreId, playedAt: now, exScore: result.exScore, lamp, missCount });
    const playedHere = (current?.playedHere ?? false) || playedRuleset === ruleset;
    return { ruleset, result, lamp, missCount, update, playedHere };
  });

  const chartValues = chartRegistration
    ? [
        db
          .insert(chart)
          .values({
            chartFingerprint,
            title: input.playlog.chart.title ?? null,
            artist: input.playlog.chart.artist ?? null,
            subtitle: input.playlog.chart.subtitle ?? null,
            genre: input.playlog.chart.genre ?? null,
            sourceFormat: input.playlog.chart.sourceFormat,
            laneMode: input.playlog.chart.laneMode,
            total: input.playlog.chart.total ?? null,
            lnMode: input.playlog.chart.lnMode,
            judgeRank: chartJudgeRank(input.playlog.chart.judgeRank),
            noteCount: input.playlog.chart.noteCount,
            playFingerprints: verification === 'L4' ? [playFingerprint] : [],
            documentKey: documentKey(chartFingerprint),
            createdAt: new Date(now),
            updatedAt: new Date(now),
          })
          // A concurrent first submission of the same chart may have registered it already.
          .onConflictDoNothing(),
      ]
    : [];
  // The file hashes the client claims (`chart.sha256`, `chart.md5`). The server cannot check them without the file, so
  // they only name the chart on other sites; well-formed ones are kept, lowercased.
  const aliasValues = fileHashAliases(input.playlog.chart).map((alias) =>
    db
      .insert(chartAlias)
      .values({ ...alias, chartFingerprint })
      .onConflictDoNothing(),
  );
  const statements: BatchItem<'sqlite'>[] = [
    ...chartValues,
    ...aliasValues,
    db.insert(score).values({
      id: scoreId,
      submissionId,
      userId: input.userId,
      chartFingerprint,
      playFingerprint,
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
  await refreshChartListing(db, chartFingerprint);

  const results: RulesetOutcome[] = [];
  for (const { ruleset, result, lamp, missCount, update } of figures) {
    const filter = { chartFingerprint, ruleset, assisted, includeAnonymous: true, playedHereOnly: false };
    results.push({
      ruleset,
      rulesetRevision: result.ruleset,
      exScore: result.exScore,
      noteCount: result.noteCount,
      clearLamp: lamp,
      missCount,
      rank: await rankOfExScore(db, filter, update.next.bestEx),
      players: await countPlayers(db, filter),
      improved: update.improved,
    });
  }
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

interface ChartRegistration {
  document: unknown;
}

function documentKey(chartFingerprint: string): string {
  return `charts/${chartFingerprint}.json`;
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
  const outcomes: RulesetOutcome[] = [];
  for (const row of rows) {
    const filter = { chartFingerprint, ruleset: row.ruleset, assisted, includeAnonymous: true, playedHereOnly: false };
    outcomes.push({
      ruleset: row.ruleset,
      rulesetRevision: row.rulesetRevision,
      exScore: row.exScore,
      noteCount: row.noteCount,
      clearLamp: row.clearLamp as ClearLamp,
      missCount: row.missCount,
      rank: await rankOfExScore(db, filter, row.exScore),
      players: await countPlayers(db, filter),
      improved: { exScore: false, lamp: false, missCount: false },
    });
  }
  return outcomes.sort(byRulesetOrder);
}

/** The chart's own judge rank, without the in-play changes (`timeline`). */
function chartJudgeRank(judgeRank: { percent: number; sourceRank?: number; sourceExRank?: number }) {
  return {
    percent: judgeRank.percent,
    ...(judgeRank.sourceRank !== undefined ? { sourceRank: judgeRank.sourceRank } : {}),
    ...(judgeRank.sourceExRank !== undefined ? { sourceExRank: judgeRank.sourceExRank } : {}),
  };
}

const FILE_HASH_PATTERNS = { sha256: /^[0-9a-f]{64}$/, md5: /^[0-9a-f]{32}$/ } as const;

/** The well-formed file hashes of a play log's chart, lowercased, as chart aliases. */
export function fileHashAliases(chart: {
  sha256?: string;
  md5?: string;
}): Array<{ kind: 'sha256' | 'md5'; hash: string }> {
  const aliases: Array<{ kind: 'sha256' | 'md5'; hash: string }> = [];
  for (const kind of ['sha256', 'md5'] as const) {
    const hash = chart[kind]?.toLowerCase();
    if (hash !== undefined && FILE_HASH_PATTERNS[kind].test(hash)) aliases.push({ kind, hash });
  }
  return aliases;
}

async function gzip(text: string): Promise<ArrayBuffer> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return await new Response(stream).arrayBuffer();
}
