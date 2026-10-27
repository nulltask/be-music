import type { Hono } from 'hono';
import { describeRoute, resolver, validator } from 'hono-openapi';
import { parseCourseReplay, ReplayParseError, serializeCourseReplay } from '@be-music/player-engine/replay';
import * as v from 'valibot';
import type { AppEnv } from '../app.ts';
import { CARD_HEIGHT, CARD_MAX_BYTES, CARD_WIDTH, courseCardURL, putCourseScoreCard } from '../cards.ts';
import {
  loadCourseDetail,
  loadCourseReplayAccess,
  loadCourseScoreDetail,
  loadMyCourseRank,
} from '../courses/detail.ts';
import { loadCourseRanking } from '../courses/ranking.ts';
import { loadRecentCourseRuns } from '../courses/runs.ts';
import { submitCourseScore } from '../courses/submit.ts';
import { setCourseScoreHidden } from '../courses/visibility.ts';
import { readJSONBody, SUBMISSION_LIMITS } from '../http/body.ts';
import { isOn } from '../http/query.ts';
import {
  courseRankingResponse,
  courseResponse,
  courseRunsQuery,
  courseRunsResponse,
  courseScoreResponse,
  courseSubmissionBody,
  courseSubmissionResponse,
  courseVisibilityBody,
  errorResponse,
  myCourseRankResponse,
  myRankQuery,
  rankingQuery,
  scoreVisibilityResponse,
} from './schemas.ts';

const json = (description: string, schema: Parameters<typeof resolver>[0]) => ({
  description,
  content: { 'application/json': { schema: resolver(schema) } },
});

const signInRequired = json('No session: sign in first (anonymously is enough).', errorResponse(['sign-in-required']));
const notFound = (what: string) => json(`${what} does not exist.`, errorResponse(['not-found']));

/** The rejection codes of a course submission's 422, in the order they are checked. */
const COURSE_REJECTIONS = [
  'invalid-replay',
  'auto-play',
  'aborted',
  'tempo',
  'unreleased',
  'missing-fingerprint',
  'not-a-course-run',
  'play-document-not-a-document',
  'play-document-fingerprint-mismatch',
  'chart-document-not-a-document',
  'chart-document-fingerprint-mismatch',
  'course-ruleset-mismatch',
  'stage-chart-required',
  'stage-chart-invalid',
  'stage-chart-fingerprint-mismatch',
  'course-stage-facts-mismatch',
  'nonstop-stitch-unsupported',
  'nonstop-chart-mismatch',
  'nonstop-stage-mismatch',
  'course-constraint-mismatch',
  'course-carry-in-mismatch',
] as const;

/**
 * The course routes of `/api/v0` (docs/leaderboard.md section 6.1): submitting a course run, a course, its ranking, my
 * rank on it, the latest runs, one run, its replay, and hiding a run. Mounted on the version's own router, so they
 * share its session middleware and its OpenAPI document.
 */
