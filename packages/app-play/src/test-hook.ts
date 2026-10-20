// The demo's test hook: `window.__beMusicTest`, a read-only view of what the demo shows, for the end-to-end suite
// (`packages/app-play/e2e`, `docs/course-checklist.md`). It reads state the host already keeps and the facts of
// each result screen and replay the host hands it; it never drives the demo. Files are loaded through the page's
// drop handler, as a person drops them.
//
// The shape is a contract: the scene router and host rewrite (docs/architecture.md, P5) keep every field meaning
// what it means here, and bump `version` when one changes.

import type { BeMusicCourseReplay, BeMusicReplay, ReplayCourseResult } from '@be-music/player-engine/replay';
import type { LibraryEntry, PlayResult } from '@be-music/player-scene-model';

/** The contract's revision. */
export const TEST_HOOK_VERSION = 1;

/** The skin family drawing a scene: the built-in be-music skins, an LR2 theme or a beatoraja skin. */
export type TestHookFamily = 'built-in' | 'lr2' | 'beatoraja';

/** The screen on show. `none` between screens (a scene being torn down or prepared) and before the first one. */
export type TestHookSceneKind = 'none' | 'select' | 'decide' | 'play' | 'result';

/** Judgments by kind. */
export interface TestHookJudged {
  pgreat: number;
  great: number;
  good: number;
  bad: number;
  poor: number;
}

/**
 * A bar on the select screen. A chart bar is `'song'`: contract v1 keeps the name the library entries had, although
 * `@be-music/player-scene-model` now calls the kind `'chart'`.
 */
export interface TestHookBar {
  kind: 'folder' | 'chart' | 'course';
  /** The folder label, the chart title or the course name. */
  title: string;
  /** A course bar. */
  course?: {
    kind: string;
    /** Each stage's title; a stage not in the library shows the course file's title. */
    stages: string[];
    /** Stages not found in the library. */
    missingStages: number;
    playable: boolean;
    /** LR2's NEW COURSE bar, which starts the course maker. */
    newCourse: boolean;
  };
  /** The best lamp kept for the chart or course, when there is one. */
  lamp?: string;
  /** The best trophy kept for the course, when there is one. */
  trophy?: string;
}

/** How the select screen's list is shaped: its sort and filters (`@be-music/player-scene-model`'s names) and the search. */
export interface TestHookList {
  sort: string;
  keysFilter: string;
  difficultyFilter: string;
  /** The search as typed; empty for none. */
  search: string;
}

/** The select screen's cursor: the folders open, root first, and the bar under it. */
export interface TestHookCursor {
  folderPath: string[];
  bar?: TestHookBar;
  /** How the list is shaped (the built-in and LR2 select screens). */
  list?: TestHookList;
}

/** The play on screen. */
export interface TestHookPlay {
  title: string;
  autoPlay: boolean;
  replay: boolean;
  /** The play tempo in force (1 = the chart's own). */
  tempo: number;
  /** The hi-speed in force (the LR2 and built-in scenes; a replay shows its recorded one). */
  hiSpeed?: number;
  /** Chart time so far, in seconds, once the play runs. */
  seconds?: number;
  /** Judgments so far. */
  judged?: TestHookJudged;
  /** The gauge now. */
  gauge?: { type?: string; value: number };
  /** A course stage: the course and the stage (1-based). */
  course?: { name: string; stage: number; stageCount: number };
}

/** One stage of a course result. */
export interface TestHookStageResult {
  title?: string;
  /** Given up with ESC. */
  aborted: boolean;
  judged: TestHookJudged;
  exScore: number;
  /** The course gauge: the value the stage started on (carried in; absent for the first stage) and ended on. */
  gauge: { type: string; start?: number; final: number };
}

