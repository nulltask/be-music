import { gzipSync } from 'node:zlib';
import { describe, expect, test } from 'vite-plus/test';
import { scoreCardExcerpt } from '../pages/score-card-excerpt.ts';
import { makeChart } from '../test-support/support.ts';
import { readStoredJSON, type StoredJSONObject } from './stored-json.ts';

function objectOf(bytes: Uint8Array, contentEncoding?: string): StoredJSONObject {
  const body = Uint8Array.from(bytes).buffer;
  return {
    ...(contentEncoding !== undefined ? { httpMetadata: { contentEncoding } } : {}),
    arrayBuffer: () => Promise.resolve(body),
  };
}

describe('readStoredJSON', () => {
  test('a gzip chart document still yields the excerpt', async () => {
    const chart = makeChart(['#00111:01', '#00311:0101010101010101', '#00316:01', '#00412:0101']);
    const excerpt = scoreCardExcerpt(chart.chartDocument, '7 KEY SP');
    const gzip = gzipSync(JSON.stringify(chart.chartDocument));
    const plain = new TextEncoder().encode(JSON.stringify(chart.chartDocument));

    expect(scoreCardExcerpt(await readStoredJSON(objectOf(gzip, 'gzip')), '7 KEY SP')).toEqual(excerpt);
    // A copy that lost Content-Encoding is still gzip: the magic bytes say so.
    expect(scoreCardExcerpt(await readStoredJSON(objectOf(gzip)), '7 KEY SP')).toEqual(excerpt);
    // Documents stored before compression stay plain JSON at the same key.
    expect(scoreCardExcerpt(await readStoredJSON(objectOf(plain)), '7 KEY SP')).toEqual(excerpt);
  });
});
