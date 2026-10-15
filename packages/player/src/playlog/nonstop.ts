import { resolveChart } from '@be-music/chart';
import type { BeMusicJson } from '@be-music/json';
import type { NonstopConnection } from '../course/definition.ts';
import type { NonstopStitchMap } from '../course/nonstop/compose.ts';
import type { BeMusicPlaylog, PlaylogChart, PlaylogInputEvent, PlaylogJudgeRank, PlaylogNote } from './format.ts';
import { simulatePlaylog, type SimulatePlaylogOptions } from './simulate.ts';

/**
 * A NONSTOP course run (`BeMusicCoursePlaylog.nonstop`): the play of the stitched chart, which is what was judged, and
 * where each stage sat in it. The course log's `stages` hold each reached stage cut out of it
 * ({@link splitNonstopPlaylog}), so a stage still replays on its own.
 */
export interface PlaylogNonstopRun {
  connections: NonstopConnection[];
  placement: 'intended' | 'lr2';
  /** The stitched play, as recorded: authoritative for the course result. */
  playlog: BeMusicPlaylog;
  stages: PlaylogNonstopStage[];
  /** The stage each note of {@link playlog} belongs to, by note id. */
  noteStages: number[];
}

/** Where one stage sat in a stitched NONSTOP play, in its µs clock. */
export interface PlaylogNonstopStage {
  /** Stitched time of the stage's own time zero. */
  offsetUs: number;
  /** The span the stage owned: from the previous boundary to its own (open for the last stage). */
  windowStartUs: number;
  windowEndUs?: number;
  /** FIT's time-stretch the stage was played at (1 without FIT). */
  rate: number;
}

const toUs = (seconds: number): number => Math.round(seconds * 1_000_000);

/** The {@link PlaylogNonstopStage}s of a stitched chart's map. */
export function resolveNonstopPlaylogStages(map: NonstopStitchMap): PlaylogNonstopStage[] {
  return map.stages.map((stage) => ({
    offsetUs: toUs(stage.placement.offsetSeconds),
    windowStartUs: toUs(stage.windowStart),
    ...(Number.isFinite(stage.windowEnd) ? { windowEndUs: toUs(stage.windowEnd) } : {}),
    rate: stage.placement.rate,
  }));
}

/**
 * The stage of every note of a stitched play log, by note id. A judged or invisible note belongs to the stage whose
 * keysound it plays (the stitched keys are per stage); a mine, whose value is its damage, to the stage whose window it
 * falls in. Notes are matched to the stitched chart by time and type, since a play log lists them by time and lane after
 * the lane options moved them.
 */
export function resolveNonstopNoteStages(
  stitchedChart: BeMusicJson,
  map: NonstopStitchMap,
  notes: readonly PlaylogNote[],
): number[] {
  const stageOfKey = new Map<string, number>();
  map.stages.forEach((stage, index) => stage.wavKeys.forEach((key) => stageOfKey.set(key, index)));
  const windows = resolveNonstopPlaylogStages(map);
  const stageAt = (timeUs: number): number => {
    const index = windows.findIndex((window) => window.windowEndUs === undefined || timeUs < window.windowEndUs);
    return index < 0 ? windows.length - 1 : index;
  };
  const resolved = resolveChart(stitchedChart);
  const pending = new Map<string, number[]>();
  const add = (timeUs: number, type: string, stage: number): void => {
    const slot = `${timeUs}:${type}`;
    pending.set(slot, [...(pending.get(slot) ?? []), stage]);
  };
  for (const note of resolved.notes) {
    const type = note.kind === 'ln' ? 'long' : 'normal';
    add(toUs(note.seconds), type, stageOfKey.get(note.sampleKey) ?? stageAt(toUs(note.seconds)));
  }
  for (const note of resolved.invisibleNotes) {
    add(toUs(note.seconds), 'invisible', stageOfKey.get(note.sampleKey) ?? stageAt(toUs(note.seconds)));
  }
  for (const [slot, stages] of pending)
    pending.set(
      slot,
      stages.sort((left, right) => left - right),
    );
  return notes.map((note) => {
    if (note.type === 'mine') return stageAt(note.timeUs);
    const type = note.type === 'freezone' ? 'long' : note.type;
    return pending.get(`${note.timeUs}:${type}`)?.shift() ?? stageAt(note.timeUs);
  });
}

/** The facts of a stage chart its cut-out log names: what identifies it and its title. */
export type NonstopStageChartFacts = Pick<
  PlaylogChart,
  'title' | 'subtitle' | 'artist' | 'genre' | 'playLevel' | 'difficulty' | 'sha256' | 'md5' | 'chartFingerprint'
>;

/**
 * Cuts each reached stage out of a stitched NONSTOP play log as a self-contained single-chart log:
 *
 * - its notes, timed from the stage's own zero (`offsetUs`), still at the FIT-stretched speed it was played at
 *   (`play.course.rate` records the stretch);
 * - the inputs that played them: a press goes to the stage of the nearest note on its lanes (to the stage whose window it
 *   falls in when its lanes have none), a release with the press it ends;
 * - the state the stitched play was in when the stage began (`play.course.carryIn`), simulated under `options`.
 *
 * A stage is reached when the play got to its window. Judgments of a cut-out stage can differ from the stitched play at
 * the seams (a press there may have judged the other stage's note); the course result always comes from the stitched
 * play.
 */
