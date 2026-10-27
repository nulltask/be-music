/** @jsxImportSource hono/jsx */
import { HelpTip } from './components/help-tip.tsx';
import type { Child } from 'hono/jsx';
import { openDatabase } from '../db/client.ts';
import { loadScoreDetail } from '../scores/detail.ts';
import { ResultCards } from './components/lists.tsx';
import { Details } from './components/cards.tsx';
import { EntityIcon } from './components/entity-icon.tsx';
import { chartHref, LocalTime, playerHref, Tag } from './components/basics.tsx';
import { loadChartsetOf } from './data.ts';
import { pickPlayInfoRows } from './components/play-info.tsx';
import { toPlayInfo } from '../play-info.ts';
import { avatarURL } from '../avatars.ts';
import { cardURL } from '../cards.ts';
import type { ScoreDetail } from '../scores/detail.ts';
import { chartTitle, djLevel, formatGauge, formatScoreRate, lampStyle, rulesetName } from './format.ts';
import { shareText, type ScoreCardData } from './score-card-data.ts';
import { ShareCard } from './components/share-card.tsx';
import { scoreCardExcerpt } from './score-card-excerpt.ts';
import { Layout, PageHeader } from './layout.tsx';
import { helpHref } from './help-topics.ts';
import { useMessages } from './i18n/index.ts';
import {
  displayRuleset,
  meta,
  notFound,
  PAGE_CACHE,
  pageMessages,
  withArtist,
  type PageContext,
  chartsetCrumbs,
} from './page.tsx';

/** The share card's content: the play under the ruleset it was played with. */
function scoreCardData(detail: ScoreDetail, played: ScoreDetail['results'][number], title: string): ScoreCardData {
  const lamp = lampStyle(played.clearLamp);
  return {
    genre: detail.chart.genre,
    title,
    subtitle: detail.chart.subtitle,
    artist: detail.chart.artist,
    playerName: detail.player?.displayName ?? '',
    handle: detail.player?.handle ?? '',
    avatarUrl: detail.player !== null ? avatarURL(detail.player.handle, detail.player.avatarKey) : '',
    rulesetLabel: rulesetName(played.ruleset),
    lamp: { label: lamp.label, color: lamp.color },
    exScore: played.exScore,
    maxExScore: played.noteCount * 2,
    rate: formatScoreRate(played.exScore, played.noteCount),
    djRank: djLevel(played.exScore, played.noteCount),
    bp: played.missCount,
    maxCombo: played.maxCombo,
    judges: {
      pgreat: played.judges.pgreat ?? 0,
      great: played.judges.great ?? 0,
      good: played.judges.good ?? 0,
      bad: played.judges.bad ?? 0,
      poor: (played.judges.poor ?? 0) + (played.judges.emptyPoor ?? 0),
    },
    gauge: formatGauge(played.gaugeType, played.gaugeFinal),
    playedAt: detail.score.createdAt.getTime(),
  };
}

/** The play's own player hides it, or shows it again (wired by the client script's `hide-score` / `show-score`). */
function VisibilityCard(props: { scoreId: string; hidden: boolean }) {
  const t = useMessages().score;
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
          data-score-id={props.scoreId}
        >
          {props.hidden ? t.show : t.hide}
        </button>
        <p class="text-destructive text-sm" data-visibility-status role="status" hidden />
      </div>
    </section>
  );
}

/** The excerpt for a play's card, from the chart's fingerprint document in R2; null when it cannot be read. */
async function loadCardExcerpt(c: PageContext, documentKey: string, laneMode: string | null) {
  if (laneMode === null) return null;
  try {
    const object = await c.env.BLOBS.get(documentKey);
    return object === null ? null : scoreCardExcerpt(await object.json(), laneMode);
  } catch (error) {
    console.warn('could not read the chart document for a score card', error);
    return null;
  }
}

