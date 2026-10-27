import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';
import { createApp } from './app.ts';
import type { Env } from './env.ts';
import {
  makeChart,
  makeReplay,
  ORIGIN,
  signInAnonymously,
  startTestBindings,
  submissionBody,
} from './test-support/support.ts';

let env: Env;
let dispose: () => Promise<void>;
const app = createApp({ chartsetLookup: async () => undefined });
const fetchApp = (path: string, init?: RequestInit): Promise<Response> =>
  Promise.resolve(app.request(`${ORIGIN}${path}`, init, env));

beforeAll(async () => {
  ({ env, dispose } = await startTestBindings());
});

afterAll(async () => {
  await dispose();
});

const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='),
  (c) => c.charCodeAt(0),
);

async function submit(cookie: string): Promise<string> {
  const chart = makeChart(['#00111:01010101', '#00211:0101']);
  const replay = makeReplay(chart, { noteCount: 6, hits: 6 });
  replay.chart.title = 'card test';
  const response = await fetchApp('/api/v0/scores', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', cookie },
    body: submissionBody(replay, chart.playDocument, chart.chartDocument),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { scoreId: string }).scoreId;
}

describe('share cards', () => {
  test('the score page previews as a large card, the default one until its player uploads one', async () => {
    const owner = await signInAnonymously(fetchApp);
    const scoreId = await submit(owner);
    const page = await (await fetchApp(`/scores/${scoreId}`)).text();
    expect(page).toContain('<meta name="twitter:card" content="summary_large_image"');
    const image = /<meta property="og:image" content="([^"]+)"/.exec(page)?.[1];
    expect(image).toBe(`${ORIGIN}/scores/${scoreId}/card?v=d`);
    expect(page).toContain('https://x.com/intent/post?');
    // Only the player's own view asks the client to draw and upload the card.
    expect(page).not.toContain('data-upload=');
    const ownView = await (await fetchApp(`/scores/${scoreId}`, { headers: { cookie: owner } })).text();
    expect(ownView).toContain(`data-upload="/api/v0/scores/${scoreId}/card"`);
    // The card to draw carries the chart's densest notes for its playfield; nobody else's view needs them.
    expect(ownView).toMatch(/"excerpt":\{"lanes":\[\{"tone":"red","side":"1P"\},/);
    expect(page).not.toContain('"excerpt"');

    const fallback = await fetchApp(new URL(image!).pathname + new URL(image!).search);
    expect(fallback.headers.get('content-type')).toBe('image/png');

    const stranger = await signInAnonymously(fetchApp);
    const put = (cookie: string, body: BodyInit, type = 'image/png') =>
      fetchApp(`/api/v0/scores/${scoreId}/card`, { method: 'PUT', headers: { cookie, 'content-type': type }, body });
    expect((await put(stranger, PNG)).status).toBe(403);
    expect((await put(owner, '<svg/>', 'image/svg+xml')).status).toBe(415);
    expect((await put(owner, new Uint8Array(600 * 1024))).status).toBe(413);
    const stored = await put(owner, PNG);
    expect(stored.status).toBe(200);
    const { cardUrl: cardURL } = (await stored.json()) as { cardUrl: string };
    expect(cardURL).toMatch(new RegExp(`^/scores/${scoreId}/card\\?v=[0-9a-f]{16}$`));
    expect(new Uint8Array(await (await fetchApp(cardURL)).arrayBuffer())).toEqual(PNG);
    expect(await (await fetchApp(`/scores/${scoreId}`)).text()).toContain(`${ORIGIN}${cardURL}`);
  });

  test('other pages preview as the site card', async () => {
    const top = await (await fetchApp('/')).text();
    expect(top).toMatch(/<meta property="og:image" content="http:\/\/[^"]+\/assets\/og\.[0-9a-f]{12}\.png"/);
    expect(top).toContain('<meta property="og:image:width" content="1200"');
  });
});
