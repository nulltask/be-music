import { sValidator } from '@hono/standard-validator';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { parsePlaylog, PlaylogParseError, serializePlaylog } from '@be-music/player/playlog';
import * as v from 'valibot';
import { createAuth } from './auth.ts';
import { openDatabase, type Database } from './db/client.ts';
import { bestScore, profile, score, scoreResult } from './db/schema.ts';
import type { Env } from './env.ts';
import { readJsonBody, SUBMISSION_LIMITS } from './http/body.ts';
import { countPlayers, loadRanking, rankOfExScore, type RankingFilter } from './ranking.ts';
import { submitScore } from './scores/submit.ts';

interface Variables {
  db: Database;
  userId: string | undefined;
}

type AppEnv = { Bindings: Env; Variables: Variables };

const rulesetSchema = v.picklist(['lr2', 'beatoraja', 'iidx']);
const flagSchema = v.optional(v.picklist(['0', '1', 'true', 'false']), '0');
const isOn = (flag: string): boolean => flag === '1' || flag === 'true';

const rankingQuery = v.object({
  ruleset: rulesetSchema,
  assisted: flagSchema,
  anonymous: flagSchema,
  played: flagSchema,
  offset: v.optional(v.pipe(v.string(), v.toNumber(), v.integer(), v.minValue(0)), '0'),
  limit: v.optional(v.pipe(v.string(), v.toNumber(), v.integer(), v.minValue(1), v.maxValue(100)), '50'),
});

const meQuery = v.object({ ruleset: rulesetSchema, assisted: flagSchema });

const submissionBody = v.object({
  playlog: v.unknown(),
  playDocument: v.unknown(),
  chartDocument: v.optional(v.unknown()),
});