/** A result screen, as the host showed it. */
export interface TestHookResult {
  /** A single play, a course stage, a whole EXPERT / GRADE course, or a NONSTOP run. */
  run: 'single' | 'stage' | 'course' | 'nonstop';
  family: TestHookFamily;
  title: string;
  lamp?: string;
  cleared: boolean;
  exScore: number;
  judged: TestHookJudged;
  gauge: { type?: string; value: number };
  /** PLAY TIME, in seconds. */
  playSeconds?: number;
  /** Where the jingle for the result's outcome comes from (`lr2:courseClear`, `beatoraja:clear`, ...). */
  jingle?: string;
  /** An EXPERT / GRADE course result. */
  course?: {
    name: string;
    kind: string;
    stageCount: number;
    stagesPlayed: number;
    /** A stage was given up with ESC. */
    aborted: boolean;
    trophy?: string;
    stages: TestHookStageResult[];
  };
}

/** What `window.__beMusicTest.state()` returns. Plain data. */
export interface TestHookState {
  version: number;
  scene: { kind: TestHookSceneKind; family?: TestHookFamily };
  /** The status line. */
  status: string;
  /** Every status line shown so far, oldest first (repeats included). */
  statusLog: string[];
  /** Dropped or picked files being read. */
  loading: boolean;
  /** Drops (and file picks) finished so far. */
  loads: number;
  /** Charts listed (`songs`, contract v1's name) and the course folders. */
  library: { charts: number; courseFolders: string[] };
  cursor?: TestHookCursor;
  play?: TestHookPlay;
  /** The course being made (LR2's course maker). */
  courseDraft?: { kind: string; stages: string[] };
  /** Every result screen shown, oldest first. */
  results: TestHookResult[];
  /** Replays recorded so far (see `lastReplay()`). */
  replays: number;
}

/** `window.__beMusicTest`. */
export interface BeMusicTestHook {
  readonly version: number;
  state(): TestHookState;
  /** The replay the last finished play recorded (a single play, a course stage or a NONSTOP run). */
  lastReplay(): BeMusicReplay | undefined;
}

declare global {
  interface Window {
    __beMusicTest?: BeMusicTestHook;
  }
}

/** What the host reads for {@link TestHookState} at each call. */
export type TestHookLiveState = Omit<TestHookState, 'version' | 'statusLog' | 'loads' | 'results' | 'replays'>;

/** Whether the hook is installed: with `?e2e=1`, or in a development build. */
export function isTestHookEnabled(href: string, dev: boolean): boolean {
  if (dev) return true;
  try {
    return new URL(href).searchParams.get('e2e') === '1';
  } catch {
    return false;
  }
}

/** Keeps what the host hands the hook (results, replays, finished loads) and answers `window.__beMusicTest`. */
export class TestHookRecorder {
  private readonly results: TestHookResult[] = [];
  private readonly replays: BeMusicReplay[] = [];
  private readonly statusLog: string[] = [];
  private loads = 0;

  /** Installs `__beMusicTest` on `target`, reading the host's live state through `live`. */
  install(target: { __beMusicTest?: BeMusicTestHook }, live: () => TestHookLiveState): void {
    target.__beMusicTest = {
      version: TEST_HOOK_VERSION,
      state: () => ({
        version: TEST_HOOK_VERSION,
        ...live(),
        statusLog: [...this.statusLog],
        loads: this.loads,
        results: [...this.results],
        replays: this.replays.length,
      }),
      lastReplay: () => this.replays.at(-1),
    };
  }

  /** A result screen is up. */
  recordResult(result: TestHookResult): void {
    this.results.push(result);
  }

  /** A play finished and recorded its log. */
  recordReplay(replay: BeMusicReplay | undefined): void {
    if (replay !== undefined) this.replays.push(replay);
  }

  /** The status line changed. */
  recordStatus(text: string): void {
    this.statusLog.push(text);
  }

  /** A drop or file pick finished loading. */
  recordLoad(): void {
    this.loads += 1;
  }
}

/** Judgments of a score or summary. */
export function judgedOf(score: {
  perfect: number;
  great: number;
  good: number;
  bad: number;
  poor: number;
}): TestHookJudged {
  return { pgreat: score.perfect, great: score.great, good: score.good, bad: score.bad, poor: score.poor };
}

