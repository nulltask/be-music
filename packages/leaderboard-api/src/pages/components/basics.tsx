/** @jsxImportSource hono/jsx */
/** Shared building blocks of the Leaderboard pages: links, tags, lamps, filter chips, table frames. */
import type { Child } from 'hono/jsx';
import { lampStyle } from '../format.ts';

export const scoreHref = (scoreId: string): string => `/leaderboard/scores/${encodeURIComponent(scoreId)}`;
export const chartHref = (chartFingerprint: string): string =>
  `/leaderboard/charts/${encodeURIComponent(chartFingerprint)}`;
export const playerHref = (handle: string): string => `/leaderboard/players/${encodeURIComponent(handle)}`;

export const LINK = 'font-medium underline-offset-4 hover:underline';
export const NUM = 'text-end tabular-nums';

/** What the column abbreviations stand for, shown on hover. */
export const BP_MEANING = 'BP = B+P: BADs plus POORs (empty POORs count as POORs). Lower is better.';
export const DJ_MEANING = 'DJ Rank: the score rate in ninths, from F up to AAA (8/9 of the maximum EX-Score).';

/** A small outlined label next to a name or a title. */
export function Tag(props: { children: Child }) {
  return (
    <span class="badge" data-variant="outline">
      {props.children}
    </span>
  );
}

export function Lamp(props: { lamp: number }) {
  const style = lampStyle(props.lamp);
  return (
    <span class="inline-flex items-center gap-2" title={style.meaning}>
      <span class="ring-foreground/20 inline-block h-4 w-1.5 rounded-sm ring-1" style={`background:${style.color}`} />
      {style.label}
    </span>
  );
}

/** A toggle that links to the same page with one query flag flipped. */
export function FilterChip(props: { label: string; on: boolean; href: string }) {
  return (
    <a
      class="btn"
      data-size="sm"
      data-variant={props.on ? 'secondary' : 'outline'}
      aria-pressed={props.on ? 'true' : 'false'}
      href={props.href}
    >
      {props.on ? '✓ ' : ''}
      {props.label}
    </a>
  );
}

/** A row of filter toggles. */
export function Filters(props: { children: Child }) {
  return <div class="flex flex-wrap gap-2">{props.children}</div>;
}

/** A bordered frame around a table, scrolling sideways on narrow screens. */
export function TableCard(props: { children: Child }) {
  return (
    <div class="card gap-0 py-0">
      <div class="table-container">
        <table class="table">{props.children}</table>
      </div>
    </div>
  );
}

export function Empty(props: { title: string; children: Child }) {
  return (
    <div class="empty border">
      <header>
        <h3 class="text-base font-medium">{props.title}</h3>
        <p class="text-muted-foreground text-sm">{props.children}</p>
      </header>
    </div>
  );
}

/**
 * Makes a whole table row open a score: an invisible link stretched over the row (the row is `relative`). Links and
 * buttons inside the row sit above it (`relative z-10`) and keep working.
 */
export function RowLink(props: { href: string; label: string }) {
  return <a class="absolute inset-0" href={props.href} aria-label={props.label} />;
}

export const ROW = 'relative cursor-pointer';
export const ABOVE = 'relative z-10';

export const chartsetHref = (id: string): string => `/leaderboard/chartsets/${encodeURIComponent(id)}`;
