/** @jsxImportSource hono/jsx */
/** What every Leaderboard page shares: its meta, the viewer's display ruleset, query links, small value formatters. */
import type { Context } from 'hono';
import type { Child } from 'hono/jsx';
import { getCookie } from 'hono/cookie';
import type { AppEnv } from '../app.ts';
import { chartsetHref, LocalTime } from './components/basics.tsx';
import { Layout, PageHeader, type Crumb, type PageMeta } from './layout.tsx';
import { RULESET_COOKIE, resolveDisplayRuleset } from './preferences.ts';

/** A page handler's context; `Path` types its route parameters. */
export type PageContext<Path extends string = string> = Context<AppEnv, Path>;

/** Rows per list page. */
export const RECENT_LIMIT = 50;
export const RANKING_LIMIT = 100;

/**
 * Pages change with every submission and follow the viewer's display ruleset (a cookie), so they are private and the
 * browser revalidates every time: a player sees their new score at once.
 */
export const PAGE_CACHE = 'private, max-age=0';

/** The display ruleset lasts a year; switching it again replaces it. */
export const RULESET_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** `Artist · ` before the rest of a subtitle, or nothing when the play log carried no artist. */
export const withArtist = (artist: string | null): string =>
  artist !== null && artist.trim().length > 0 ? `${artist} · ` : '';

/** A day for a figure tile (the full time on hover), or `-` when there is none. */
export const day = (epochMs: number | null): Child =>
  epochMs === null ? '-' : <LocalTime at={epochMs} precision="day" />;

/** A timestamp, or `-` when there is none. */
export const when = (epochMs: number | null): Child => (epochMs === null ? '-' : <LocalTime at={epochMs} />);

/** The breadcrumb of a chart's chartset, when it is filed under one. */
export const chartsetCrumbs = (filed: { id: string; title: string } | undefined): Crumb[] =>
  filed === undefined ? [] : [{ label: filed.title, href: chartsetHref(filed.id) }];

/** Detail rows without the ones the play log left empty. */
export const known = (rows: Array<[string, Child]>): Array<[string, Child]> =>
  rows.filter(([, value]) => value !== '-');

/** A text value a play log may have left out. */
export const orDash = (value: string | number | null): string | number =>
  value === null || value === '' ? '-' : value;

/** The current URL with one query parameter set (or removed with `undefined`). */
export function withQuery(c: Context, key: string, value: string | undefined): string {
  const url = new URL(c.req.url);
  if (value === undefined) url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}

export function meta(c: Context, title: string, description: string, crumbs: Crumb[] = []): PageMeta {
  const url = new URL(c.req.url);
  return {
    title,
    description,
    crumbs,
    url: c.req.url,
    path: `${url.pathname}${url.search}`,
    ruleset: resolveDisplayRuleset(getCookie(c, RULESET_COOKIE)),
    viewer: (c as Context<AppEnv>).get('viewer') ?? null,
  };
}

/** The viewer's display ruleset: every page shows its figures under it (docs/leaderboard.md section 10). */
export function displayRuleset(c: Context) {
  return resolveDisplayRuleset(getCookie(c, RULESET_COOKIE));
}

export function notFound(c: Context<AppEnv>, what: string) {
  return c.html(
    <Layout meta={meta(c, 'Not found', `${what} not found.`, [{ label: 'Not found' }])}>
      <PageHeader title="Not found">{what} does not exist, or it was removed.</PageHeader>
    </Layout>,
    404,
  );
}
