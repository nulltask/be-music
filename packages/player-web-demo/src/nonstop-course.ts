import type { RandomDraws } from '@be-music/chart';
import type { BeMusicJson } from '@be-music/json';
import {
  applyCourseLongNoteConstraint,
  NONSTOP_STITCH_VERSION,
  stitchNonstopCourse,
  type NonstopConnection,
  type NonstopStitchMap,
} from '@be-music/player/course';
import {
  createCoursePlaylog,
  resolveChartRulesetFacts,
  resolvePlayChart,
  resolveNonstopNoteStages,
  resolveNonstopPlaylogStages,
  splitNonstopPlaylog,
  type BeMusicCoursePlaylog,
  type BeMusicPlaylog,
  type NonstopStageChartFacts,
  type PlaylogCourseStageEntry,
} from '@be-music/player/playlog';
import {
  createNonstopAssets,
  NONSTOP_CHART_PATH,
  type BrowserCourseEntry,
  type BrowserSongAssetSource,
  type BrowserSongEntry,
} from '@be-music/player-web/collection';

/** A NONSTOP course stitched and ready to play as one chart. */
export interface PreparedNonstopCourse {
  /** The stitched chart as a song entry the gameplay scenes play (title: the course name). */
  song: BrowserSongEntry;
  /** Where the stitched chart's assets load from (each stage's files, named per stage). */
  source: BrowserSongAssetSource;
  map: NonstopStitchMap;
  connections: NonstopConnection[];
  placement: 'intended' | 'lr2';
  /** Each stage's chart as played: control flow resolved, the course's long-note constraint applied. */
  stageCharts: BeMusicJson[];
  /** The `#RANDOM` / `#SWITCH` draws each stage chart was resolved with (the Leaderboard rebuilds the stitch with them). */
  stageDraws: RandomDraws[];
  /** What a cut-out stage log names its chart by. */
  stageFacts: NonstopStageChartFacts[];
}

/** Why a NONSTOP course cannot be stitched, for the status line. */
export type NonstopPrepareFailure = 'missing-stage' | 'bmson' | 'id-space' | 'no-stage' | 'stitch-version';

/**
 * Stitches a NONSTOP course from the collection: resolves each stage's `#RANDOM` (with `random`), applies the course's
 * long-note constraint, finds each stage's files in its own source and stitches the stages with the course's
 * connections (`stitchNonstopCourse`). The Leaderboard rebuilds the stitched chart the same way from the stage charts and
 * the draws, so the steps here must stay the ones it takes (`checkNonstopStageCharts` in `@be-music/leaderboard-api`).
 * `chartFingerprintOf` names each stage's chart in the course play log, which keys the course on the Leaderboard.
 */
