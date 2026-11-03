import { html, nothing } from '@be-music/service-web-theme/server';
/**
 * The course lists: a course's ranking, the latest course runs, and one run's stages. They are laid out as the chart
 * lists are (lists.ts), one compact row per entry, so a course reads like a chart wherever it appears.
 */
import type { CourseStageFigures } from '../../courses/figures.ts';
import type { CourseRankingEntry } from '../../courses/ranking.ts';
import type { RecentCourseRun } from '../../courses/runs.ts';
import { chartTitle, formatChartLevel, formatGauge, RULESET_LABELS } from '../format.ts';
import { type Messages } from '../i18n/index.ts';
import { ABOVE, Avatar, chartHref, courseHref, courseRunHref, Empty, LINK, playerHref, Tag } from './basics.ts';
import { EntityIcon } from './entity-icon.ts';
import { When } from './play-info.ts';
import { AnonymousMark, LampBar, LampLabel, List, PrivacyBadge, Row, Score, wideOnly } from './lists.ts';

/** A course's ranking under the display ruleset; a row opens the run that set the player's best EX-Score. */
export function CourseRankingList(props: { entries: CourseRankingEntry[]; highlight?: string }, messages: Messages) {
  const t = messages;
  if (props.entries.length === 0) {
    return Empty({ title: t.lists.nobody, children: html`${t.lists.noMatch}` });
  }
  return List({
    label: t.lists.ranking,
    children: html`${props.entries.map((entry) =>
      Row(
        {
          href: courseRunHref(entry.exScoreId),
          label: t.lists.runOfPlayer(entry.displayName, entry.rank),
          current: props.highlight === entry.handle,
          start: html`<span class="flex items-center gap-3"
            ><span class="w-6 text-end font-semibold">${entry.rank}</span>${LampBar(
              { lamp: entry.clearLamp },
              messages,
            )}${Avatar({ src: entry.avatarUrl, size: 32 })}</span
          >`,
          title: html`<a class=${`${LINK} ${ABOVE} truncate`} href=${playerHref(entry.handle) ?? nothing}
              >${entry.displayName}</a
            >${entry.anonymous ? AnonymousMark(messages) : null}`,
          details: [
            LampLabel({ lamp: entry.clearLamp }, messages),
            html`BP ${entry.missCount}`,
            entry.trophy !== null ? Tag({ children: html`${entry.trophy}` }) : null,
            wideOnly(html`${t.count.plays(entry.playCount)}`),
            When({ at: entry.achievedAt }),
          ],
          end: Score({ exScore: entry.exScore, noteCount: entry.noteCount }, messages),
        },
        messages,
      ),
    )}`,
  });
}

/**
 * The latest course runs: which course, who, how it went under the display ruleset (lamp, BP, stages reached, trophy),
 * where it places on the course, and when. A row opens the run.
 */
