/** @jsxImportSource hono/jsx */
import type { Child } from 'hono/jsx';
import type { RankingEntry } from '../ranking.ts';
import type { RecentScore } from './data.ts';
import type { ExternalLink } from './external.ts';
import {
  chartTitle,
  djLevel,
  formatScoreRate,
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

/** Newest plays: when, who, which chart, the ruleset it was played with, and its figures under the display ruleset. */
export function RecentScoresTable(props: { scores: RecentScore[]; showPlayer: boolean; empty: string }) {
  if (props.scores.length === 0) {
    return <Empty title="No plays here yet">{props.empty}</Empty>;
  }
  return (
    <TableCard>
      <thead>
        <tr>
          <th>When</th>
          {props.showPlayer ? <th>Player</th> : null}
          <th>Song</th>
          <th>Ruleset</th>
          <th>Lamp</th>
          <th class={NUM}>EX</th>
          <th class={NUM}>Rate</th>
          <th class={NUM}>BP</th>
        </tr>
      </thead>
      <tbody>
        {props.scores.map((entry) => (
          <tr>
            <td class="text-muted-foreground">
              <a class="underline-offset-4 hover:underline" href={scoreHref(entry.scoreId)}>
                {formatTimestamp(entry.createdAt)}
              </a>
            </td>
            {props.showPlayer ? (
              <td>
                <span class="inline-flex items-center gap-1.5">
                  <a class={LINK} href={playerHref(entry.handle)}>
                    {entry.displayName}
                  </a>
                  {entry.anonymous ? <Tag>anonymous</Tag> : null}
                </span>
              </td>
            ) : null}
            <td class="min-w-48 whitespace-normal">
              <span class="inline-flex flex-wrap items-center gap-1.5">
                <a class={LINK} href={chartHref(entry.chartFingerprint)}>
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
            <td class={NUM}>{entry.exScore}</td>
            <td class={NUM}>{formatScoreRate(entry.exScore, entry.noteCount)}</td>
            <td class={NUM}>{entry.missCount}</td>
          </tr>
        ))}
      </tbody>
    </TableCard>
  );
}

/** A chart's ranking under the display ruleset. */
export function RankingTable(props: { entries: RankingEntry[]; noteCount: number }) {
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
          <th class={NUM}>EX</th>
          <th class={NUM}>Rate</th>
          <th>DJ</th>
          <th class={NUM}>BP</th>
          <th class={NUM}>Plays</th>
        </tr>
      </thead>
      <tbody>
        {props.entries.map((entry) => (
          <tr>
            <td class={`${NUM} font-medium`}>{entry.rank}</td>
            <td>
              <span class="inline-flex items-center gap-1.5">
                <a class={LINK} href={playerHref(entry.handle)}>
                  {entry.displayName}
                </a>
                {entry.anonymous ? <Tag>anonymous</Tag> : null}
              </span>
            </td>
            <td>
              <Lamp lamp={entry.clearLamp} />
            </td>
            <td class={NUM}>
              <a class={LINK} href={scoreHref(entry.exScoreId)}>
                {entry.exScore}
              </a>
            </td>
            <td class={NUM}>{formatScoreRate(entry.exScore, props.noteCount)}</td>
            <td>{djLevel(entry.exScore, props.noteCount)}</td>
            <td class={NUM}>{entry.missCount}</td>
            <td class={NUM}>{entry.playCount}</td>
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
          <th class={NUM}>EX</th>
          <th class={NUM}>Rate</th>
          <th>DJ</th>
          <th class={NUM}>BP</th>
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
            <td class={NUM}>{result.exScore}</td>
            <td class={NUM}>{formatScoreRate(result.exScore, result.noteCount)}</td>
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
