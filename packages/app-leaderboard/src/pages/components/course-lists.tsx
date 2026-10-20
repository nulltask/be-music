/** @jsxImportSource hono/jsx */
/**
 * The course lists: a course's ranking, the latest course runs, and one run's stages. They are laid out as the chart
 * lists are (lists.tsx), one compact row per entry, so a course reads like a chart wherever it appears.
 */
import type { CourseStageFigures } from '../../courses/figures.ts';
import type { CourseRankingEntry } from '../../courses/ranking.ts';
import type { RecentCourseRun } from '../../courses/runs.ts';
import { chartTitle, formatChartLevel, formatGauge, RULESET_LABELS } from '../format.ts';
import { useMessages } from '../i18n/index.ts';
import { ABOVE, Avatar, chartHref, courseHref, courseRunHref, Empty, LINK, playerHref, Tag } from './basics.tsx';
import { EntityIcon } from './entity-icon.tsx';
import { When } from './play-info.tsx';
import { AnonymousMark, LampBar, LampLabel, List, PrivacyBadge, Row, Score, wideOnly } from './lists.tsx';

/** A course's ranking under the display ruleset; a row opens the run that set the player's best EX-Score. */
export function CourseRankingList(props: { entries: CourseRankingEntry[]; highlight?: string }) {
  const t = useMessages();
  if (props.entries.length === 0) {
    return <Empty title={t.lists.nobody}>{t.lists.noMatch}</Empty>;
  }
  return (
    <List label={t.lists.ranking}>
      {props.entries.map((entry) => (
        <Row
          href={courseRunHref(entry.exScoreId)}
          label={t.lists.runOfPlayer(entry.displayName, entry.rank)}
          current={props.highlight === entry.handle}
          start={
            <span class="flex items-center gap-3">
              <span class="w-6 text-end font-semibold">{entry.rank}</span>
              <LampBar lamp={entry.clearLamp} />
              <Avatar src={entry.avatarUrl} size={32} />
            </span>
          }
          title={
            <>
              <a class={`${LINK} ${ABOVE} truncate`} href={playerHref(entry.handle)}>
                {entry.displayName}
              </a>
              {entry.anonymous ? <AnonymousMark /> : null}
            </>
          }
          details={[
            <LampLabel lamp={entry.clearLamp} />,
            <>BP {entry.missCount}</>,
            entry.trophy !== null ? <Tag>{entry.trophy}</Tag> : null,
            wideOnly(<>{t.count.plays(entry.playCount)}</>),
            <When at={entry.achievedAt} />,
          ]}
          end={<Score exScore={entry.exScore} noteCount={entry.noteCount} />}
        />
      ))}
    </List>
  );
}

/**
 * The latest course runs: which course, who, how it went under the display ruleset (lamp, BP, stages reached, trophy),
 * where it places on the course, and when. A row opens the run.
 */
export function CourseRunsList(props: {
  runs: RecentCourseRun[];
  showPlayer: boolean;
  empty: string;
  /** The list leaves anonymous players out, so an anonymous row is the viewer's own and only they see it. */
  anonymousOnlyForOwner?: boolean;
}) {
  const t = useMessages();
  if (props.runs.length === 0) {
    return <Empty title={t.lists.noRuns}>{props.empty}</Empty>;
  }
  return (
    <List label={t.lists.latestRuns}>
      {props.runs.map((run) => (
        <Row
          href={courseRunHref(run.id)}
          label={t.lists.runOfCourse(run.courseName, run.displayName)}
          start={
            <span class="flex items-center gap-3">
              <LampBar lamp={run.clearLamp} />
              {props.showPlayer ? <Avatar src={run.avatarUrl} size={32} /> : null}
            </span>
          }
          title={
            <>
              <a
                class={`${LINK} ${ABOVE} inline-flex min-w-0 items-center gap-1`}
                href={courseHref(run.courseFingerprint)}
              >
                <EntityIcon kind="course" size="sm" />
                <span class="truncate">{run.courseName}</span>
              </a>
              <PrivacyBadge
                hidden={run.hidden}
                onlyYou={t.lists.onlyYouRun}
                reasons={[
                  run.hidden ? t.visibility.reasonHidden : undefined,
                  run.anonymous && props.anonymousOnlyForOwner === true
                    ? t.visibility.sentences([t.visibility.reasonAnonymous, t.visibility.passkeyHint])
                    : undefined,
                ]}
              />
            </>
          }
          subtitle={
            props.showPlayer ? (
              <>
                <a class={`${ABOVE} truncate underline-offset-4 hover:underline`} href={playerHref(run.handle)}>
                  {run.displayName}
                </a>
                {run.anonymous ? <AnonymousMark /> : null}
              </>
            ) : undefined
          }
          details={[
            <span class="text-foreground/80 font-medium">{t.course.kinds[run.courseKind] ?? run.courseKind}</span>,
            props.showPlayer
              ? wideOnly(
                  <>
                    <a
                      class={`${ABOVE} text-foreground font-medium underline-offset-4 hover:underline`}
                      href={playerHref(run.handle)}
                    >
                      {run.displayName}
                    </a>
                    {run.anonymous ? <Tag>{t.lists.anonymous}</Tag> : null}
                  </>,
                )
              : null,
            <LampLabel lamp={run.clearLamp} />,
            <>BP {run.missCount}</>,
            run.stagesPlayed < run.stageCount ? <>{t.lists.stagesReached(run.stagesPlayed, run.stageCount)}</> : null,
            run.trophy !== null ? <Tag>{run.trophy}</Tag> : null,
            run.hidden ? null : (
              <span title={t.lists.rankAmongOnCourse(run.players)}>
                #{run.rank} / {run.players}
              </span>
            ),
            wideOnly(
              <span title={t.rules.playedWithTitle}>
                {t.rules.playedWith(t.rules.name(RULESET_LABELS[run.playedRuleset] ?? run.playedRuleset))}
              </span>,
            ),
            run.assisted ? <Tag>{t.lists.assist}</Tag> : null,
            <When at={run.createdAt} />,
          ]}
          end={<Score exScore={run.exScore} noteCount={run.noteCount} />}
        />
      ))}
    </List>
  );
}