export function CourseRunsList(
  props: {
    runs: RecentCourseRun[];
    showPlayer: boolean;
    empty: string;
    /** The list leaves anonymous players out, so an anonymous row is the viewer's own and only they see it. */
    anonymousOnlyForOwner?: boolean;
  },
  messages: Messages,
) {
  const t = messages;
  if (props.runs.length === 0) {
    return Empty({ title: t.lists.noRuns, children: html`${props.empty}` });
  }
  return List({
    label: t.lists.latestRuns,
    children: html`${props.runs.map((run) =>
      Row(
        {
          href: courseRunHref(run.id),
          label: t.lists.runOfCourse(run.courseName, run.displayName),
          start: html`<span class="flex items-center gap-3"
            >${LampBar(
              { lamp: run.clearLamp },
              messages,
            )}${props.showPlayer ? Avatar({ src: run.avatarUrl, size: 32 }) : null}</span
          >`,
          title: html`<a
              class=${`${LINK} ${ABOVE} inline-flex min-w-0 items-center gap-1`}
              href=${courseHref(run.courseFingerprint) ?? nothing}
              >${EntityIcon({ kind: 'course', size: 'sm' })}<span class="truncate">${run.courseName}</span></a
            >${PrivacyBadge(
              {
                hidden: run.hidden,
                onlyYou: t.lists.onlyYouRun,
                reasons: [
                  run.hidden ? t.visibility.reasonHidden : undefined,
                  run.anonymous && props.anonymousOnlyForOwner === true
                    ? t.visibility.sentences([t.visibility.reasonAnonymous, t.visibility.passkeyHint])
                    : undefined,
                ],
              },
              messages,
            )}`,
          subtitle: props.showPlayer
            ? html`<a
                  class=${`${ABOVE} truncate underline-offset-4 hover:underline`}
                  href=${playerHref(run.handle) ?? nothing}
                  >${run.displayName}</a
                >${run.anonymous ? AnonymousMark(messages) : null}`
            : undefined,
          details: [
            html`<span class="text-foreground/80 font-medium"
              >${t.course.kinds[run.courseKind] ?? run.courseKind}</span
            >`,
            props.showPlayer
              ? wideOnly(
                  html`<a
                      class=${`${ABOVE} text-foreground font-medium underline-offset-4 hover:underline`}
                      href=${playerHref(run.handle) ?? nothing}
                      >${run.displayName}</a
                    >${run.anonymous ? Tag({ children: html`${t.lists.anonymous}` }) : null}`,
                )
              : null,
            LampLabel({ lamp: run.clearLamp }, messages),
            html`BP ${run.missCount}`,
            run.stagesPlayed < run.stageCount ? html`${t.lists.stagesReached(run.stagesPlayed, run.stageCount)}` : null,
            run.trophy !== null ? Tag({ children: html`${run.trophy}` }) : null,
            run.hidden
              ? null
              : html`<span title=${t.lists.rankAmongOnCourse(run.players) ?? nothing}
                  >#${run.rank} / ${run.players}</span
                >`,
            wideOnly(
              html`<span title=${t.rules.playedWithTitle ?? nothing}
                >${t.rules.playedWith(t.rules.name(RULESET_LABELS[run.playedRuleset] ?? run.playedRuleset))}</span
              >`,
            ),
            run.assisted ? Tag({ children: html`${t.lists.assist}` }) : null,
            When({ at: run.createdAt }),
          ],
          end: Score({ exScore: run.exScore, noteCount: run.noteCount }, messages),
        },
        messages,
      ),
    )}`,
  });
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
function StageTitle(props: { stage: CourseStageChart }, messages: Messages) {
  const t = messages;
  if (props.stage.title === null) {
    return html`<span class="inline-flex min-w-0 items-center gap-1" title=${props.stage.chartFingerprint ?? nothing}
      >${EntityIcon({ kind: 'chart', size: 'sm' })}<span class="text-muted-foreground truncate font-normal"
        >${t.course.unknownChart}</span
      ></span
    >`;
  }
  return html`<a
    class=${`${LINK} ${ABOVE} inline-flex min-w-0 items-center gap-1`}
    href=${chartHref(props.stage.chartFingerprint) ?? nothing}
    >${EntityIcon({ kind: 'chart', size: 'sm' })}<span class="truncate"
      >${chartTitle(props.stage.title, props.stage.chartFingerprint)}</span
    ></a
  >`;
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
export function CourseStagesList(
  props: { stages: CourseStageChart[]; figures?: CourseStageFigures[] },
  messages: Messages,
) {
  const t = messages;
  return List({
    label: t.courseRun.stages,
    children: html`${props.stages.map((stage, index) => {
      const figures = props.figures?.[index];
      const reached = props.figures === undefined || figures !== undefined;
      const level = formatChartLevel(stage.laneMode ?? null, stage.playLevel);
      return Row(
        {
          href: chartHref(stage.chartFingerprint),
          label: t.course.stageLabel(index + 1),
          start: html`<span class="flex items-center gap-3"
            ><span class="w-6 text-end font-semibold">${index + 1}</span>${
              props.figures !== undefined
                ? // Cleared, failed, or (an outline only) never reached: every row keeps the bar, so titles line up.
                  html`<span
                    class=${`ring-foreground/15 block h-8 w-1.5 rounded-full ring-1 ${figures === undefined ? '' : figures.cleared ? 'bg-sky-500' : 'bg-muted-foreground/35'}`}
                  ></span>`
                : null
            }</span
          >`,
          title: StageTitle({ stage: stage }, messages),
          details: [
            level !== undefined ? html`<span class="text-foreground/80 font-medium">${level}</span>` : null,
            stage.artist !== null && stage.artist.length > 0 ? wideOnly(html`${stage.artist}`) : null,
            ...(figures === undefined
              ? [reached ? null : Tag({ children: html`${t.courseRun.notReached}` })]
              : [
                  wideOnly(
                    html`<span class="tabular-nums"
                      >${STAGE_JUDGES.map(([key, label]) => `${label} ${figures.judges[key] ?? 0}`).join(' ')}</span
                    >`,
                  ),
                  html`BP ${figures.missCount}`,
                  html`${formatGauge(figures.gaugeType, figures.gaugeFinal)}`,
                ]),
          ],
          end:
            figures !== undefined
              ? Score({ exScore: figures.exScore, noteCount: figures.noteCount }, messages)
              : html`<span class="text-muted-foreground text-sm">${reached ? '' : '-'}</span>`,
        },
        messages,
      );
    })}`,
  });
}
