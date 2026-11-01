import { normalizeCourseConstraints } from '@be-music/player-engine/course';
import type {
  BeMusicCourseReplay,
  BeMusicReplay,
  ReplayCourseResult,
  ReplayRulesetResult,
} from '@be-music/player-engine/replay';

/** Why a course run that passed `checkCourseReplayEligibility` is still refused. */
export type CourseRunRejection =
  /** The stages were judged under different rulesets. */
  | 'course-ruleset-mismatch'
  /** A stage did not play under the course's constraints (gauge set, judge constraint, lane option). */
  | 'course-constraint-mismatch'
  /** A stage's recorded carry-in is not the state the previous stage, re-simulated, left; or a stage was played after one that failed. */
  | 'course-carry-in-mismatch'
  /** The run stopped before the last stage without failing one or being given up on its last stage played. */
  | 'aborted';

export type CourseRunCheck = { ok: true } | { ok: false; reason: CourseRunRejection; stage?: number };

/** How far a recorded carry-in gauge may sit from the re-simulated one (float noise; the value is a percentage). */
const CARRY_GAUGE_TOLERANCE = 1e-3;

/** The stage settings a course's constraints give (`gauge_*` → gauge set, `no_good` / `no_great` → judge). */
function expectedStageSettings(constraints: readonly string[]) {
  const normalized = normalizeCourseConstraints(constraints);
  const gaugeSet = normalized.find((name) => name.startsWith('gauge_'))?.slice('gauge_'.length);
  const judge = normalized.includes('no_good') ? 'no-good' : normalized.includes('no_great') ? 'no-great' : undefined;
  const lane = normalized.includes('grade')
    ? ['OFF']
    : normalized.includes('grade_mirror')
      ? ['OFF', 'MIRROR']
      : undefined;
  return { gaugeSet, judge, lane };
}

function laneAllowed(replay: BeMusicReplay, allowed: readonly string[] | undefined): boolean {
  if (allowed === undefined) return true;
  // A chart that forces its own arrangement (#844) wins over the course's lane lock, as over the player's choice.
  if (replay.chart.chartPlayOptions?.options.random !== undefined) return true;
  const { play } = replay;
  const sides = [play.randomLane?.p1, play.randomLane?.p2].map((side) => (side ?? 'OFF').toUpperCase());
  return sides.every((side) => allowed.includes(side));
}

/** Whether a play ran on the course's gauge set and judge constraint, with a lane option the course allows. */
function playsUnderConstraints(replay: BeMusicReplay, expected: ReturnType<typeof expectedStageSettings>): boolean {
  const course = replay.play.course;
  return (
    course !== undefined &&
    course.gaugeSet === expected.gaugeSet &&
    course.judge === expected.judge &&
    laneAllowed(replay, expected.lane)
  );
}

/** A stage the re-simulation ended the course on: its survival gauge emptied, as `simulateCourseReplay` stops. */
function stageFailed(result: ReplayRulesetResult): boolean {
  return result.gauge.failedMidPlay === true || result.gauge.final <= 0;
}

/**
 * The checks a course run needs beyond each stage's own (docs/leaderboard.md section 6.1), given the run re-simulated
 * under the ruleset it was played with (`simulateCourseReplay`):
 *
 * - every stage played under the course's constraints: the gauge set and judge constraint in `play.course`, and a lane
 *   option the course allows (`grade` OFF only, `grade_mirror` OFF or MIRROR), unless the stage's chart forced its own
 *   arrangement (`chart.chartPlayOptions.options.random`, which wins over the lock);
 * - every stage after the first carried in exactly the state the previous stage, re-simulated, left (gauge, course
 *   combo and max combo), and the first carried in nothing;
 * - no stage was played after one that failed, and a run that stopped before the last stage stopped because its last
 *   stage played failed or was given up (ESC, `play.aborted`). A course given up is a failed run, as LR2 records it.
 *
 * A NONSTOP run was one play of the stitched chart: only that play's settings are checked against the constraints. It
 * carried nothing in, and wherever it stopped (cleared, failed, or given up with ESC) the re-simulation scores it.
 */
export function checkCourseRun(courseLog: BeMusicCourseReplay, simulated: ReplayCourseResult): CourseRunCheck {
  const expected = expectedStageSettings(courseLog.course.constraints);
  if (courseLog.nonstop !== undefined) {
    return playsUnderConstraints(courseLog.nonstop.replay, expected)
      ? { ok: true }
      : { ok: false, reason: 'course-constraint-mismatch' };
  }
  const played = courseLog.stages.filter((entry) => entry.played).map((entry) => entry.replay);
  for (const [index, stage] of played.entries()) {
    if (!playsUnderConstraints(stage, expected)) {
      return { ok: false, reason: 'course-constraint-mismatch', stage: index };
    }
  }
  if (simulated.stages.length < played.length) {
    // The re-simulation ended the course at a stage the log played past.
    return { ok: false, reason: 'course-carry-in-mismatch', stage: simulated.stages.length };
  }
  for (const [index, stage] of played.entries()) {
    const carryIn = stage.play.course?.carryIn;
    const previous = index > 0 ? simulated.stages[index - 1] : undefined;
    if (previous === undefined) {
      if (carryIn !== undefined) return { ok: false, reason: 'course-carry-in-mismatch', stage: index };
      continue;
    }
    const combo = previous.course?.combo ?? 0;
    const maxCombo = previous.course?.maxCombo ?? previous.maxCombo;
    if (
      carryIn === undefined ||
      Math.abs(carryIn.gauge - previous.gauge.final) > CARRY_GAUGE_TOLERANCE ||
      carryIn.combo !== combo ||
      carryIn.maxCombo !== maxCombo
    ) {
      return { ok: false, reason: 'course-carry-in-mismatch', stage: index };
    }
  }
  const last = simulated.stages.at(-1);
  const givenUp = played.at(-1)?.play.aborted === true;
  if (played.length < courseLog.stages.length && !givenUp && (last === undefined || !stageFailed(last))) {
    return { ok: false, reason: 'aborted', stage: played.length - 1 };
  }
  return { ok: true };
}
