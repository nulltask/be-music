/**
 * The Cloudflare Access application and policy that keep the preview environment (docs/services.md section 2) private.
 * `access-apply.ts` creates or updates them through the Cloudflare API; this module only builds the request bodies.
 *
 * Nothing here is a secret: Access does not depend on its configuration being hidden. The allowed email addresses
 * are personal data, though, so they come from `ACCESS_ALLOWED_EMAILS` (the environment or `.env.cloudflare`), never
 * from the repository.
 */

/** Every preview host: the Dashboard and Accounts on the apex, every other service on a subdomain. */
export const PREVIEW_ACCESS_HOSTS = ['preview.be-music.app', '*.preview.be-music.app'] as const;

export const PREVIEW_ACCESS_APP_NAME = 'Be-Music preview';
export const PREVIEW_ACCESS_POLICY_NAME = 'Be-Music preview: allowed people';

/** Parse a comma- or whitespace-separated list of email addresses, lowercased and without duplicates. */
export function parseAllowedEmails(value: string | undefined): string[] {
  const emails = [
    ...new Set(
      (value ?? '')
        .split(/[\s,]+/)
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  for (const email of emails) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(`Not an email address: ${email}`);
  }
  if (emails.length === 0) throw new Error('ACCESS_ALLOWED_EMAILS lists no email address.');
  return emails;
}

/** A reusable Access policy: allow the listed addresses, and only after they sign in with the given identity provider. */
export function previewAccessPolicy(emails: readonly string[], identityProviderId: string) {
  return {
    name: PREVIEW_ACCESS_POLICY_NAME,
    decision: 'allow',
    include: emails.map((email) => ({ email: { email } })),
    require: [{ login_method: { id: identityProviderId } }],
    exclude: [],
    session_duration: '24h',
  };
}

/** The self-hosted Access application covering every preview host, signing in only through the given provider. */
export function previewAccessApplication(policyId: string, identityProviderId: string) {
  return {
    type: 'self_hosted',
    name: PREVIEW_ACCESS_APP_NAME,
    domain: PREVIEW_ACCESS_HOSTS[0],
    destinations: PREVIEW_ACCESS_HOSTS.map((uri) => ({ type: 'public', uri })),
    allowed_idps: [identityProviderId],
    auto_redirect_to_identity: true,
    app_launcher_visible: false,
    session_duration: '24h',
    policies: [{ id: policyId, precedence: 1 }],
  };
}
