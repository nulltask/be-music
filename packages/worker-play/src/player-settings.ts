// The Debug Menu document for one browser, and for the signed-in account when there is one.
//
// `__Host-be-music.device` is set with `Set-Cookie`, so it is not script-writable storage. Safari's seven-day cap
// deletes `localStorage` and IndexedDB after seven days of Safari use without a visit; this cookie stays, and the
// next visit reads the document back from R2. The bytes share the play bucket with the ffmpeg core, under
// `player-settings/`, which `/ffmpeg-core/` refuses because that route rejects nested keys.

export const PLAYER_SETTINGS_PATH = '/api/player-settings';
const DEVICE_COOKIE = '__Host-be-music.device';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400;
const MAX_BODY_BYTES = 64 * 1024;
const KEY_PREFIX = 'player-settings';

/** The document the player stores. Field checks happen when the browser reads it back. */
interface DebugMenuSettingsDocument {
  version: 1;
  updatedAt: number;
  settings: Record<string, unknown>;
}

function debugMenuSettingsDocument(value: unknown): DebugMenuSettingsDocument | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { version, updatedAt, settings } = value as { version?: unknown; updatedAt?: unknown; settings?: unknown };
  if (version !== 1 || typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt < 0) return undefined;
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) return undefined;
  return { version: 1, updatedAt, settings: settings as Record<string, unknown> };
}

export interface PlayerSettingsBucket {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(key: string, value: string): Promise<unknown>;
  delete(key: string): Promise<unknown>;
}

/** Reads, writes, or deletes the document. `subject` is the signed-in account, when the session has one. */
export async function handlePlayerSettings(
  request: Request,
  bucket: PlayerSettingsBucket,
  subject: string | undefined,
  now = Date.now(),
): Promise<Response> {
  const device = deviceId(request);
  if (request.method === 'GET') return await read(bucket, device, subject);
  if (request.method !== 'PUT' && request.method !== 'DELETE') {
    return json({ error: 'method' }, 405, device.id);
  }
  const origin = request.headers.get('origin');
  const target = new URL(request.url).origin;
  if (origin !== target) return json({ error: 'origin' }, 403, device.id);
  if (request.method === 'DELETE') {
    await bucket.delete(deviceKey(device.id));
    if (subject) await bucket.delete(accountKey(subject));
    return json({ ok: true }, 200, device.id);
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: 'too-large' }, 413, device.id);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: 'json' }, 400, device.id);
  }
  const incoming = debugMenuSettingsDocument(body);
  if (!incoming) return json({ error: 'document' }, 400, device.id);
  const current = await newer(bucket, device.id, subject);
  if (current && current.updatedAt > incoming.updatedAt) return json(current, 200, device.id);
  const stored = { ...incoming, updatedAt: Math.max(incoming.updatedAt, now) };
  await writeBoth(bucket, device.id, subject, stored);
  return json(stored, 200, device.id);
}

async function read(bucket: PlayerSettingsBucket, device: Device, subject: string | undefined): Promise<Response> {
  const chosen = await newer(bucket, device.id, subject);
  if (!chosen) return json(null, 204, device.id);
  const deviceDoc = await readDoc(bucket, deviceKey(device.id));
  const accountDoc = subject ? await readDoc(bucket, accountKey(subject)) : undefined;
  if (!sameDocument(deviceDoc, chosen)) await bucket.put(deviceKey(device.id), JSON.stringify(chosen));
  if (subject && !sameDocument(accountDoc, chosen)) await bucket.put(accountKey(subject), JSON.stringify(chosen));
  return json(chosen, 200, device.id);
}

async function newer(
  bucket: PlayerSettingsBucket,
  id: string,
  subject: string | undefined,
): Promise<DebugMenuSettingsDocument | undefined> {
  const deviceDoc = await readDoc(bucket, deviceKey(id));
  const accountDoc = subject ? await readDoc(bucket, accountKey(subject)) : undefined;
  if (!deviceDoc) return accountDoc;
  if (!accountDoc) return deviceDoc;
  return accountDoc.updatedAt > deviceDoc.updatedAt ? accountDoc : deviceDoc;
}

async function writeBoth(
  bucket: PlayerSettingsBucket,
  id: string,
  subject: string | undefined,
  document: DebugMenuSettingsDocument,
): Promise<void> {
  const body = JSON.stringify(document);
  await bucket.put(deviceKey(id), body);
  if (subject) await bucket.put(accountKey(subject), body);
}

async function readDoc(bucket: PlayerSettingsBucket, key: string): Promise<DebugMenuSettingsDocument | undefined> {
  const object = await bucket.get(key);
  if (!object) return undefined;
  try {
    return debugMenuSettingsDocument(JSON.parse(await object.text()));
  } catch {
    return undefined;
  }
}

function sameDocument(left: DebugMenuSettingsDocument | undefined, right: DebugMenuSettingsDocument): boolean {
  return left?.updatedAt === right.updatedAt && JSON.stringify(left?.settings) === JSON.stringify(right.settings);
}

function deviceKey(id: string): string {
  return `${KEY_PREFIX}/device/${id}`;
}

function accountKey(subject: string): string {
  return `${KEY_PREFIX}/account/${encodeURIComponent(subject)}`;
}

interface Device {
  readonly id: string;
}

function deviceId(request: Request): Device {
  const cookie = request.headers.get('cookie') ?? '';
  const match = new RegExp(`(?:^|;\\s*)${DEVICE_COOKIE}=([^;]+)`).exec(cookie);
  const current = match?.[1];
  if (current && /^[a-f0-9]{32}$/.test(current)) return { id: current };
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return { id: [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('') };
}

function json(body: unknown, status: number, device: string): Response {
  const headers = new Headers({ 'cache-control': 'no-store' });
  if (status !== 204) headers.set('content-type', 'application/json; charset=utf-8');
  headers.append(
    'set-cookie',
    `${DEVICE_COOKIE}=${device}; HttpOnly; Secure; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`,
  );
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}
