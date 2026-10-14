import { eq } from 'drizzle-orm';
import { CHART_CARD_BACKGROUND_HASH, chartCardBackground } from '../chart-card/background.ts';
import { CHART_CARD_LAYOUT, chartCardRects, renderChartCard } from '../chart-card/card.ts';
import type { ExcerptDocument } from '../chart-card/excerpt.ts';
import { openDatabase } from '../db/client.ts';
import { chart, score } from '../db/schema.ts';
import { afterResponse } from '../http/after-response.ts';
import { ICONS } from './icons.generated.ts';
import type { PageContext } from './page.tsx';

/** Card URLs carry a version, so caches keep them; a play without its own card falls back to the default one. */
const CARD_CACHE = 'public, max-age=86400';

let defaultCard: Uint8Array<ArrayBuffer> | undefined;
function defaultCardBytes(): Uint8Array<ArrayBuffer> {
  if (defaultCard === undefined) {
    const text = atob(ICONS.ogDefault.base64);
    defaultCard = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) defaultCard[i] = text.charCodeAt(i);
  }
  return defaultCard;
}

/** A play's share card (og:image): the one its player's browser drew, or the site's default card. */
export async function scoreCardImage(c: PageContext<'/leaderboard/scores/:id/card'>) {
  const found = await openDatabase(c.env.DB).query.score.findFirst({
    where: eq(score.id, c.req.param('id')),
    columns: { cardKey: true },
  });
  if (found === undefined) return c.body('Not Found', 404);
  if (found.cardKey !== null) {
    const object = await c.env.BLOBS.get(found.cardKey);
    if (object !== null) {
      return c.body(object.body, 200, {
        'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
        'cache-control': CARD_CACHE,
        'x-content-type-options': 'nosniff',
      });
    }
  }
  return c.body(defaultCardBytes(), 200, { 'content-type': 'image/png', 'cache-control': CARD_CACHE });
}

/** The version of a chart's card: the drawing and the background it is drawn on. */
const CHART_CARD_VERSION = `${CHART_CARD_LAYOUT}-${CHART_CARD_BACKGROUND_HASH}`;

/** The URL of a chart's share card; the version busts caches when the drawing changes. */
export function chartCardUrl(chartFingerprint: string): string {
  return `/leaderboard/charts/${encodeURIComponent(chartFingerprint)}/card?v=${CHART_CARD_VERSION}`;
}

/**
 * A chart's share card (og:image): the default card with the chart's densest two measures as lanes and notes
 * (src/chart-card/). The Worker draws it from the chart's fingerprint document on the first request and keeps it in
 * R2; a chart whose document or lane mode is missing gets the default card.
 */
export async function chartCardImage(c: PageContext<'/leaderboard/charts/:chartFingerprint/card'>) {
  const chartFingerprint = c.req.param('chartFingerprint');
  const key = `og/charts/${chartFingerprint}/${CHART_CARD_VERSION}.png`;
  const png = { 'content-type': 'image/png', 'cache-control': CARD_CACHE, 'x-content-type-options': 'nosniff' };
  const stored = await c.env.BLOBS.get(key);
  if (stored !== null) return c.body(stored.body, 200, png);
  const found = await openDatabase(c.env.DB).query.chart.findFirst({
    where: eq(chart.chartFingerprint, chartFingerprint),
    columns: { documentKey: true, laneMode: true },
  });
  if (found === undefined) return c.body('Not Found', 404);
  const document = found.laneMode !== null ? await c.env.BLOBS.get(found.documentKey) : null;
  if (document === null || found.laneMode === null) {
    return c.body(defaultCardBytes(), 200, { 'content-type': 'image/png', 'cache-control': CARD_CACHE });
  }
  const rects = chartCardRects((await document.json()) as ExcerptDocument, found.laneMode);
  const bytes = renderChartCard(await chartCardBackground(), rects);
  afterResponse(c, () => c.env.BLOBS.put(key, bytes, { httpMetadata: { contentType: 'image/png' } }));
  return c.body(bytes, 200, png);
}
