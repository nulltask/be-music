import { avatarTemplate } from '@be-music/service-web-theme/server';
import type { PageContent } from '../template.ts';
import { html, nothing } from '@be-music/service-web-theme/server';
/** Shared building blocks of the Leaderboard pages: links, tags, lamps, filter chips, table frames. */
import type { HelpId } from '../help-topics.ts';
import { HelpTip } from './help-tip.ts';
import { formatTimestamp, lampStyle } from '../format.ts';
import { type Messages } from '../i18n/index.ts';
import { partialLinkAttributes } from '../partial-swap.ts';

export const scoreHref = (scoreId: string): string => `/scores/${encodeURIComponent(scoreId)}`;
export const chartHref = (chartFingerprint: string): string => `/charts/${encodeURIComponent(chartFingerprint)}`;
export const playerHref = (handle: string): string => `/players/${encodeURIComponent(handle)}`;

/**
 * The web player next to this Leaderboard (docs/services.md section 1): `https://play.be-music.app/` from
 * `leaderboard.be-music.app`, `https://play.preview.be-music.app/` from its preview, and the production player from
 * anywhere else (a local dev server).
 */
export function playerAppHref(pageURL: string): string {
  const match = /^leaderboard\.(.+)$/.exec(new URL(pageURL).hostname.toLowerCase());
  return `https://play.${match?.[1] ?? 'be-music.app'}/`;
}
export const courseHref = (courseFingerprint: string): string => `/courses/${encodeURIComponent(courseFingerprint)}`;
export const courseRunHref = (courseScoreId: string): string => `/course-scores/${encodeURIComponent(courseScoreId)}`;

export const LINK = 'font-medium underline-offset-4 hover:underline';
export const NUM = 'text-end tabular-nums';

/** What the column abbreviations stand for, shown on hover. */
export const BP_MEANING = 'BP = B+P: BADs plus POORs (empty POORs count as POORs). Lower is better.';
export const DJ_MEANING = 'DJ Rank: the score rate in ninths, from F up to AAA (8/9 of the maximum EX-Score).';

/** A small outlined label next to a name or a title. */
export function Tag(props: { children: PageContent }) {
  return html`<span class="badge" data-variant="outline">${props.children}</span>`;
}

export function Lamp(props: { lamp: number }, messages: Messages) {
  const t = messages;
  const style = lampStyle(props.lamp);
  return html`<span
    class="inline-flex items-center gap-2"
    title=${t.lampMeanings[props.lamp] ?? t.lampMeanings.none ?? nothing}
    ><span
      class="ring-foreground/20 inline-block h-4 w-1.5 rounded-sm ring-1"
      style=${`background:${style.color}`}
    ></span
    >${style.label}</span
  >`;
}

/**
 * An on/off switch for a filter: a link to the same page with one query flag flipped. It looks like a switch (a track
 * with a knob) rather than a button, so its state reads at a glance, and says so to assistive technology. With the
 * client script it updates the page in place (partial-swap.ts), the knob sliding over.
 */
