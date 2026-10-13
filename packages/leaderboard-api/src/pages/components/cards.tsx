/** @jsxImportSource hono/jsx */
/** The Leaderboard's cards: detail lists, figure tiles, distributions, links elsewhere and the lamp legend. */
import type { Child } from 'hono/jsx';
import { ExternalLink as ExternalLinkIcon } from 'lucide-static';
import type { ExternalLink } from '../external.ts';
import { lampStyle } from '../format.ts';
import type { JudgeTotals } from '../stats.ts';
import type { Distribution } from '../stats.ts';
import { Icon } from './icon.tsx';

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

/** A row of headline figures (label above, value below); six figures make two rows of three. */
export function Stats(props: { items: Array<[string, Child]> }) {
  return (
    <dl class={`grid grid-cols-2 gap-3 ${props.items.length % 3 === 0 ? 'sm:grid-cols-3' : 'sm:grid-cols-4'}`}>
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
 * Empty buckets stay out of the bar; the list keeps them (muted) when `showEmpty` is set, so every lamp or rank still
 * to get is there to see.
 */
export function DistributionCard<Key extends number | string>(props: {
  title: string;
  description: string;
  distribution: Distribution<Key>;
  kind: 'lamp' | 'dj-rank';
  showEmpty?: boolean;
}) {
  const { total, buckets } = props.distribution;
  const shown = buckets
    .map((bucket, index) => ({
      ...bucket,
      label: props.kind === 'lamp' ? lampStyle(Number(bucket.key)).label : String(bucket.key),
      color: props.kind === 'lamp' ? lampStyle(Number(bucket.key)).color : (DJ_RANK_SHADES[index] ?? '#94a3b8'),
      meaning: props.kind === 'lamp' ? lampStyle(Number(bucket.key)).meaning : undefined,
    }))
    .filter((bucket) => bucket.count > 0 || props.showEmpty === true);
  const filled = shown.filter((bucket) => bucket.count > 0);
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
              aria-label={filled.map((bucket) => `${bucket.label}: ${bucket.count}`).join(', ')}
            >
              {filled.map((bucket) => (
                <span
                  title={`${bucket.label}: ${bucket.count}`}
                  style={`background:${bucket.color};width:${(bucket.count / total) * 100}%`}
                />
              ))}
            </div>
            <ul class="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-x-6 gap-y-1 text-sm">
              {shown.map((bucket) => (
                <li
                  class={`flex items-center justify-between gap-2 ${bucket.count === 0 ? 'text-muted-foreground/70' : ''}`}
                  title={bucket.meaning}
                >
                  <span class="inline-flex items-center gap-2">
                    <span
                      class="ring-foreground/20 inline-block size-2.5 rounded-sm ring-1"
                      style={`background:${bucket.color}`}
                    />
                    {bucket.label}
                  </span>
                  <span class="text-muted-foreground whitespace-nowrap tabular-nums">
                    {bucket.count === 0 ? '–' : `${bucket.count} (${Math.round((bucket.count / total) * 100)}%)`}
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
  // One row per file: an MD5-keyed link joins the SHA-256 of its file when that is known.
  const fileOf = (link: ExternalLink) => link.file ?? link.hash ?? '';
  const files = [...new Set(props.links.map(fileOf))];
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
              .filter((link) => fileOf(link) === hash)
              .map((link) => (
                <a
                  class="btn"
                  data-size="sm"
                  data-variant="outline"
                  href={link.url}
                  rel="noopener noreferrer"
                  target="_blank"
                  aria-label={`${link.kind === 'search' ? `Search ${link.name}` : link.name} (opens another site)`}
                >
                  {link.kind === 'search' ? `Search ${link.name}` : link.name}
                  <Icon svg={ExternalLinkIcon} class="text-muted-foreground [&>svg]:size-3.5" />
                </a>
              ))}
          </div>
        ))}
      </div>
    </section>
  );
}

const JUDGE_ROWS: Array<{ key: keyof JudgeTotals; label: string; name: string; color: string }> = [
  { key: 'pgreat', label: 'PG', name: 'PGREAT', color: '#38bdf8' },
  { key: 'great', label: 'GR', name: 'GREAT', color: '#facc15' },
  { key: 'good', label: 'GD', name: 'GOOD', color: '#4ade80' },
  { key: 'bad', label: 'BD', name: 'BAD', color: '#c084fc' },
  { key: 'poor', label: 'PR', name: 'POOR', color: '#f87171' },
  { key: 'emptyPoor', label: 'EPR', name: 'empty POOR (a press with no note)', color: '#94a3b8' },
];

/**
 * How a player's notes were judged, summed over every play under the display ruleset: one stacked bar and the count
 * of each judgment. Empty POORs are presses, not notes, so they are listed but stay out of the bar's share.
 */
export function JudgeTotalsCard(props: { judges: JudgeTotals; ruleset: string }) {
  const notes = JUDGE_ROWS.filter((row) => row.key !== 'emptyPoor').reduce(
    (sum, row) => sum + props.judges[row.key],
    0,
  );
  return (
    <section class="card gap-4" data-size="sm">
      <header>
        <h2>Judgments</h2>
        <p>Every note of every play under {props.ruleset}.</p>
      </header>
      <div class="space-y-3 px-4">
        {notes === 0 ? (
          <p class="text-muted-foreground text-sm">No plays yet.</p>
        ) : (
          <div
            class="ring-foreground/10 flex h-3 overflow-hidden rounded-full ring-1"
            role="img"
            aria-label={JUDGE_ROWS.map((row) => `${row.name}: ${props.judges[row.key]}`).join(', ')}
          >
            {JUDGE_ROWS.filter((row) => row.key !== 'emptyPoor' && props.judges[row.key] > 0).map((row) => (
              <span
                title={`${row.name}: ${props.judges[row.key]}`}
                style={`background:${row.color};width:${(props.judges[row.key] / notes) * 100}%`}
              />
            ))}
          </div>
        )}
        <dl class="grid grid-cols-3 gap-x-6 gap-y-1 text-sm sm:grid-cols-6">
          {JUDGE_ROWS.map((row) => (
            <div class="flex items-center justify-between gap-2 sm:block" title={row.name}>
              <dt class="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
                <span
                  class="ring-foreground/20 inline-block size-2 rounded-full ring-1"
                  style={`background:${row.color}`}
                />
                {row.label}
              </dt>
              <dd class="font-semibold tabular-nums">{props.judges[row.key].toLocaleString('en-US')}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
