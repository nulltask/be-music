/** @jsxImportSource hono/jsx */
/** Shared building blocks of the Leaderboard pages: links, tags, lamps, filter chips, table frames. */
import type { Child } from 'hono/jsx';
import type { HelpId } from '../help-topics.ts';
import { HelpTip } from './help-tip.tsx';
import { formatTimestamp, lampStyle } from '../format.ts';
import { useMessages } from '../i18n/index.ts';

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
  const t = useMessages();
  const style = lampStyle(props.lamp);
  return (
    <span class="inline-flex items-center gap-2" title={t.lampMeanings[props.lamp] ?? t.lampMeanings.none}>
      <span class="ring-foreground/20 inline-block h-4 w-1.5 rounded-sm ring-1" style={`background:${style.color}`} />
      {style.label}
    </span>
  );
}

/**
 * An on/off switch for a filter: a link to the same page with one query flag flipped. It looks like a switch (a track
 * with a knob) rather than a button, so its state reads at a glance, and says so to assistive technology.
 */
export function Toggle(props: { label: string; on: boolean; href: string; description?: string; help?: HelpId }) {
  const toggle = (
    <a
      role="switch"
      aria-checked={props.on ? 'true' : 'false'}
      href={props.href}
      title={props.help === undefined ? props.description : undefined}
      class={`inline-flex items-center gap-2 rounded-md py-1 text-sm transition-colors ${props.on ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
    >
      <span
        class={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${props.on ? 'bg-sky-500' : 'bg-muted-foreground/35'}`}
      >
        <span
          class={`absolute top-0.5 size-4 rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform ${props.on ? 'translate-x-[1.125rem]' : 'translate-x-0.5'}`}
        />
      </span>
      {props.label}
    </a>
  );
  // With `help`, the description moves from the hover title into a "?" beside the switch, linking into the Help page.
  if (props.help === undefined) return toggle;
  return (
    <span class="inline-flex items-center gap-1">
      {toggle}
      <HelpTip topic={props.help} label={`"${props.label}"`}>
        {props.description}
      </HelpTip>
    </span>
  );
}

/** One choice among a few, as joined buttons (the scoring rules, a chart's files). */
export function Segmented(props: {
  label: string;
  options: Array<{ label: Child; href: string; current: boolean; title?: string }>;
}) {
  return (
    <div class="button-group flex-wrap" role="group" aria-label={props.label}>
      {props.options.map((option) => (
        <a
          class="btn"
          data-size="sm"
          data-variant={option.current ? 'primary' : 'outline'}
          aria-current={option.current ? 'true' : undefined}
          href={option.href}
          title={option.title}
        >
          {option.label}
        </a>
      ))}
    </div>
  );
}

/** A row of filter switches. */
export function Filters(props: { children: Child }) {
  return <div class="flex flex-wrap items-center gap-x-5 gap-y-2">{props.children}</div>;
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

/** A player's icon, round; the name next to it says who it is, so it is decorative to screen readers. */
export function Avatar(props: { src: string; size: number; class?: string }) {
  return (
    <img
      src={props.src}
      width={props.size}
      height={props.size}
      alt=""
      loading="lazy"
      decoding="async"
      class={`bg-muted ring-foreground/10 inline-block shrink-0 rounded-full ring-1 ${props.class ?? ''}`}
    />
  );
}

/**
 * A moment: written in UTC here, rewritten in the viewer's local time by LOCAL_TIME_SCRIPT (local-time.ts). `compact`
 * leaves the zone out of the UTC text (table cells); the title always holds the UTC time.
 */
export function LocalTime(props: { at: number; precision?: 'minute' | 'day'; compact?: boolean }) {
  const utc = formatTimestamp(props.at);
  const precision = props.precision ?? 'minute';
  const text = precision === 'day' ? utc.slice(0, 10) : props.compact ? utc.replace(' UTC', '') : utc;
  return (
    <time datetime={new Date(props.at).toISOString()} data-local={precision} title={utc}>
      {text}
    </time>
  );
}

/** A section's heading with an optional note at its end (a count, a hint), on one baseline. */
export function SectionHeading(props: { id?: string; children: Child; note?: Child }) {
  return (
    <div class="flex items-baseline justify-between gap-3">
      <h2 id={props.id} class="text-base font-semibold tracking-tight">
        {props.children}
      </h2>
      {props.note !== undefined ? <span class="text-muted-foreground text-xs">{props.note}</span> : null}
    </div>
  );
}
