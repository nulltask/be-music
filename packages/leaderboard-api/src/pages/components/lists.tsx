/** @jsxImportSource hono/jsx */
/**
 * The Leaderboard's lists: a chart's ranking, the latest plays, a chartset's charts, one play under every ruleset.
 *
 * Each row is one line of a compact list rather than a table row, so nothing wraps into columns or scrolls sideways on
 * a phone. Every row keeps one layout: what it is at the start (rank, lamp colour), who or what in the middle with its
 * details on a second, smaller line, and the score at the end, aligned on its digits.
 */
import type { Child } from 'hono/jsx';
import type { RankingEntry } from '../../ranking.ts';
import { byRulesetOrder } from '../../rulesets.ts';
import type { ChartsetChart, PlayInfo, RecentScore } from '../data.ts';
import {
  chartTitle,
  djLevel,
  formatGauge,
  formatLaneMode,
  formatScoreRate,
  lampStyle,
  RULESET_MEANING,
  rulesetName,
} from '../format.ts';
import { ABOVE, Avatar, chartHref, Empty, LINK, playerHref, RowLink, scoreHref, Tag } from './basics.tsx';
import { When } from './play-info.tsx';

/** The frame of a list: a card whose rows are split by hairlines. */
function List(props: { label: string; children: Child }) {
  return (
    <ol class="card divide-border gap-0 divide-y overflow-hidden py-0" aria-label={props.label}>
      {props.children}
    </ol>
  );
}

/** One row: a fixed start column, the main text (title over details), and the score at the end. */
function Row(props: {
  href: string;
  label: string;
  start: Child;
  title: Child;
  details: Child[];
  end: Child;
  current?: boolean;
}) {
  return (
    <li
      class={`hover:bg-muted/50 relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2.5 ${props.current ? 'bg-muted/60' : ''}`}
    >
      <RowLink href={props.href} label={props.label} />
      {props.start}
      <div class="min-w-0">
        <div class="flex min-w-0 items-center gap-1.5">{props.title}</div>
        <div class="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          {props.details
            .filter((item) => item !== null && item !== false)
            .map((item) => (
              // The separator trails each item, so a wrapped line never starts with one.
              <span class="inline-flex items-center gap-1 [&:not(:last-child)]:after:ms-1 [&:not(:last-child)]:after:text-muted-foreground/60 [&:not(:last-child)]:after:content-['·']">
                {item}
              </span>
            ))}
        </div>
      </div>
      {props.end}
    </li>
  );
}

/** The lamp as a colour bar: the row's leading edge, the same colour the lamp has everywhere else. */
function LampBar(props: { lamp: number }) {
  const style = lampStyle(props.lamp);
  return (
    <span
      class="ring-foreground/15 block h-8 w-1.5 rounded-full ring-1"
      style={`background:${style.color}`}
      title={`${style.label}: ${style.meaning}`}
    />
  );
}

/** The lamp's name in its colour's dot, for the details line. */
function LampLabel(props: { lamp: number }) {
  const style = lampStyle(props.lamp);
  return (
    <span class="inline-flex items-center gap-1" title={style.meaning}>
      <span class="ring-foreground/20 inline-block size-2 rounded-full ring-1" style={`background:${style.color}`} />
      {style.label}
    </span>
  );
}

/** EX-Score over its rate, right-aligned on the digits. */
function Score(props: { exScore: number; noteCount: number }) {
  return (
    <div class="text-end tabular-nums">
      <div class="font-semibold">{props.exScore}</div>
      <div class="text-muted-foreground text-xs">{formatScoreRate(props.exScore, props.noteCount)}</div>
    </div>
  );
}

/**
 * A chart's ranking under the display ruleset; a row opens the play it shows. `highlight` marks the viewer's rows.
 */
