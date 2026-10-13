import { Hono } from 'hono';
import { describeRoute, openAPIRouteHandler, resolver, validator } from 'hono-openapi';
import { parsePlaylog, PlaylogParseError, serializePlaylog } from '@be-music/player/playlog';
import * as v from 'valibot';
import { loadAccount } from '../accounts.ts';
import { AVATAR_MAX_BYTES, putAvatar, removeAvatar } from '../avatars.ts';
import { CARD_HEIGHT, CARD_MAX_BYTES, CARD_WIDTH, cardUrl, putScoreCard } from '../cards.ts';
import { updateProfile } from '../profiles.ts';
import type { AppEnv } from '../app.ts';
import { createAuth } from '../auth.ts';
import { openDatabase } from '../db/client.ts';
import { readJsonBody, SUBMISSION_LIMITS } from '../http/body.ts';
import { loadMyRank, loadRanking, type RankingFilter } from '../ranking.ts';
import { refreshChartsetIfUnchecked, type ChartsetLookup } from '../chartsets/refresh.ts';
import { isOn } from '../http/query.ts';
import { afterResponse } from '../http/after-response.ts';
import { loadPlaylogAccess, loadScoreDetail, toScoreResponse } from '../scores/detail.ts';
import { submitScore } from '../scores/submit.ts';
import {
  accountResponse,
  errorResponse,
  myRankQuery,
  myRankResponse,
  profileUpdateBody,
  rankingQuery,
  rankingResponse,
  scoreResponse,
  submissionBody,
  submissionResponse,
} from './schemas.ts';

/** A JSON response of `schema` for the OpenAPI document. */
const json = (description: string, schema: Parameters<typeof resolver>[0]) => ({
  description,
  content: { 'application/json': { schema: resolver(schema) } },
});

const signInRequired = json('No session: sign in first (anonymously is enough).', errorResponse(['sign-in-required']));
const notFound = (what: string) => json(`${what} does not exist.`, errorResponse(['not-found']));

/** The OpenAPI document's header; the paths come from the routes' `describeRoute` and validators. */
export const OPENAPI_DOCUMENTATION = {
  openapi: '3.1.0',
  info: {
    title: 'be-music Leaderboard API',
    version: '0',
    description:
      'Version 0 is the beta: it may still change incompatibly (docs/leaderboard.md section 8). Requests are ' +
      'authenticated with the Better Auth session cookie from `/api/auth/*`; reads are public.',
  },
  servers: [{ url: '/api/v0' }],
};

/**
 * Version 0 of the Leaderboard API, mounted at `/api/v0` (docs/leaderboard.md section 8). Version 0 is the beta: it may
 * still change incompatibly. Once stable it becomes `/api/v1`, and breaking changes after that go into a new version
 * mounted next to the old one.
 */
