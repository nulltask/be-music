/**
 * SHA-256 of bytes or UTF-8 text, as lowercase hex. Web Crypto rather than `@be-music/chart`'s pure-JS SHA-256: it is
 * native on Workers, keeping upload hashing efficient.
 */
export async function sha256Hex(input: Uint8Array | string): Promise<string> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