export function RankingList(props: {
  entries: RankingEntry[];
  infos: Map<string, PlayInfo>;
  noteCount: number;
  highlight?: string;
  empty?: string;
}) {
  if (props.entries.length === 0) {
    return <Empty title="Nobody here yet">{props.empty ?? 'No plays match these filters.'}</Empty>;
  }
  return (
    <List label="Ranking">
      {props.entries.map((entry) => (
        <Row
          href={scoreHref(entry.exScoreId)}
          label={`Play of ${entry.displayName}, rank ${entry.rank}`}
          current={props.highlight === entry.handle}
          start={
            <span class="flex items-center gap-3">
              <span class="w-6 text-end font-semibold tabular-nums">{entry.rank}</span>
              <LampBar lamp={entry.clearLamp} />
              <Avatar src={entry.avatarUrl} size={32} />
            </span>
          }
          title={
            <>
              <a class={`${LINK} ${ABOVE} truncate`} href={playerHref(entry.handle)}>
                {entry.displayName}
              </a>
              {entry.anonymous ? <Tag>anonymous</Tag> : null}
            </>
          }
          details={[
            <LampLabel lamp={entry.clearLamp} />,
            <>DJ {djLevel(entry.exScore, props.noteCount)}</>,
            <span class="tabular-nums">BP {entry.missCount}</span>,
            <span class="tabular-nums">
              {entry.playCount} play{entry.playCount === 1 ? '' : 's'}
            </span>,
            <span class={ABOVE}>
              <When at={entry.achievedAt} info={props.infos.get(entry.exScoreId)} />
            </span>,
          ]}
          end={<Score exScore={entry.exScore} noteCount={props.noteCount} />}
        />
      ))}
    </List>
  );
}

/** The latest plays: which chart, who, how it went under the display ruleset, and when. */
export function RecentScoresList(props: {
  scores: RecentScore[];
  infos: Map<string, PlayInfo>;
  showPlayer: boolean;
  empty: string;
}) {
  if (props.scores.length === 0) {
    return <Empty title="No plays here yet">{props.empty}</Empty>;
  }
  return (
    <List label="Latest plays">
      {props.scores.map((entry) => {
        const title = chartTitle(entry.title, entry.chartFingerprint);
        return (
          <Row
            href={scoreHref(entry.scoreId)}
            label={`Play of ${title} by ${entry.displayName}`}
            start={
              <span class="flex items-center gap-3">
                <LampBar lamp={entry.clearLamp} />
                {props.showPlayer ? <Avatar src={entry.avatarUrl} size={32} /> : null}
              </span>
            }
            title={
              <>
                <a class={`${LINK} ${ABOVE} truncate`} href={chartHref(entry.chartFingerprint)}>
                  {title}
                </a>
                {entry.chartListed ? null : <Tag>new chart</Tag>}
              </>
            }
            details={[
              props.showPlayer ? (
                <>
                  <a
                    class={`${ABOVE} text-foreground font-medium underline-offset-4 hover:underline`}
                    href={playerHref(entry.handle)}
                  >
                    {entry.displayName}
                  </a>
                  {entry.anonymous ? <Tag>anonymous</Tag> : null}
                </>
              ) : null,
              <LampLabel lamp={entry.clearLamp} />,
              <span class="tabular-nums">{formatGauge(entry.gaugeType, entry.gaugeFinal)}</span>,
              <span class="tabular-nums">BP {entry.missCount}</span>,
              <>
                <span title="The scoring rules the player played under">{rulesetName(entry.playedRuleset)}</span>
                {entry.assisted ? <Tag>assist</Tag> : null}
              </>,
              <span class={ABOVE}>
                <When at={entry.createdAt} info={props.infos.get(entry.scoreId)} />
              </span>,
            ]}
            end={<Score exScore={entry.exScore} noteCount={entry.noteCount} />}
          />
        );
      })}
    </List>
  );
}

const PACK_TYPE_LABELS = {
  included: { label: 'original', meaning: 'Came in the work’s own package.' },
  additional: { label: 'add-on', meaning: 'An add-on chart (差分), distributed separately from the work.' },
} as const;

