import type { Locale } from './locale.ts';

/** Application adapters translate persisted account fields into this presentation shape. */
export interface ServiceAccountIdentity {
  handle: string;
  displayName: string;
  anonymous: boolean;
  avatarURL?: string;
}

export function resolveAccountIdentity(account: ServiceAccountIdentity, locale: Locale) {
  const guest = locale === 'ja' ? 'ゲスト' : 'guest';
  return {
    label: account.handle === '' ? account.displayName : `@${account.handle}`,
    ariaLabel:
      account.handle === ''
        ? account.displayName
        : locale === 'ja'
          ? `@${account.handle} のアカウント`
          : `Account of @${account.handle}`,
    title: account.anonymous ? `${account.displayName} (${guest})` : account.displayName,
    guest,
  };
}
