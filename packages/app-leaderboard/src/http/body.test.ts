import { gzipSync } from 'node:zlib';
import { describe, expect, test } from 'vite-plus/test';
import { readJSONBody } from './body.ts';

const limits = { maxEncodedBytes: 1024, maxDecodedBytes: 4096 };

function request(body: BodyInit, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/v0/scores', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('readJSONBody', () => {
  test('reads plain and gzipped JSON', async () => {
    expect(await readJSONBody(request('{"a":1}'), limits)).toEqual({ ok: true, value: { a: 1 } });
    const gz = gzipSync('{"b":2}');
    expect(await readJSONBody(request(gz, { 'content-encoding': 'gzip' }), limits)).toEqual({
      ok: true,
      value: { b: 2 },
    });
  });

  test('rejects other content types and encodings', async () => {
    expect(await readJSONBody(request('{}', { 'content-type': 'text/plain' }), limits)).toMatchObject({ status: 415 });
    expect(await readJSONBody(request('{}', { 'content-encoding': 'br' }), limits)).toMatchObject({ status: 415 });
  });

  test('cuts off a body over the encoded limit', async () => {
    expect(await readJSONBody(request(`"${'x'.repeat(2000)}"`), limits)).toEqual({
      ok: false,
      status: 413,
      reason: 'body-too-large',
    });
  });

  test('cuts off a small gzip body that inflates past the decoded limit', async () => {
    const bomb = gzipSync(`"${'x'.repeat(100_000)}"`);
    expect(bomb.byteLength).toBeLessThan(limits.maxEncodedBytes);
    expect(await readJSONBody(request(bomb, { 'content-encoding': 'gzip' }), limits)).toEqual({
      ok: false,
      status: 413,
      reason: 'body-too-large',
    });
  });

  test('reports broken gzip and broken JSON', async () => {
    expect(await readJSONBody(request('not gzip', { 'content-encoding': 'gzip' }), limits)).toMatchObject({
      status: 400,
      reason: 'invalid-encoding',
    });
    expect(await readJSONBody(request('{oops'), limits)).toMatchObject({ status: 400, reason: 'invalid-json' });
  });
});
