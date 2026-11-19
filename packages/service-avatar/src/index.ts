import { sha256HexAsync as sha256Hex } from '@be-music/shared-utils/hash';

/**
 * Player icons. A player may upload one (the clients shrink it to a 256 px square first); without one, an icon is
 * generated from the account id, so it stays the same when the handle changes.
 */

/** Uploads above this are refused; a 256 px WebP is a few KB. */
export const AVATAR_MAX_BYTES = 128 * 1024;

const TYPES = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
} as const;
export type AvatarType = keyof typeof TYPES;

/** The image type of `bytes` by its signature, or undefined for anything else (the declared type is not trusted). */
export function detectAvatarType(bytes: Uint8Array): AvatarType | undefined {
  const at = (offset: number, ...values: number[]) => values.every((value, i) => bytes[offset + i] === value);
  if (bytes.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  if (bytes.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (bytes.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  return undefined;
}

/** FNV-1a, 32 bits: a small stable hash to draw the generated icon from. */
function fnv1a(text: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * A generated icon: a 5 by 5 grid, mirrored left to right, in one colour drawn from `seed` (the account id), on a dark
 * square. The same seed always gives the same picture.
 */
export function generatedAvatarSVG(seed: string): string {
  const bits = fnv1a(seed);
  const hue = fnv1a(seed, 0x2f6b8a4d) % 360;
  const cells: string[] = [];
  for (let row = 0; row < 5; row++) {
    for (let column = 0; column < 3; column++) {
      if (((bits >>> (row * 3 + column)) & 1) === 0) continue;
      for (const x of column === 2 ? [2] : [column, 4 - column]) {
        cells.push(`<rect x="${x + 1}" y="${row + 1}" width="1" height="1"/>`);
      }
    }
  }
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 7 7" shape-rendering="crispEdges">' +
    '<rect width="7" height="7" fill="#0f172a"/>' +
    `<g fill="hsl(${hue} 70% 62%)">${cells.join('')}</g></svg>`
  );
}

type AvatarUploadError = {
  ok: false;
  status: 400 | 413 | 415;
  error: 'empty-body' | 'avatar-too-large' | 'unsupported-image';
};
export type AvatarUpload = { ok: true; avatarKey: string } | AvatarUploadError;

export async function prepareAvatarUpload(
  userId: string,
  bytes: Uint8Array,
): Promise<AvatarUploadError | { ok: true; avatarKey: string; type: AvatarType }> {
  if (bytes.length === 0) return { ok: false, status: 400, error: 'empty-body' };
  if (bytes.length > AVATAR_MAX_BYTES) return { ok: false, status: 413, error: 'avatar-too-large' };
  const type = detectAvatarType(bytes);
  if (type === undefined) return { ok: false, status: 415, error: 'unsupported-image' };
  const avatarKey = `avatars/${userId}/${await sha256Hex(bytes)}.${TYPES[type]}`;
  return { ok: true, avatarKey, type };
}