/** A course stage as the course page and the run page name it: its chart, when the server has seen it played. */
export interface CourseStageChart {
  chartFingerprint: string;
  title: string | null;
  artist: string | null;
  playLevel: string | null;
  laneMode?: string | null;
}

/** The stage's chart title, linked to its page when the chart is known here; a short fingerprint otherwise. */
function StageTitle(props: { stage: CourseStageChart }) {
  const t = useMessages();
  if (props.stage.title === null) {
    return (
      <span class="inline-flex min-w-0 items-center gap-1" title={props.stage.chartFingerprint}>
        <EntityIcon kind="chart" size="sm" />
        <span class="text-muted-foreground truncate font-normal">{t.course.unknownChart}</span>
      </span>
    );
  }
  return (
    <a class={`${LINK} ${ABOVE} inline-flex min-w-0 items-center gap-1`} href={chartHref(props.stage.chartFingerprint)}>
      <EntityIcon kind="chart" size="sm" />
      <span class="truncate">{chartTitle(props.stage.title, props.stage.chartFingerprint)}</span>
    </a>
  );
}

const STAGE_JUDGES: Array<[string, string]> = [
  ['pgreat', 'PG'],
  ['great', 'GR'],
  ['good', 'GD'],
  ['bad', 'BD'],
  ['poor', 'PR'],
];

/**
 * The stages of a course, in order. With `figures` (one run's, under the display ruleset), each reached stage shows how
 * it went — its judgments, BP, the gauge it left — and the stages past `figures` are marked as never reached. Without
 * them (the course page), a row opens the stage's chart.
 */
export function CourseStagesList(props: { stages: CourseStageChart[]; figures?: CourseStageFigures[] }) {
  const t = useMessages();
  return (
    <List label={t.courseRun.stages}>
      {props.stages.map((stage, index) => {
        const figures = props.figures?.[index];
        const reached = props.figures === undefined || figures !== undefined;
        const level = formatChartLevel(stage.laneMode ?? null, stage.playLevel);
        return (
          <Row
            href={chartHref(stage.chartFingerprint)}
            label={t.course.stageLabel(index + 1)}
            start={
              <span class="flex items-center gap-3">
                <span class="w-6 text-end font-semibold">{index + 1}</span>
                {props.figures !== undefined ? (
                  // Cleared, failed, or (an outline only) never reached: every row keeps the bar, so titles line up.
                  <span
                    class={`ring-foreground/15 block h-8 w-1.5 rounded-full ring-1 ${figures === undefined ? '' : figures.cleared ? 'bg-sky-500' : 'bg-muted-foreground/35'}`}
                  />
                ) : null}
              </span>
            }
            title={<StageTitle stage={stage} />}
            details={[
              level !== undefined ? <span class="text-foreground/80 font-medium">{level}</span> : null,
              stage.artist !== null && stage.artist.length > 0 ? wideOnly(<>{stage.artist}</>) : null,
              ...(figures === undefined
                ? [reached ? null : <Tag>{t.courseRun.notReached}</Tag>]
                : [
                    wideOnly(
                      <span class="tabular-nums">
                        {STAGE_JUDGES.map(([key, label]) => `${label} ${figures.judges[key] ?? 0}`).join(' ')}
                      </span>,
                    ),
                    <>BP {figures.missCount}</>,
                    <>{formatGauge(figures.gaugeType, figures.gaugeFinal)}</>,
                  ]),
            ]}
            end={
              figures !== undefined ? (
                <Score exScore={figures.exScore} noteCount={figures.noteCount} />
              ) : (
                <span class="text-muted-foreground text-sm">{reached ? '' : '-'}</span>
              )
            }
          />
        );
      })}
    </List>
  );
}
