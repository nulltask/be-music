import type { PageContent } from '../template.ts';
import { html, nothing } from '@be-music/service-web-theme/server';
/**
 * The Leaderboard's lists: a chart's ranking, the latest plays, a chartset's charts, one play under every ruleset.
 *
 * Each row is one line of a compact list rather than a table row, so nothing wraps into columns or scrolls sideways on
 * a phone. Every row keeps one layout: what it is at the start (rank, lamp colour), who or what in the middle with its
 * details on a second, smaller line, and the score at the end, aligned on its digits. The list is a size container:
 * where it is narrow (a phone), the details line runs on under the score too, so it keeps most of the row's width.
 */
import type { RankingEntry } from '../../ranking.ts';
import { byRulesetOrder } from '../../rulesets.ts';
import type { ChartsetChart, PlayInfo, RecentScore } from '../data.ts';
import {
  chartTitle,
  difficultyName,
  djLevel,
  formatChartLevel,
  formatDelta,
  formatGauge,
  formatLaneMode,
  formatScoreRate,
  lampStyle,
  RULESET_LABELS,
  showsGauge,
} from '../format.ts';
import { ABOVE, Avatar, chartHref, Empty, LINK, playerHref, RowLink, scoreHref, Tag } from './basics.ts';
import { EntityIcon } from './entity-icon.ts';
import { HelpTip } from './help-tip.ts';
import { InfoButton, When } from './play-info.ts';
import { type Messages } from '../i18n/index.ts';

/**
 * A detail only a wide row shows. A narrow row keeps its details line to what tells the plays apart (who, the lamp, the
 * misses, the place, when); the rest (the rules it was played under, the gauge, the lane option) is on the play's page,
 * which a tap on the row opens.
 */
interface WideOnly {
  wideOnly: PageContent;
}

export const wideOnly = (child: PageContent): WideOnly => ({ wideOnly: child });

const isWideOnly = (item: unknown): item is WideOnly => typeof item === 'object' && item !== null && 'wideOnly' in item;

const shown = (item: PageContent): boolean => item !== null && item !== false && item !== undefined;

/** The frame of a list: a card whose rows are split by hairlines, and the container its rows lay out against. */
export function List(props: { label: string; children: PageContent }) {
  return html`<ol
    class="card divide-border @container gap-0 divide-y overflow-hidden py-0"
    aria-label=${props.label ?? nothing}
  >
    ${props.children}
  </ol>`;
}

/** A details-line item and the separator after it (its `content` set where one is due). */
const DETAIL =
  "items-center gap-1 after:ms-1 after:text-muted-foreground/60 @xl:[&:not(:last-child)]:after:content-['·']";

/**
 * One row: a fixed start column, the main text (title over details), the score, and, for a play in a wide list, its
 * info icon in a column of its own at the end, so the icons line up down the list whatever the details say.
 *
 * In a wide list the score and the icon stand beside both lines. In a narrow one (under `@xl`, 36rem) the row reads in
 * three steps: the title beside the score, the `subtitle` (who played it) beside the DJ LEVEL and rate, and the details,
 * small and muted, spanning to the row's end beneath them instead of wrapping down a column squeezed between the start
 * and the score. A wide row has room for the subtitle among the details, so it shows it there.
 */
