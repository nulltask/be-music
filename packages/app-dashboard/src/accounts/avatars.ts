import { eq } from 'drizzle-orm';
import type { Database } from './db/client.ts';
import { profile } from './schema.ts';
import { prepareAvatarUpload, type AvatarUpload } from '@be-music/service-avatar';
export {
  AVATAR_MAX_BYTES,
  detectAvatarType,
  generatedAvatarSVG,
  type AvatarType,
  type AvatarUpload,
} from '@be-music/service-avatar';

/** The URL of a player's icon; the version (the upload's hash, or `g` for the generated one) busts caches on change. */
export function avatarURL(handle: string, avatarKey: string | null): string {
  const version = avatarKey === null ? 'g' : (/\/([0-9a-f]{16})[0-9a-f]*\.\w+$/.exec(avatarKey)?.[1] ?? 'u');
  return `/profiles/${encodeURIComponent(handle)}/avatar?v=${version}`;
}

/** Stores an uploaded icon in R2 and points the profile at it; the previous upload is deleted. */
export async function putAvatar(
  db: Database,
  blobs: R2Bucket,
  userId: string,
  bytes: Uint8Array,
): Promise<AvatarUpload> {
  const upload = await prepareAvatarUpload(userId, bytes);
  if (!upload.ok) return upload;
  const { avatarKey, type } = upload;
  const current = await db.query.profile.findFirst({ where: eq(profile.userId, userId), columns: { avatarKey: true } });
  await blobs.put(avatarKey, bytes, { httpMetadata: { contentType: type } });
  await db.update(profile).set({ avatarKey }).where(eq(profile.userId, userId));
  if (current?.avatarKey != null && current.avatarKey !== avatarKey) await blobs.delete(current.avatarKey);
  return { ok: true, avatarKey };
}

/** Goes back to the generated icon. */
export async function removeAvatar(db: Database, blobs: R2Bucket, userId: string): Promise<void> {
  const current = await db.query.profile.findFirst({ where: eq(profile.userId, userId), columns: { avatarKey: true } });
  await db.update(profile).set({ avatarKey: null }).where(eq(profile.userId, userId));
  if (current?.avatarKey != null) await blobs.delete(current.avatarKey);
}