/** The Leaderboard API (docs/leaderboard.md section 8). */
export function createApp(options: { now?: () => number; newId?: () => string } = {}) {
  const now = options.now ?? Date.now;
  const newId = options.newId ?? (() => crypto.randomUUID());

  const app = new Hono<AppEnv>();

  app.on(['GET', 'POST'], '/api/auth/*', (c) => createAuth(c.env, new URL(c.req.url).origin).handler(c.req.raw));

  app.use('/api/v1/*', async (c, next) => {
    c.set('db', openDatabase(c.env.DB));
    const session = await createAuth(c.env, new URL(c.req.url).origin).api.getSession({ headers: c.req.raw.headers });
    c.set('userId', session?.user.id);
    await next();
  });

  app.post('/api/v1/scores', async (c) => {
    const userId = c.get('userId');
    if (userId === undefined) {
      return c.json({ error: 'sign-in-required' }, 401);
    }
    if (c.env.SUBMIT_LIMITER !== undefined) {
      const { success } = await c.env.SUBMIT_LIMITER.limit({ key: userId });
      if (!success) return c.json({ error: 'rate-limited' }, 429, { 'Retry-After': '60' });
    }
    const body = await readJsonBody(c.req.raw, SUBMISSION_LIMITS);
    if (!body.ok) {
      return c.json({ error: body.reason }, body.status);
    }
    const parsedBody = v.safeParse(submissionBody, body.value);
    if (!parsedBody.success) {
      return c.json({ error: 'invalid-submission' }, 400);
    }
    let playlog;
    try {
      playlog = parsePlaylog(parsedBody.output.playlog);
    } catch (error) {
      if (error instanceof PlaylogParseError) return c.json({ error: 'invalid-playlog', detail: error.message }, 422);
      throw error;
    }
    const outcome = await submitScore(
      { db: c.get('db'), blobs: c.env.BLOBS, now, newId },
      {
        userId,
        playlog,
        playlogText: serializePlaylog(playlog),
        playDocument: parsedBody.output.playDocument,
        chartDocument: parsedBody.output.chartDocument,
        submittedBy: c.req.header('be-music-client'),
      },
    );
    if (outcome.status === 'rejected') {
      return c.json({ error: outcome.reason }, outcome.httpStatus);
    }
    const { status, ...rest } = outcome;
    return c.json(rest, status === 'accepted' ? 201 : 200);
  });

  app.get('/api/v1/scores/:id', async (c) => {
    const db = c.get('db');
    const found = await db.query.score.findFirst({ where: eq(score.id, c.req.param('id')) });
    if (found === undefined) return c.json({ error: 'not-found' }, 404);
    const owner = await db.query.profile.findFirst({ where: eq(profile.userId, found.userId) });
    const results = await db.select().from(scoreResult).where(eq(scoreResult.scoreId, found.id));
    return c.json({
      id: found.id,
      chartFingerprint: found.chartFingerprint,
      playFingerprint: found.playFingerprint,
      player: owner ? { handle: owner.handle, displayName: owner.displayName } : null,
      playedRuleset: found.playedRuleset,
      gauge: found.gauge,
      assisted: found.assisted,
      assistFlags: found.assistFlags,
      verification: found.verification,
      createdAt: found.createdAt.getTime(),
      results: results.map(({ scoreId: _scoreId, ...result }) => result),
    });
  });

  app.get('/api/v1/scores/:id/playlog', async (c) => {
    const db = c.get('db');
    const found = await db.query.score.findFirst({ where: eq(score.id, c.req.param('id')) });
    if (found === undefined) return c.json({ error: 'not-found' }, 404);
    if (found.replayVisibility !== 'public' && found.userId !== c.get('userId')) {
      return c.json({ error: 'not-found' }, 404);
    }
    const object = await c.env.BLOBS.get(found.playlogKey);
    if (object === null) return c.json({ error: 'not-found' }, 404);
    return new Response(object.body, {
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'cache-control': found.replayVisibility === 'public' ? 'public, max-age=31536000, immutable' : 'private',
      },
      encodeBody: 'manual',
    });
  });

  app.get('/api/v1/charts/:chartFingerprint/leaderboard', sValidator('query', rankingQuery), async (c) => {
    const query = c.req.valid('query');
    const filter: RankingFilter = {
      chartFingerprint: c.req.param('chartFingerprint'),
      ruleset: query.ruleset,
      assisted: isOn(query.assisted),
      includeAnonymous: isOn(query.anonymous),
      playedHereOnly: isOn(query.played),
    };
    const ranking = await loadRanking(c.get('db'), filter, { offset: query.offset, limit: query.limit });
    return c.json({ ...ranking, offset: query.offset, limit: query.limit });
  });

  app.get('/api/v1/charts/:chartFingerprint/leaderboard/me', sValidator('query', meQuery), async (c) => {
    const userId = c.get('userId');
    if (userId === undefined) return c.json({ error: 'sign-in-required' }, 401);
    const query = c.req.valid('query');
    const db = c.get('db');
    const chartFingerprint = c.req.param('chartFingerprint');
    const assisted = isOn(query.assisted);
    const mine = await db.query.bestScore.findFirst({
      where: and(
        eq(bestScore.userId, userId),
        eq(bestScore.chartFingerprint, chartFingerprint),
        eq(bestScore.ruleset, query.ruleset),
        eq(bestScore.assisted, assisted),
      ),
    });
    if (mine === undefined) return c.json({ error: 'not-played' }, 404);
    // The viewer's own rank counts everyone, anonymous players included, so an anonymous viewer is ranked too.
    const filter: RankingFilter = {
      chartFingerprint,
      ruleset: query.ruleset,
      assisted,
      includeAnonymous: true,
      playedHereOnly: false,
    };
    return c.json({
      rank: await rankOfExScore(db, filter, mine.bestEx),
      players: await countPlayers(db, filter),
      exScore: mine.bestEx,
      exScoreId: mine.bestExScoreId,
      clearLamp: mine.bestLamp,
      missCount: mine.minMiss,
      playCount: mine.playCount,
    });
  });

  return app;
}

export type AppType = ReturnType<typeof createApp>;
