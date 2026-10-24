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
  deleted?: true;
}

function debugMenuSettingsDocument(value: unknown): DebugMenuSettingsDocument | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { version, updatedAt, settings } = value as { version?: unknown; updatedAt?: unknown; settings?: unknown };
  if (version !== 1 || typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt < 0) return undefined;
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) return undefined;
  if ((value as { deleted?: unknown }).deleted === true) return { version: 1, updatedAt, settings: {}, deleted: true };
  return { version: 1, updatedAt, settings: settings as Record<string, unknown> };
}

export interface PlayerSettingsBucket {
  get(key: string): Promise<{ etag: string; text(): Promise<string> } | null>;
  put(
    key: string,
    value: string,
    options?: { onlyIf: { etagMatches?: string; etagDoesNotMatch?: string } },
  ): Promise<{ etag: string } | null>;
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
  if (request.method === 'GET') {
    const chosen = latest((await snapshots(bucket, keys(device.id, subject))).map((entry) => entry.document));
    return json(chosen ?? null, chosen ? 200 : 204, device.id);
  }
  if (request.method !== 'PUT' && request.method !== 'DELETE') {
    return json({ error: 'method' }, 405, device.id);
  }
  const origin = request.headers.get('origin');
  const target = new URL(request.url).origin;
  if (origin !== target) return json({ error: 'origin' }, 403, device.id);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return json({ error: 'too-large' }, 413, device.id);
  let body: unknown;
  try {
    body =
      text === '' && request.method === 'DELETE'
        ? { version: 1, updatedAt: now, settings: {}, deleted: true }
        : JSON.parse(text);
  } catch {
    return json({ error: 'json' }, 400, device.id);
  }
  const incoming = debugMenuSettingsDocument(body);
  if (!incoming) return json({ error: 'document' }, 400, device.id);
  const deletion = request.method === 'DELETE';
  if (!deletion && incoming.deleted) return json({ error: 'document' }, 400, device.id);
  const stored = await storeNewer(bucket, keys(device.id, subject), incoming, deletion);
  if (!stored) return json({ error: 'conflict' }, 409, device.id);
  return json(stored, 200, device.id);
}

interface Snapshot {
  key: string;
  etag?: string;
  document?: DebugMenuSettingsDocument;
}

function keys(id: string, subject: string | undefined): string[] {
  return [deviceKey(id), ...(subject ? [accountKey(subject)] : [])];
}

async function snapshots(bucket: PlayerSettingsBucket, paths: string[]): Promise<Snapshot[]> {
  return Promise.all(
    paths.map(async (key) => {
      const object = await bucket.get(key);
      if (!object) return { key };
      let document: DebugMenuSettingsDocument | undefined;
      try {
        document = debugMenuSettingsDocument(JSON.parse(await object.text()));
      } catch {
        /* Replace invalid data conditionally. */
      }
      return { key, etag: object.etag, document };
    }),
  );
}

function latest(documents: Array<DebugMenuSettingsDocument | undefined>): DebugMenuSettingsDocument | undefined {
  return documents.reduce<DebugMenuSettingsDocument | undefined>(
    (best, item) =>
      item && (!best || item.updatedAt > best.updatedAt || (item.updatedAt === best.updatedAt && item.deleted))
        ? item
        : best,
    undefined,
  );
}

/** Conditional writes retry against the observed version; no GET performs a repair write. */
async function storeNewer(
  bucket: PlayerSettingsBucket,
  paths: string[],
  incoming: DebugMenuSettingsDocument,
  deletion: boolean,
): Promise<DebugMenuSettingsDocument | undefined> {
  // A reset retains its revision only, so delayed pre-reset writes cannot recreate deleted values.
  let candidate = incoming;
  for (let attempt = 0; attempt < 8; attempt++) {
    const entries = await snapshots(bucket, paths);
    const current = latest(entries.map((entry) => entry.document));
    if (deletion) {
      candidate =
        current?.deleted && current.updatedAt >= candidate.updatedAt
          ? current
          : {
              version: 1,
              updatedAt: Math.max(candidate.updatedAt, (current?.updatedAt ?? -1) + 1),
              settings: {},
              deleted: true,
            };
    } else if (current && current.updatedAt >= candidate.updatedAt) candidate = current;
    const body = JSON.stringify(candidate);
    let conflict = false;
    for (const entry of entries) {
      if (JSON.stringify(entry.document) === body) continue;
      const written = await bucket.put(entry.key, body, {
        onlyIf: entry.etag === undefined ? { etagDoesNotMatch: '*' } : { etagMatches: entry.etag },
      });
      if (!written) {
        conflict = true;
        break;
      }
    }
    if (!conflict) return candidate;
  }
  return undefined;
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
