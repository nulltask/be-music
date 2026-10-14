/** @jsxImportSource hono/jsx */
import { HelpTip } from './components/help-tip.tsx';
import { openDatabase } from '../db/client.ts';
import { isOn } from '../http/query.ts';
import { RecentScoresList } from './components/lists.tsx';
import { Filters, Toggle } from './components/basics.tsx';
import { loadPlayInfos, loadRecentScores } from './data.ts';
import { RULESET_LABELS } from './format.ts';
import { Layout, PageHeader } from './layout.tsx';
import { displayRuleset, meta, PAGE_CACHE, pageMessages, RECENT_LIMIT, withQuery, type PageContext } from './page.tsx';

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
    // Charts not listed yet stay out, except the viewer's own plays of them.
    includeUnlisted: false,
    ...(c.get('viewer') !== null ? { ownerUserId: c.get('viewer')!.userId } : {}),
  });
  c.header('cache-control', PAGE_CACHE);
  const t = pageMessages(c);
  return c.html(
    <Layout meta={meta(c, t.latest.title, t.latest.description, [{ label: t.latest.title, kind: 'latest' }])}>
      <PageHeader title={t.latest.title} kind="latest">
        <span class="inline-flex items-center gap-0.5">
          {t.latest.lead(t.rules.name(RULESET_LABELS[ruleset] ?? ruleset))}
          <HelpTip topic="rows" label={t.latest.rowsLabel}>
            {t.latest.rowsHelp}
          </HelpTip>
        </span>
      </PageHeader>
      <Filters>
        <Toggle
          help="filters"
          label={t.filters.anonymous}
          description={t.filters.anonymousPlaysHelp}
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
        empty={includeAnonymous ? t.latest.empty : t.latest.emptyNamed}
        anonymousOnlyForOwner={!includeAnonymous}
      />
    </Layout>,
  );
}
