/** @jsxImportSource hono/jsx */
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
import {
  chartTitle,
  djLevel,
  formatGauge,
  formatScoreRate,
  lampStyle,
  rulesetName,
  verificationMeaning,
} from './format.ts';
import { shareText, xIntentUrl, type ScoreCardData } from './score-card-data.ts';
import { Layout, PageHeader } from './layout.tsx';
import { displayRuleset, meta, notFound, PAGE_CACHE, withArtist, type PageContext, chartsetCrumbs } from './page.tsx';

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
  const text = shareText(props.data);
  return (
    <section class="card gap-4" data-size="sm" data-share>
      <header>
        <h2>Share</h2>
        <p>
          {props.upload !== undefined && !props.hasCard
            ? 'Your share card is being drawn; links to this page show it.'
            : 'Links to this page show this card.'}
        </p>
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
            Post on X
          </a>
          <button type="button" class="btn" data-variant="outline" data-share-native hidden>
            Share…
          </button>
          <button type="button" class="btn" data-variant="outline" data-share-copy>
            Copy link
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
  if (detail === undefined || detail.player === null) return notFound(c, 'This score');
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
  const pageMeta = {
    ...meta(c, `${title} — ${player.displayName}`, description, [
      ...chartsetCrumbs(filed),
      { label: title, href: chartHref(detail.chart.chartFingerprint), kind: 'chart' as const },
      { label: `${player.displayName}’s play`, kind: 'score' as const },
    ]),
    image: { path: image, alt: card !== undefined ? shareText(card) : description },
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
        {withArtist(detail.chart.artist)}played by
        <a class="text-foreground font-medium underline-offset-4 hover:underline" href={playerHref(player.handle)}>
          {player.displayName}
        </a>
        {player.anonymous ? <Tag>anonymous</Tag> : null}
      </PageHeader>
      <ResultCards
        results={detail.results}
        playedRuleset={detail.score.playedRuleset}
        displayRuleset={displayRuleset(c)}
      />
      <Details
        title="Play"
        rows={[
          ['Played', <LocalTime at={detail.score.createdAt.getTime()} />],
          ['Gauge', detail.score.gauge],
          ['Assists', detail.score.assisted ? detail.score.assistFlags.join(', ') : 'none'],
          ['Verification', verificationMeaning(detail.score.verification)],
          [
            'Chart',
            <a
              class="inline-flex items-center gap-1 underline-offset-4 hover:underline"
              href={chartHref(detail.chart.chartFingerprint)}
            >
              <EntityIcon kind="chart" size="sm" />
              {title}
            </a>,
          ],
          ['Fingerprint', <span class="font-mono text-xs break-all">{detail.chart.chartFingerprint}</span>],
          ...(detail.score.replayVisibility === 'public'
            ? ([
                [
                  'Replay',
                  <a
                    class="underline-offset-4 hover:underline"
                    href={`/api/v0/scores/${encodeURIComponent(detail.score.id)}/playlog`}
                    download
                  >
                    Download play log
                  </a>,
                ],
              ] as Array<[string, Child]>)
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