export function Row(
  props: {
    href: string;
    label: string;
    start: PageContent;
    title: PageContent;
    /** The narrow row's second line; a wide row shows it among the details instead. */
    subtitle?: PageContent;
    details: Array<PageContent | WideOnly>;
    end: PageContent;
    /** A play's row: the info column, holding the play's info icon when its info was loaded. */
    play?: { info: PlayInfo | undefined };
    current?: boolean;
  },
  messages: Messages,
) {
  const hasInfo = props.play !== undefined;
  const hasSubtitle = props.subtitle !== undefined;
  return html`<li
    class=${`hover:bg-muted/50 relative grid items-center gap-x-3 gap-y-1 py-3 ps-4 grid-cols-[auto_minmax(0,1fr)_auto] pe-4 ${hasInfo ? '@xl:grid-cols-[auto_minmax(0,1fr)_auto_2rem] @xl:pe-2' : ''} ${props.current ? 'bg-muted/60' : ''}`}
  >
    ${RowLink({ href: props.href, label: props.label })}
    <div class=${hasSubtitle ? 'row-span-3 @xl:row-span-2' : 'row-span-2'}>${props.start}</div>
    <div
      class="col-start-2 row-start-1 flex min-w-0 flex-nowrap items-center gap-x-2 gap-y-1 self-center leading-tight font-medium @xl:flex-wrap @xl:self-end"
    >
      ${props.title}
    </div>
    ${
      hasSubtitle
        ? html`<div class="col-start-2 row-start-2 flex min-w-0 items-center gap-1.5 text-sm leading-tight @xl:hidden">
            ${props.subtitle}
          </div>`
        : null
    }
    <div
      class=${`text-muted-foreground col-[2/-1] flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 self-start text-xs leading-tight @xl:col-[2/3] ${hasSubtitle ? 'row-start-3 @xl:row-start-2 pt-0.5 @xl:pt-0' : 'row-start-2'}`}
    >
      ${props.details
        .filter((item) => (isWideOnly(item) ? shown(item.wideOnly) : shown(item)))
        .map((item) =>
          // The separator trails each item, so a wrapped line never starts with one: in a wide row every item but
          // the last has one; in a narrow one, an item has one only while a narrow item follows it.
          isWideOnly(item)
            ? html`<span class=${`${DETAIL} hidden @xl:inline-flex`}>${item.wideOnly}</span>`
            : html`<span class=${`${DETAIL} inline-flex [&:has(~[data-narrow])]:after:content-['·']`} data-narrow
                >${item}</span
              >`,
        )}
    </div>
    <div class=${`col-start-3 row-start-1 ${hasSubtitle ? 'row-span-2' : '@xl:row-span-2'}`}>${props.end}</div>
    ${
      hasInfo
        ? // Only a wide row has the info icon: on a phone a tap opens the play, whose page lists the same info.
          html`<span class="col-start-4 row-start-1 hidden justify-center @xl:row-span-2 @xl:flex"
            >${InfoButton({ info: props.play?.info }, messages)}</span
          >`
        : null
    }
  </li>`;
}

/** What only a wide row shows, such as a help tip beside a badge. */
function NarrowHidden(props: { children: PageContent }) {
  return html`<span class="hidden items-center @xl:inline-flex">${props.children}</span>`;
}

/** Marks an anonymous player: quiet text in a narrow row, a badge in a wide one. */
export function AnonymousMark(messages: Messages) {
  const t = messages;
  return html`<span class="text-muted-foreground shrink-0 text-xs font-normal @xl:hidden">${t.lists.anonymous}</span
    ><span class="hidden @xl:inline-flex">${Tag({ children: html`${t.lists.anonymous}` })}</span>`;
}

/** What a lamp means, in the page's language. */
function lampMeaning(t: Messages, lamp: number): string {
  return t.lampMeanings[lamp] ?? t.lampMeanings.none;
}

/** The lamp as a colour bar: the row's leading edge, the same colour the lamp has everywhere else. */
export function LampBar(props: { lamp: number }, messages: Messages) {
  const t = messages;
  const style = lampStyle(props.lamp);
  return html`<span
    class="ring-foreground/15 block h-8 w-1.5 rounded-full ring-1"
    style=${`background:${style.color}`}
    title=${`${style.label}: ${lampMeaning(t, props.lamp)}`}
  ></span>`;
}

