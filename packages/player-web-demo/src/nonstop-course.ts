import { prepareNonstopCourse, type NonstopPrepareFailure, type PreparedNonstopCourse } from '@be-music/player/course';
import type { LibraryChart, LibraryCourse } from '@be-music/scene-model';
import { createNonstopAssets, NONSTOP_CHART_PATH, type BrowserSongAssetSource } from '@be-music/player-web/collection';

/** A NONSTOP course stitched for the demo to play as one chart. */
export interface PreparedNonstopPlay {
  /** The stitched chart as a song entry the gameplay scenes play (title: the course name). */
  song: LibraryChart;
  /** Where the stitched chart's assets load from (each stage's files, named per stage). */
  source: BrowserSongAssetSource;
  /** The course as stitched (`prepareNonstopCourse`): its map, stage charts and draws, for the play and its course log. */
  stitched: PreparedNonstopCourse;
}

/** Why a NONSTOP course cannot be played, for the status line. */
export type NonstopPlayFailure = 'missing-stage' | NonstopPrepareFailure;

/**
 * Stitches a NONSTOP course from the collection with the shared pipeline (`prepareNonstopCourse` in
 * `@be-music/player/course`, which the Leaderboard rebuilds runs with): each stage's `#RANDOM` drawn with `random`, the
 * course's long-note constraint applied, and the stages stitched with the course's connections. The demo's part is the
 * asset plumbing (each stage's files found in its own source, `createNonstopAssets`) and the song entry the scenes play.
 * `hashesOf` gives each stage's file hashes, which its cut-out play log records.
 */
export function prepareNonstopPlay(
  course: LibraryCourse,
  options: {
    sourceOf: (song: LibraryChart) => BrowserSongAssetSource | undefined;
    hashesOf?: (song: LibraryChart) => { sha256?: string; md5?: string } | undefined;
    placement?: 'intended' | 'lr2';
    random?: () => number;
  },
): { ok: true; prepared: PreparedNonstopPlay } | { ok: false; reason: NonstopPlayFailure; stage?: number } {
  const songs = course.stages.map((stage) => stage.chart);
  const sources = songs.map((song) => (song !== undefined ? options.sourceOf(song) : undefined));
  const missing = songs.findIndex((song, index) => song === undefined || sources[index] === undefined);
  if (missing >= 0) return { ok: false, reason: 'missing-stage', stage: missing };
  const stages = songs as LibraryChart[];
  let assets: ReturnType<typeof createNonstopAssets> | undefined;
  const stitched = prepareNonstopCourse(
    stages.map((song) => {
      const hashes = options.hashesOf?.(song);
      return {
        chart: song.chart,
        chartPath: song.chartPath,
        facts: {
          title: song.title,
          ...(song.subtitle !== undefined ? { subtitle: song.subtitle } : {}),
          ...(song.artist !== undefined ? { artist: song.artist } : {}),
          ...(hashes?.sha256 !== undefined ? { sha256: hashes.sha256 } : {}),
          ...(hashes?.md5 !== undefined ? { md5: hashes.md5 } : {}),
        },
      };
    }),
    {
      constraints: course.definition.constraints,
      connections: course.definition.connections ?? [],
      placement: options.placement ?? 'intended',
      title: course.definition.name,
      ...(options.random !== undefined ? { random: options.random } : {}),
      assetPath: (stageCharts) => {
        assets = createNonstopAssets(
          stageCharts.map((chart, index) => ({ chart, source: sources[index]!, chartPath: stages[index]!.chartPath })),
        );
        return assets.assetPath;
      },
    },
  );
  if (!stitched.ok) {
    return { ok: false, reason: stitched.reason, ...(stitched.stage !== undefined ? { stage: stitched.stage } : {}) };
  }
  // The pipeline hands the stage charts to `assetPath` before it stitches them, so the assets are there.
  const { source } = assets!;
  const song: LibraryChart = {
    ...stages[0]!,
    id: `nonstop:${course.id}`,
    sourceId: source.id,
    chartPath: NONSTOP_CHART_PATH,
    fileLabel: NONSTOP_CHART_PATH,
    title: course.definition.name,
    totalNotes: stages.reduce((sum, stage) => sum + stage.totalNotes, 0),
    chart: stitched.course.chart,
  };
  delete song.subtitle;
  return { ok: true, prepared: { song, source, stitched: stitched.course } };
}