export function mountCourseRoutes(v0: Hono<AppEnv>, options: { now: () => number; newId: () => string }): void {
  const { now, newId } = options;

  v0.post(
    '/course-scores',
    describeRoute({
      tags: ['Courses'],
      summary: 'Submit a course run',
      description:
        'Submits a course replay with the fingerprint documents of each played stage and the charts of the ' +
        'stages it never reached. The body is JSON, gzip-compressed (`Content-Encoding: gzip`). Every played stage ' +
        'is checked like a single play, every unreached stage’s facts must be its chart’s, the run is ' +
        're-simulated under every ruleset, and each stage’s carry-in must be the state the previous stage, ' +
        're-simulated, left. A run given up with ESC on its last stage played is a failed run; one that stopped ' +
        'before the last stage otherwise must have failed there, or it is refused as `aborted`. A NONSTOP run ' +
        'sends every stage chart instead of documents: the server stitches them again, the stitched play must have ' +
        'been recorded on that chart, and the stitched play is re-simulated (given up with ESC, it is a failed run). ' +
        'A course run creates no chart scores. The same run submitted again by the same ' +
        'account answers 200 with the stored result. Rejections name the stage at fault in `detail` when there is one.',
      requestBody: { required: true, content: { 'application/json': { schema: resolver(courseSubmissionBody) } } },
      responses: {
        201: json('Accepted.', courseSubmissionResponse),
        200: json('Already submitted by this account: the stored result.', courseSubmissionResponse),
        400: json(
          'The body is not a course submission (or its `stages` do not match the played stages).',
          errorResponse(['invalid-submission', 'empty-body', 'invalid-encoding', 'invalid-json']),
        ),
        401: signInRequired,
        409: json(
          '`chart-document-required`: send every stage’s `chartDocument` too. `play-already-submitted`: another account sent it.',
          errorResponse(['chart-document-required', 'play-already-submitted']),
        ),
        413: json('The body is too large.', errorResponse(['body-too-large'])),
        415: json('Not gzip-compressed JSON.', errorResponse(['expected-json', 'unsupported-encoding'])),
        422: json('The run cannot be ranked.', errorResponse(COURSE_REJECTIONS)),
        429: json('Too many submissions; retry after `Retry-After` seconds.', errorResponse(['rate-limited'])),
      },
    }),
    async (c) => {
      const userId = c.get('userId');
      if (userId === undefined) return c.json({ error: 'sign-in-required' }, 401);
      // Course runs share the submission limit with single plays.
      if (c.env.SUBMIT_LIMITER !== undefined) {
        const { success } = await c.env.SUBMIT_LIMITER.limit({ key: userId });
        if (!success) return c.json({ error: 'rate-limited' }, 429, { 'Retry-After': '60' });
      }
      const body = await readJSONBody(c.req.raw, SUBMISSION_LIMITS);
      if (!body.ok) return c.json({ error: body.reason }, body.status);
      const parsedBody = v.safeParse(courseSubmissionBody, body.value);
      if (!parsedBody.success) return c.json({ error: 'invalid-submission' }, 400);
      let courseLog;
      try {
        courseLog = parseCourseReplay(parsedBody.output.courseReplay);
      } catch (error) {
        if (error instanceof ReplayParseError) return c.json({ error: 'invalid-replay', detail: error.message }, 422);
        throw error;
      }
      const outcome = await submitCourseScore(
        { db: c.get('db'), blobs: c.env.BLOBS, now, newId },
        {
          userId,
          courseLog,
          courseLogText: serializeCourseReplay(courseLog),
          stages: parsedBody.output.stages,
          ...(parsedBody.output.stageCharts !== undefined ? { stageCharts: parsedBody.output.stageCharts } : {}),
          submittedBy: c.req.header('be-music-client'),
        },
      );
      if (outcome.status === 'rejected') {
        return c.json(
          {
            error: outcome.reason,
            ...(outcome.stage !== undefined ? { detail: `stage ${outcome.stage + 1}` } : {}),
          },
          outcome.httpStatus,
        );
      }
      const { status, ...rest } = outcome;
      return c.json(rest, status === 'accepted' ? 201 : 200);
    },
  );

  v0.get(
    '/course-scores/:id',
    describeRoute({
      tags: ['Courses'],
      summary: 'A course run',
      description: 'A hidden run answers only its player; to anyone else it does not exist.',
      responses: { 200: json('The run under every ruleset.', courseScoreResponse), 404: notFound('The run') },
    }),
    async (c) => {
      const detail = await loadCourseScoreDetail(c.get('db'), c.req.param('id'), c.get('userId'));
      if (detail === undefined) return c.json({ error: 'not-found' }, 404);
      return c.json(detail);
    },
  );

  v0.get(
    '/course-scores',
    describeRoute({
      tags: ['Courses'],
      summary: 'The latest course runs',
      description:
        'Newest first, with their figures under one ruleset. Anonymous players’ runs come in with `anonymous`, or for one `player`; hidden runs are listed only to their own player.',
      responses: { 200: json('The runs.', courseRunsResponse) },
    }),
    validator('query', courseRunsQuery),
    async (c) => {
      const query = c.req.valid('query');
      const userId = c.get('userId');
      const runs = await loadRecentCourseRuns(c.get('db'), {
        limit: query.limit,
        ruleset: query.ruleset,
        includeAnonymous: isOn(query.anonymous) || query.player !== undefined,
        ...(userId !== undefined ? { ownerUserId: userId } : {}),
        ...(query.player !== undefined ? { handle: query.player.toLowerCase() } : {}),
      });
      return c.json({ runs });
    },
  );

  v0.get(
    '/course-scores/:id/replay',
    describeRoute({
      tags: ['Courses'],
      summary: 'A course run’s replay',
      description:
        'The stored course replay (`be-music-course-replay`), gzip-compressed. Anyone can read a shown run’s; only its player a hidden one’s.',
      responses: {
        200: { description: 'The course replay (docs/replay.md).', content: { 'application/json': {} } },
        404: notFound('The run or its replay'),
      },
    }),
    async (c) => {
      const access = await loadCourseReplayAccess(c.get('db'), c.req.param('id'), c.get('userId'));
      if (access === undefined) return c.json({ error: 'not-found' }, 404);
      const object = await c.env.BLOBS.get(access.key);
      if (object === null) return c.json({ error: 'not-found' }, 404);
      return new Response(object.body, {
        headers: {
          'content-type': 'application/json',
          'content-encoding': 'gzip',
          // As a play's log: a stored log never changes.
          'cache-control': access.public ? 'public, max-age=31536000, immutable' : 'private',
        },
        encodeBody: 'manual',
      });
    },
  );

  v0.patch(
    '/course-scores/:id',
    describeRoute({
      tags: ['Courses'],
      summary: 'Hide or show my course run',
      description:
        'A hidden run is kept, but leaves the course rankings, the personal bests, the figures and every list, and only its player can open it. The player’s bests on the course, the trophy best included, are rebuilt from the runs still shown.',
      responses: {
        200: json('The run’s visibility after the change.', scoreVisibilityResponse),
        401: signInRequired,
        403: json('Someone else ran it.', errorResponse(['not-your-score'])),
        404: notFound('The run'),
      },
    }),
    validator('json', courseVisibilityBody),
    async (c) => {
      const userId = c.get('userId');
      if (userId === undefined) return c.json({ error: 'sign-in-required' }, 401);
      const id = c.req.param('id');
      const result = await setCourseScoreHidden(c.get('db'), id, userId, c.req.valid('json').hidden, now());
      if (!result.ok) return c.json({ error: result.error }, result.status);
      return c.json({ id, hidden: result.hidden });
    },
  );

  v0.put(
    '/course-scores/:id/card',
    describeRoute({
      tags: ['Courses'],
      summary: 'Upload a course run’s share card',
      description: `The ${CARD_WIDTH} x ${CARD_HEIGHT} picture link previews of the course run page show (og:image), drawn by the player’s browser: PNG, WebP or JPEG, at most ${CARD_MAX_BYTES / 1024} KB. Only the run’s player can upload it.`,
      requestBody: {
        required: true,
        content: {
          'image/png': { schema: { type: 'string', format: 'binary' } },
          'image/webp': { schema: { type: 'string', format: 'binary' } },
          'image/jpeg': { schema: { type: 'string', format: 'binary' } },
        },
      },
      responses: {
        200: json('Stored.', v.object({ cardUrl: v.string() })),
        400: json('No image was sent.', errorResponse(['empty-body'])),
        401: signInRequired,
        403: json('Someone else ran it.', errorResponse(['not-your-score'])),
        404: notFound('The run'),
        413: json('The image is too large.', errorResponse(['card-too-large'])),
        415: json('Not a PNG, WebP or JPEG image.', errorResponse(['unsupported-image'])),
      },
    }),
    async (c) => {
      const userId = c.get('userId');
      if (userId === undefined) return c.json({ error: 'sign-in-required' }, 401);
      if (Number(c.req.header('content-length') ?? '0') > CARD_MAX_BYTES)
        return c.json({ error: 'card-too-large' }, 413);
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      const result = await putCourseScoreCard(c.get('db'), c.env.BLOBS, c.req.param('id'), userId, bytes);
      if (!result.ok) return c.json({ error: result.error }, result.status);
      return c.json({ cardUrl: courseCardURL(c.req.param('id'), result.cardKey) });
    },
  );

  v0.get(
    '/courses/:courseFingerprint',
    describeRoute({
      tags: ['Courses'],
      summary: 'A course',
      description: 'Its kind, constraints and stage charts, as the first submitted run named them.',
      responses: { 200: json('The course.', courseResponse), 404: notFound('The course') },
    }),
    async (c) => {
      const detail = await loadCourseDetail(c.get('db'), c.req.param('courseFingerprint'));
      if (detail === undefined) return c.json({ error: 'not-found' }, 404);
      return c.json(detail);
    },
  );

  v0.get(
    '/courses/:courseFingerprint/leaderboard',
    describeRoute({
      tags: ['Courses'],
      summary: 'A course’s ranking',
      description:
        'Players by best course EX-Score under one ruleset, ranked like a chart; ties share a rank. `exScoreId` is the course run that set it, and `trophy` the best trophy each player earned.',
      responses: { 200: json('A page of the ranking.', courseRankingResponse) },
    }),
    validator('query', rankingQuery),
    async (c) => {
      const query = c.req.valid('query');
      const ranking = await loadCourseRanking(
        c.get('db'),
        {
          courseFingerprint: c.req.param('courseFingerprint'),
          ruleset: query.ruleset,
          assisted: isOn(query.assisted),
          includeAnonymous: isOn(query.anonymous),
          playedHereOnly: isOn(query.played),
        },
        { offset: query.offset, limit: query.limit },
      );
      return c.json({ ...ranking, offset: query.offset, limit: query.limit });
    },
  );

  v0.get(
    '/courses/:courseFingerprint/leaderboard/me',
    describeRoute({
      tags: ['Courses'],
      summary: 'My rank on a course',
      description: 'My bests on the course (trophy included) and my rank among every player, anonymous ones included.',
      responses: {
        200: json('My rank.', myCourseRankResponse),
        401: signInRequired,
        404: json('I have not run the course under these filters.', errorResponse(['not-played'])),
      },
    }),
    validator('query', myRankQuery),
    async (c) => {
      const userId = c.get('userId');
      if (userId === undefined) return c.json({ error: 'sign-in-required' }, 401);
      const query = c.req.valid('query');
      const mine = await loadMyCourseRank(c.get('db'), {
        userId,
        courseFingerprint: c.req.param('courseFingerprint'),
        ruleset: query.ruleset,
        assisted: isOn(query.assisted),
      });
      if (mine === undefined) return c.json({ error: 'not-played' }, 404);
      return c.json(mine);
    },
  );
}