/** The lamp's name in its colour's dot, for the details line; `from` marks a lamp this play raised. */
export function LampLabel(props: { lamp: number; from?: number }, messages: Messages) {
  const t = messages;
  const style = lampStyle(props.lamp);
  const raised = props.from !== undefined && props.lamp > props.from;
  return html`<span class="inline-flex items-center gap-1" title=${lampMeaning(t, props.lamp) ?? nothing}
    ><span
      class="ring-foreground/20 inline-block size-2 rounded-full ring-1"
      style=${`background:${style.color}`}
    ></span
    >${
      raised
        ? html`<span class="text-muted-foreground/70 hidden @xl:inline">${lampStyle(props.from!).label} →</span
            ><span class="text-foreground font-medium">${style.label}</span>`
        : style.label
    }</span
  >`;
}

/** A change against the player's earlier best, in the colour of a gain or a loss. */
function Delta(props: { delta: number; better: boolean; title: string }) {
  return html`<span class=${props.better ? 'text-emerald-400' : 'text-muted-foreground'} title=${props.title ?? nothing}
    >${formatDelta(props.delta)}</span
  >`;
}

/**
 * EX-Score over its DJ LEVEL and rate, right-aligned on the digits; `previous` adds how far the play moved the
 * player's best, when it did.
 */
export function Score(props: { exScore: number; noteCount: number; previous?: number }, messages: Messages) {
  const t = messages;
  const gain = props.previous !== undefined ? props.exScore - props.previous : 0;
  return html`<div class="text-end leading-tight">
    <div class="flex items-baseline justify-end gap-1.5">
      ${
        gain > 0
          ? html`<span class="text-xs">${Delta({ delta: gain, better: true, title: t.lists.aboveBest })}</span>`
          : null
      }<span class="font-semibold">${props.exScore}</span>
    </div>
    <div class="text-muted-foreground mt-1 text-xs">
      <span class="text-foreground/80 font-medium">${djLevel(props.exScore, props.noteCount)}</span
      >${' '}${formatScoreRate(props.exScore, props.noteCount)}
    </div>
  </div>`;
}

/**
 * A chart's mode and level (`7K ☆12`), the difficulty's name on hover: the first item of a play's details, so the
 * title line keeps its width for the title.
 */
function ChartLevel(props: { laneMode: string | null; playLevel: string | null; difficulty: number | null }) {
  const label = formatChartLevel(props.laneMode, props.playLevel);
  if (label === undefined) return null;
  return html`<span class="text-foreground/80 font-medium" title=${difficultyName(props.difficulty) ?? nothing}
    >${label}</span
  >`;
}

/**
 * A chart's ranking under the display ruleset; a row opens the play it shows. `highlight` marks the viewer's rows.
 * `everyPlay` lists plays rather than players, where a play count per row would only repeat itself.
 */
export function RankingList(
  props: {
    entries: RankingEntry[];
    infos: Map<string, PlayInfo>;
    noteCount: number;
    highlight?: string;
    everyPlay?: boolean;
    empty?: string;
  },
  messages: Messages,
) {
  const t = messages;
  if (props.entries.length === 0) {
    return Empty({ title: t.lists.nobody, children: html`${props.empty ?? t.lists.noMatch}` });
  }
  return List({
    label: t.lists.ranking,
    children: html`${props.entries.map((entry) =>
      Row(
        {
          href: scoreHref(entry.exScoreId),
          label: t.lists.playOfPlayer(entry.displayName, entry.rank),
          current: props.highlight === entry.handle,
          play: { info: props.infos.get(entry.exScoreId) },
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
            props.everyPlay ? null : wideOnly(html`${t.count.plays(entry.playCount)}`),
            When({ at: entry.achievedAt }),
          ],
          end: Score({ exScore: entry.exScore, noteCount: props.noteCount }, messages),
        },
        messages,
      ),
    )}`,
  });
}

/**
 * Marks a play only its own player sees in the lists: "hidden" when they hid it, "not public" otherwise. The help tip
 * says why (any of: hidden, chart not listed yet, anonymous account), so the reason reads without hovering a title.
 */
