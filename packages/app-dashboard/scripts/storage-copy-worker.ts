import type { Crypto, SubtleCrypto } from '@cloudflare/workers-types';
/** Temporary maintenance Worker. Deploy with explicit source/destination R2 bindings and a random COPY_SECRET. */
interface CopyEnv {
  SOURCE: R2Bucket;
  DESTINATION: R2Bucket;
  COPY_SECRET: string;
  SOURCE_NAME: string;
  DESTINATION_NAME: string;
}
export default {
  async fetch(request: Request, env: CopyEnv): Promise<Response> {
    const provided = new TextEncoder().encode(request.headers.get('authorization') ?? '');
    const expected = new TextEncoder().encode(`Bearer ${env.COPY_SECRET}`);
    if (
      !env.COPY_SECRET ||
      provided.length !== expected.length ||
      !(crypto.subtle as SubtleCrypto).timingSafeEqual(provided, expected)
    )
      return new Response('Forbidden', { status: 403 });
    const url = new URL(request.url);
    if (
      url.searchParams.get('source') !== env.SOURCE_NAME ||
      url.searchParams.get('destination') !== env.DESTINATION_NAME
    )
      return new Response('Bindings not ready', { status: 409 });
    if (request.method === 'DELETE' && url.pathname === '/empty-source') {
      const allowed = new Set([
        'be-music',
        'be-music-ffmpeg-core',
        'be-music-leaderboard',
        'be-music-leaderboard-preview',
      ]);
      if (!allowed.has(env.SOURCE_NAME) || url.searchParams.get('confirm') !== env.SOURCE_NAME)
        return new Response('Forbidden', { status: 403 });
      const objects = await env.SOURCE.list({ limit: 1000 });
      if (objects.objects.length) await env.SOURCE.delete(objects.objects.map((object) => object.key));
      return Response.json({ deleted: objects.objects.length, more: objects.truncated });
    }
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const source = await env.SOURCE.list({
      limit: 20,
      cursor: url.searchParams.get('cursor') ?? undefined,
      prefix: url.searchParams.get('prefix') ?? undefined,
      include: ['httpMetadata', 'customMetadata'],
    });
    let copied = 0;
    let bytes = 0;
    for (const listed of source.objects) {
      if (url.searchParams.get('excludeAvatars') === 'true' && listed.key.startsWith('avatars/')) continue;
      const existing = await env.DESTINATION.head(listed.key);
      // Immutable content-addressed keys and play IDs make retries safe. Never replace an already copied object.
      if (existing) {
        if (existing.size !== listed.size || (!listed.etag.includes('-') && existing.etag !== listed.etag))
          throw new Error('Destination object differs; refusing to overwrite');
      } else {
        if (url.pathname === '/verify') throw new Error('Destination object missing');
        const object = await env.SOURCE.get(listed.key);
        if (!object) throw new Error('Source object disappeared');
        await env.DESTINATION.put(object.key, object.body, {
          httpMetadata: object.httpMetadata,
          customMetadata: object.customMetadata,
        });
        const stored = await env.DESTINATION.head(object.key);
        if (!stored || stored.size !== object.size || (!object.etag.includes('-') && stored.etag !== object.etag))
          throw new Error('Copy verification failed');
      }
      if (url.pathname === '/verify') {
        const original = await env.SOURCE.get(listed.key);
        const stored = await env.DESTINATION.get(listed.key);
        if (!original || !stored) throw new Error('Object missing during content verification');
        const hash = async (body: ReadableStream<Uint8Array>) => {
          const stream = new (crypto as Crypto).DigestStream('SHA-256');
          await body.pipeTo(stream);
          return stream.digest;
        };
        const [sourceHash, destinationHash] = await Promise.all([hash(original.body), hash(stored.body)]);
        if (!(crypto.subtle as SubtleCrypto).timingSafeEqual(sourceHash, destinationHash))
          throw new Error('Copied bytes differ');
      }
      copied++;
      bytes += listed.size;
    }
    return Response.json({
      verifier: 'sha256-v1',
      source: env.SOURCE_NAME,
      destination: env.DESTINATION_NAME,
      objects: copied,
      bytes,
      cursor: source.truncated ? source.cursor : null,
    });
  },
} satisfies ExportedHandler<CopyEnv>;
