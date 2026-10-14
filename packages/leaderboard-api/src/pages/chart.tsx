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
import { chartTitle, difficultyName, formatJudgeRank, formatLaneMode, formatLnMode, rulesetName } from './format.ts';
import { Layout, PageHeader } from './layout.tsx';
import {
  day,
  displayRuleset,
  known,
  meta,
  notFound,
  orDash,
  PAGE_CACHE,
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
  if (found === undefined) return notFound(c, 'This chart');
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
  return c.html(
    <Layout
      meta={meta(c, title, `${title} — ranking under ${rulesetName(ruleset)}, ${ranking.players} players.`, [
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
        {found.noteCount} notes · {everyone} player{everyone === 1 ? '' : 's'}
      </PageHeader>
      <Stats
        items={[
          ['Players', stats.players],
          ['Plays', stats.plays],
          ['First played', day(stats.firstPlayedAt)],
          ['Last played', day(stats.lastPlayedAt)],
        ]}
      />
      <section class="space-y-3" aria-labelledby="ranking">
        <SectionHeading
          id="ranking"
          note={
            everyPlay
              ? `${'plays' in ranking ? ranking.plays : ranking.entries.length} plays`
              : `${ranking.players} player${ranking.players === 1 ? '' : 's'}`
          }
        >
          Ranking
        </SectionHeading>
        <Filters>
          <Toggle
            help="filters"
            label="Every play"
            description="List each play on its own row, so a player can appear more than once"
            on={everyPlay}
            href={withQuery(c, 'every', everyPlay ? undefined : '1')}
          />
          <Toggle
            help="filters"
            label="Assisted"
            description="Plays with auto-scratch or a judge window override, ranked apart"
            on={assisted}
            href={withQuery(c, 'assisted', assisted ? undefined : '1')}
          />
          <Toggle
            help="filters"
            label="Anonymous players"
            description="Include players who have not made a passkey yet"
            on={includeAnonymous}
            href={withQuery(c, 'anonymous', includeAnonymous ? undefined : '1')}
          />
        </Filters>
        {files.length > 1 ? (
          <div class="flex flex-wrap items-center gap-3">
            <span class="text-muted-foreground inline-flex items-center gap-0.5 text-xs">
              File
              <HelpTip topic="filters" label="File">
                One chart can come in several files (re-saves, re-encodes). Pick one to rank only its plays; the number is
                its plays.
              </HelpTip>
            </span>
            <Segmented
              label="Chart file"
              options={[
                { label: 'All files', href: withQuery(c, 'file', undefined), current: fileSha256 === undefined },
                ...files.map((file) => ({
                  label: (
                    <span class="inline-flex items-baseline gap-1.5">
                      <span class="font-mono">{file.sha256.slice(0, 8)}</span>
                      <span class="text-muted-foreground text-xs">{file.plays}</span>
                    </span>
                  ),
                  href: withQuery(c, 'file', file.sha256),
                  current: file.sha256 === fileSha256,
                  title: `SHA-256 ${file.sha256}${file.md5 !== null ? ` · MD5 ${file.md5}` : ''} · ${file.plays} play${file.plays === 1 ? '' : 's'}`,
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
        title="Clear lamps"
        description={`Best lamps of the players above, under ${rulesetName(ruleset)}.`}
        distribution={stats.lamps}
        kind="lamp"
      />
      <Details
        title="Chart"
        rows={known([
          [
            'Chartset',
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
            'Package',
            found.packType === 'included' ? 'original' : found.packType === 'additional' ? 'add-on (差分)' : '-',
          ],
          ['Genre', orDash(found.genre)],
          ['Mode', formatLaneMode(found.laneMode)],
          ['Notes', found.noteCount],
          ['TOTAL', orDash(found.total)],
          ['Judge rank', formatJudgeRank(found.judgeRank)],
          [
            <span class="inline-flex items-center gap-0.5">
              LN mode
              <HelpTip topic="long-notes" label="LN mode">
                How the chart's long notes are judged: LN judges the start, CN the release too, HCN also the hold.
              </HelpTip>
            </span>,
            formatLnMode(found.lnMode),
          ],
          ['Format', found.sourceFormat === null ? '-' : found.sourceFormat.toUpperCase()],
          [
            '#RANDOM outcomes',
            found.playFingerprints.length > 1 ? `${found.playFingerprints.length} seen` : 'none seen',
          ],
          ['Fingerprint', <span class="font-mono text-xs">{chartFingerprint}</span>],
          [files.length > 1 ? 'Files' : 'File', <ChartFilesList files={files} aliases={aliases} />],
          ['First seen', <LocalTime at={found.createdAt.getTime()} />],
          ['Listed', found.status === 'listed' ? 'yes' : 'not yet (two players with a passkey list a chart)'],
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
  const played = new Set(props.files.flatMap((file) => [file.sha256, file.md5]));
  const others = props.aliases.filter((alias) => !played.has(alias.hash));
  if (props.files.length === 0 && others.length === 0) return <>-</>;
  return (
    <ul class="space-y-1.5">
      {props.files.map((file) => (
        <li class="space-y-0.5">
          <div class="font-mono text-xs break-all">SHA-256 {file.sha256}</div>
          {file.md5 !== null ? <div class="font-mono text-xs break-all">MD5 {file.md5}</div> : null}
          <div class="text-muted-foreground text-xs">
            {file.plays} play{file.plays === 1 ? '' : 's'} by {file.players} player{file.players === 1 ? '' : 's'}
          </div>
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
