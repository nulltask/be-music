/** @jsxImportSource hono/jsx */
import { openDatabase } from '../db/client.ts';
import { loadCourseDetail } from '../courses/detail.ts';
import { toPlayInfo } from '../play-info.ts';
import { CourseStagesList } from './components/course-lists.tsx';
import { Details } from './components/cards.tsx';
import { EntityIcon } from './components/entity-icon.tsx';
import { courseHref, LocalTime, playerHref, SectionHeading, Tag } from './components/basics.tsx';
import { HelpTip } from './components/help-tip.tsx';
import { ResultCards } from './components/lists.tsx';
import { pickPlayInfoRows } from './components/play-info.tsx';
import { loadCourseRun } from './data.ts';
import { RULESET_LABELS, rulesetName } from './format.ts';
import { helpHref } from './help-topics.ts';
import { useMessages } from './i18n/index.ts';
import { Layout, PageHeader } from './layout.tsx';
import { displayRuleset, meta, notFound, PAGE_CACHE, pageMessages, type PageContext } from './page.tsx';

/** The run's own player hides it, or shows it again (wired by the client script's `hide-score` / `show-score`). */
function RunVisibilityCard(props: { courseScoreId: string; hidden: boolean }) {
  const t = useMessages().courseRun;
  return (
    <section class="card gap-4" data-size="sm">
      <header>
        <h2>{t.visibility}</h2>
        <p>{props.hidden ? t.visibilityHiddenLead : t.visibilityShownLead}</p>
      </header>
      <div class="space-y-3 px-4">
        <button
          type="button"
          class="btn"
          data-variant="outline"
          data-account-action={props.hidden ? 'show-score' : 'hide-score'}
          data-course-score-id={props.courseScoreId}
        >
          {props.hidden ? t.show : t.hide}
        </button>
        <p class="text-destructive text-sm" data-visibility-status role="status" hidden />
      </div>
    </section>
  );
}

