import { resolveChart } from '@be-music/chart';
import { parseChart } from '@be-music/parser';
import { manualPlay } from '@be-music/player';
import { buildNonstopCoursePlaylog, parseLr2CourseFile } from '@be-music/player/course';
import type { BeMusicPlaylog, PlaylogInputEvent } from '@be-music/player/playlog';
import { simulatePlaylog } from '@be-music/player/playlog';
import type { BrowserCourseEntry, BrowserSongAssetSource, BrowserSongEntry } from '@be-music/player-web/collection';
import { describe, expect, test } from 'vite-plus/test';
import { courseStageChartFingerprint, prepareCourseLeaderboardSubmission } from './leaderboard.ts';
import { prepareNonstopPlay } from './nonstop-course.ts';

const MD5 = ['1', '2'].map((digit) => digit.repeat(32));

function song(id: string, text: string): { song: BrowserSongEntry; source: BrowserSongAssetSource } {
  const chartPath = `${id}/${id}.bms`;
  return {
    song: {
      id,
      sourceId: `src-${id}`,
      sourceLabel: id,
      sourceKind: 'directory',
      chartPath,
      directoryLabel: id,
      fileLabel: `${id}.bms`,
      title: id.toUpperCase(),
      totalNotes: 3,
      chart: parseChart(text, 'bms'),
    },
    source: {
      id: `src-${id}`,
      kind: 'directory',
      label: id,
      files: new Map([[`${id}/${id}.wav`, new Uint8Array([1])]]),
    },
  };
}

const STAGE_A = song('a', ['#BPM 240', '#WAV01 a.wav', '#00111:0101', '#00212:01'].join('\n'));
const STAGE_B = song('b', ['#BPM 240', '#WAV01 b.wav', '#00211:00010000', '#00312:00010001'].join('\n'));

function course(): BrowserCourseEntry {
  // A NONSTOP course (type 1) with a CUT connection after stage 1.
  const header = `2${'0'.repeat(9)}1${'0'.repeat(21)}`;
  const [definition] = parseLr2CourseFile(
    `<courselist><course><title>Nonstop</title><type>1</type><hash>${header}${MD5.join('')}</hash></course></courselist>`,
  );
  return {
    id: 'ns#0',
    definition: definition!,
    stages: [STAGE_A, STAGE_B].map(({ song: entry }) => ({ title: entry.title, song: entry })),
    playable: true,
  };
}

/** Presses every note of `chart` dead on. */
function presses(chart: BrowserSongEntry['chart']): PlaylogInputEvent[] {
  const events: PlaylogInputEvent[] = [];
  for (const note of resolveChart(chart).notes) {
    const timeUs = Math.round(note.seconds * 1_000_000);
    events.push({ seq: 0, timeUs, action: 'down', channels: [note.channel] });
    events.push({ seq: 0, timeUs: timeUs + 40_000, action: 'up', channels: [note.channel] });
  }
  return events.sort((left, right) => left.timeUs - right.timeUs).map((event, seq) => ({ ...event, seq }));
}

const sourceOf = (entry: BrowserSongEntry) => [STAGE_A, STAGE_B].find((stage) => stage.song.id === entry.id)?.source;

describe('prepareNonstopPlay', () => {
  test("stitches the stages into one song played from the stages' own files", () => {
    const prepared = prepareNonstopPlay(course(), { sourceOf, random: () => 0 });
    if (!prepared.ok) throw new Error(prepared.reason);
    const { song: stitched, source } = prepared.prepared;
    const { map, connections } = prepared.prepared.stitched;
    expect(connections).toEqual(['cut']);
    expect(stitched).toMatchObject({ title: 'Nonstop', chartPath: 'nonstop.bms', sourceId: source.id, totalNotes: 6 });
    expect([...source.files.keys()].sort()).toEqual(['s0/a/a.wav', 's1/b/b.wav']);
    expect(map.stages).toHaveLength(2);
  });

  test('refuses a course with a stage missing from the collection', () => {
    const entry = course();
    entry.stages = [entry.stages[0]!, { title: 'gone' }];
    expect(prepareNonstopPlay(entry, { sourceOf })).toEqual({ ok: false, reason: 'missing-stage', stage: 1 });
  });
});

describe('a NONSTOP run in the demo', () => {
  test('records the stitched play with each stage cut out of it, named by its chart and file hashes', async () => {
    const prepared = prepareNonstopPlay(course(), {
      sourceOf,
      random: () => 0,
      hashesOf: (song) => ({ md5: song.id.repeat(32) }),
    });
    if (!prepared.ok) throw new Error(prepared.reason);
    const chart = prepared.prepared.song.chart;
    let playlog: BeMusicPlaylog | undefined;
    await manualPlay(chart, {
      speed: 16,
      leadInMs: 0,
      audio: false,
      tui: false,
      replayInputs: presses(chart),
      course: { kind: 'nonstop' },
      recordPlaylog: {},
      onPlaylogRecorded: (recorded) => {
        playlog = recorded;
      },
    });
    const log = buildNonstopCoursePlaylog(course().definition, prepared.prepared.stitched, playlog!, {
      createdAt: '2026-10-15T00:00:00.000Z',
    });
    expect(log.nonstop?.connections).toEqual(['cut']);
    expect(log.stages.map((entry) => entry.played)).toEqual([true, true]);
    const [first, second] = log.stages;
    expect(first!.played && first!.playlog.chart).toMatchObject({ title: 'A', md5: 'a'.repeat(32) });
    expect(second!.played && second!.playlog.chart.notes).toHaveLength(3);
    expect(log.results?.native).toMatchObject({ noteCount: 6, stagesPlayed: 2 });
    expect(simulatePlaylog(log.nonstop!.playlog, { ruleset: 'lr2' }).noteCount).toBe(6);
    // Each stage names its chart, which keys the course on the Leaderboard.
    expect(log.stages.map((entry) => entry.played && entry.playlog.chart.chartFingerprint)).toEqual(
      [STAGE_A, STAGE_B].map(({ song: entry }) => courseStageChartFingerprint(entry)),
    );

    // The Leaderboard gets every stage chart to stitch again, and no documents.
    const submission = prepareCourseLeaderboardSubmission(
      log,
      [STAGE_A, STAGE_B].map(({ song: entry }) => ({ chart: entry.chart, chartPath: entry.chartPath })),
    );
    expect(submission).toMatchObject({ ok: true, submission: { stages: [] } });
    expect(submission.ok && submission.submission.stageCharts.map((stage) => stage.stage)).toEqual([0, 1]);
  });
});
