/** @jsxImportSource hono/jsx */
import type { RankingEntry } from '../ranking.ts';
import type { RecentScore } from './data.ts';
import { chartTitle, djLevel, formatScoreRate, formatTimestamp, lampStyle, RULESET_LABELS } from './format.ts';

export const scoreHref = (scoreId: string): string => `/leaderboard/scores/${encodeURIComponent(scoreId)}`;
export const chartHref = (chartFingerprint: string, ruleset?: string): string =>
  `/leaderboard/charts/${encodeURIComponent(chartFingerprint)}${ruleset !== undefined ? `?ruleset=${ruleset}` : ''}`;
export const playerHref = (handle: string): string => `/leaderboard/players/${encodeURIComponent(handle)}`;

function Lamp(props: { lamp: number }) {
  const style = lampStyle(props.lamp);
  return (
    <span title={style.label}>
      <span class="lamp" style={`background:${style.color}`} />
      {style.label}
    </span>
  );
}

/** A toggle chip that links to the same page with one query flag flipped. */
export function FilterChip(props: { label: string; on: boolean; href: string }) {
  return (
    <a class={props.on ? 'on' : ''} href={props.href}>
      {props.on ? '✓ ' : ''}
      {props.label}
    </a>
  );
}

/** Newest plays: when, who, which chart, and the figures under the ruleset it was played under. */
export function RecentScoresTable(props: { scores: RecentScore[]; showPlayer: boolean; empty: string }) {
  if (props.scores.length === 0) {
    return (
      <div class="table-wrap">
        <p class="empty">{props.empty}</p>
      </div>
    );
  }
  return (
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>When</th>
            {props.showPlayer ? <th>Player</th> : null}
            <th>Song</th>
            <th>Ruleset</th>
            <th>Lamp</th>
            <th>EX</th>
            <th>Rate</th>
            <th>BP</th>
          </tr>
        </thead>
        <tbody>
          {props.scores.map((entry) => (
            <tr>
              <td>
                <a href={scoreHref(entry.scoreId)}>{formatTimestamp(entry.createdAt)}</a>
              </td>
              {props.showPlayer ? (
                <td>
                  <a href={playerHref(entry.handle)}>{entry.displayName}</a>
                  {entry.anonymous ? <span class="tag">anonymous</span> : null}
                </td>
              ) : null}
              <td class="song">
                <a href={chartHref(entry.chartFingerprint, entry.playedRuleset)}>
                  {chartTitle(entry.title, entry.chartFingerprint)}
                </a>
                {entry.chartListed ? null : <span class="tag">new chart</span>}
                {entry.artist !== null ? <small>{entry.artist}</small> : null}
              </td>
              <td>
                {RULESET_LABELS[entry.playedRuleset] ?? entry.playedRuleset}
                {entry.assisted ? <span class="tag">assist</span> : null}
              </td>
              <td>
                <Lamp lamp={entry.clearLamp} />
              </td>
              <td class="num">{entry.exScore}</td>
              <td class="num">{formatScoreRate(entry.exScore, entry.noteCount)}</td>
              <td class="num">{entry.missCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A chart's ranking under one ruleset. */
export function RankingTable(props: { entries: RankingEntry[]; noteCount: number }) {
  if (props.entries.length === 0) {
    return (
      <div class="table-wrap">
        <p class="empty">Nobody here yet.</p>
      </div>
    );
  }
  return (
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Player</th>
            <th>Lamp</th>
            <th>EX</th>
            <th>Rate</th>
            <th>DJ</th>
            <th>BP</th>
            <th>Plays</th>
          </tr>
        </thead>
        <tbody>
          {props.entries.map((entry) => (
            <tr>
              <td class="num">{entry.rank}</td>
              <td>
                <a href={playerHref(entry.handle)}>{entry.displayName}</a>
                {entry.anonymous ? <span class="tag">anonymous</span> : null}
              </td>
              <td>
                <Lamp lamp={entry.clearLamp} />
              </td>
              <td class="num">
                <a href={scoreHref(entry.exScoreId)}>{entry.exScore}</a>
              </td>
              <td class="num">{formatScoreRate(entry.exScore, props.noteCount)}</td>
              <td>{djLevel(entry.exScore, props.noteCount)}</td>
              <td class="num">{entry.missCount}</td>
              <td class="num">{entry.playCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
}) {
  const order = ['lr2', 'beatoraja', 'iidx'];
  const results = [...props.results].sort((left, right) => order.indexOf(left.ruleset) - order.indexOf(right.ruleset));
  return (
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Ruleset</th>
            <th>Lamp</th>
            <th>EX</th>
            <th>Rate</th>
            <th>DJ</th>
            <th>BP</th>
            <th>Combo</th>
            <th>PG / GR / GD / BD / PR / EPR</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result) => (
            <tr>
              <td>
                {RULESET_LABELS[result.ruleset] ?? result.ruleset}
                {result.ruleset === props.playedRuleset ? <span class="tag">played</span> : null}
              </td>
              <td>
                <Lamp lamp={result.clearLamp} />
              </td>
              <td class="num">{result.exScore}</td>
              <td class="num">{formatScoreRate(result.exScore, result.noteCount)}</td>
              <td>{djLevel(result.exScore, result.noteCount)}</td>
              <td class="num">{result.missCount}</td>
              <td class="num">{result.maxCombo}</td>
              <td class="num">
                {['pgreat', 'great', 'good', 'bad', 'poor', 'emptyPoor']
                  .map((key) => result.judges[key] ?? 0)
                  .join(' / ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
