/** @jsxImportSource hono/jsx */
import { openDatabase } from '../db/client.ts';
import { isOn } from '../http/query.ts';
import { RecentScoresList } from './components/lists.tsx';
import { Filters, Toggle } from './components/basics.tsx';
import { loadPlayInfos, loadRecentScores } from './data.ts';
import { rulesetName } from './format.ts';
import { Layout, PageHeader } from './layout.tsx';
import { displayRuleset, meta, PAGE_CACHE, RECENT_LIMIT, withQuery, type PageContext } from './page.tsx';

/**
 * Latest: every play by a player who is not anonymous, on any chart; a chart not listed yet carries a "new chart"
 * tag. Anonymous plays come in on request. An invented chart can reach this page only through an account with a
 * passkey, and the chart index (later) still lists charts by the two-player rule.
 */
export async function topPage(c: PageContext) {
  const includeAnonymous = isOn(c.req.query('anonymous'));
  const ruleset = displayRuleset(c);
  const db = openDatabase(c.env.DB);
  const scores = await loadRecentScores(db, {
    limit: RECENT_LIMIT,
    ruleset,
    includeAnonymous,
    includeUnlisted: true,
  });
  c.header('cache-control', PAGE_CACHE);
  return c.html(
    <Layout
      meta={meta(c, 'Latest', 'The latest plays on the be-music Leaderboard.', [{ label: 'Latest', kind: 'latest' }])}
    >
      <PageHeader title="Latest" kind="latest">
        The latest plays, scored under {rulesetName(ruleset)}.
      </PageHeader>
      <Filters>
        <Toggle
          label="Anonymous players"
          description="Include plays by players who have not made a passkey yet"
          on={includeAnonymous}
          href={withQuery(c, 'anonymous', includeAnonymous ? undefined : '1')}
        />
      </Filters>
      <RecentScoresList
        scores={scores}
        infos={await loadPlayInfos(
          db,
          scores.map((entry) => entry.scoreId),
        )}
        showPlayer
        empty={
          includeAnonymous
            ? 'No plays yet.'
            : 'Plays show up once their player creates a passkey — turn on “Anonymous players” to see the rest.'
        }
      />
    </Layout>,
  );
}