export function PrivacyBadge(
  props: { hidden: boolean; reasons: Array<string | undefined>; onlyYou?: string },
  messages: Messages,
) {
  const t = messages;
  const reasons = props.reasons.filter((reason) => reason !== undefined);
  if (reasons.length === 0) return null;
  const label = props.hidden ? t.visibility.hidden : t.visibility.notPublic;
  return html`<span class="inline-flex shrink-0 items-center"
    ><span class="badge" data-variant="secondary">${label}</span>${NarrowHidden({
      children: html`${HelpTip(
        {
          topic: 'visibility',
          label: label,
          children: html`${props.onlyYou ?? t.visibility.onlyYou}${reasons.map((reason) => html`<br />• ${reason}`)}`,
        },
        messages,
      )}`,
    })}</span
  >`;
}

/**
 * The latest plays: which chart (with its mode and level), who, how it went under the display ruleset and what it
 * changed on the player's best, where it places on the chart, and when.
 */
export function RecentScoresList(
  props: {
    scores: RecentScore[];
    infos: Map<string, PlayInfo>;
    showPlayer: boolean;
    empty: string;
    /** The list leaves anonymous players out, so an anonymous row is the viewer's own and only they see it. */
    anonymousOnlyForOwner?: boolean;
  },
  messages: Messages,
) {
  const t = messages;
  if (props.scores.length === 0) {
    return Empty({ title: t.lists.noPlays, children: html`${props.empty}` });
  }
  return List({
    label: t.lists.latestPlays,
    children: html`${props.scores.map((entry) => {
      const title = chartTitle(entry.title, entry.chartFingerprint);
      // A hidden play moved no best and holds no place in the ranking: it shows neither.
      const previous = entry.hidden ? undefined : entry.previous;
      const missDelta = previous !== undefined ? entry.missCount - previous.missCount : 0;
      return Row(
        {
          href: scoreHref(entry.scoreId),
          label: t.lists.playOfChart(title, entry.displayName),
          play: { info: props.infos.get(entry.scoreId) },
          start: html`<span class="flex items-center gap-3"
            >${LampBar(
              { lamp: entry.clearLamp },
              messages,
            )}${props.showPlayer ? Avatar({ src: entry.avatarUrl, size: 32 }) : null}</span
          >`,
          title: html`<a
              class=${`${LINK} ${ABOVE} inline-flex min-w-0 items-center gap-1`}
              href=${chartHref(entry.chartFingerprint) ?? nothing}
              >${EntityIcon({ kind: 'chart', size: 'sm' })}<span class="truncate">${title}</span></a
            >${PrivacyBadge(
              {
                hidden: entry.hidden,
                reasons: [
                  entry.hidden ? t.visibility.reasonHidden : undefined,
                  entry.chartListed ? undefined : t.visibility.reasonNotListed,
                  entry.anonymous && props.anonymousOnlyForOwner === true
                    ? t.visibility.sentences([t.visibility.reasonAnonymous, t.visibility.passkeyHint])
                    : undefined,
                ],
              },
              messages,
            )}`,
          subtitle: props.showPlayer
            ? html`<a
                  class=${`${ABOVE} truncate underline-offset-4 hover:underline`}
                  href=${playerHref(entry.handle) ?? nothing}
                  >${entry.displayName}</a
                >${entry.anonymous ? AnonymousMark(messages) : null}`
            : undefined,
          details: [
            formatChartLevel(entry.laneMode, entry.playLevel) !== undefined
              ? ChartLevel({ laneMode: entry.laneMode, playLevel: entry.playLevel, difficulty: entry.difficulty })
              : null,
            props.showPlayer
              ? wideOnly(
                  html`<a
                      class=${`${ABOVE} text-foreground font-medium underline-offset-4 hover:underline`}
                      href=${playerHref(entry.handle) ?? nothing}
                      >${entry.displayName}</a
                    >${entry.anonymous ? Tag({ children: html`${t.lists.anonymous}` }) : null}`,
                )
              : null,
            LampLabel({ lamp: entry.clearLamp, from: previous?.clearLamp }, messages),
            showsGauge(entry.clearLamp) ? wideOnly(html`${formatGauge(entry.gaugeType, entry.gaugeFinal)}`) : null,
            html`BP
            ${entry.missCount}${missDelta < 0 ? Delta({ delta: missDelta, better: true, title: t.lists.fewerMisses }) : null}`,
            entry.laneOption !== null && entry.laneOption !== 'OFF' && entry.laneOption !== '-'
              ? wideOnly(html`${entry.laneOption}`)
              : null,
            entry.hidden
              ? null
              : html`<span title=${t.lists.rankAmong(entry.players) ?? nothing}
                  >#${entry.rank} / ${entry.players}</span
                >`,
            wideOnly(
              html`<span title=${t.rules.playedWithTitle ?? nothing}
                >${t.rules.playedWith(t.rules.name(RULESET_LABELS[entry.playedRuleset] ?? entry.playedRuleset))}</span
              >`,
            ),
            entry.assisted ? Tag({ children: html`${t.lists.assist}` }) : null,
            When({ at: entry.createdAt }),
          ],
          end: Score({ exScore: entry.exScore, noteCount: entry.noteCount, previous: previous?.exScore }, messages),
        },
        messages,
      );
    })}`,
  });
}

