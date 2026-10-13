/** @jsxImportSource hono/jsx */
import type { Context, Hono } from 'hono';
import type { AppEnv } from '../app.ts';
import { openDatabase } from '../db/client.ts';
import { countPlayers, loadRanking } from '../ranking.ts';
import { loadChart, loadPlayer, loadRecentScores, loadScoreDetail } from './data.ts';
import { chartTitle, formatTimestamp, RULESET_LABELS } from './format.ts';
import { Layout, type PageMeta } from './layout.tsx';
import { chartHref, FilterChip, playerHref, RankingTable, RecentScoresTable, ResultsTable } from './views.tsx';

const RECENT_LIMIT = 50;
const RANKING_LIMIT = 100;
const RULESETS = ['lr2', 'beatoraja', 'iidx'] as const;
type Ruleset = (typeof RULESETS)[number];

/**
 * Pages change with every submission. Browsers always revalidate, so a player sees their new score at once; a shared
 * cache may keep a page for half a minute to absorb a burst of visitors.
 */
const PAGE_CACHE = 'public, max-age=0, s-maxage=30';

const isOn = (value: string | undefined): boolean => value === '1' || value === 'true';

/** `Artist · ` before the rest of a subtitle, or nothing when the play log carried no artist. */
const withArtist = (artist: string | null): string =>
  artist !== null && artist.trim().length > 0 ? `${artist} · ` : '';

/** The current URL with one query parameter set (or removed with `undefined`). */
function withQuery(c: Context, key: string, value: string | undefined): string {
  const url = new URL(c.req.url);
  if (value === undefined) url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}

function meta(c: Context, title: string, description: string): PageMeta {
  return { title, description, url: c.req.url };
}

function notFound(c: Context<AppEnv>, what: string) {
  return c.html(
    <Layout meta={meta(c, 'Not found', `${what} not found.`)}>
      <h1>Not found</h1>
      <p class="sub">{what} does not exist, or it was removed.</p>
    </Layout>,
    404,
  );
}