export function prepareNonstopCourse(
  course: BrowserCourseEntry,
  options: {
    sourceOf: (song: BrowserSongEntry) => BrowserSongAssetSource | undefined;
    hashesOf?: (song: BrowserSongEntry) => { sha256?: string; md5?: string } | undefined;
    chartFingerprintOf?: (stage: { chart: BeMusicJson; chartPath: string | undefined }) => string | undefined;
    placement?: 'intended' | 'lr2';
    random?: () => number;
  },
): { ok: true; prepared: PreparedNonstopCourse } | { ok: false; reason: NonstopPrepareFailure; stage?: number } {
  const songs = course.stages.map((stage) => stage.song);
  const sources = songs.map((song) => (song !== undefined ? options.sourceOf(song) : undefined));
  const missing = songs.findIndex((song, index) => song === undefined || sources[index] === undefined);
  if (missing >= 0) return { ok: false, reason: 'missing-stage', stage: missing };
  const random = options.random ?? Math.random;
  const resolved = songs.map((song) => resolvePlayChart(song!.chart, { random }));
  const stageCharts = resolved.map(({ chart }) => applyCourseLongNoteConstraint(chart, course.definition.constraints));
  const assets = createNonstopAssets(
    songs.map((song, index) => ({ chart: stageCharts[index]!, source: sources[index]!, chartPath: song!.chartPath })),
  );
  const connections = course.definition.connections ?? [];
  const placement = options.placement ?? 'intended';
  const stitched = stitchNonstopCourse(
    stageCharts.map((chart, index) => ({ chart, pms: songs[index]!.chartPath.toLowerCase().endsWith('.pms') })),
    { connections, placement, title: course.definition.name, assetPath: assets.assetPath },
  );
  if (!stitched.ok) {
    return { ok: false, reason: stitched.reason, ...(stitched.stage !== undefined ? { stage: stitched.stage } : {}) };
  }
  const first = songs[0]!;
  const song: BrowserSongEntry = {
    ...first,
    id: `nonstop:${course.id}`,
    sourceId: assets.source.id,
    chartPath: NONSTOP_CHART_PATH,
    fileLabel: NONSTOP_CHART_PATH,
    title: course.definition.name,
    totalNotes: songs.reduce((sum, stage) => sum + stage!.totalNotes, 0),
    chart: stitched.chart,
  };
  delete song.subtitle;
  return {
    ok: true,
    prepared: {
      song,
      source: assets.source,
      map: stitched.map,
      connections,
      placement,
      stageCharts,
      stageDraws: resolved.map(({ randomDraws }) => randomDraws),
      stageFacts: songs.map((stage) => {
        const hashes = options.hashesOf?.(stage!);
        const chartFingerprint = options.chartFingerprintOf?.({ chart: stage!.chart, chartPath: stage!.chartPath });
        return {
          title: stage!.title,
          ...(chartFingerprint !== undefined ? { chartFingerprint } : {}),
          ...(stage!.subtitle !== undefined ? { subtitle: stage!.subtitle } : {}),
          ...(stage!.artist !== undefined ? { artist: stage!.artist } : {}),
          ...(hashes?.sha256 !== undefined ? { sha256: hashes.sha256 } : {}),
          ...(hashes?.md5 !== undefined ? { md5: hashes.md5 } : {}),
        };
      }),
    },
  };
}

/**
 * The course play log of a NONSTOP run: the stitched play (`nonstop`), each reached stage cut out of it, and the facts
 * of every stage the run never reached.
 */
export function buildNonstopCoursePlaylog(
  course: BrowserCourseEntry,
  prepared: PreparedNonstopCourse,
  playlog: BeMusicPlaylog,
  options: { createdAt?: string; recorder?: BeMusicPlaylog['recorder'] } = {},
): BeMusicCoursePlaylog {
  const noteStages = resolveNonstopNoteStages(prepared.song.chart, prepared.map, playlog.chart.notes);
  const stages = resolveNonstopPlaylogStages(prepared.map, prepared.stageDraws);
  const cut = splitNonstopPlaylog({ playlog, stages, noteStages }, prepared.stageFacts, {
    ruleset: playlog.play.judgeRuleset ?? 'lr2',
  });
  const entries: PlaylogCourseStageEntry[] = prepared.stageCharts.map((chart, index) => {
    const stageLog = cut[index];
    if (stageLog !== undefined) return { played: true, playlog: stageLog };
    const facts = prepared.stageFacts[index];
    return {
      played: false,
      facts: resolveChartRulesetFacts(chart, { laneModeExtension: course.stages[index]?.song?.chartPath }),
      ...(facts?.sha256 !== undefined ? { sha256: facts.sha256 } : {}),
      ...(facts?.md5 !== undefined ? { md5: facts.md5 } : {}),
      ...(facts?.chartFingerprint !== undefined ? { chartFingerprint: facts.chartFingerprint } : {}),
    };
  });
  const { definition } = course;
  return createCoursePlaylog({
    course: {
      name: definition.name,
      kind: definition.kind,
      constraints: [...definition.constraints],
      trophies: definition.trophies.map((trophy) => ({ ...trophy })),
      ...(definition.release === false ? { release: false as const } : {}),
    },
    stages: entries,
    nonstop: {
      connections: prepared.connections,
      placement: prepared.placement,
      stitch: NONSTOP_STITCH_VERSION,
      playlog,
      stages,
      noteStages,
    },
    ...(options.createdAt !== undefined ? { createdAt: options.createdAt } : {}),
    ...(options.recorder !== undefined ? { recorder: options.recorder } : {}),
  });
}