/** The charts of a chartset; a row opens the chart. */
export function ChartsetChartsList(props: { charts: ChartsetChart[] }) {
  if (props.charts.length === 0) {
    return <Empty title="No charts yet">No chart of this work has been played here.</Empty>;
  }
  return (
    <List label="Charts">
      {props.charts.map((entry) => {
        const pack = entry.packType === null ? undefined : PACK_TYPE_LABELS[entry.packType];
        const title = chartTitle(entry.title, entry.chartFingerprint);
        return (
          <Row
            href={chartHref(entry.chartFingerprint)}
            label={title}
            start={<span class="text-muted-foreground w-14 text-xs font-medium">{formatLaneMode(entry.laneMode)}</span>}
            title={
              <>
                <span class="truncate font-medium">{title}</span>
                {entry.subtitle !== null && entry.subtitle.length > 0 ? (
                  <span class="text-muted-foreground truncate">{entry.subtitle}</span>
                ) : null}
                {entry.listed ? null : <Tag>new chart</Tag>}
              </>
            }
            details={[
              entry.artist !== null && entry.artist.length > 0 ? <>{entry.artist}</> : null,
              <span class="tabular-nums">{entry.noteCount} notes</span>,
              pack !== undefined ? <span title={pack.meaning}>{pack.label}</span> : null,
            ]}
            end={
              <div class="text-end tabular-nums">
                <div class="font-semibold">{entry.players}</div>
                <div class="text-muted-foreground text-xs">player{entry.players === 1 ? '' : 's'}</div>
              </div>
            }
          />
        );
      })}
    </List>
  );
}

const JUDGE_LABELS: Array<[string, string]> = [
  ['pgreat', 'PG'],
  ['great', 'GR'],
  ['good', 'GD'],
  ['bad', 'BD'],
  ['poor', 'PR'],
  ['emptyPoor', 'EPR'],
];

/** One play under every ruleset, one card each: the shown ruleset first in the reading order of the rulesets. */
export function ResultCards(props: {
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
  const results = [...props.results].sort(byRulesetOrder);
  return (
    <section class="space-y-2" aria-labelledby="scored-with">
      <h2 id="scored-with" class="text-muted-foreground text-sm">
        <abbr title={RULESET_MEANING}>Scored with</abbr> each set of rules
      </h2>
      <div class="grid gap-3 sm:grid-cols-3">
        {results.map((result) => {
          const shown = result.ruleset === props.displayRuleset;
          return (
            <section
              class={`card gap-3 px-4 py-4 ${shown ? 'ring-primary ring-2' : ''}`}
              aria-label={rulesetName(result.ruleset)}
              data-state={shown ? 'selected' : undefined}
            >
              {/* A div, not a header: Basecoat pads a card's header, which would shift it off the card's edge. */}
              <div class="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                {rulesetName(result.ruleset)}
                {shown ? <Tag>shown</Tag> : null}
                {result.ruleset === props.playedRuleset ? <Tag>played</Tag> : null}
              </div>
              <div class="flex items-end justify-between gap-3">
                <LampLabel lamp={result.clearLamp} />
                <div class="text-end tabular-nums">
                  <div class="text-2xl leading-none font-semibold">{result.exScore}</div>
                  <div class="text-muted-foreground mt-1 text-xs">
                    {formatScoreRate(result.exScore, result.noteCount)} · DJ {djLevel(result.exScore, result.noteCount)}
                  </div>
                </div>
              </div>
              <dl class="text-muted-foreground grid grid-cols-3 gap-x-3 gap-y-1 text-xs tabular-nums">
                {JUDGE_LABELS.map(([key, label]) => (
                  <div class="flex justify-between gap-2">
                    <dt>{label}</dt>
                    <dd class="text-foreground">{result.judges[key] ?? 0}</dd>
                  </div>
                ))}
                <div class="flex justify-between gap-2">
                  <dt>BP</dt>
                  <dd class="text-foreground">{result.missCount}</dd>
                </div>
                <div class="flex justify-between gap-2">
                  <dt>Combo</dt>
                  <dd class="text-foreground">{result.maxCombo}</dd>
                </div>
                <div class="col-span-3 flex justify-between gap-2">
                  <dt>Gauge</dt>
                  <dd class="text-foreground">{formatGauge(result.gaugeType, result.gaugeFinal)}</dd>
                </div>
              </dl>
            </section>
          );
        })}
      </div>
    </section>
  );
}
