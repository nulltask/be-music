import { generateSpecs } from 'hono-openapi';
import { describe, expect, test } from 'vite-plus/test';
import { bmsSearchLookup } from '../chartsets/refresh.ts';
import { createV0API, OPENAPI_DOCUMENTATION } from './v0.ts';

const api = createV0API({ now: Date.now, newId: () => 'id', chartsetLookup: bmsSearchLookup() });

describe('OpenAPI document', () => {
  test('describes every route of /api/v0 from its schemas', async () => {
    const spec = await generateSpecs(api, { documentation: OPENAPI_DOCUMENTATION, exclude: ['/openapi.json'] });
    expect(Object.keys(spec.paths ?? {}).sort()).toEqual([
      '/charts/{chartFingerprint}/leaderboard',
      '/charts/{chartFingerprint}/leaderboard/me',
      '/course-scores',
      '/course-scores/{id}',
      '/course-scores/{id}/playlog',
      '/courses/{courseFingerprint}',
      '/courses/{courseFingerprint}/leaderboard',
      '/courses/{courseFingerprint}/leaderboard/me',
      '/me',
      '/me/avatar',
      '/scores',
      '/scores/{id}',
      '/scores/{id}/card',
      '/scores/{id}/playlog',
    ]);
    const ranking = spec.paths?.['/charts/{chartFingerprint}/leaderboard']?.get;
    // The query parameters come from the validator the route runs.
    expect(ranking?.parameters?.map((parameter) => ('name' in parameter ? parameter.name : undefined))).toEqual(
      expect.arrayContaining(['ruleset', 'assisted', 'anonymous', 'played', 'offset', 'limit']),
    );
    // A course ranking takes the same filters as a chart's.
    const courseRanking = spec.paths?.['/courses/{courseFingerprint}/leaderboard']?.get;
    expect(courseRanking?.parameters?.map((parameter) => ('name' in parameter ? parameter.name : undefined))).toEqual(
      expect.arrayContaining(['ruleset', 'assisted', 'anonymous', 'played', 'offset', 'limit']),
    );
    // Committed next to the package so API changes show up in review; refresh it with `vp test run -u`.
    await expect(`${JSON.stringify(spec, null, 2)}\n`).toMatchFileSnapshot('../../openapi.json');
  });
});