/** The charts of a chartset; a row opens the chart. */
export function ChartsetChartsList(props: { charts: ChartsetChart[] }, messages: Messages) {
  const t = messages;
  if (props.charts.length === 0) {
    return Empty({ title: t.chartset.empty, children: html`${t.chartset.emptyLead}` });
  }
  const packs = {
    included: { label: t.chartset.original, meaning: t.chartset.originalMeaning },
    additional: { label: t.chartset.addOn, meaning: t.chartset.addOnMeaning },
  };
  return List({
    label: t.chartset.listLabel,
    children: html`${props.charts.map((entry) => {
      const pack = entry.packType === null ? undefined : packs[entry.packType];
      const title = chartTitle(entry.title, entry.chartFingerprint);
      return Row(
        {
          href: chartHref(entry.chartFingerprint),
          label: title,
          start: html`<span class="text-muted-foreground w-14 text-xs font-medium"
            >${formatLaneMode(entry.laneMode)}</span
          >`,
          title: html`<span class="inline-flex min-w-0 items-center gap-1 font-medium"
              >${EntityIcon({ kind: 'chart', size: 'sm' })}<span class="truncate">${title}</span></span
            >${
              entry.subtitle !== null && entry.subtitle.length > 0
                ? html`<span class="text-muted-foreground truncate">${entry.subtitle}</span>`
                : null
            }`,
          details: [
            entry.artist !== null && entry.artist.length > 0 ? html`${entry.artist}` : null,
            html`<span class="tabular-nums">${t.count.notes(entry.noteCount)}</span>`,
            pack !== undefined ? html`<span title=${pack.meaning ?? nothing}>${pack.label}</span>` : null,
          ],
          end: html`<div class="text-end tabular-nums">
            <div class="font-semibold">${entry.players}</div>
            <div class="text-muted-foreground text-xs">${t.chartset.players(entry.players)}</div>
          </div>`,
        },
        messages,
      );
    })}`,
  });
}

const JUDGE_LABELS: Array<[string, string]> = [
  ['pgreat', 'PG'],
  ['great', 'GR'],
  ['good', 'GD'],
  ['bad', 'BD'],
  ['poor', 'PR'],
  ['emptyPoor', 'EPR'],
];

