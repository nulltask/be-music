/** @jsxImportSource hono/jsx */
import { openDatabase } from '../db/client.ts';
import { RecentScoresTable } from './components/tables.tsx';
import { Details, DistributionCard, LampLegend, Stats } from './components/cards.tsx';
import { Avatar, LocalTime, Tag } from './components/basics.tsx';
import { loadPlayer, loadPlayInfos, loadRecentScores } from './data.ts';
import { formatPercent, RULESET_LABELS } from './format.ts';
import { Layout, PageHeader } from './layout.tsx';
import { day, displayRuleset, meta, notFound, PAGE_CACHE, RECENT_LIMIT, when, type PageContext } from './page.tsx';
import { loadPlayerStats } from './stats.ts';
import { resolveFormerHandle } from '../profiles.ts';
import { movedTo } from './avatar.ts';

/** A player's figures and newest plays. */
export async function playerPage(c: PageContext<'/leaderboard/players/:handle'>) {
  const db = openDatabase(c.env.DB);
  const player = await loadPlayer(db, c.req.param('handle'));
  if (player === undefined) {
    // A handle the player has since changed: send old links to the current page.
    const current = await resolveFormerHandle(db, c.req.param('handle'));
    if (current !== undefined) return c.redirect(movedTo(c.req.url, c.req.param('handle'), current), 301);
    return notFound(c, 'This player');
  }
  const ruleset = displayRuleset(c);
  const stats = await loadPlayerStats(db, player.userId, ruleset);
  const scores = await loadRecentScores(db, {
    limit: RECENT_LIMIT,
    ruleset,
    includeAnonymous: true,
    includeUnlisted: true,
    handle: player.handle,
  });
  c.header('cache-control', PAGE_CACHE);
  return c.html(
    <Layout
      meta={meta(c, player.displayName, `${player.displayName} (@${player.handle}) on the be-music Leaderboard.`, [
        { label: player.displayName },
      ])}
    >
      <PageHeader
        title={
          <span class="inline-flex items-center gap-3">
            <Avatar src={player.avatarUrl} size={40} />
            {player.displayName}
          </span>
        }
      >
        @{player.handle}
        {player.anonymous ? <Tag>anonymous</Tag> : null}
      </PageHeader>
      <Stats
        items={[
          ['Plays', stats.plays],
          ['Charts', stats.charts],
          [`Average rate (${RULESET_LABELS[ruleset]})`, formatPercent(stats.averageRate)],
          ['Last played', day(stats.lastPlayedAt)],
        ]}
      />
      <div class="grid gap-6 lg:grid-cols-2">
        <DistributionCard
          title="Clear lamps"
          description={`Best lamp per chart under ${RULESET_LABELS[ruleset]}, without assists.`}
          distribution={stats.lamps}
          kind="lamp"
        />
        <DistributionCard
          title="DJ Ranks"
          description={`Best EX-Score per chart under ${RULESET_LABELS[ruleset]}, without assists.`}
          distribution={stats.djRanks}
          kind="dj-rank"
        />
      </div>
      <Details
        title="Player"
        rows={[
          ['Joined', <LocalTime at={player.joinedAt} />],
          ['First play', when(stats.firstPlayedAt)],
          [
            'Played under',
            stats.playsByRuleset.length === 0
              ? '-'
              : stats.playsByRuleset
                  .map(
                    (entry) => `${RULESET_LABELS[entry.ruleset]}: ${entry.count} play${entry.count === 1 ? '' : 's'}`,
                  )
                  .join(' · '),
          ],
        ]}
      />
      <RecentScoresTable
        scores={scores}
        infos={await loadPlayInfos(
          db,
          scores.map((entry) => entry.scoreId),
        )}
        showPlayer={false}
        empty="No plays yet."
      />
      <LampLegend />
    </Layout>,
  );
}
