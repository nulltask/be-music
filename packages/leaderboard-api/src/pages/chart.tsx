/** @jsxImportSource hono/jsx */
import { HelpTip } from './components/help-tip.tsx';
import type { Child } from 'hono/jsx';
import { openDatabase } from '../db/client.ts';
import { isOn } from '../http/query.ts';
import { countPlayers, loadRanking } from '../ranking.ts';
import { loadChartFiles, loadPlayRanking, type ChartFile } from '../ranking-plays.ts';
import { RankingList } from './components/lists.tsx';
import { Details, DistributionCard, Elsewhere, Stats } from './components/cards.tsx';
import { EntityIcon } from './components/entity-icon.tsx';
import { chartsetHref, Filters, LocalTime, SectionHeading, Segmented, Tag, Toggle } from './components/basics.tsx';
import { loadChart, loadChartAliases, loadChartsetOf, loadPlayInfos } from './data.ts';
import { externalLinks, type ChartAlias } from './external.ts';
import { chartTitle, difficultyName, formatJudgeRank, formatLaneMode, RULESET_LABELS } from './format.ts';
import { useMessages } from './i18n/index.ts';
import { Layout, PageHeader } from './layout.tsx';
import {
  day,
  displayRuleset,
  known,
  meta,
  notFound,
  orDash,
  PAGE_CACHE,
  pageMessages,
  RANKING_LIMIT,
  withArtist,
  withQuery,
  type PageContext,
  chartsetCrumbs,
} from './page.tsx';
import { loadChartStats } from './stats.ts';

