/**
 * The ghost as a pacemaker with its recorded inputs over the player's own lanes (the `'lane-overlay'`
 * {@link GhostPresentation}): the pacemaker of `pacemaker-ghost.ts`, and on the live lanes the ghost's key presses as
 * hollow beams and its judgments as flashes (`view/shared/playfield/ghost-lanes.ts`), in a colour of their own. The
 * replay's lanes are its own (after its lane options), so a ghost recorded under another RANDOM presses other lanes than
 * the live chart's notes ask for.
 *
 * It writes only into its own {@link GhostLaneOverlay}, which the playfield it presents carries as `ghostLanes`; the live
 * play's key beams, bombs and judgments are never touched. The pacemaker runs on every family's view; the lane marks
 * draw only on a built-in one.
 */

import type { GhostLaneOverlay } from '../../../view/shared/playfield/ghost-lanes.ts';
import type { PlayfieldRuntime } from '../../../view/shared/playfield/context.ts';
import type { GhostTimeline } from './ghost-timeline.ts';
import { DEFAULT_GHOST_LABEL, PacemakerGhost } from './pacemaker-ghost.ts';
import { PresentedPlayfield } from './presented-playfield.ts';

/** A step further behind the playhead than this is caught up silently: no beam, no flash for it. */
const EFFECT_WINDOW_SECONDS = 0.25;

/** The pacemaker with the lane marks. See the module comment. */
export class LaneOverlayGhost extends PacemakerGhost {
  /** What the ghost shows on the lanes; exposed for the tests. */
  public readonly overlay: GhostLaneOverlay = { pressedAt: new Map(), releasedAt: new Map(), flashes: new Map() };
  private readonly timeline: GhostTimeline;
  /** The live lanes: the ghost's inputs on others show nowhere. */
  private readonly channels: ReadonlySet<string>;
  private readonly presented = new PresentedPlayfield();
  private seconds = Number.NEGATIVE_INFINITY;
  private inputCursor = 0;
  private judgmentCursor = 0;

  public constructor(timeline: GhostTimeline, laneChannels: readonly string[], label: string = DEFAULT_GHOST_LABEL) {
    super(timeline, label);
    this.timeline = timeline;
    this.channels = new Set(laneChannels);
  }

  public override update(seconds: number, nowMs: number): void {
    if (seconds < this.seconds) this.rewind();
    this.seconds = seconds;
    const { inputs, judgments } = this.timeline;
    const { pressedAt, releasedAt, flashes } = this.overlay;
    while (this.inputCursor < inputs.length && inputs[this.inputCursor]!.seconds <= seconds) {
      const input = inputs[this.inputCursor]!;
      this.inputCursor += 1;
      if (!this.channels.has(input.channel)) continue;
      if (input.pressed) {
        if (seconds - input.seconds > EFFECT_WINDOW_SECONDS) continue;
        pressedAt.set(input.channel, nowMs);
        releasedAt.delete(input.channel);
      } else if (pressedAt.has(input.channel)) {
        // A release is never skipped, so a key caught up past is not left held.
        releasedAt.set(input.channel, nowMs);
      }
    }
    while (this.judgmentCursor < judgments.length && judgments[this.judgmentCursor]!.seconds <= seconds) {
      const step = judgments[this.judgmentCursor]!;
      this.judgmentCursor += 1;
      if (step.channel === undefined || !this.channels.has(step.channel)) continue;
      if (seconds - step.seconds > EFFECT_WINDOW_SECONDS) continue;
      flashes.set(step.channel, { judgment: step.judgment, atMs: nowMs });
    }
  }

  public override present(play: PlayfieldRuntime): PlayfieldRuntime {
    return this.presented.present(play, { ghostLanes: this.overlay });
  }

  /** Back to the chart's start: nothing of the ghost's left on the lanes. */
  private rewind(): void {
    this.inputCursor = 0;
    this.judgmentCursor = 0;
    this.overlay.pressedAt.clear();
    this.overlay.releasedAt.clear();
    this.overlay.flashes.clear();
  }
}
