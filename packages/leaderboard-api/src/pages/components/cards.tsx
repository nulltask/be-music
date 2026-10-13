/** @jsxImportSource hono/jsx */
/** The Leaderboard's cards: detail lists, figure tiles, distributions, links elsewhere and the lamp legend. */
import type { Child } from 'hono/jsx';
import type { ExternalLink } from '../external.ts';
import { LAMP_STYLES, lampStyle } from '../format.ts';
import type { Distribution } from '../stats.ts';
import { Lamp } from './basics.tsx';

/** A titled block of details: label / value rows. */
export function Details(props: { title: string; rows: Array<[string, Child]> }) {
  return (
    <section class="card gap-4" data-size="sm">
      <header>
        <h2>{props.title}</h2>
      </header>
      <dl class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 px-4 text-sm">
        {props.rows.map(([label, value]) => (
          <>
            <dt class="text-muted-foreground">{label}</dt>
            <dd class="break-all">{value}</dd>
          </>
        ))}
      </dl>
    </section>
  );
}

/** A row of headline figures (label above, value below). */
export function Stats(props: { items: Array<[string, Child]> }) {
  return (
    <dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {props.items.map(([label, value]) => (
        <div class="card gap-1 px-4 py-3">
          <dt class="text-muted-foreground text-xs">{label}</dt>
          <dd class="text-xl font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Shades for the DJ Rank bar, AAA darkest. */
const DJ_RANK_SHADES = ['#0f172a', '#334155', '#475569', '#64748b', '#94a3b8', '#cbd5e1', '#e2e8f0', '#f1f5f9'];

/**
 * A distribution as one stacked bar and a list of counts. Lamps take their lamp colours; DJ Ranks take grey shades.
 * Buckets without players stay out of the bar and the list.
 */
export function DistributionCard<Key extends number | string>(props: {
  title: string;
  description: string;
  distribution: Distribution<Key>;
  kind: 'lamp' | 'dj-rank';
}) {
  const { total, buckets } = props.distribution;
  const shown = buckets
    .map((bucket, index) => ({
      ...bucket,
      label: props.kind === 'lamp' ? lampStyle(Number(bucket.key)).label : String(bucket.key),
      color: props.kind === 'lamp' ? lampStyle(Number(bucket.key)).color : (DJ_RANK_SHADES[index] ?? '#94a3b8'),
      meaning: props.kind === 'lamp' ? lampStyle(Number(bucket.key)).meaning : undefined,
    }))
    .filter((bucket) => bucket.count > 0);
  return (
    <section class="card gap-4" data-size="sm">
      <header>
        <h2>{props.title}</h2>
        <p>{props.description}</p>
      </header>
      <div class="space-y-3 px-4">
        {total === 0 ? (
          <p class="text-muted-foreground text-sm">No plays yet.</p>
        ) : (
          <>
            <div
              class="ring-foreground/10 flex h-3 overflow-hidden rounded-full ring-1"
              role="img"
              aria-label={shown.map((bucket) => `${bucket.label}: ${bucket.count}`).join(', ')}
            >
              {shown.map((bucket) => (
                <span
                  title={`${bucket.label}: ${bucket.count}`}
                  style={`background:${bucket.color};width:${(bucket.count / total) * 100}%`}
                />
              ))}
            </div>
            <ul class="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-x-6 gap-y-1 text-sm">
              {shown.map((bucket) => (
                <li class="flex items-center justify-between gap-2" title={bucket.meaning}>
                  <span class="inline-flex items-center gap-2">
                    <span
                      class="ring-foreground/20 inline-block size-2.5 rounded-sm ring-1"
                      style={`background:${bucket.color}`}
                    />
                    {bucket.label}
                  </span>
                  <span class="text-muted-foreground whitespace-nowrap tabular-nums">
                    {bucket.count} ({Math.round((bucket.count / total) * 100)}%)
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

/** Links to the same chart on other Internet Rankings and BMS Search, one set per file the chart is known by. */
export function Elsewhere(props: { links: ExternalLink[] }) {
  if (props.links.length === 0) return null;
  const files = [...new Set(props.links.map((link) => link.hash ?? ''))];
  return (
    <section class="card gap-4" data-size="sm">
      <header>
        <h2>Elsewhere</h2>
        <p>This chart on other Internet Rankings and on BMS Search.</p>
      </header>
      <div class="space-y-3 px-4">
        {files.map((hash) => (
          <div class="flex flex-wrap items-center gap-2">
            {files.length > 1 && hash !== '' ? (
              <span class="text-muted-foreground font-mono text-xs">file {hash.slice(0, 8)}</span>
            ) : null}
            {props.links
              .filter((link) => (link.hash ?? '') === hash)
              .map((link) => (
                <a
                  class="btn"
                  data-size="sm"
                  data-variant="outline"
                  href={link.url}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {link.kind === 'search' ? `Search ${link.name}` : link.name}
                </a>
              ))}
          </div>
        ))}
      </div>
    </section>
  );
}

/** What each clear lamp means, in the order lamps rank (FAILED lowest). */
export function LampLegend() {
  return (
    <details class="text-sm">
      <summary class="text-muted-foreground hover:text-foreground cursor-pointer select-none">
        What the clear lamps mean
      </summary>
      <dl class="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
        {Object.entries(LAMP_STYLES).map(([lamp]) => {
          const style = lampStyle(Number(lamp));
          return (
            <>
              <dt>
                <Lamp lamp={Number(lamp)} />
              </dt>
              <dd class="text-muted-foreground">{style.meaning}</dd>
            </>
          );
        })}
      </dl>
    </details>
  );
}