/** A select-screen bar, with the best record kept for it (`record`). */
export function describeBar(entry: LibraryEntry, record?: { lamp?: string; trophy?: string }): TestHookBar {
  const kept = {
    ...(record?.lamp !== undefined ? { lamp: record.lamp } : {}),
    ...(record?.trophy !== undefined ? { trophy: record.trophy } : {}),
  };
  if (entry.kind === 'folder') return { kind: 'folder', title: entry.folder.label };
  // Contract v1 names a chart bar `'song'`.
  if (entry.kind === 'chart') return { kind: 'chart', title: entry.chart.title, ...kept };
  const { course } = entry;
  return {
    kind: 'course',
    title: course.definition.name,
    course: {
      kind: course.definition.kind,
      stages: course.stages.map((stage) => stage.title),
      missingStages:
        course.random !== undefined ? 0 : course.stages.filter((stage) => stage.chart === undefined).length,
      playable: course.playable,
      newCourse: course.newCourse === true,
    },
    ...kept,
  };
}

/** A result shown on the LR2 or built-in result view, from the data it was given. */
export function resultFromData(
  data: PlayResult,
  run: TestHookResult['run'],
  family: TestHookFamily,
  jingle?: string,
): TestHookResult {
  return {
    run,
    family,
    title: data.chart.title,
    ...(data.lamp !== undefined ? { lamp: data.lamp } : {}),
    cleared: data.cleared,
    exScore: data.score.exScore,
    judged: judgedOf(data.score),
    gauge: { ...(data.gaugeType !== undefined ? { type: data.gaugeType } : {}), value: data.gauge },
    playSeconds: data.playSeconds,
    ...(jingle !== undefined ? { jingle } : {}),
  };
}

/** An EXPERT / GRADE course result, from its course replay and the native course result. */
export function resultFromCourseLog(
  courseLog: BeMusicCourseReplay,
  result: ReplayCourseResult,
  options: { family: TestHookFamily; playSeconds?: number; jingle?: string },
): TestHookResult {
  const stages = courseLog.stages.flatMap((entry): TestHookStageResult[] => {
    if (!entry.played) return [];
    const { replay } = entry;
    const native = replay.results?.native;
    const start = replay.play.course?.carryIn?.gauge;
    return [
      {
        ...(replay.chart.title !== undefined ? { title: replay.chart.title } : {}),
        aborted: replay.play.aborted === true,
        judged: {
          pgreat: native?.judge.pgreat ?? 0,
          great: native?.judge.great ?? 0,
          good: native?.judge.good ?? 0,
          bad: native?.judge.bad ?? 0,
          poor: native?.judge.poor ?? 0,
        },
        exScore: native?.exScore ?? 0,
        gauge: {
          type: native?.gauge.type ?? '',
          ...(start !== undefined ? { start } : {}),
          final: native?.gauge.final ?? 0,
        },
      },
    ];
  });
  return {
    run: 'course',
    family: options.family,
    title: courseLog.course.name,
    lamp: result.lamp,
    cleared: result.gauge.cleared,
    exScore: result.exScore,
    judged: {
      pgreat: result.judge.pgreat,
      great: result.judge.great,
      good: result.judge.good,
      bad: result.judge.bad,
      poor: result.judge.poor,
    },
    gauge: { type: result.gauge.type, value: result.gauge.final },
    ...(options.playSeconds !== undefined ? { playSeconds: options.playSeconds } : {}),
    ...(options.jingle !== undefined ? { jingle: options.jingle } : {}),
    course: {
      name: courseLog.course.name,
      kind: courseLog.course.kind,
      stageCount: courseLog.stages.length,
      stagesPlayed: result.stagesPlayed,
      aborted: stages.some((stage) => stage.aborted),
      ...(result.trophy !== undefined ? { trophy: result.trophy } : {}),
      stages,
    },
  };
}

/**
 * Names the jingle `bytes` by the theme slot it was loaded into (`lr2:courseClear`, `beatoraja:fail`, ...), the first
 * slot holding those very bytes; `undefined` for no jingle or one from elsewhere.
 */
export function nameJingle(
  bytes: Uint8Array | undefined,
  sets: Readonly<Record<string, Readonly<Record<string, Uint8Array | undefined>>>>,
): string | undefined {
  if (bytes === undefined) return undefined;
  for (const [family, slots] of Object.entries(sets)) {
    for (const [slot, candidate] of Object.entries(slots)) {
      if (candidate === bytes) return `${family}:${slot}`;
    }
  }
  return undefined;
}
