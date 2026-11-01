import { renderBuildInfo, type BuildInfo } from './build-info.ts';
import type { Locale } from './locale.ts';
import { renderPublicBetaNotice } from './public-beta.ts';

/** Dashboard, Accounts, Play, then Leaderboard. Donate is not in this row. */
export const SERVICE_NAMES = ['dashboard', 'accounts', 'play', 'leaderboard'] as const;

export type ServiceName = (typeof SERVICE_NAMES)[number];

/** Public names. Accounts is the site title (`Be-Music Accounts`), not the signed-in person's account. */
export const SERVICE_LABELS: Record<ServiceName, string> = {
  dashboard: 'Dashboard',
  accounts: 'Accounts',
  play: 'Play',
  leaderboard: 'Leaderboard',
};

/** The footer frame used on Accounts and Dashboard, with room for the four regions. */
export const SERVICE_FOOTER_CLASS = 'text-muted-foreground mx-auto max-w-5xl space-y-2 border-t px-4 pt-4 pb-8 text-xs';

export const SERVICE_FOOTER_NAV_CLASS = 'flex flex-wrap items-center gap-x-4 gap-y-1';

export const SERVICE_FOOTER_LINK_CLASS = 'underline underline-offset-4 hover:text-foreground';

/** Holder and licence of the be-music repository (LICENSE), as on the Leaderboard. */
export const SERVICE_COPYRIGHT = '© 2026 nulltask · MIT License';

const SERVICE_PREFIXES = ['accounts', 'play', 'leaderboard', 'donate'] as const;

export interface ServiceFooterInput {
  /** The service this page is. Omit it on Donate, which is not in the link row. */
  current?: ServiceName;
  /**
   * Host of the page. Preview hosts link to preview siblings. An unknown host, including local development, uses
   * production, as the Player and Leaderboard already do.
   */
  hostname?: string;
  /** Replaces the origin derived from `hostname` for that service. Keeps an env binding when one is already set. */
  origins?: Partial<Record<ServiceName, string>>;
  /** Escaped HTML that belongs only to this site. The caller escapes text and attributes. */
  siteHTML?: string;
  copyright?: string;
  buildInfo?: BuildInfo;
  /** Accessible name of the service list. */
  navLabel?: string;
  /** Extra class on the footer element, for a site that positions it. */
  className?: string;
  /**
   * Language of the Public Beta line. `both` includes English and Japanese, for the player, which keeps both on the
   * page. Omitted means English.
   */
  locale?: Locale | 'both';
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
 * The environment site (`be-music.app` or `preview.be-music.app`) for a public host. Dashboard is that site. The other
 * services are one label in front of it. A branch Preview URL of the preview Player uses the preview site.
 */
export function serviceSite(hostname: string): string {
  const host = hostname.toLowerCase();
  if (host.endsWith('-play-preview.be-music.workers.dev')) return 'preview.be-music.app';
  for (const prefix of SERVICE_PREFIXES) {
    if (host.startsWith(`${prefix}.`)) return host.slice(prefix.length + 1);
  }
  if (host === 'be-music.app' || host === 'preview.be-music.app') return host;
  return 'be-music.app';
}

/** Absolute origins of the four services next to `hostname`, each with a trailing slash. */
export function serviceOrigins(hostname: string): Record<ServiceName, string> {
  const site = serviceSite(hostname);
  return {
    dashboard: `https://${site}/`,
    accounts: `https://accounts.${site}/`,
    play: `https://play.${site}/`,
    leaderboard: `https://leaderboard.${site}/`,
  };
}

function footerOrigins(input: ServiceFooterInput): Record<ServiceName, string> {
  const origins = serviceOrigins(input.hostname ?? '');
  for (const name of SERVICE_NAMES) {
    const override = input.origins?.[name];
    if (override !== undefined && override !== '') origins[name] = override;
  }
  return origins;
}

/**
 * The shared service footer, in order: the Public Beta line, links to the other services (the current one is text),
 * this site's own content, the copyright line, then the build timestamp and source revision.
 */
export function renderServiceFooter(input: ServiceFooterInput = {}): string {
  const origins = footerOrigins(input);
  const links = SERVICE_NAMES.map((name) => {
    const label = escapeHTML(SERVICE_LABELS[name]);
    if (name === input.current) return `<span aria-current="page">${label}</span>`;
    return `<a class="${SERVICE_FOOTER_LINK_CLASS}" data-service="${name}" href="${escapeHTML(origins[name])}">${label}</a>`;
  }).join('');
  const site =
    input.siteHTML !== undefined && input.siteHTML !== '' ? `<div class="space-y-2">${input.siteHTML}</div>` : '';
  const footerClass =
    input.className === undefined || input.className === ''
      ? SERVICE_FOOTER_CLASS
      : `${SERVICE_FOOTER_CLASS} ${escapeHTML(input.className)}`;
  const notice = renderPublicBetaNotice(input.locale ?? 'en');
  return `<footer class="${footerClass}">${notice}<nav class="${SERVICE_FOOTER_NAV_CLASS}" aria-label="${escapeHTML(input.navLabel ?? 'Services')}">${links}</nav>${site}<p>${escapeHTML(input.copyright ?? SERVICE_COPYRIGHT)}</p>${renderBuildInfo(input.buildInfo)}</footer>`;
}
