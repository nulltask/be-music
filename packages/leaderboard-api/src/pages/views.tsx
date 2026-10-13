/** @jsxImportSource hono/jsx */
import type { Child } from 'hono/jsx';
import type { RankingEntry } from '../ranking.ts';
import type { PlayInfo, RecentScore } from './data.ts';
import type { ExternalLink } from './external.ts';
import type { Distribution } from './stats.ts';
import {
  chartTitle,
  djLevel,
  formatExScore,
  formatGauge,
  formatRecorder,
  formatTimestamp,
  LAMP_STYLES,
  lampStyle,
  RULESET_LABELS,
} from './format.ts';

export const scoreHref = (scoreId: string): string => `/leaderboard/scores/${encodeURIComponent(scoreId)}`;
export const chartHref = (chartFingerprint: string): string =>
  `/leaderboard/charts/${encodeURIComponent(chartFingerprint)}`;
export const playerHref = (handle: string): string => `/leaderboard/players/${encodeURIComponent(handle)}`;

const LINK = 'font-medium underline-offset-4 hover:underline';
const NUM = 'text-end tabular-nums';

/** What the column abbreviations stand for, shown on hover. */
const BP_MEANING = 'BP = B+P: BADs plus POORs (empty POORs count as POORs). Lower is better.';
const DJ_MEANING = 'DJ Rank: the score rate in ninths, from F up to AAA (8/9 of the maximum EX-Score).';

/** A small outlined label next to a name or a title. */
export function Tag(props: { children: Child }) {
  return (
    <span class="badge" data-variant="outline">
      {props.children}
    </span>
  );
}

