import { html, renderHTML } from '@be-music/service-web-theme/server';
import { HelpTip } from './components/help-tip.ts';
import { openDatabase } from '../db/client.ts';
import { RecentScoresList } from './components/lists.ts';
import { CourseRunsList } from './components/course-lists.ts';
import { loadRecentCourseRuns } from '../courses/runs.ts';
import { Details, DistributionCard, JudgeTotalsCard, Stats } from './components/cards.ts';
import { Avatar, LocalTime, SectionHeading, Tag } from './components/basics.ts';
import { loadPlayer, loadRecentScores } from './data.ts';
import { formatPercent, formatPlayTime, RULESET_LABELS } from './format.ts';
import { Layout, PageHeader } from './layout.ts';
import {
  day,
  displayRuleset,
  meta,
  notFound,
  PAGE_CACHE,
  pageMessages,
  RECENT_LIMIT,
  when,
  type PageContext,
} from './page.ts';
import { loadPlayerStats } from './stats.ts';
import { resolveFormerHandle } from '../profiles.ts';
import { movedTo } from './avatar.ts';

/** A player's figures and newest plays. */
export async function playerPage(c: PageContext<'/players/:handle'>) {
  const messages = pageMessages(c);
  const db = openDatabase(c.env.DB);
  const player = await loadPlayer(db, c.req.param('handle'));
  if (player === undefined) {
    // A handle the player has since changed: send old links to the current page.
    const current = await resolveFormerHandle(db, c.req.param('handle'));
    if (current !== undefined) return c.redirect(movedTo(c.req.url, c.req.param('handle'), current), 301);
    return notFound(c, 'player');
  }
  const ruleset = displayRuleset(c);
  const owner = c.get('viewer')?.handle === player.handle ? { ownerUserId: c.get('viewer')!.userId } : {};
  const [stats, scores, runs] = await Promise.all([
    loadPlayerStats(db, player.userId, ruleset),
    loadRecentScores(db, {
      limit: RECENT_LIMIT,
      ruleset,
      includeAnonymous: true,
      // Plays of charts not listed yet show only on the player's own page, to them.
      includeUnlisted: false,
      ...owner,
      handle: player.handle,
    }),
    // Their course runs, the hidden ones only to them.
    loadRecentCourseRuns(db, { limit: RECENT_LIMIT, ruleset, includeAnonymous: true, ...owner, handle: player.handle }),
  ]);
  c.header('cache-control', PAGE_CACHE);
  const t = pageMessages(c);
  const label = (id: string) => t.rules.name(RULESET_LABELS[id] ?? id);
  const rules = label(ruleset);
  return c.html(
    renderHTML(
      Layout({
        meta: meta(c, player.displayName, t.player.description(player.displayName, player.handle), [
          { label: player.displayName, kind: 'player' },
        ]),
        children: html`${PageHeader({
            title: html`<span class="inline-flex items-center gap-3"
              >${Avatar({ src: player.avatarUrl, size: 40 })}${player.displayName}</span
            >`,
            children: html`@${player.handle}${player.anonymous ? Tag({ children: html`${t.lists.anonymous}` }) : null}`,
          })}${Stats({
            items: [
              [t.player.stats.plays, stats.plays],
              [t.player.stats.charts, stats.charts],
              [t.player.stats.playTime, formatPlayTime(stats.playTimeMs, t.duration)],
              [t.player.stats.notes, stats.notes.toLocaleString('en-US')],
              [t.player.stats.averageRate, formatPercent(stats.averageRate)],
              [t.player.stats.lastPlayed, day(stats.lastPlayedAt)],
            ],
          })}${JudgeTotalsCard({ judges: stats.judges, ruleset: rules }, messages)}
          <div class="grid gap-6 lg:grid-cols-2">
            ${DistributionCard(
              {
                title: t.player.clearLamps,
                description: t.player.clearLampsLead(rules),
                distribution: stats.lamps,
                kind: 'lamp',
                showEmpty: true,
              },
              messages,
            )}${DistributionCard(
              {
                title: t.player.djRanks,
                description: t.player.djRanksLead(rules),
                distribution: stats.djRanks,
                kind: 'dj-rank',
                showEmpty: true,
              },
              messages,
            )}
          </div>
          ${Details({
            title: t.player.details,
            rows: [
              [t.player.joined, LocalTime({ at: player.joinedAt })],
              [t.player.firstPlay, when(stats.firstPlayedAt)],
              [
                html`<span class="inline-flex items-center gap-0.5"
                  >${t.player.playedUnder}${HelpTip(
                    { topic: 'rules', label: t.player.playedUnder, children: html`${t.player.playedUnderHelp}` },
                    messages,
                  )}</span
                >`,
                stats.playsByRuleset.length === 0
                  ? '-'
                  : stats.playsByRuleset
                      .map((entry) => t.player.playsUnder(label(entry.ruleset), entry.count))
                      .join(' · '),
              ],
            ],
          })}
          <section class="space-y-3" aria-labelledby="latest-plays">
            ${SectionHeading({ id: 'latest-plays', children: html`${t.player.latestPlays}` })}${RecentScoresList(
              {
                scores: scores,
                infos: new Map(scores.map((entry) => [entry.scoreId, entry.info])),
                showPlayer: false,
                empty: t.player.empty,
              },
              messages,
            )}
          </section>
          ${
            runs.length > 0
              ? html`<section class="space-y-3" aria-labelledby="latest-runs">
                  ${SectionHeading({ id: 'latest-runs', children: html`${t.player.latestRuns}` })}${CourseRunsList(
                    { runs: runs, showPlayer: false, empty: '' },
                    messages,
                  )}
                </section>`
              : null
          }`,
      }),
    ),
  );
}
