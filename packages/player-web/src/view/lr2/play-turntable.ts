/**
 * The scratch turntable an LR2 play skin spins: the angle of the sprites a skin authors with `op4 = 1` (1P scratch) or
 * `op4 = 2` (2P scratch).
 *
 * - **Baseline**: the disc always spins forward at a constant angular velocity (1 rev/sec).
 * - **Press**: snaps the velocity to `±delta`. The delta is larger than the baseline, so a brake drives the disc
 *   visibly backwards, like a real DJ scratching the platter back.
 * - **Streak alternation**: a press within {@link TURNTABLE_STREAK_GAP_MS} of the previous one continues a "scratch
 *   run": the sign flips on each press, so rapid hits alternate forward / reverse. A press after a longer pause resets
 *   the streak, so an isolated press always brakes first.
 * - **Recovery**: between presses the velocity relaxes back to the baseline, so the disc resumes its idle spin.
 */

/** A side's scratch: `'1'` for 1P (channel 16), `'2'` for 2P (channel 26). */
export type Lr2TurntableSide = '1' | '2';

const TURNTABLE_BASELINE_RAD_PER_SEC = 2 * Math.PI;
/** Snap on each press; larger than the baseline so a brake genuinely reverses the disc. */
const TURNTABLE_PRESS_DELTA_RAD_PER_SEC = 3 * Math.PI;
const TURNTABLE_RECOVERY_PER_SEC = 3;
/**
 * Two presses this close (ms) count as one streak: faster than a casual isolated press, slower than the fastest
 * practical scratch tempo (about 10 Hz).
 */
const TURNTABLE_STREAK_GAP_MS = 250;

/** The turntable's motion. See the module comment. */
export class Lr2Turntable {
  private angle: Record<Lr2TurntableSide, number> = { '1': 0, '2': 0 };
  private velocity: Record<Lr2TurntableSide, number> = {
    '1': TURNTABLE_BASELINE_RAD_PER_SEC,
    '2': TURNTABLE_BASELINE_RAD_PER_SEC,
  };
  /** The direction the next press pushes the disc: `-1` brakes, `+1` pushes forward. */
  private nextSign: Record<Lr2TurntableSide, -1 | 1> = { '1': -1, '2': -1 };
  /** The last press per side, on the play clock, for the streak. */
  private lastImpulseAt: Record<Lr2TurntableSide, number> = {
    '1': Number.NEGATIVE_INFINITY,
    '2': Number.NEGATIVE_INFINITY,
  };
  private lastUpdateAt = 0;

  /** The disc's angle on `side`, in radians. */
  public angleOf(side: Lr2TurntableSide): number {
    return this.angle[side];
  }

  /** Back to angle 0, spinning at the baseline, with no streak: each chart starts the same. */
  public reset(): void {
    this.angle = { '1': 0, '2': 0 };
    this.velocity = { '1': TURNTABLE_BASELINE_RAD_PER_SEC, '2': TURNTABLE_BASELINE_RAD_PER_SEC };
    this.nextSign = { '1': -1, '2': -1 };
    this.lastImpulseAt = { '1': Number.NEGATIVE_INFINITY, '2': Number.NEGATIVE_INFINITY };
    this.lastUpdateAt = 0;
  }

  /**
   * A press on `channel` at `now` (play clock): a scratch lane (`16` for 1P, `26` for 2P) snaps its disc to the
   * streak's next direction; other lanes are left alone.
   */
  public impulse(channel: string, now: number): void {
    if (channel !== '16' && channel !== '26') return;
    const side: Lr2TurntableSide = channel === '16' ? '1' : '2';
    if (now - this.lastImpulseAt[side] > TURNTABLE_STREAK_GAP_MS) {
      this.nextSign[side] = -1;
    }
    const sign = this.nextSign[side];
    this.velocity[side] = sign * TURNTABLE_PRESS_DELTA_RAD_PER_SEC;
    this.nextSign[side] = sign === -1 ? 1 : -1;
    this.lastImpulseAt[side] = now;
  }

  /**
   * Integrates the motion up to `now` (play clock). It holds still through the intro (the chart has not started) and
   * while paused. Within a streak the snapped velocity holds, as a hand on the platter; out of one it relaxes toward the
   * baseline.
   */
  public update(now: number, state: { readonly introPlaying: boolean; readonly paused: boolean }): void {
    if (this.lastUpdateAt === 0) {
      this.lastUpdateAt = now;
      return;
    }
    if (state.introPlaying) {
      this.lastUpdateAt = now;
      return;
    }
    const dt = Math.max(0, (now - this.lastUpdateAt) / 1000);
    this.lastUpdateAt = now;
    if (state.paused || dt <= 0) return;
    const recovery = 1 - Math.exp(-TURNTABLE_RECOVERY_PER_SEC * dt);
    for (const side of ['1', '2'] as const) {
      this.angle[side] += this.velocity[side] * dt;
      if (now - this.lastImpulseAt[side] < TURNTABLE_STREAK_GAP_MS) continue;
      this.velocity[side] += (TURNTABLE_BASELINE_RAD_PER_SEC - this.velocity[side]) * recovery;
    }
  }
}
