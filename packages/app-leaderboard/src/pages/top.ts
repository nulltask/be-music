import { html, renderHTML } from '@be-music/service-web-theme/server';
import { HelpTip } from './components/help-tip.ts';
import { openDatabase } from '../db/client.ts';
import { isOn } from '../http/query.ts';
import { RecentScoresList } from './components/lists.ts';
import { CourseRunsList } from './components/course-lists.ts';
import { Filters, SectionHeading, Toggle } from './components/basics.ts';
import { loadRecentCourseRuns } from '../courses/runs.ts';
import { loadRecentScores } from './data.ts';
import { RULESET_LABELS } from './format.ts';
import { Layout, PageHeader } from './layout.ts';
import { displayRuleset, meta, PAGE_CACHE, pageMessages, RECENT_LIMIT, withQuery, type PageContext } from './page.ts';

/** Course runs the top page lists below the plays: courses are run far less often than charts are played. */
const COURSE_RUNS_LIMIT = 10;

/**
 * Latest: every play by a player who is not anonymous, on any chart; a chart not listed yet carries a "new chart"
 * tag. Anonymous plays come in on request. The newest course runs follow, under the same rules. An invented chart can reach this page only through an account with a
 * passkey, and the chart index (later) still lists charts by the two-player rule.
 */
export async function topPage(c: PageContext) {
  const messages = pageMessages(c);
  const includeAnonymous = isOn(c.req.query('anonymous'));
  const ruleset = displayRuleset(c);
  const db = openDatabase(c.env.DB);
  const owner = c.get('viewer') !== null ? { ownerUserId: c.get('viewer')!.userId } : {};
  const [scores, runs] = await Promise.all([
    loadRecentScores(db, {
      limit: RECENT_LIMIT,
      ruleset,
      includeAnonymous,
      // Charts not listed yet stay out, except the viewer's own plays of them.
      includeUnlisted: false,
      ...owner,
    }),
    loadRecentCourseRuns(db, { limit: COURSE_RUNS_LIMIT, ruleset, includeAnonymous, ...owner }),
  ]);
  c.header('cache-control', PAGE_CACHE);
  const t = pageMessages(c);
  return c.html(
    renderHTML(
      Layout({
        meta: meta(c, t.latest.title, t.latest.description),
        children: html`${PageHeader({
          title: t.latest.title,
          kind: 'latest',
          children: html`<span class="inline-flex items-center gap-0.5"
            >${t.latest.lead(t.rules.name(RULESET_LABELS[ruleset] ?? ruleset))}${HelpTip(
              { topic: 'rows', label: t.latest.rowsLabel, children: html`${t.latest.rowsHelp}` },
              messages,
            )}</span
          >`,
        })}${Filters({
          children: html`${Toggle(
            {
              help: 'filters',
              label: t.filters.anonymous,
              description: t.filters.anonymousPlaysHelp,
              on: includeAnonymous,
              href: withQuery(c, 'anonymous', includeAnonymous ? undefined : '1'),
            },
            messages,
          )}`,
        })}${RecentScoresList(
          {
            scores: scores,
            infos: new Map(scores.map((entry) => [entry.scoreId, entry.info])),
            showPlayer: true,
            empty: includeAnonymous ? t.latest.empty : t.latest.emptyNamed,
            anonymousOnlyForOwner: !includeAnonymous,
          },
          messages,
        )}${
          runs.length > 0
            ? html`<section class="space-y-3" aria-labelledby="latest-runs">
                ${SectionHeading({
                  id: 'latest-runs',
                  note: t.latest.runsLead(t.rules.name(RULESET_LABELS[ruleset] ?? ruleset)),
                  children: html`${t.latest.runs}`,
                })}${CourseRunsList(
                  { runs: runs, showPlayer: true, empty: '', anonymousOnlyForOwner: !includeAnonymous },
                  messages,
                )}
              </section>`
            : null
        }`,
      }),
    ),
  );
}
