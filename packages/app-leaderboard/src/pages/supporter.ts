import type { Env } from '../env.ts';

export const SUPPORTER_ACCENT_CLASSES = {
  teal: 'text-teal-700 dark:text-teal-300',
  indigo: 'text-indigo-700 dark:text-indigo-300',
  rose: 'text-rose-700 dark:text-rose-300',
} as const;

interface SupporterBenefits {
  showBadge: boolean;
  titleKey: 'supporter' | null;
  accentColorKey: keyof typeof SUPPORTER_ACCENT_CLASSES | null;
}

/** Read the approved public profile fields from Be-Music Supporter. */
export async function loadSupporterBenefits(
  env: Pick<Env, 'SUPPORTER' | 'SUPPORTER_ORIGIN'>,
  userId: string,
): Promise<SupporterBenefits | null> {
  if (!env.SUPPORTER || !env.SUPPORTER_ORIGIN) return null;
  try {
    const url = new URL('/api/supporter/public-profile', env.SUPPORTER_ORIGIN);
    url.searchParams.set('userId', userId);
    const response = await env.SUPPORTER.fetch(new Request(url));
    if (!response.ok) return null;
    const input: unknown = await response.json();
    if (input === null || typeof input !== 'object') return null;
    const fields = input as Record<string, unknown>;
    const color = fields.accentColorKey;
    return {
      showBadge: fields.showBadge === true,
      titleKey: fields.titleKey === 'supporter' ? 'supporter' : null,
      accentColorKey: color === 'teal' || color === 'indigo' || color === 'rose' ? color : null,
    };
  } catch {
    return null;
  }
}
