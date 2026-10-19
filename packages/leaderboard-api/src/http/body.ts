/** Upper bounds of a submission body: the bytes on the wire, and the JSON once decompressed. */
export interface BodyLimits {
  maxEncodedBytes: number;
  maxDecodedBytes: number;
}

export const SUBMISSION_LIMITS: BodyLimits = { maxEncodedBytes: 2 * 1024 * 1024, maxDecodedBytes: 16 * 1024 * 1024 };

export type BodyResult = { ok: true; value: unknown } | { ok: false; status: 400 | 413 | 415; reason: string };

/**
 * Reads a JSON request body, gunzipping it when it is sent with `Content-Encoding: gzip` (play logs compress about ten
 * to one). Both the encoded and the decoded size are counted while streaming, so an oversized or decompression-bomb
 * body is cut off instead of buffered.
 */
export async function readJSONBody(request: Request, limits: BodyLimits): Promise<BodyResult> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return { ok: false, status: 415, reason: 'expected-json' };
  }
  const encoding = (request.headers.get('content-encoding') ?? 'identity').toLowerCase();
  if (encoding !== 'identity' && encoding !== 'gzip') {
    return { ok: false, status: 415, reason: 'unsupported-encoding' };
  }
  const declared = Number(request.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > limits.maxEncodedBytes) {
    return { ok: false, status: 413, reason: 'body-too-large' };
  }
  if (request.body === null) {
    return { ok: false, status: 400, reason: 'empty-body' };
  }

  let stream: ReadableStream<Uint8Array> = request.body.pipeThrough(byteLimit(limits.maxEncodedBytes));
  if (encoding === 'gzip') {
    const gunzip = new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>;
    stream = stream.pipeThrough(gunzip).pipeThrough(byteLimit(limits.maxDecodedBytes));
  }
  let text: string;
  try {
    text = await new Response(stream).text();
  } catch (error) {
    if (error instanceof BodyTooLargeError) return { ok: false, status: 413, reason: 'body-too-large' };
    return { ok: false, status: 400, reason: 'invalid-encoding' };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, reason: 'invalid-json' };
  }
}

class BodyTooLargeError extends Error {}

function byteLimit(maxBytes: number): TransformStream<Uint8Array, Uint8Array> {
  let total = 0;
  return new TransformStream({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > maxBytes) {
        controller.error(new BodyTooLargeError());
        return;
      }
      controller.enqueue(chunk);
    },
  });
}
