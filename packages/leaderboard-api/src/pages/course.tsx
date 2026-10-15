/** @jsxImportSource hono/jsx */
import { openDatabase } from '../db/client.ts';
import { loadCourseDetail } from '../courses/detail.ts';
import { countCoursePlayers, loadCourseRanking } from '../courses/ranking.ts';
import { isOn } from '../http/query.ts';
import { CourseRankingList, CourseStagesList } from './components/course-lists.tsx';
import { Details, DistributionCard, Stats } from './components/cards.tsx';
import { Filters, LocalTime, SectionHeading, Tag, Toggle } from './components/basics.tsx';
import { HelpTip } from './components/help-tip.tsx';
import { RULESET_LABELS } from './format.ts';
import { Layout, PageHeader } from './layout.tsx';
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
} from './page.tsx';
import { loadCourseStats } from './stats.ts';

/** A course's ranking under the display ruleset, its stages with links to their charts, its figures and details. */
export async function coursePage(c: PageContext<'/leaderboard/courses/:courseFingerprint'>) {
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
    <Layout
      meta={{
        ...meta(c, found.name, t.course.description(found.name, rules, ranking.players), [
          { label: found.name, kind: 'course' },
        ]),
        noindex: namedPlayers === 0,
      }}
    >
      <PageHeader kind="course" title={found.name}>
        {kind} · {t.course.stages(found.stages.length)} · {t.count.players(ranking.players)}
      </PageHeader>
      <Stats
        items={[
          [t.course.stats.players, stats.players],
          [t.course.stats.runs, stats.plays],
          [t.course.stats.firstRun, day(stats.firstPlayedAt)],
          [t.course.stats.lastRun, day(stats.lastPlayedAt)],
        ]}
      />
      <section class="space-y-3" aria-labelledby="ranking">
        <SectionHeading id="ranking" note={t.count.players(ranking.players)}>
          <span class="inline-flex items-center gap-0.5">
            {t.course.ranking}
            <HelpTip topic="rows" label={t.course.ranking}>
              {t.course.rankingHelp}
            </HelpTip>
          </span>
        </SectionHeading>
        <Filters>
          <Toggle
            help="filters"
            label={t.filters.assisted}
            description={t.filters.assistedHelp}
            on={assisted}
            href={withQuery(c, 'assisted', assisted ? undefined : '1')}
          />
          <Toggle
            help="filters"
            label={t.filters.anonymous}
            description={t.filters.anonymousHelp}
            on={includeAnonymous}
            href={withQuery(c, 'anonymous', includeAnonymous ? undefined : '1')}
          />
        </Filters>
        <CourseRankingList entries={ranking.entries} highlight={c.get('viewer')?.handle} />
      </section>
      <section class="space-y-3" aria-labelledby="stages">
        <SectionHeading id="stages" note={t.course.stages(found.stages.length)}>
          {t.course.stageList}
        </SectionHeading>
        <p class="text-muted-foreground text-sm">{t.course.stageListLead}</p>
        <CourseStagesList stages={found.stages} />
      </section>
      <DistributionCard
        title={t.course.clearLamps}
        description={t.course.clearLampsLead(rules)}
        distribution={stats.lamps}
        kind="lamp"
      />
      <Details
        title={t.course.details}
        rows={[
          [t.course.rows.kind, kind],
          [
            t.course.rows.constraints,
            found.constraints.length === 0 ? (
              t.course.noConstraints
            ) : (
              <span class="inline-flex flex-wrap gap-1">
                {found.constraints.map((constraint) => (
                  <Tag>{constraint}</Tag>
                ))}
              </span>
            ),
          ],
          [t.course.rows.stages, found.stages.length],
          [t.course.rows.fingerprint, <span class="font-mono text-xs break-all">{courseFingerprint}</span>],
          [t.course.rows.firstRun, <LocalTime at={found.createdAt} />],
        ]}
      />
    </Layout>,
  );
}
