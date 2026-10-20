import { eq } from 'drizzle-orm';
import { createAuth, type Env } from './auth.ts';
import { openDatabase } from './db/client.ts';
import { profile, user } from './schema.ts';
import { createProfile, updateProfile } from './profiles.ts';
import { AVATAR_MAX_BYTES, avatarURL, generatedAvatarSVG, putAvatar, removeAvatar } from './avatars.ts';

/** The public projection of a profile. Authentication details never leave Accounts. */
export async function publicProfile(env: Env, subject: string) {
  const found = await openDatabase(env.DB).query.profile.findFirst({ where: eq(profile.userId, subject) });
  return found
    ? {
        handle: found.handle,
        displayName: found.displayName,
        avatarURL: new URL(avatarURL(found.handle, found.avatarKey), env.AUTH_ORIGIN).href,
      }
    : null;
}

/** Profile routes are owned by Accounts; mutations require its session and an exact Origin. */
export async function profileHTTP(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const db = openDatabase(env.DB);
  const reply = (value: unknown, status = 200) =>
    Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
  const publicMatch = /^\/api\/profiles\/([^/]+)$/.exec(url.pathname);
  if (publicMatch && request.method === 'GET') {
    const found = await publicProfile(env, decodeURIComponent(publicMatch[1]));
    return found ? reply(found) : reply({ error: 'not-found' }, 404);
  }
  const avatarMatch = /^\/profiles\/([A-Za-z0-9_]+)\/avatar$/.exec(url.pathname);
  if (avatarMatch && ['GET', 'HEAD'].includes(request.method)) {
    const found = await db.query.profile.findFirst({ where: eq(profile.handle, avatarMatch[1].toLowerCase()) });
    if (!found) return reply({ error: 'not-found' }, 404);
    const object = found.avatarKey ? await env.BLOBS.get(found.avatarKey) : null;
    if (request.method === 'HEAD') await object?.body.cancel();
    return new Response(request.method === 'HEAD' ? null : (object?.body ?? generatedAvatarSVG(found.userId)), {
      headers: {
        'content-type': object?.httpMetadata?.contentType ?? 'image/svg+xml',
        'access-control-allow-origin': '*',
        'cache-control': 'public, max-age=300',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
      },
    });
  }
  if (!['/api/profile', '/api/profile/avatar'].includes(url.pathname)) return null;
  if (request.method !== 'GET' && request.headers.get('origin') !== env.AUTH_ORIGIN)
    return reply({ error: 'invalid-origin' }, 403);
  const session = await createAuth(env).api.getSession({ headers: request.headers });
  if (!session) return reply({ error: 'sign-in-required' }, 401);
  const userId = session.user.id;
  await createProfile(db, userId, session.user.isAnonymous === true);
  if (url.pathname === '/api/profile' && request.method === 'PATCH') {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return reply({ error: 'invalid-json' }, 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ error: 'invalid-profile' }, 400);
    const value = body as Record<string, unknown>;
    if (
      (value.handle !== undefined && typeof value.handle !== 'string') ||
      (value.displayName !== undefined && typeof value.displayName !== 'string')
    )
      return reply({ error: 'invalid-profile' }, 400);
    const result = await updateProfile(db, userId, {
      handle: value.handle as string | undefined,
      displayName: value.displayName as string | undefined,
    });
    if (!result.ok) return reply(result, result.status);
    const current = await publicProfile(env, userId);
    await db.update(user).set({ name: current!.displayName }).where(eq(user.id, userId));
  } else if (url.pathname === '/api/profile/avatar' && request.method === 'PUT') {
    // Bound actual bytes, including chunked requests without Content-Length.
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader)
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > AVATAR_MAX_BYTES) {
          await reader.cancel();
          return reply({ error: 'avatar-too-large' }, 413);
        }
        chunks.push(part.value);
      }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const result = await putAvatar(db, env.BLOBS, userId, bytes);
    if (!result.ok) return reply({ error: result.error }, result.status);
  } else if (url.pathname === '/api/profile/avatar' && request.method === 'DELETE') {
    await removeAvatar(db, env.BLOBS, userId);
  } else if (!(url.pathname === '/api/profile' && request.method === 'GET'))
    return reply({ error: 'method-not-allowed' }, 405);
  return reply(await publicProfile(env, userId));
}