/** One course run under every ruleset, broken down by stage under the display ruleset, with how it was played. */
export async function courseRunPage(c: PageContext<'/course-scores/:id'>) {
  const db = openDatabase(c.env.DB);
  const found = await loadCourseRun(db, c.req.param('id'));
  const viewer = c.get('viewer');
  const isOwner = viewer !== null && viewer.userId === found?.run.userId;
  // A hidden run is its player's alone: to anyone else it does not exist.
  if (found === undefined || found.player === null || (found.run.hidden && !isOwner)) return notFound(c, 'score');
  const course = await loadCourseDetail(db, found.run.courseFingerprint);
  if (course === undefined) return notFound(c, 'score');
  const { run, player } = found;
  const ruleset = displayRuleset(c);
  const t = pageMessages(c);
  const rules = t.rules.name(RULESET_LABELS[ruleset] ?? ruleset);
  const shown = found.results.find((result) => result.ruleset === ruleset);
  const played = found.results.find((result) => result.ruleset === run.playedRuleset);
  const description =
    played !== undefined
      ? `${player.displayName} · ${course.name} · EX ${played.exScore} (${rulesetName(played.ruleset)})`
      : `${player.displayName} · ${course.name}`;
  const info = toPlayInfo({
    scoreId: run.id,
    createdAt: run.createdAt,
    playedRuleset: run.playedRuleset,
    gauge: run.gauge,
    assistFlags: run.assistFlags,
    laneOption: null,
    durationMs: null,
    verification: run.verification,
    recordedBy: run.recordedBy,
    submittedBy: run.submittedBy,
    serverEngine: run.serverEngine,
  });
  c.header('cache-control', PAGE_CACHE);
  return c.html(
    <Layout
      meta={{
        ...meta(c, `${course.name} — ${player.displayName}`, description, [
          { label: course.name, href: courseHref(course.courseFingerprint), kind: 'course' },
          { label: t.courseRun.crumb(player.displayName), kind: 'score' },
        ]),
        // A hidden run stays out of search engines, and so does an anonymous one.
        noindex: run.hidden || player.anonymous,
      }}
    >
      <PageHeader
        kind="score"
        title={
          <a class="underline-offset-4 hover:underline" href={courseHref(course.courseFingerprint)}>
            {course.name}
          </a>
        }
      >
        {t.course.kinds[course.kind] ?? course.kind} · {t.courseRun.runBy}{' '}
        <a class="text-foreground font-medium underline-offset-4 hover:underline" href={playerHref(player.handle)}>
          {player.displayName}
        </a>
        {player.anonymous ? <Tag>{t.lists.anonymous}</Tag> : null}
      </PageHeader>
      {run.hidden ? (
        <div class="alert" role="note">
          <h2>{t.courseRun.hiddenTitle}</h2>
          <section>{t.courseRun.hiddenLead}</section>
        </div>
      ) : player.anonymous ? (
        <div class="alert" role="note">
          <h2>{t.courseRun.notPublicTitle}</h2>
          <section>
            <p>{t.visibility.lead}</p>
            <ul class="mt-1 list-disc space-y-0.5 ps-5">
              <li>
                {isOwner
                  ? t.visibility.sentences([t.visibility.reasonAnonymous, t.visibility.passkeyHint])
                  : t.visibility.reasonAnonymous}
              </li>
            </ul>
            <a class="mt-1 inline-block underline underline-offset-4" href={helpHref('visibility')}>
              {t.help.more}
            </a>
          </section>
        </div>
      ) : null}
      <ResultCards
        results={found.results}
        stageCount={course.stages.length}
        playedRuleset={run.playedRuleset}
        displayRuleset={ruleset}
      />
      <section class="space-y-3" aria-labelledby="stages">
        <SectionHeading id="stages" note={t.course.stages(course.stages.length)}>
          {t.courseRun.stages}
        </SectionHeading>
        <p class="text-muted-foreground text-sm">
          {shown?.stages === null || shown?.stages === undefined
            ? t.courseRun.noBreakdown
            : t.courseRun.stagesLead(rules)}
        </p>
        <CourseStagesList stages={course.stages} figures={shown?.stages ?? undefined} />
      </section>
      <Details
        title={t.courseRun.details}
        rows={[
          [t.score.played, <LocalTime at={run.createdAt.getTime()} />],
          ...pickPlayInfoRows(info, t, ['playedUnder']),
          [
            <span class="inline-flex items-center gap-0.5">
              {t.score.gauge}
              <HelpTip topic="gauges" label={t.score.gauge}>
                {t.score.gaugeHelp}
              </HelpTip>
            </span>,
            run.gauge,
          ],
          [t.score.assists, run.assisted ? run.assistFlags.join(', ') : t.score.none],
          [
            <span class="inline-flex items-center gap-0.5">
              {t.score.verification}
              <HelpTip topic="verification" label={t.score.verification}>
                {t.score.verificationHelp}
              </HelpTip>
            </span>,
            t.playInfo.verification[run.verification] ?? run.verification,
          ],
          ...pickPlayInfoRows(info, t, ['app', 'sentFrom', 'scoredBy']),
          [
            t.courseRun.course,
            <a
              class="inline-flex items-center gap-1 underline-offset-4 hover:underline"
              href={courseHref(course.courseFingerprint)}
            >
              <EntityIcon kind="course" size="sm" />
              {course.name}
            </a>,
          ],
          [t.course.rows.fingerprint, <span class="font-mono text-xs break-all">{course.courseFingerprint}</span>],
          [
            t.courseRun.playLog,
            <a
              class="underline-offset-4 hover:underline"
              href={`/api/v0/course-scores/${encodeURIComponent(run.id)}/playlog`}
              download
            >
              {t.courseRun.downloadPlayLog}
            </a>,
          ],
        ]}
      />
      {isOwner ? <RunVisibilityCard courseScoreId={run.id} hidden={run.hidden} /> : null}
    </Layout>,
  );
}