/** One play under every ruleset, with how it was played. */
export async function scorePage(c: PageContext<'/scores/:id'>) {
  const db = openDatabase(c.env.DB);
  const detail = await loadScoreDetail(db, c.req.param('id'));
  const viewer = c.get('viewer');
  const isOwner = viewer !== null && viewer.userId === detail?.score.userId;
  // A hidden play is its player's alone: to anyone else it does not exist.
  if (detail === undefined || detail.player === null || (detail.score.hidden && !isOwner)) {
    return notFound(c, 'score');
  }
  const { player } = detail;
  const filed = await loadChartsetOf(db, detail.chart.chartsetId);
  const title = chartTitle(detail.chart.title, detail.chart.chartFingerprint);
  const played = detail.results.find((result) => result.ruleset === detail.score.playedRuleset);
  const description =
    played !== undefined
      ? `${player.displayName} · ${title} · EX ${played.exScore} (${rulesetName(played.ruleset)})`
      : `${player.displayName} · ${title}`;
  const card = played === undefined ? undefined : scoreCardData(detail, played, title);
  // The play's own player draws the card when it has none yet: hand them the chart's notes for its playfield.
  if (card !== undefined && isOwner && detail.score.cardKey === null) {
    const excerpt = await loadCardExcerpt(c, detail.chart.documentKey, detail.chart.laneMode);
    if (excerpt !== null) card.excerpt = excerpt;
  }
  const image = cardURL(detail.score.id, detail.score.cardKey);
  const { hidden } = detail.score;
  const info = toPlayInfo({
    scoreId: detail.score.id,
    createdAt: detail.score.createdAt,
    playedRuleset: detail.score.playedRuleset,
    gauge: detail.score.gauge,
    assistFlags: detail.score.assistFlags,
    laneOption: detail.score.laneOption,
    durationMs: detail.score.durationMs,
    verification: detail.score.verification,
    recordedBy: detail.score.recordedBy,
    submittedBy: detail.score.submittedBy,
    serverEngine: detail.score.serverEngine,
  });
  c.header('cache-control', PAGE_CACHE);
  const t = pageMessages(c);
  // Why the rankings and lists leave a shown play out; the play's own player also reads how to change it.
  const notPublic = [
    detail.chart.status === 'listed' ? undefined : t.visibility.reasonNotListed,
    player.anonymous
      ? isOwner
        ? t.visibility.sentences([t.visibility.reasonAnonymous, t.visibility.passkeyHint])
        : t.visibility.reasonAnonymous
      : undefined,
  ].filter((reason) => reason !== undefined);
  const pageMeta = {
    ...meta(c, `${title} — ${player.displayName}`, description, [
      ...chartsetCrumbs(filed),
      { label: title, href: chartHref(detail.chart.chartFingerprint), kind: 'chart' as const },
      { label: t.score.crumb(player.displayName), kind: 'score' as const },
    ]),
    image: { path: image, alt: card !== undefined ? shareText(card) : description },
    // A play of a chart not listed yet stays out of search engines too, and so does a hidden one.
    noindex: hidden || detail.chart.status !== 'listed',
  };
  return c.html(
    <Layout meta={pageMeta}>
      <PageHeader
        kind="score"
        title={
          <a class="underline-offset-4 hover:underline" href={chartHref(detail.chart.chartFingerprint)}>
            {title}
          </a>
        }
      >
        {withArtist(detail.chart.artist)}
        {t.score.playedBy}
        <a class="text-foreground font-medium underline-offset-4 hover:underline" href={playerHref(player.handle)}>
          {player.displayName}
        </a>
        {player.anonymous ? <Tag>{t.lists.anonymous}</Tag> : null}
      </PageHeader>
      {hidden ? (
        <div class="alert" role="note">
          <h2>{t.score.hiddenTitle}</h2>
          <section>{t.score.hiddenLead}</section>
        </div>
      ) : notPublic.length > 0 ? (
        <div class="alert" role="note">
          <h2>{t.visibility.title}</h2>
          <section>
            <p>{t.visibility.lead}</p>
            <ul class="mt-1 list-disc space-y-0.5 ps-5">
              {notPublic.map((reason) => (
                <li>{reason}</li>
              ))}
            </ul>
            <a class="mt-1 inline-block underline underline-offset-4" href={helpHref('visibility')}>
              {t.help.more}
            </a>
          </section>
        </div>
      ) : null}
      <ResultCards
        results={detail.results}
        playedRuleset={detail.score.playedRuleset}
        displayRuleset={displayRuleset(c)}
      />
      <Details
        title={t.score.details}
        rows={[
          [t.score.played, <LocalTime at={detail.score.createdAt.getTime()} />],
          // What the lists' info popover shows of a play, here on every screen width, around the rows this page
          // writes with help tips of its own.
          ...pickPlayInfoRows(info, t, ['playedUnder']),
          [
            <span class="inline-flex items-center gap-0.5">
              {t.score.gauge}
              <HelpTip topic="gauges" label={t.score.gauge}>
                {t.score.gaugeHelp}
              </HelpTip>
            </span>,
            detail.score.gauge,
          ],
          ...pickPlayInfoRows(info, t, ['lanes']),
          [t.score.assists, detail.score.assisted ? detail.score.assistFlags.join(', ') : t.score.none],
          ...pickPlayInfoRows(info, t, ['length']),
          [
            <span class="inline-flex items-center gap-0.5">
              {t.score.verification}
              <HelpTip topic="verification" label={t.score.verification}>
                {t.score.verificationHelp}
              </HelpTip>
            </span>,
            t.playInfo.verification[detail.score.verification] ?? detail.score.verification,
          ],
          ...pickPlayInfoRows(info, t, ['app', 'sentFrom', 'scoredBy']),
          [
            t.score.chart,
            <a
              class="inline-flex items-center gap-1 underline-offset-4 hover:underline"
              href={chartHref(detail.chart.chartFingerprint)}
            >
              <EntityIcon kind="chart" size="sm" />
              {title}
            </a>,
          ],
          [t.score.fingerprint, <span class="font-mono text-xs break-all">{detail.chart.chartFingerprint}</span>],
          ...(detail.score.replayVisibility === 'public'
            ? ([
                [
                  t.score.replay,
                  <a
                    class="underline-offset-4 hover:underline"
                    href={`/api/v0/scores/${encodeURIComponent(detail.score.id)}/replay`}
                    download
                  >
                    {t.score.downloadReplay}
                  </a>,
                ],
              ] as Array<[Child, Child]>)
            : []),
        ]}
      />
      {card !== undefined && !hidden ? (
        <ShareCard
          data={card}
          text={shareText(card)}
          pageURL={c.req.url}
          image={image}
          upload={isOwner ? `/api/v0/scores/${encodeURIComponent(detail.score.id)}/card` : undefined}
          hasCard={detail.score.cardKey !== null}
        />
      ) : null}
      {isOwner ? <VisibilityCard scoreId={detail.score.id} hidden={hidden} /> : null}
    </Layout>,
  );
}
