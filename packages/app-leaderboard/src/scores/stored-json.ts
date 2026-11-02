/** The part of an R2 object needed to read JSON that may be gzip-compressed. */
export interface StoredJSONObject {
  readonly httpMetadata?: { readonly contentEncoding?: string };
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * JSON stored in R2. Chart documents are gzip (`Content-Encoding: gzip`) under `charts/{fingerprint}.json`, the same
 * way replays are; documents written before that are still plain JSON at the same key. Gunzip when the encoding is
 * gzip or the body starts with the gzip magic bytes (`1f 8b`), and parse anything else as text.
 */
export async function readStoredJSON(object: StoredJSONObject): Promise<unknown> {
  const bytes = new Uint8Array(await object.arrayBuffer());
  const gzip =
    object.httpMetadata?.contentEncoding === 'gzip' || (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b);
  const text = gzip
    ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
    : new TextDecoder().decode(bytes);
  return JSON.parse(text);
}
