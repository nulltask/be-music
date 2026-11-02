import type { Locale } from './locale.ts';

/** The service status, in its official capitalization. */
export const PUBLIC_BETA_LABEL: Readonly<Record<Locale, string>> = {
  en: 'Public Beta',
  ja: 'パブリックベータ',
};

/** Shown with the Public Beta label. Stored data may be removed without a prior warning. */
export const PUBLIC_BETA_DELETION: Readonly<Record<Locale, string>> = {
  en: 'Data may be deleted without notice.',
  ja: 'データは予告なく削除されることがあります。',
};

/** The label and the deletion warning as one line. Japanese joins them with のため and no space. */
export function publicBetaNotice(locale: Locale): string {
  if (locale === 'ja') return `${PUBLIC_BETA_LABEL.ja}のため${PUBLIC_BETA_DELETION.ja}`;
  return `${PUBLIC_BETA_LABEL.en}. ${PUBLIC_BETA_DELETION.en}`;
}

function escapeHTML(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * The Public Beta line. `both` includes English and Japanese for the player, which keeps both on the page; English
 * starts visible, and Help shows the language it picked.
 */
export function renderPublicBetaNotice(locale: Locale | 'both'): string {
  if (locale === 'both') {
    return `<p data-public-beta-notice="en" lang="en">${escapeHTML(publicBetaNotice('en'))}</p><p data-public-beta-notice="ja" lang="ja" hidden>${escapeHTML(publicBetaNotice('ja'))}</p>`;
  }
  return `<p lang="${locale}">${escapeHTML(publicBetaNotice(locale))}</p>`;
}