/** One play under every ruleset, one card each: the shown ruleset first in the reading order of the rulesets. */
export function ResultCards(
  props: {
    results: Array<{
      ruleset: string;
      exScore: number;
      noteCount: number;
      clearLamp: number;
      missCount: number;
      maxCombo: number;
      gaugeType: string;
      gaugeFinal: number | null;
      judges: Record<string, number>;
      /** A course run's: the stages it reached and its trophy. */
      stagesPlayed?: number;
      trophy?: string | null;
    }>;
    /** A course run's stage count, beside the stages each ruleset's run reached. */
    stageCount?: number;
    playedRuleset: string;
    /** The viewer's display ruleset (the header's ruleset menu), marked as selected. */
    displayRuleset: string;
  },
  messages: Messages,
) {
  const t = messages;
  const name = (ruleset: string) => t.rules.name(RULESET_LABELS[ruleset] ?? ruleset);
  const results = [...props.results].sort(byRulesetOrder);
  return html`<section class="space-y-2" aria-labelledby="scored-with">
    <h2 id="scored-with" class="text-muted-foreground text-sm">
      <span class="inline-flex items-center gap-0.5"
        ><abbr title=${t.rules.meaning ?? nothing}>${t.score.scoredWith}</abbr> ${t.score.eachSet}${HelpTip(
          { topic: 'rules', label: t.score.rulesLabel, children: html`${t.score.rulesHelp}` },
          messages,
        )}</span
      >
    </h2>
    <div class="grid gap-3 sm:grid-cols-3">
      ${results.map((result) => {
        const shown = result.ruleset === props.displayRuleset;
        return html`<section
          class=${`card gap-3 px-4 py-4 ${shown ? 'ring-primary ring-2' : ''}`}
          aria-label=${name(result.ruleset) ?? nothing}
          data-state=${(shown ? 'selected' : undefined) ?? nothing}
        >
          <div class="flex flex-wrap items-center gap-1.5 text-sm font-medium">
            ${name(result.ruleset)}${shown ? Tag({ children: html`${t.score.selected}` }) : null}${result.ruleset === props.playedRuleset ? Tag({ children: html`${t.score.playedWith}` }) : null}
          </div>
          <div class="flex items-end justify-between gap-3">
            ${LampLabel({ lamp: result.clearLamp }, messages)}
            <div class="text-end tabular-nums">
              <div class="text-2xl leading-none font-semibold">${result.exScore}</div>
              <div class="text-muted-foreground mt-1 text-xs">
                <span class="text-foreground/80 font-medium">${djLevel(result.exScore, result.noteCount)}</span
                >${' '}${formatScoreRate(result.exScore, result.noteCount)}
              </div>
            </div>
          </div>
          <dl class="text-muted-foreground grid grid-cols-3 gap-x-3 gap-y-1 text-xs tabular-nums">
            ${JUDGE_LABELS.map(
              ([key, label]) =>
                html`<div class="flex justify-between gap-2">
                  <dt>${label}</dt>
                  <dd class="text-foreground">${result.judges[key] ?? 0}</dd>
                </div>`,
            )}
            <div class="flex justify-between gap-2">
              <dt>BP</dt>
              <dd class="text-foreground">${result.missCount}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt>${t.score.combo}</dt>
              <dd class="text-foreground">${result.maxCombo}</dd>
            </div>
            <div class="col-span-3 flex justify-between gap-2">
              <dt>${t.score.gauge}</dt>
              <dd class="text-foreground">${formatGauge(result.gaugeType, result.gaugeFinal)}</dd>
            </div>
            ${
              result.stagesPlayed !== undefined && props.stageCount !== undefined
                ? html`<div class="col-span-3 flex justify-between gap-2">
                    <dt>${t.courseRun.stagesReached}</dt>
                    <dd class="text-foreground">${t.courseRun.stagesOf(result.stagesPlayed, props.stageCount)}</dd>
                  </div>`
                : null
            }${
              result.trophy !== undefined
                ? html`<div class="col-span-3 flex justify-between gap-2">
                    <dt>${t.courseRun.trophy}</dt>
                    <dd class="text-foreground">${result.trophy ?? t.courseRun.noTrophy}</dd>
                  </div>`
                : null
            }
          </dl>
        </section>`;
      })}
    </div>
  </section>`;
}