/** A chart's ranking, figures and details under the display ruleset. */
export async function chartPage(c: PageContext<'/leaderboard/charts/:chartFingerprint'>) {
  const db = openDatabase(c.env.DB);
  const chartFingerprint = c.req.param('chartFingerprint');
  const found = await loadChart(db, chartFingerprint);
  if (found === undefined) return notFound(c, 'chart');
  const ruleset = displayRuleset(c);
  const assisted = isOn(c.req.query('assisted'));
  const includeAnonymous = isOn(c.req.query('anonymous'));
  const everyPlay = isOn(c.req.query('every'));
  const fileQuery = c.req.query('file')?.toLowerCase();
  const fileSha256 = fileQuery !== undefined && /^[0-9a-f]{64}$/.test(fileQuery) ? fileQuery : undefined;
  const filter = { chartFingerprint, ruleset, assisted, includeAnonymous, playedHereOnly: false };
  const page = { offset: 0, limit: RANKING_LIMIT };
  // Everything below depends only on the chart: ask D1 for it at once rather than one query after another.
  const [ranking, everyone, aliases, stats, filed, files] = await Promise.all([
    // The kept personal bests answer the plain ranking; every play and one file's plays need the plays themselves.
    everyPlay || fileSha256 !== undefined
      ? loadPlayRanking(db, filter, { everyPlay, fileSha256 }, page)
      : loadRanking(db, filter, page),
    countPlayers(db, { ...filter, includeAnonymous: true }),
    loadChartAliases(db, chartFingerprint),
    loadChartStats(db, filter),
    loadChartsetOf(db, found.chartsetId),
    loadChartFiles(db, chartFingerprint),
  ]);
  const infos = await loadPlayInfos(
    db,
    ranking.entries.map((entry) => entry.exScoreId),
  );
  const title = chartTitle(found.title, chartFingerprint);
  const elsewhere = externalLinks(found, aliases, files);
  c.header('cache-control', PAGE_CACHE);
  const t = pageMessages(c);
  const rules = t.rules.name(RULESET_LABELS[ruleset] ?? ruleset);
  return c.html(
    <Layout
      meta={meta(c, title, t.chart.description(title, rules, ranking.players), [
        ...chartsetCrumbs(filed),
        { label: title, kind: 'chart' },
      ])}
    >
      <PageHeader
        kind="chart"
        title={
          <>
            {title}
            {found.subtitle !== null && found.subtitle.length > 0 ? (
              <span class="text-muted-foreground ms-2 text-lg font-normal">{found.subtitle}</span>
            ) : null}
          </>
        }
      >
        {withArtist(found.artist)}
        {found.laneMode !== null ? `${formatLaneMode(found.laneMode)} · ` : ''}
        {found.playLevel !== null ? (
          <span title={difficultyName(found.difficulty)}>
            ☆{found.playLevel}
            {difficultyName(found.difficulty) !== undefined ? ` ${difficultyName(found.difficulty)}` : ''} ·{' '}
          </span>
        ) : null}
        {t.count.notes(found.noteCount)} · {t.count.players(everyone)}
      </PageHeader>
      <Stats
        items={[
          [t.chart.stats.players, stats.players],
          [t.chart.stats.plays, stats.plays],
          [t.chart.stats.firstPlayed, day(stats.firstPlayedAt)],
          [t.chart.stats.lastPlayed, day(stats.lastPlayedAt)],
        ]}
      />
      <section class="space-y-3" aria-labelledby="ranking">
        <SectionHeading
          id="ranking"
          note={
            everyPlay
              ? t.count.plays('plays' in ranking ? Number(ranking.plays) : ranking.entries.length)
              : t.count.players(ranking.players)
          }
        >
          {t.chart.ranking}
        </SectionHeading>
        <Filters>
          <Toggle
            help="filters"
            label={t.filters.everyPlay}
            description={t.filters.everyPlayHelp}
            on={everyPlay}
            href={withQuery(c, 'every', everyPlay ? undefined : '1')}
          />
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
        {files.length > 1 ? (
          <div class="flex flex-wrap items-center gap-3">
            <span class="text-muted-foreground inline-flex items-center gap-0.5 text-xs">
              {t.filters.file}
              <HelpTip topic="filters" label={t.filters.file}>
                {t.filters.fileHelp}
              </HelpTip>
            </span>
            <Segmented
              label={t.filters.chartFile}
              options={[
                { label: t.filters.allFiles, href: withQuery(c, 'file', undefined), current: fileSha256 === undefined },
                ...files.map((file) => ({
                  label: (
                    <span class="inline-flex items-baseline gap-1.5">
                      <span class="font-mono">{file.sha256.slice(0, 8)}</span>
                      <span class="text-muted-foreground text-xs">{file.plays}</span>
                    </span>
                  ),
                  href: withQuery(c, 'file', file.sha256),
                  current: file.sha256 === fileSha256,
                  title: `SHA-256 ${file.sha256}${file.md5 !== null ? ` · MD5 ${file.md5}` : ''} · ${t.count.plays(file.plays)}`,
                })),
              ]}
            />
          </div>
        ) : null}
        <RankingList
          entries={ranking.entries}
          infos={infos}
          noteCount={found.noteCount}
          highlight={c.get('viewer')?.handle}
          everyPlay={everyPlay}
        />
      </section>
      <DistributionCard
        title={t.chart.clearLamps}
        description={t.chart.clearLampsLead(rules)}
        distribution={stats.lamps}
        kind="lamp"
      />
      <Details
        title={t.chart.details}
        rows={known([
          [
            t.chart.rows.chartset,
            filed === undefined ? (
              '-'
            ) : (
              <a
                class="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                href={chartsetHref(filed.id)}
              >
                <EntityIcon kind="chartset" size="sm" />
                {filed.title}
              </a>
            ),
          ],
          [
            t.chart.rows.package,
            found.packType === 'included' ? t.chart.original : found.packType === 'additional' ? t.chart.addOn : '-',
          ],
          [t.chart.rows.genre, orDash(found.genre)],
          [t.chart.rows.mode, formatLaneMode(found.laneMode)],
          [t.chart.rows.notes, found.noteCount],
          [t.chart.rows.total, orDash(found.total)],
          [t.chart.rows.judgeRank, formatJudgeRank(found.judgeRank)],
          [
            <span class="inline-flex items-center gap-0.5">
              {t.chart.rows.lnMode}
              <HelpTip topic="long-notes" label={t.chart.rows.lnMode}>
                {t.chart.rows.lnModeHelp}
              </HelpTip>
            </span>,
            found.lnMode === 1 || found.lnMode === 2 || found.lnMode === 3 ? t.lnModes[found.lnMode] : '-',
          ],
          [t.chart.rows.format, found.sourceFormat === null ? '-' : found.sourceFormat.toUpperCase()],
          [
            t.chart.rows.randomOutcomes,
            found.playFingerprints.length > 1 ? t.chart.randomSeen(found.playFingerprints.length) : t.chart.noneSeen,
          ],
          [t.chart.rows.fingerprint, <span class="font-mono text-xs">{chartFingerprint}</span>],
          [
            files.length > 1 ? t.chart.rows.files : t.chart.rows.file,
            <ChartFilesList files={files} aliases={aliases} />,
          ],
          [t.chart.rows.firstSeen, <LocalTime at={found.createdAt.getTime()} />],
          [t.chart.rows.listed, found.status === 'listed' ? t.chart.listedYes : t.chart.listedNo],
        ])}
      />
      <Elsewhere links={elsewhere} />
    </Layout>,
  );
}

/**
 * The files a chart is known by: those its plays came from (with their play counts), then any other hash a client
 * reported for it. One chart fingerprint can cover several files.
 */
function ChartFilesList(props: { files: ChartFile[]; aliases: ChartAlias[] }) {
  const t = useMessages();
  const played = new Set(props.files.flatMap((file) => [file.sha256, file.md5]));
  const others = props.aliases.filter((alias) => !played.has(alias.hash));
  if (props.files.length === 0 && others.length === 0) return <>-</>;
  return (
    <ul class="space-y-1.5">
      {props.files.map((file) => (
        <li class="space-y-0.5">
          <div class="font-mono text-xs break-all">SHA-256 {file.sha256}</div>
          {file.md5 !== null ? <div class="font-mono text-xs break-all">MD5 {file.md5}</div> : null}
          <div class="text-muted-foreground text-xs">{t.count.playsBy(file.plays, file.players)}</div>
        </li>
      ))}
      {others.map((alias) => (
        <li class="font-mono text-xs break-all">
          {alias.kind === 'sha256' ? 'SHA-256' : 'MD5'} {alias.hash}
        </li>
      ))}
    </ul>
  );
}