function Lamp(props: { lamp: number }) {
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
function TableCard(props: { children: Child }) {
  return (
    <div class="card gap-0 py-0">
      <div class="table-container">
        <table class="table">{props.children}</table>
      </div>
    </div>
  );
}

function Empty(props: { title: string; children: Child }) {
  return (
    <div class="empty border">
      <header>
        <h3 class="text-base font-medium">{props.title}</h3>
        <p class="text-muted-foreground text-sm">{props.children}</p>
      </header>
    </div>
  );
}

/** Everything a play's info popover lists: how it was played and which software recorded and sent it. */
function playInfoRows(info: PlayInfo): Array<[string, Child]> {
  return [
    ['Played', formatTimestamp(info.createdAt)],
    ['Ruleset played', RULESET_LABELS[info.playedRuleset] ?? info.playedRuleset],
    ['Gauge', info.gauge],
    ['Assists', info.assistFlags.length > 0 ? info.assistFlags.join(', ') : 'none'],
    ['Verification', info.verification],
    ['Recorded with', formatRecorder(info.recordedBy)],
    ['Sent from', info.submittedBy ?? 'unknown'],
    ['Scored by', `be-music engine ${info.serverEngine}`],
  ];
}

/**
 * An info icon that opens a small card with a play's details. It uses the browser's Popover API (`popovertarget`), so
 * it opens, closes on Escape or an outside click, and is announced as a dialog without any script.
 */
function InfoButton(props: { info: PlayInfo | undefined }) {
  if (props.info === undefined) return null;
  const id = `info-${props.info.scoreId}`;
  return (
    <>
      <button
        type="button"
        class="btn relative z-10"
        data-variant="ghost"
        data-size="icon-sm"
        popovertarget={id}
        aria-label="Play details"
        title="Play details"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      </button>
      <div
        id={id}
        // Spelled out: a bare `popover` renders as `popover="true"`, which browsers treat as `manual` (no Escape, no
        // outside click). `auto` closes on both.
        popover="auto"
        class="bg-popover text-popover-foreground m-auto w-80 max-w-[calc(100vw-2rem)] rounded-lg border p-4 text-sm shadow-md"
      >
        <dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 whitespace-normal">
          {playInfoRows(props.info).map(([label, value]) => (
            <>
              <dt class="text-muted-foreground">{label}</dt>
              <dd class="break-words">{value}</dd>
            </>
          ))}
        </dl>
      </div>
    </>
  );
}

/**
 * Makes a whole table row open a score: an invisible link stretched over the row (the row is `relative`). Links and
 * buttons inside the row sit above it (`relative z-10`) and keep working.
 */
function RowLink(props: { href: string; label: string }) {
  return <a class="absolute inset-0" href={props.href} aria-label={props.label} />;
}

/** When a play happened, compact (`2026-10-13 06:20`, UTC in full on hover), with its info icon. */
function When(props: { at: number; info: PlayInfo | undefined }) {
  const full = formatTimestamp(props.at);
  return (
    <span class="text-muted-foreground inline-flex items-center gap-1">
      <time datetime={new Date(props.at).toISOString()} title={full}>
        {full.replace(' UTC', '')}
      </time>
      <InfoButton info={props.info} />
    </span>
  );
}

const ROW = 'relative cursor-pointer';
const ABOVE = 'relative z-10';

/** Newest plays: who, which chart, the ruleset it was played with, its figures under the display ruleset, and when. */
export function RecentScoresTable(props: {
  scores: RecentScore[];
  infos: Map<string, PlayInfo>;
  showPlayer: boolean;
  empty: string;
}) {
  if (props.scores.length === 0) {
    return <Empty title="No plays here yet">{props.empty}</Empty>;
  }
  return (
    <TableCard>
      <thead>
        <tr>
          {props.showPlayer ? <th>Player</th> : null}
          <th>Song</th>
          <th>Ruleset</th>
          <th>Lamp</th>
          <th class={NUM}>Gauge</th>
          <th class={NUM}>EX-Score</th>
          <th class={NUM}>
            <abbr title={BP_MEANING}>BP</abbr>
          </th>
          <th>When</th>
        </tr>
      </thead>
      <tbody>
        {props.scores.map((entry) => (
          <tr class={ROW}>
            {props.showPlayer ? (
              <td>
                <RowLink href={scoreHref(entry.scoreId)} label={`Score of ${entry.displayName}`} />
                <span class="inline-flex items-center gap-1.5">
                  <a class={`${LINK} ${ABOVE}`} href={playerHref(entry.handle)}>
                    {entry.displayName}
                  </a>
                  {entry.anonymous ? <Tag>anonymous</Tag> : null}
                </span>
              </td>
            ) : null}
            <td class="min-w-48 whitespace-normal">
              {props.showPlayer ? null : <RowLink href={scoreHref(entry.scoreId)} label="Score" />}
              <span class="inline-flex flex-wrap items-center gap-1.5">
                <a class={`${LINK} ${ABOVE}`} href={chartHref(entry.chartFingerprint)}>
                  {chartTitle(entry.title, entry.chartFingerprint)}
                </a>
                {entry.chartListed ? null : <Tag>new chart</Tag>}
              </span>
              {entry.artist !== null ? <span class="text-muted-foreground block text-xs">{entry.artist}</span> : null}
            </td>
            <td>
              <span class="inline-flex items-center gap-1.5">
                {RULESET_LABELS[entry.playedRuleset] ?? entry.playedRuleset}
                {entry.assisted ? <Tag>assist</Tag> : null}
              </span>
            </td>
            <td>
              <Lamp lamp={entry.clearLamp} />
            </td>
            <td class={NUM}>{formatGauge(entry.gaugeType, entry.gaugeFinal)}</td>
            <td class={NUM}>{formatExScore(entry.exScore, entry.noteCount)}</td>
            <td class={NUM}>{entry.missCount}</td>
            <td>
              <When at={entry.createdAt} info={props.infos.get(entry.scoreId)} />
            </td>
          </tr>
        ))}
      </tbody>
    </TableCard>
  );
}

/** A chart's ranking under the display ruleset; a row opens the player's best EX-Score play. */
export function RankingTable(props: { entries: RankingEntry[]; infos: Map<string, PlayInfo>; noteCount: number }) {
  if (props.entries.length === 0) {
    return <Empty title="Nobody here yet">No plays match these filters.</Empty>;
  }
  return (
    <TableCard>
      <thead>
        <tr>
          <th class={NUM}>#</th>
          <th>Player</th>
          <th>Lamp</th>
          <th class={NUM}>EX-Score</th>
          <th>
            <abbr title={DJ_MEANING}>DJ Rank</abbr>
          </th>
          <th class={NUM}>
            <abbr title={BP_MEANING}>BP</abbr>
          </th>
          <th class={NUM}>Plays</th>
          <th>When</th>
        </tr>
      </thead>
      <tbody>
        {props.entries.map((entry) => (
          <tr class={ROW}>
            <td class={`${NUM} font-medium`}>
              <RowLink href={scoreHref(entry.exScoreId)} label={`Best play of ${entry.displayName}`} />
              {entry.rank}
            </td>
            <td>
              <span class="inline-flex items-center gap-1.5">
                <a class={`${LINK} ${ABOVE}`} href={playerHref(entry.handle)}>
                  {entry.displayName}
                </a>
                {entry.anonymous ? <Tag>anonymous</Tag> : null}
              </span>
            </td>
            <td>
              <Lamp lamp={entry.clearLamp} />
            </td>
            <td class={NUM}>{formatExScore(entry.exScore, props.noteCount)}</td>
            <td>{djLevel(entry.exScore, props.noteCount)}</td>
            <td class={NUM}>{entry.missCount}</td>
            <td class={NUM}>{entry.playCount}</td>
            <td>
              <When at={entry.achievedAt} info={props.infos.get(entry.exScoreId)} />
            </td>
          </tr>
        ))}
      </tbody>
    </TableCard>
  );
}

/** One score under every ruleset. */
export function ResultsTable(props: {
  results: Array<{
    ruleset: string;
    exScore: number;
    noteCount: number;
    clearLamp: number;
    missCount: number;
    maxCombo: number;
    gaugeType: string;
    gaugeFinal: number | null;
    judges: Record<string, number>;
  }>;
  playedRuleset: string;
  /** The viewer's display ruleset, marked as shown. */
  displayRuleset: string;
}) {
  const order = ['lr2', 'beatoraja', 'iidx'];
  const results = [...props.results].sort((left, right) => order.indexOf(left.ruleset) - order.indexOf(right.ruleset));
  return (
    <TableCard>
      <thead>
        <tr>
          <th>Ruleset</th>
          <th>Lamp</th>
          <th class={NUM}>Gauge</th>
          <th class={NUM}>EX-Score</th>
          <th>
            <abbr title={DJ_MEANING}>DJ Rank</abbr>
          </th>
          <th class={NUM}>
            <abbr title={BP_MEANING}>BP</abbr>
          </th>
          <th class={NUM}>Combo</th>
          <th class={NUM}>PG / GR / GD / BD / PR / EPR</th>
        </tr>
      </thead>
      <tbody>
        {results.map((result) => (
          <tr data-state={result.ruleset === props.displayRuleset ? 'selected' : undefined}>
            <td>
              <span class="inline-flex items-center gap-1.5">
                {RULESET_LABELS[result.ruleset] ?? result.ruleset}
                {result.ruleset === props.displayRuleset ? <Tag>shown</Tag> : null}
                {result.ruleset === props.playedRuleset ? <Tag>played</Tag> : null}
              </span>
            </td>
            <td>
              <Lamp lamp={result.clearLamp} />
            </td>
            <td class={NUM}>{formatGauge(result.gaugeType, result.gaugeFinal)}</td>
            <td class={NUM}>{formatExScore(result.exScore, result.noteCount)}</td>
            <td>{djLevel(result.exScore, result.noteCount)}</td>
            <td class={NUM}>{result.missCount}</td>
            <td class={NUM}>{result.maxCombo}</td>
            <td class={NUM}>
              {['pgreat', 'great', 'good', 'bad', 'poor', 'emptyPoor']
                .map((key) => result.judges[key] ?? 0)
                .join(' / ')}
            </td>
          </tr>
        ))}
      </tbody>
    </TableCard>
  );
}

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
