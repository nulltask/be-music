import { cloudflareAccountId } from './env.ts';
import {
  parseAllowedEmails,
  PREVIEW_ACCESS_APP_NAME,
  PREVIEW_ACCESS_POLICY_NAME,
  previewAccessApplication,
  previewAccessPolicy,
} from './access.ts';

/**
 * `node scripts/cloudflare/access-apply.ts [--apply]` puts the preview hosts behind Cloudflare Access (access.ts).
 * Without `--apply` it only prints what it would send. Running it again updates the same policy and application.
 *
 * Needs `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (Access: Apps and Policies Edit, and Access: Organizations,
 * Identity Providers, and Groups Read) and `ACCESS_ALLOWED_EMAILS`, from the environment or `.env.cloudflare`. The
 * GitHub identity provider must already exist in Zero Trust (Settings → Authentication).
 */
const apply = process.argv.includes('--apply');
const accountId = cloudflareAccountId();
const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
if (!accountId || !token) throw new Error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.');
const emails = parseAllowedEmails(process.env.ACCESS_ALLOWED_EMAILS);
const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/access`;

interface Named {
  id: string;
  name: string;
  type?: string;
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json()) as { success: boolean; errors?: unknown; result: T };
  if (!response.ok || !json.success) {
    throw new Error(`${method} ${path} failed (${response.status}): ${JSON.stringify(json.errors)}`);
  }
  return json.result;
}

/** Create `body` at `path`, or replace the existing entry with the same name. */
async function upsert(path: string, existing: Named | undefined, body: { name: string }): Promise<string> {
  const action = existing ? `update ${path}/${existing.id}` : `create ${path}`;
  console.log(`${apply ? '' : '[dry run] '}${action}: ${body.name}`);
  if (!apply) {
    console.log(JSON.stringify(body, null, 2));
    return existing?.id ?? '<new id>';
  }
  const result = existing
    ? await api<Named>('PUT', `${path}/${existing.id}`, body)
    : await api<Named>('POST', path, body);
  return result.id;
}

const providers = await api<Named[]>('GET', '/identity_providers');
const github = providers.find((provider) => provider.type === 'github');
if (!github) throw new Error('Add a GitHub identity provider in Zero Trust (Settings → Authentication) first.');

const policies = await api<Named[]>('GET', '/policies');
const policyId = await upsert(
  '/policies',
  policies.find((policy) => policy.name === PREVIEW_ACCESS_POLICY_NAME),
  previewAccessPolicy(emails, github.id),
);

const apps = await api<Named[]>('GET', '/apps');
await upsert(
  '/apps',
  apps.find((app) => app.name === PREVIEW_ACCESS_APP_NAME),
  previewAccessApplication(policyId, github.id),
);
if (!apply) console.log('Nothing was changed. Run again with --apply to send it.');