export function createV0Api(options: { now: () => number; newId: () => string; chartsetLookup: ChartsetLookup }) {
  const { now, newId, chartsetLookup } = options;
  const v0 = new Hono<AppEnv>();

  v0.use('*', async (c, next) => {
    c.set('db', openDatabase(c.env.DB));
    const session = await createAuth(c.env, new URL(c.req.url).origin).api.getSession({ headers: c.req.raw.headers });
    c.set('userId', session?.user.id);
    await next();
  });

  v0.get(
    '/openapi.json',
    openAPIRouteHandler(v0, { documentation: OPENAPI_DOCUMENTATION, exclude: ['/openapi.json'] }),
  );

  v0.get(
    '/me',
    describeRoute({
      tags: ['Account'],
      summary: 'My account',
      responses: {
        200: json('The signed-in account.', accountResponse),
        401: signInRequired,
        404: notFound('The account'),
      },
    }),
    async (c) => {
      const userId = c.get('userId');
      if (userId === undefined) return c.json({ error: 'sign-in-required' }, 401);
      const account = await loadAccount(c.get('db'), userId);
      if (account === undefined) return c.json({ error: 'not-found' }, 404);
      return c.json(account);
    },
  );

  v0.patch(
    '/me',
    describeRoute({
      tags: ['Account'],
      summary: 'Change my handle or display name',
      description:
        'Fields left out stay as they are. The old handle stays reserved for the player, and its pages redirect to the new one.',
      responses: {
        200: json('The account after the change.', accountResponse),
        400: json(
          'The handle or the display name breaks a rule (`detail`: format, reserved, empty, length, characters).',
          errorResponse(['invalid-handle', 'invalid-display-name']),
        ),
        401: signInRequired,
        404: notFound('The account'),
        409: json('Another player holds this handle, now or formerly.', errorResponse(['handle-taken'])),
      },
    }),
    validator('json', profileUpdateBody),
    async (c) => {
      const userId = c.get('userId');
      if (userId === undefined) return c.json({ error: 'sign-in-required' }, 401);
      const result = await updateProfile(c.get('db'), userId, c.req.valid('json'));
      if (!result.ok) {
        return result.status === 400
          ? c.json({ error: result.error, detail: result.detail }, 400)
          : c.json({ error: result.error }, result.status);
      }
      const account = await loadAccount(c.get('db'), userId);
      if (account === undefined) return c.json({ error: 'not-found' }, 404);
      return c.json(account);
    },
  );

  v0.put(
    '/me/avatar',
    describeRoute({
      tags: ['Account'],
      summary: 'Upload my icon',
      description: `The image itself as the body: WebP, PNG or JPEG (recognized by its signature), at most ${AVATAR_MAX_BYTES / 1024} KB. Clients shrink it to a 256 px square first.`,
      requestBody: {
        required: true,
        content: {
          'image/webp': { schema: { type: 'string', format: 'binary' } },
          'image/png': { schema: { type: 'string', format: 'binary' } },
          'image/jpeg': { schema: { type: 'string', format: 'binary' } },
        },
      },
      responses: {
        200: json('The account with its new icon.', accountResponse),
        400: json('No image was sent.', errorResponse(['empty-body'])),
        401: signInRequired,
        413: json('The image is too large.', errorResponse(['avatar-too-large'])),
        415: json('Not a WebP, PNG or JPEG image.', errorResponse(['unsupported-image'])),
      },
    }),
    async (c) => {
      const userId = c.get('userId');
      if (userId === undefined) return c.json({ error: 'sign-in-required' }, 401);
      const declared = Number(c.req.header('content-length') ?? '0');
      if (declared > AVATAR_MAX_BYTES) return c.json({ error: 'avatar-too-large' }, 413);
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      const result = await putAvatar(c.get('db'), c.env.BLOBS, userId, bytes);
      if (!result.ok) return c.json({ error: result.error }, result.status);
      const account = await loadAccount(c.get('db'), userId);
      if (account === undefined) return c.json({ error: 'not-found' }, 404);
      return c.json(account);
    },
  );

  v0.delete(
    '/me/avatar',
    describeRoute({
      tags: ['Account'],
      summary: 'Remove my icon',
      description: 'Goes back to the icon generated from the account.',
      responses: { 200: json('The account with the generated icon.', accountResponse), 401: signInRequired },
    }),
    async (c) => {
      const userId = c.get('userId');
      if (userId === undefined) return c.json({ error: 'sign-in-required' }, 401);
      await removeAvatar(c.get('db'), c.env.BLOBS, userId);
      const account = await loadAccount(c.get('db'), userId);
      if (account === undefined) return c.json({ error: 'not-found' }, 404);
      return c.json(account);
    },
  );

  v0.post(
    '/scores',
    describeRoute({
      tags: ['Scores'],
      summary: 'Submit a play',
      description:
        'Submits a play log with its fingerprint documents. The body is JSON, gzip-compressed (`Content-Encoding: ' +
        'gzip`). The server re-simulates the play under every ruleset and answers its figures and ranks. The same ' +
        'play submitted again by the same account answers 200 with the stored result.',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: resolver(submissionBody) } },
      },
      responses: {
        201: json('Accepted.', submissionResponse),
        200: json('Already submitted by this account: the stored result.', submissionResponse),
        400: json(
          'The body is not a submission.',
          errorResponse(['invalid-submission', 'empty-body', 'invalid-encoding', 'invalid-json']),
        ),
        401: signInRequired,
        409: json(
          '`chart-document-required`: send `chartDocument` too. `play-already-submitted`: another account sent it.',
          errorResponse(['chart-document-required', 'play-already-submitted']),
        ),
        413: json('The body is too large.', errorResponse(['body-too-large'])),
        415: json('Not gzip-compressed JSON.', errorResponse(['expected-json', 'unsupported-encoding'])),
        422: json(
          'The play cannot be ranked: an auto or aborted play, a malformed play log, or a fingerprint document that ' +
            'does not hash to the play log’s fingerprint.',
          errorResponse([
            'invalid-playlog',
            'auto-play',
            'aborted',
            'missing-fingerprint',
            'play-document-not-a-document',
            'play-document-fingerprint-mismatch',
            'chart-document-not-a-document',
            'chart-document-fingerprint-mismatch',
          ]),
        ),
        429: json('Too many submissions; retry after `Retry-After` seconds.', errorResponse(['rate-limited'])),
      },
    }),
    async (c) => {
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
      // A chart seen for the first time is filed under its chartset after the response, without holding it up.
      if (status === 'accepted') {
        afterResponse(c, () => refreshChartsetIfUnchecked(c.get('db'), chartsetLookup, rest.chartFingerprint, now()));
      }
      return c.json(rest, status === 'accepted' ? 201 : 200);
    },
  );

  v0.get(
    '/scores/:id',
    describeRoute({
      tags: ['Scores'],
      summary: 'A play',
      responses: { 200: json('The play under every ruleset.', scoreResponse), 404: notFound('The score') },
    }),
    async (c) => {
      const detail = await loadScoreDetail(c.get('db'), c.req.param('id'));
      if (detail === undefined) return c.json({ error: 'not-found' }, 404);
      return c.json(toScoreResponse(detail));
    },
  );

  v0.put(
    '/scores/:id/card',
    describeRoute({
      tags: ['Scores'],
      summary: 'Upload a play’s share card',
      description: `The ${CARD_WIDTH} x ${CARD_HEIGHT} picture link previews of the score page show (og:image), drawn by the player’s browser: PNG, WebP or JPEG, at most ${CARD_MAX_BYTES / 1024} KB. Only the play’s player can upload it.`,
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
        403: json('Someone else played it.', errorResponse(['not-your-score'])),
        404: notFound('The score'),
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
      const result = await putScoreCard(c.get('db'), c.env.BLOBS, c.req.param('id'), userId, bytes);
      if (!result.ok) return c.json({ error: result.error }, result.status);
      return c.json({ cardUrl: cardUrl(c.req.param('id'), result.cardKey) });
    },
  );

  v0.get(
    '/scores/:id/playlog',
    describeRoute({
      tags: ['Scores'],
      summary: 'A play’s play log',
      description: 'The stored play log, gzip-compressed. Only its player can read a private one.',
      responses: {
        200: { description: 'The play log (docs/playlog.md).', content: { 'application/json': {} } },
        404: notFound('The score or its play log'),
      },
    }),
    async (c) => {
      const access = await loadPlaylogAccess(c.get('db'), c.req.param('id'), c.get('userId'));
      if (access === undefined) return c.json({ error: 'not-found' }, 404);
      const object = await c.env.BLOBS.get(access.key);
      if (object === null) return c.json({ error: 'not-found' }, 404);
      return new Response(object.body, {
        headers: {
          'content-type': 'application/json',
          'content-encoding': 'gzip',
          'cache-control': access.public ? 'public, max-age=31536000, immutable' : 'private',
        },
        encodeBody: 'manual',
      });
    },
  );

  v0.get(
    '/charts/:chartFingerprint/leaderboard',
    describeRoute({
      tags: ['Rankings'],
      summary: 'A chart’s ranking',
      description: 'Players by best EX-Score under one ruleset; ties share a rank.',
      responses: { 200: json('A page of the ranking.', rankingResponse) },
    }),
    validator('query', rankingQuery),
    async (c) => {
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
    },
  );

  v0.get(
    '/charts/:chartFingerprint/leaderboard/me',
    describeRoute({
      tags: ['Rankings'],
      summary: 'My rank on a chart',
      description: 'My best on the chart and my rank among every player, anonymous ones included.',
      responses: {
        200: json('My rank.', myRankResponse),
        401: signInRequired,
        404: json('I have not played the chart under these filters.', errorResponse(['not-played'])),
      },
    }),
    validator('query', myRankQuery),
    async (c) => {
      const userId = c.get('userId');
      if (userId === undefined) return c.json({ error: 'sign-in-required' }, 401);
      const query = c.req.valid('query');
      const mine = await loadMyRank(c.get('db'), {
        userId,
        chartFingerprint: c.req.param('chartFingerprint'),
        ruleset: query.ruleset,
        assisted: isOn(query.assisted),
      });
      if (mine === undefined) return c.json({ error: 'not-played' }, 404);
      return c.json(mine);
    },
  );

  return v0;
}
