import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';
import { createApp } from './app.ts';
import type { Env } from './env.ts';
import {
  makeChart,
  makePlaylog,
  ORIGIN,
  signInAnonymously,
  startTestBindings,
  submissionBody,
} from '../test/support.ts';

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
  const playlog = makePlaylog(chart, { noteCount: 6, hits: 6 });
  playlog.chart.title = 'card test';
  const response = await fetchApp('/api/v0/scores', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', cookie },
    body: submissionBody(playlog, chart.playDocument, chart.chartDocument),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { scoreId: string }).scoreId;
}

describe('share cards', () => {
  test('the score page previews as a large card, the default one until its player uploads one', async () => {
    const owner = await signInAnonymously(fetchApp);
    const scoreId = await submit(owner);
    const page = await (await fetchApp(`/leaderboard/scores/${scoreId}`)).text();
    expect(page).toContain('<meta name="twitter:card" content="summary_large_image"');
    const image = /<meta property="og:image" content="([^"]+)"/.exec(page)?.[1];
    expect(image).toBe(`${ORIGIN}/leaderboard/scores/${scoreId}/card?v=d`);
    expect(page).toContain('https://x.com/intent/post?');
    // Only the player's own view asks the client to draw and upload the card.
    expect(page).not.toContain('data-upload=');
    expect(await (await fetchApp(`/leaderboard/scores/${scoreId}`, { headers: { cookie: owner } })).text()).toContain(
      `data-upload="/api/v0/scores/${scoreId}/card"`,
    );

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
    const { cardUrl } = (await stored.json()) as { cardUrl: string };
    expect(cardUrl).toMatch(new RegExp(`^/leaderboard/scores/${scoreId}/card\\?v=[0-9a-f]{16}$`));
    expect(new Uint8Array(await (await fetchApp(cardUrl)).arrayBuffer())).toEqual(PNG);
    expect(await (await fetchApp(`/leaderboard/scores/${scoreId}`)).text()).toContain(`${ORIGIN}${cardUrl}`);
  });

  test("the chart page previews as the chart's own card, its densest notes drawn by the Worker", async () => {
    const cookie = await signInAnonymously(fetchApp);
    const chart = makeChart(['#00111:01010101', '#00216:01000000', '#00213:0101']);
    const playlog = makePlaylog(chart, { noteCount: 7, hits: 7 });
    const response = await fetchApp('/api/v0/scores', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', cookie },
      body: submissionBody(playlog, chart.playDocument, chart.chartDocument),
    });
    expect(response.status).toBe(201);
    const page = await (
      await fetchApp(`/leaderboard/charts/${chart.chartFingerprint}`, { headers: { cookie } })
    ).text();
    const image = /<meta property="og:image" content="([^"]+)"/.exec(page)?.[1];
    expect(image).toMatch(
      new RegExp(`/leaderboard/charts/${encodeURIComponent(chart.chartFingerprint)}/card\\?v=\\d+-[0-9a-f]{12}$`),
    );
    expect(page).toContain('<meta name="twitter:image:alt" content="be-music Leaderboard: the densest two measures');
    const card = await fetchApp(new URL(image!).pathname + new URL(image!).search);
    expect(card.status).toBe(200);
    expect(card.headers.get('content-type')).toBe('image/png');
    const bytes = new Uint8Array(await card.arrayBuffer());
    // A palette PNG of 1200 x 630 (colour type 3): drawn by the Worker, not the default card.
    expect([...bytes.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
    const header = new DataView(bytes.buffer, bytes.byteOffset + 16, 8);
    expect([header.getUint32(0), header.getUint32(4)]).toEqual([1200, 630]);
    expect(bytes[25]).toBe(3);
    expect((await fetchApp('/leaderboard/charts/bmfp0:unknown/card')).status).toBe(404);
  });

  test('other pages preview as the site card', async () => {
    const top = await (await fetchApp('/leaderboard')).text();
    expect(top).toMatch(
      /<meta property="og:image" content="http:\/\/[^"]+\/leaderboard\/assets\/og\.[0-9a-f]{12}\.png"/,
    );
    expect(top).toContain('<meta property="og:image:width" content="1200"');
  });
});
