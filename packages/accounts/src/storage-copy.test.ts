import { expect, test } from 'vite-plus/test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('copies binary bytes and metadata, verifies retries, and refuses unauthenticated requests', async () => {
  const source = await readFile(new URL('../scripts/storage-copy-worker.ts', import.meta.url), 'utf8');
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: stripTypeScriptTypes(source),
      compatibilityDate: '2026-10-01',
      r2Buckets: ['SOURCE', 'DESTINATION'],
      bindings: {
        COPY_SECRET: 'test-copy-secret',
        SOURCE_NAME: 'be-music-leaderboard',
        DESTINATION_NAME: 'leaderboard',
      },
    }),
  );
  try {
    const bucket = await mf.getR2Bucket('SOURCE');
    const destination = await mf.getR2Bucket('DESTINATION');
    await bucket.put('playlogs/test.gz', new Uint8Array([0, 1, 2, 255]), {
      httpMetadata: { contentType: 'application/json', contentEncoding: 'gzip' },
      customMetadata: { version: 'one' },
    });
    await bucket.put('avatars/test.png', 'avatar');
    const call = (path: string) =>
      mf.dispatchFetch(
        'https://copy.example' +
          path +
          (path.includes('?') ? '&' : '?') +
          'source=be-music-leaderboard&destination=leaderboard',
        {
          method: 'POST',
          headers: { authorization: 'Bearer test-copy-secret' },
        },
      );
    expect((await mf.dispatchFetch('https://copy.example/copy', { method: 'POST' })).status).toBe(403);
    expect((await call('/verify?excludeAvatars=true')).status).toBe(500);
    expect((await call('/copy?excludeAvatars=true')).status).toBe(200);
    const copied = await destination.get('playlogs/test.gz');
    expect(new Uint8Array(await copied!.arrayBuffer())).toEqual(new Uint8Array([0, 1, 2, 255]));
    expect(copied!.httpMetadata).toEqual({ contentType: 'application/json', contentEncoding: 'gzip' });
    expect(copied!.customMetadata).toEqual({ version: 'one' });
    expect(await destination.head('avatars/test.png')).toBeNull();
    expect((await call('/verify?excludeAvatars=true')).status).toBe(200);
    expect((await call('/copy?excludeAvatars=true')).status).toBe(200);
    await destination.put('playlogs/test.gz', 'wrong');
    expect((await call('/copy?excludeAvatars=true')).status).toBe(500);
    const emptyURL = 'https://copy.example/empty-source?source=be-music-leaderboard&destination=leaderboard';
    expect(
      (await mf.dispatchFetch(emptyURL, { method: 'DELETE', headers: { authorization: 'Bearer test-copy-secret' } }))
        .status,
    ).toBe(403);
    expect(
      (
        await mf.dispatchFetch(emptyURL + '&confirm=be-music-leaderboard', {
          method: 'DELETE',
          headers: { authorization: 'Bearer test-copy-secret' },
        })
      ).status,
    ).toBe(200);
    expect((await bucket.list()).objects).toHaveLength(0);
    expect(await destination.head('playlogs/test.gz')).not.toBeNull();
  } finally {
    await mf.dispose();
  }
});
