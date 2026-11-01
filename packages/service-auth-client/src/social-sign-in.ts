/** Authorization parameter the Accounts login page reads to start Google or Discord. */
export const SOCIAL_SIGN_IN_PARAM = 'sign_in_method';

/** A provider Accounts can start from the login page. Passkeys stay a click on that page. */
export type SocialSignInMethod = 'google' | 'discord';

/** Google or Discord, when `value` names one. Anything else is ignored. */
export function socialSignInMethod(value: string | null | undefined): SocialSignInMethod | undefined {
  return value === 'google' || value === 'discord' ? value : undefined;
}

/**
 * The relying party's sign-in URL. `method` asks Accounts to start that provider after the same
 * OIDC redirect a passkey sign-in uses.
 */
export function accountSignInPath(returnTo: string, method?: SocialSignInMethod): string {
  const params = new URLSearchParams();
  if (returnTo !== '') params.set('returnTo', returnTo);
  if (method !== undefined) params.set('method', method);
  const query = params.toString();
  return query === '' ? '/api/auth/sign-in' : `/api/auth/sign-in?${query}`;
}

/** Copies a requested provider onto the Accounts authorization URL. Unknown values are left off. */
export function applySocialSignInMethod(target: URL, method: string | null | undefined): void {
  const social = socialSignInMethod(method);
  if (social !== undefined) target.searchParams.set(SOCIAL_SIGN_IN_PARAM, social);
}

/**
 * The provider the Accounts login page should start immediately. A missing button, an error, or an
 * account that only needs Continue stays on the page.
 */
export function socialSignInToStart(input: {
  pathname: string;
  search: string;
  providerConfigured: boolean;
  alreadyContinuing: boolean;
}): SocialSignInMethod | undefined {
  if (input.pathname !== '/login' || !input.providerConfigured || input.alreadyContinuing) return undefined;
  const params = new URLSearchParams(input.search.startsWith('?') ? input.search.slice(1) : input.search);
  if (params.has('error')) return undefined;
  return socialSignInMethod(params.get(SOCIAL_SIGN_IN_PARAM));
}