export function splitNonstopPlaylog(
  run: Pick<PlaylogNonstopRun, 'playlog' | 'stages' | 'noteStages'>,
  stageCharts: readonly NonstopStageChartFacts[],
  options: Omit<SimulatePlaylogOptions, 'course'>,
): BeMusicPlaylog[] {
  const { playlog, stages, noteStages } = run;
  const endUs = playlog.play.aborted === true ? (playlog.play.abortedAtUs ?? Number.POSITIVE_INFINITY) : undefined;
  const lastInputUs = playlog.inputs.at(-1)?.timeUs ?? 0;
  const reachedUntil = endUs ?? Math.max(lastInputUs, ...playlog.chart.notes.map((note) => note.timeUs));
  const inputStages = assignInputs(playlog, noteStages, stages);
  const logs: BeMusicPlaylog[] = [];
  stages.forEach((stage, index) => {
    if (index > 0 && stage.windowStartUs > reachedUntil) return;
    const notes = playlog.chart.notes
      .filter((note) => noteStages[note.id] === index)
      .map((note, id): PlaylogNote => {
        const local: PlaylogNote = { ...note, id, timeUs: note.timeUs - stage.offsetUs };
        if (note.endTimeUs !== undefined) local.endTimeUs = note.endTimeUs - stage.offsetUs;
        return local;
      });
    const inputs = playlog.inputs
      .filter((_input, position) => inputStages[position] === index)
      .map((input, seq): PlaylogInputEvent => ({ ...input, seq, timeUs: input.timeUs - stage.offsetUs }));
    const course = { ...(playlog.play.course ?? { kind: 'nonstop' as const }), rate: stage.rate };
    delete course.carryIn;
    if (index > 0) {
      const before = carryAt(playlog, stage.windowStartUs, options);
      course.carryIn = before;
    }
    const facts = stageCharts[index] ?? {};
    const stageLog: BeMusicPlaylog = {
      format: playlog.format,
      version: playlog.version,
      ...(playlog.createdAt !== undefined ? { createdAt: playlog.createdAt } : {}),
      ...(playlog.recorder !== undefined ? { recorder: playlog.recorder } : {}),
      clock: playlog.clock,
      chart: {
        ...facts,
        sourceFormat: 'bms',
        laneMode: playlog.chart.laneMode,
        lnMode: playlog.chart.lnMode,
        judgeRank: shiftJudgeRank(playlog.chart.judgeRank, stage.offsetUs),
        noteCount: notes.filter((note) => note.type === 'normal' || note.type === 'long').length,
        notes,
        ...(playlog.chart.total !== undefined ? { total: playlog.chart.total } : {}),
      },
      inputs,
      play: { ...playlog.play, course },
    };
    if (endUs !== undefined && endUs < (stage.windowEndUs ?? Number.POSITIVE_INFINITY)) {
      stageLog.play.abortedAtUs = endUs - stage.offsetUs;
    } else {
      delete stageLog.play.aborted;
      delete stageLog.play.abortedAtUs;
    }
    logs.push(stageLog);
  });
  return logs;
}

/** The stitched play's judge rank in a stage's own clock: its rank changes moved by the stage's offset. */
function shiftJudgeRank(judgeRank: PlaylogJudgeRank, offsetUs: number): PlaylogJudgeRank {
  const shifted: PlaylogJudgeRank = { ...judgeRank };
  if (judgeRank.timeline !== undefined) {
    shifted.timeline = judgeRank.timeline.map((change) => ({ ...change, timeUs: change.timeUs - offsetUs }));
  }
  if (judgeRank.stageRanks !== undefined) {
    shifted.stageRanks = judgeRank.stageRanks.map((change) => ({ ...change, timeUs: change.timeUs - offsetUs }));
  }
  return shifted;
}

/** The stage each input of a stitched play goes to (see {@link splitNonstopPlaylog}). */
function assignInputs(
  playlog: BeMusicPlaylog,
  noteStages: readonly number[],
  stages: readonly PlaylogNonstopStage[],
): number[] {
  const byChannel = new Map<string, PlaylogNote[]>();
  for (const note of playlog.chart.notes) {
    if (note.type === 'mine' || note.type === 'invisible') continue;
    byChannel.set(note.channel, [...(byChannel.get(note.channel) ?? []), note]);
  }
  const windowStage = (timeUs: number): number => {
    const index = stages.findIndex((stage) => stage.windowEndUs === undefined || timeUs < stage.windowEndUs);
    return index < 0 ? stages.length - 1 : index;
  };
  const held = new Map<string, number>();
  return playlog.inputs.map((input) => {
    if (input.action === 'up') {
      const stage = input.channels.map((channel) => held.get(channel)).find((value) => value !== undefined);
      for (const channel of input.channels) held.delete(channel);
      return stage ?? windowStage(input.timeUs);
    }
    let nearest: PlaylogNote | undefined;
    for (const channel of input.channels) {
      for (const note of byChannel.get(channel) ?? []) {
        if (nearest === undefined || Math.abs(note.timeUs - input.timeUs) < Math.abs(nearest.timeUs - input.timeUs)) {
          nearest = note;
        }
      }
    }
    const stage =
      nearest !== undefined ? (noteStages[nearest.id] ?? windowStage(input.timeUs)) : windowStage(input.timeUs);
    for (const channel of input.channels) held.set(channel, stage);
    return stage;
  });
}

/** The gauge and combo a stitched play had reached at `timeUs`: the play simulated up to that point. */
function carryAt(
  playlog: BeMusicPlaylog,
  timeUs: number,
  options: Omit<SimulatePlaylogOptions, 'course'>,
): { gauge: number; combo: number; maxCombo: number } {
  const upTo: BeMusicPlaylog = {
    ...playlog,
    inputs: playlog.inputs.filter((input) => input.timeUs < timeUs),
    play: { ...playlog.play, aborted: true, abortedAtUs: timeUs },
  };
  const result = simulatePlaylog(upTo, options);
  return {
    gauge: result.gauge.final,
    combo: result.course?.combo ?? 0,
    maxCombo: result.course?.maxCombo ?? result.maxCombo,
  };
}
