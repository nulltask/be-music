import { html, renderHTML } from '@be-music/service-web-theme/server';
import { openDatabase } from '../db/client.ts';
import { loadCourseDetail } from '../courses/detail.ts';
import { countCoursePlayers, loadCourseRanking } from '../courses/ranking.ts';
import { isOn } from '../http/query.ts';
import { CourseRankingList, CourseStagesList } from './components/course-lists.ts';
import { Details, DistributionCard, Stats } from './components/cards.ts';
import { Filters, LocalTime, SectionHeading, Tag, Toggle } from './components/basics.ts';
import { HelpTip } from './components/help-tip.ts';
import { RULESET_LABELS } from './format.ts';
import { Layout, PageHeader } from './layout.ts';
import {
  day,
  displayRuleset,
  meta,
  notFound,
  PAGE_CACHE,
  pageMessages,
  RANKING_LIMIT,
  withQuery,
  type PageContext,
} from './page.ts';
import { loadCourseStats } from './stats.ts';

/** A course's ranking under the display ruleset, its stages with links to their charts, its figures and details. */
export async function coursePage(c: PageContext<'/courses/:courseFingerprint'>) {
  const messages = pageMessages(c);
  const db = openDatabase(c.env.DB);
  const courseFingerprint = c.req.param('courseFingerprint');
  const found = await loadCourseDetail(db, courseFingerprint);
  if (found === undefined) return notFound(c, 'course');
  const ruleset = displayRuleset(c);
  const assisted = isOn(c.req.query('assisted'));
  const includeAnonymous = isOn(c.req.query('anonymous'));
  const filter = { courseFingerprint, ruleset, assisted, includeAnonymous, playedHereOnly: false };
  const [ranking, stats, named] = await Promise.all([
    loadCourseRanking(db, filter, { offset: 0, limit: RANKING_LIMIT }),
    loadCourseStats(db, filter),
    // Players with an account: a course none of them ran stays out of search engines, as a chart not listed yet does.
    includeAnonymous ? countCoursePlayers(db, { ...filter, includeAnonymous: false }) : undefined,
  ]);
  const namedPlayers = named ?? ranking.players;
  c.header('cache-control', PAGE_CACHE);
  const t = pageMessages(c);
  const rules = t.rules.name(RULESET_LABELS[ruleset] ?? ruleset);
  const kind = t.course.kinds[found.kind] ?? found.kind;
  return c.html(
    renderHTML(
      Layout({
        meta: {
          ...meta(c, found.name, t.course.description(found.name, rules, ranking.players), [
            { label: found.name, kind: 'course' },
          ]),
          noindex: namedPlayers === 0,
        },
        children: html`${PageHeader({
            kind: 'course',
            title: found.name,
            children: html`${kind} · ${t.course.stages(found.stages.length)} · ${t.count.players(ranking.players)}`,
          })}${Stats({
            items: [
              [t.course.stats.players, stats.players],
              [t.course.stats.runs, stats.plays],
              [t.course.stats.firstRun, day(stats.firstPlayedAt)],
              [t.course.stats.lastRun, day(stats.lastPlayedAt)],
            ],
          })}
          <section class="space-y-3" aria-labelledby="ranking">
            ${SectionHeading({
              id: 'ranking',
              note: t.count.players(ranking.players),
              children: html`<span class="inline-flex items-center gap-0.5"
                >${t.course.ranking}${HelpTip(
                  { topic: 'rows', label: t.course.ranking, children: html`${t.course.rankingHelp}` },
                  messages,
                )}</span
              >`,
            })}${Filters({
              children: html`${Toggle(
                {
                  help: 'filters',
                  label: t.filters.assisted,
                  description: t.filters.assistedHelp,
                  on: assisted,
                  href: withQuery(c, 'assisted', assisted ? undefined : '1'),
                },
                messages,
              )}${Toggle(
                {
                  help: 'filters',
                  label: t.filters.anonymous,
                  description: t.filters.anonymousHelp,
                  on: includeAnonymous,
                  href: withQuery(c, 'anonymous', includeAnonymous ? undefined : '1'),
                },
                messages,
              )}`,
            })}${CourseRankingList({ entries: ranking.entries, highlight: c.get('viewer')?.handle }, messages)}
          </section>
          <section class="space-y-3" aria-labelledby="stages">
            ${SectionHeading({
              id: 'stages',
              note: t.course.stages(found.stages.length),
              children: html`${t.course.stageList}`,
            })}
            <p class="text-muted-foreground text-sm">${t.course.stageListLead}</p>
            ${CourseStagesList({ stages: found.stages }, messages)}
          </section>
          ${DistributionCard(
            {
              title: t.course.clearLamps,
              description: t.course.clearLampsLead(rules),
              distribution: stats.lamps,
              kind: 'lamp',
            },
            messages,
          )}${Details({
            title: t.course.details,
            rows: [
              [t.course.rows.kind, kind],
              [
                t.course.rows.constraints,
                found.constraints.length === 0
                  ? t.course.noConstraints
                  : html`<span class="inline-flex flex-wrap gap-1"
                      >${found.constraints.map((constraint) => Tag({ children: html`${constraint}` }))}</span
                    >`,
              ],
              [t.course.rows.stages, found.stages.length],
              [t.course.rows.fingerprint, html`<span class="font-mono text-xs break-all">${courseFingerprint}</span>`],
              [t.course.rows.firstRun, LocalTime({ at: found.createdAt })],
            ],
          })}`,
      }),
    ),
  );
}
