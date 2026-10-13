/** @jsxImportSource hono/jsx */
/** The Leaderboard's tables: newest plays, a chart's ranking, a chartset's charts, one play under every ruleset. */
import type { RankingEntry } from '../../ranking.ts';
import { byRulesetOrder } from '../../rulesets.ts';
import type { ChartsetChart, PlayInfo, RecentScore } from '../data.ts';
import {
  chartTitle,
  djLevel,
  formatExScore,
  formatGauge,
  formatLaneMode,
  RULESET_MEANING,
  rulesetName,
} from '../format.ts';
import {
  ABOVE,
  Avatar,
  BP_MEANING,
  chartHref,
  DJ_MEANING,
  Empty,
  Lamp,
  LINK,
  NUM,
  playerHref,
  ROW,
  RowLink,
  scoreHref,
  TableCard,
  Tag,
} from './basics.tsx';
import { When } from './play-info.tsx';

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
          <th>
            <abbr title={RULESET_MEANING}>Played under</abbr>
          </th>
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
                  <Avatar src={entry.avatarUrl} size={20} />
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
                {rulesetName(entry.playedRuleset)}
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
                <Avatar src={entry.avatarUrl} size={20} />
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

const PACK_TYPE_LABELS = {
  included: { label: 'original', meaning: 'Came in the work’s own package.' },
  additional: { label: 'add-on', meaning: 'An add-on chart (差分), distributed separately from the work.' },
} as const;

/** The charts of a chartset; a row opens the chart. */
export function ChartsetChartsTable(props: { charts: ChartsetChart[] }) {
  if (props.charts.length === 0) {
    return <Empty title="No charts yet">No chart of this work has been played here.</Empty>;
  }
  return (
    <TableCard>
      <thead>
        <tr>
          <th>Chart</th>
          <th>Package</th>
          <th>Mode</th>
          <th class={NUM}>Notes</th>
          <th class={NUM}>Players</th>
        </tr>
      </thead>
      <tbody>
        {props.charts.map((entry) => {
          const pack = entry.packType === null ? undefined : PACK_TYPE_LABELS[entry.packType];
          const title = chartTitle(entry.title, entry.chartFingerprint);
          return (
            <tr class={ROW}>
              <td>
                <RowLink href={chartHref(entry.chartFingerprint)} label={title} />
                <span class="inline-flex flex-wrap items-center gap-1.5">
                  <span class="font-medium">{title}</span>
                  {entry.subtitle !== null && entry.subtitle.length > 0 ? (
                    <span class="text-muted-foreground">{entry.subtitle}</span>
                  ) : null}
                  {entry.listed ? null : <Tag>new chart</Tag>}
                </span>
                {entry.artist !== null && entry.artist.length > 0 ? (
                  <div class="text-muted-foreground text-xs">{entry.artist}</div>
                ) : null}
              </td>
              <td>{pack !== undefined ? <span title={pack.meaning}>{pack.label}</span> : '-'}</td>
              <td>{formatLaneMode(entry.laneMode)}</td>
              <td class={NUM}>{entry.noteCount}</td>
              <td class={NUM}>{entry.players}</td>
            </tr>
          );
        })}
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
  const results = [...props.results].sort(byRulesetOrder);
  return (
    <TableCard>
      <thead>
        <tr>
          <th>
            <abbr title={RULESET_MEANING}>Scored with</abbr>
          </th>
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
                {rulesetName(result.ruleset)}
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