export function Toggle(
  props: { label: string; on: boolean; href: string; description?: string; help?: HelpId },
  messages: Messages,
) {
  const partial = partialLinkAttributes(props.href);
  const toggle = html`<a
    role="switch"
    aria-checked=${props.on ? 'true' : 'false'}
    href=${props.href ?? nothing}
    hx-get=${partial['hx-get'] ?? nothing}
    hx-target=${partial['hx-target'] ?? nothing}
    hx-select=${partial['hx-select'] ?? nothing}
    hx-swap=${partial['hx-swap'] ?? nothing}
    hx-select-oob=${partial['hx-select-oob'] ?? nothing}
    hx-sync=${partial['hx-sync'] ?? nothing}
    hx-indicator=${partial['hx-indicator'] ?? nothing}
    hx-push-url=${partial['hx-push-url'] ?? nothing}
    title=${(props.help === undefined ? props.description : undefined) ?? nothing}
    class=${`inline-flex items-center gap-2 rounded-md py-1 text-sm transition-colors ${props.on ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
    ><span
      class=${`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${props.on ? 'bg-sky-500' : 'bg-muted-foreground/35'}`}
      ><span
        class=${`absolute top-0.5 size-4 rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform ${props.on ? 'translate-x-[1.125rem]' : 'translate-x-0.5'}`}
      ></span></span
    >${props.label}</a
  >`;
  // With `help`, the description moves from the hover title into a "?" beside the switch, linking into the Help page.
  if (props.help === undefined) return toggle;
  return html`<span class="inline-flex items-center gap-1"
    >${toggle}${HelpTip(
      { topic: props.help, label: `"${props.label}"`, children: html`${props.description}` },
      messages,
    )}</span
  >`;
}

/** One choice among a few, as joined buttons (a chart's files), updating the page in place like a Toggle. */
export function Segmented(props: {
  label: string;
  options: Array<{ label: PageContent; href: string; current: boolean; title?: string }>;
}) {
  return html`<div class="button-group flex-wrap" role="group" aria-label=${props.label ?? nothing}>
    ${props.options.map((option) => {
      const partial = partialLinkAttributes(option.href);
      return html`<a
        class="btn"
        data-size="sm"
        data-variant=${option.current ? 'primary' : 'outline'}
        aria-current=${(option.current ? 'true' : undefined) ?? nothing}
        href=${option.href ?? nothing}
        hx-get=${partial['hx-get'] ?? nothing}
        hx-target=${partial['hx-target'] ?? nothing}
        hx-select=${partial['hx-select'] ?? nothing}
        hx-swap=${partial['hx-swap'] ?? nothing}
        hx-select-oob=${partial['hx-select-oob'] ?? nothing}
        hx-sync=${partial['hx-sync'] ?? nothing}
        hx-indicator=${partial['hx-indicator'] ?? nothing}
        hx-push-url=${partial['hx-push-url'] ?? nothing}
        title=${option.title ?? nothing}
        >${option.label}</a
      >`;
    })}
  </div>`;
}

/** A row of filter switches. */
export function Filters(props: { children: PageContent }) {
  return html`<div class="flex flex-wrap items-center gap-x-5 gap-y-2">${props.children}</div>`;
}

/** A bordered frame around a table, scrolling sideways on narrow screens. */
export function TableCard(props: { children: PageContent }) {
  return html`<div class="card gap-0 py-0">
    <div class="table-container">
      <table class="table">
        ${props.children}
      </table>
    </div>
  </div>`;
}

export function Empty(props: { title: string; children: PageContent }) {
  return html`<div class="empty border">
    <header>
      <h3 class="text-base font-medium">${props.title}</h3>
      <p class="text-muted-foreground text-sm">${props.children}</p>
    </header>
  </div>`;
}

/**
 * Makes a whole table row open a score: an invisible link stretched over the row (the row is `relative`). Links and
 * buttons inside the row sit above it (`relative z-10`) and keep working.
 */
export function RowLink(props: { href: string; label: string }) {
  return html`<a class="absolute inset-0" href=${props.href ?? nothing} aria-label=${props.label ?? nothing}></a>`;
}

export const ROW = 'relative cursor-pointer';
export const ABOVE = 'relative z-10';

export const chartsetHref = (id: string): string => `/chartsets/${encodeURIComponent(id)}`;

/** A player's icon, round; the name next to it says who it is, so it is decorative to screen readers. */
export function Avatar(props: { src: string; size: number; class?: string }) {
  return avatarTemplate({ src: props.src, size: props.size, className: props.class });
}

/** UTC fallback for no-script visitors; the Lit custom element owns the localized shadow content. */
export function LocalTime(props: { at: number; precision?: 'minute' | 'day' | 'relative'; compact?: boolean }) {
  const utc = formatTimestamp(props.at);
  const precision = props.precision ?? 'minute';
  const text = precision === 'day' ? utc.slice(0, 10) : props.compact ? utc.replace(' UTC', '') : utc;
  const dateTime = new Date(props.at).toISOString();
  return html`<be-music-local-time datetime=${dateTime} utc=${utc} precision=${precision}
    ><time datetime=${dateTime} data-local=${precision ?? nothing} title=${utc ?? nothing}
      >${text}</time
    ></be-music-local-time
  >`;
}

/** A section's heading with an optional note at its end (a count, a hint), on one baseline. */
export function SectionHeading(props: { id?: string; children: PageContent; note?: PageContent }) {
  return html`<div class="flex items-baseline justify-between gap-3">
    <h2 id=${props.id ?? nothing} class="text-base font-semibold tracking-tight">${props.children}</h2>
    ${props.note !== undefined ? html`<span class="text-muted-foreground text-xs">${props.note}</span>` : null}
  </div>`;
}
