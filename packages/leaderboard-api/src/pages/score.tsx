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
import { avatarUrl } from '../avatars.ts';
import { cardUrl } from '../cards.ts';
import { CARD_FONT } from './icons.ts';
import type { ScoreDetail } from '../scores/detail.ts';
import { chartTitle, djLevel, formatGauge, formatScoreRate, lampStyle, rulesetName } from './format.ts';
import { shareText, xIntentUrl, type ScoreCardData } from './score-card-data.ts';
import { Layout, PageHeader } from './layout.tsx';
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
    avatarUrl: detail.player !== null ? avatarUrl(detail.player.handle, detail.player.avatarKey) : '',
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

/**
 * The share section: the card, a post on X (a plain link, so it works without script), the system share sheet and a
 * copy-link button. For the play's own player, the client script draws the card and uploads it when there is none yet.
 */
function ShareCard(props: { data: ScoreCardData; pageUrl: string; image: string; upload?: string; hasCard: boolean }) {
  const t = useMessages().score;
  const text = shareText(props.data);
  return (
    <section class="card gap-4" data-size="sm" data-share>
      <header>
        <h2>{t.share}</h2>
        <p>{props.upload !== undefined && !props.hasCard ? t.shareDrawing : t.shareShown}</p>
      </header>
      <div class="space-y-4 px-4">
        <img
          src={props.image}
          width={600}
          height={315}
          alt={text}
          class="w-full max-w-[600px] rounded-lg border"
          data-card-preview
        />
        <div class="flex flex-wrap gap-2">
          <a class="btn" href={xIntentUrl(text, props.pageUrl)} target="_blank" rel="noopener" data-share-x>
            {t.postOnX}
          </a>
          <button type="button" class="btn" data-variant="outline" data-share-native hidden>
            {t.shareNative}
          </button>
          <button type="button" class="btn" data-variant="outline" data-share-copy>
            {t.copyLink}
          </button>
        </div>
        <p class="text-muted-foreground text-sm" data-share-status role="status" hidden />
      </div>
      <script
        type="application/json"
        data-score-card
        data-upload={props.upload}
        data-has-card={props.hasCard ? 'true' : 'false'}
        data-font-family={CARD_FONT.family}
        data-font-url={CARD_FONT.url}
        data-share-text={text}
        dangerouslySetInnerHTML={{ __html: JSON.stringify(props.data).replace(/</g, '\\u003c') }}
      />
    </section>
  );
}

/** One play under every ruleset, with how it was played. */
export async function scorePage(c: PageContext<'/leaderboard/scores/:id'>) {
  const db = openDatabase(c.env.DB);
  const detail = await loadScoreDetail(db, c.req.param('id'));
  if (detail === undefined || detail.player === null) return notFound(c, 'score');
  const { player } = detail;
  const filed = await loadChartsetOf(db, detail.chart.chartsetId);
  const title = chartTitle(detail.chart.title, detail.chart.chartFingerprint);
  const played = detail.results.find((result) => result.ruleset === detail.score.playedRuleset);
  const description =
    played !== undefined
      ? `${player.displayName} · ${title} · EX ${played.exScore} (${rulesetName(played.ruleset)})`
      : `${player.displayName} · ${title}`;
  const card = played === undefined ? undefined : scoreCardData(detail, played, title);
  const image = cardUrl(detail.score.id, detail.score.cardKey);
  const viewer = c.get('viewer');
  const isOwner = viewer !== null && viewer.handle === player.handle;
  c.header('cache-control', PAGE_CACHE);
  const t = pageMessages(c);
  const pageMeta = {
    ...meta(c, `${title} — ${player.displayName}`, description, [
      ...chartsetCrumbs(filed),
      { label: title, href: chartHref(detail.chart.chartFingerprint), kind: 'chart' as const },
      { label: t.score.crumb(player.displayName), kind: 'score' as const },
    ]),
    image: { path: image, alt: card !== undefined ? shareText(card) : description },
    // A play of a chart not listed yet stays out of search engines too.
    noindex: detail.chart.status !== 'listed',
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
      <ResultCards
        results={detail.results}
        playedRuleset={detail.score.playedRuleset}
        displayRuleset={displayRuleset(c)}
      />
      <Details
        title={t.score.details}
        rows={[
          [t.score.played, <LocalTime at={detail.score.createdAt.getTime()} />],
          [
            <span class="inline-flex items-center gap-0.5">
              {t.score.gauge}
              <HelpTip topic="gauges" label={t.score.gauge}>
                {t.score.gaugeHelp}
              </HelpTip>
            </span>,
            detail.score.gauge,
          ],
          [t.score.assists, detail.score.assisted ? detail.score.assistFlags.join(', ') : t.score.none],
          [
            <span class="inline-flex items-center gap-0.5">
              {t.score.verification}
              <HelpTip topic="verification" label={t.score.verification}>
                {t.score.verificationHelp}
              </HelpTip>
            </span>,
            t.playInfo.verification[detail.score.verification] ?? detail.score.verification,
          ],
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
                    href={`/api/v0/scores/${encodeURIComponent(detail.score.id)}/playlog`}
                    download
                  >
                    {t.score.downloadPlayLog}
                  </a>,
                ],
              ] as Array<[Child, Child]>)
            : []),
        ]}
      />
      {card !== undefined ? (
        <ShareCard
          data={card}
          pageUrl={c.req.url}
          image={image}
          upload={isOwner ? `/api/v0/scores/${encodeURIComponent(detail.score.id)}/card` : undefined}
          hasCard={detail.score.cardKey !== null}
        />
      ) : null}
    </Layout>,
  );
}