/** Server-rendered Leaderboard pages under `/leaderboard` (docs/leaderboard.md section 10). */
export function mountPages(app: Hono<AppEnv>): void {
  // New scores: every play by a player who is not anonymous, on any chart; a chart not listed yet carries a "new chart"
  // tag. Anonymous plays come in on request. An invented chart can reach this page only through an account with a
  // passkey, and the chart index (later) still lists charts by the two-player rule.
  const top = async (c: Context<AppEnv>) => {
    const includeAnonymous = isOn(c.req.query('anonymous'));
    const scores = await loadRecentScores(openDatabase(c.env.DB), {
      limit: RECENT_LIMIT,
      includeAnonymous,
      includeUnlisted: true,
    });
    c.header('cache-control', PAGE_CACHE);
    return c.html(
      <Layout meta={meta(c, 'New scores', 'The newest plays on the be-music Leaderboard.')}>
        <h1>New scores</h1>
        <p class="sub">The newest plays, each under the ruleset it was played with.</p>
        <div class="filters">
          <FilterChip
            label="Anonymous players"
            on={includeAnonymous}
            href={withQuery(c, 'anonymous', includeAnonymous ? undefined : '1')}
          />
        </div>
        <RecentScoresTable
          scores={scores}
          showPlayer
          empty={
            includeAnonymous
              ? 'No plays yet.'
              : 'No plays here yet. Plays show up once their player creates a passkey — turn on “Anonymous players” to see the rest.'
          }
        />
      </Layout>,
    );
  };
  app.get('/leaderboard', top);
  app.get('/leaderboard/', top);

  app.get('/leaderboard/scores/:id', async (c) => {
    const detail = await loadScoreDetail(openDatabase(c.env.DB), c.req.param('id'));
    if (detail === undefined) return notFound(c, 'This score');
    const title = chartTitle(detail.chart.title, detail.chart.chartFingerprint);
    const played = detail.results.find((result) => result.ruleset === detail.score.playedRuleset);
    const description =
      played !== undefined
        ? `${detail.displayName} · ${title} · EX ${played.exScore} (${RULESET_LABELS[played.ruleset]})`
        : `${detail.displayName} · ${title}`;
    c.header('cache-control', PAGE_CACHE);
    return c.html(
      <Layout meta={meta(c, `${title} — ${detail.displayName}`, description)}>
        <h1>
          <a href={chartHref(detail.chart.chartFingerprint, detail.score.playedRuleset)}>{title}</a>
        </h1>
        <p class="sub">
          {withArtist(detail.chart.artist)}played by <a href={playerHref(detail.handle)}>{detail.displayName}</a>
          {detail.anonymous ? <span class="tag">anonymous</span> : null}
        </p>
        <ResultsTable results={detail.results} playedRuleset={detail.score.playedRuleset} />
        <h2 class="sub" style="margin-top:20px">
          Play
        </h2>
        <dl>
          <dt>Played</dt>
          <dd>{formatTimestamp(detail.score.createdAt.getTime())}</dd>
          <dt>Gauge</dt>
          <dd>{detail.score.gauge}</dd>
          <dt>Assists</dt>
          <dd>{detail.score.assisted ? detail.score.assistFlags.join(', ') : 'none'}</dd>
          <dt>Verification</dt>
          <dd>{detail.score.verification}</dd>
          <dt>Chart</dt>
          <dd>{detail.chart.chartFingerprint}</dd>
          {detail.score.replayVisibility === 'public' ? (
            <>
              <dt>Replay</dt>
              <dd>
                <a href={`/api/v1/scores/${encodeURIComponent(detail.score.id)}/playlog`} download>
                  Download play log
                </a>
              </dd>
            </>
          ) : null}
        </dl>
      </Layout>,
    );
  });

  app.get('/leaderboard/charts/:chartFingerprint', async (c) => {
    const db = openDatabase(c.env.DB);
    const chartFingerprint = c.req.param('chartFingerprint');
    const found = await loadChart(db, chartFingerprint);
    if (found === undefined) return notFound(c, 'This chart');
    const requested = c.req.query('ruleset');
    const ruleset: Ruleset = (RULESETS as readonly string[]).includes(requested ?? '') ? (requested as Ruleset) : 'lr2';
    const assisted = isOn(c.req.query('assisted'));
    const includeAnonymous = isOn(c.req.query('anonymous'));
    const playedHereOnly = isOn(c.req.query('played'));
    const filter = { chartFingerprint, ruleset, assisted, includeAnonymous, playedHereOnly };
    const ranking = await loadRanking(db, filter, { offset: 0, limit: RANKING_LIMIT });
    const title = chartTitle(found.title, chartFingerprint);
    const everyone = await countPlayers(db, { ...filter, includeAnonymous: true, playedHereOnly: false });
    c.header('cache-control', PAGE_CACHE);
    return c.html(
      <Layout meta={meta(c, title, `${title} — ${RULESET_LABELS[ruleset]} ranking, ${ranking.players} players.`)}>
        <h1>{title}</h1>
        <p class="sub">
          {withArtist(found.artist)}
          {found.noteCount} notes · {everyone} player{everyone === 1 ? '' : 's'}
          {found.status === 'listed' ? null : <span class="tag">new chart</span>}
        </p>
        <div class="filters">
          {RULESETS.map((id) => (
            <FilterChip label={RULESET_LABELS[id]!} on={id === ruleset} href={withQuery(c, 'ruleset', id)} />
          ))}
        </div>
        <div class="filters">
          <FilterChip label="Assisted" on={assisted} href={withQuery(c, 'assisted', assisted ? undefined : '1')} />
          <FilterChip
            label="Anonymous players"
            on={includeAnonymous}
            href={withQuery(c, 'anonymous', includeAnonymous ? undefined : '1')}
          />
          <FilterChip
            label={`Played under ${RULESET_LABELS[ruleset]}`}
            on={playedHereOnly}
            href={withQuery(c, 'played', playedHereOnly ? undefined : '1')}
          />
        </div>
        <RankingTable entries={ranking.entries} noteCount={found.noteCount} />
      </Layout>,
    );
  });

  app.get('/leaderboard/players/:handle', async (c) => {
    const db = openDatabase(c.env.DB);
    const player = await loadPlayer(db, c.req.param('handle'));
    if (player === undefined) return notFound(c, 'This player');
    const scores = await loadRecentScores(db, {
      limit: RECENT_LIMIT,
      includeAnonymous: true,
      includeUnlisted: true,
      handle: player.handle,
    });
    c.header('cache-control', PAGE_CACHE);
    return c.html(
      <Layout
        meta={meta(c, player.displayName, `${player.displayName} (@${player.handle}) on the be-music Leaderboard.`)}
      >
        <h1>{player.displayName}</h1>
        <p class="sub">
          @{player.handle}
          {player.anonymous ? <span class="tag">anonymous</span> : null}
        </p>
        <RecentScoresTable scores={scores} showPlayer={false} empty="No plays yet." />
      </Layout>,
    );
  });

  app.get('/leaderboard/*', (c) => notFound(c, 'This page'));
}
