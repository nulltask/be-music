/**
 * A play view's touch lanes on the canvas: follows the fingers through the canvas's pointer events
 * ({@link TouchLaneFingers}) and sends the session a `lane` intent for each lane a finger presses or releases. While
 * attached, the canvas takes `touch-action: none`, so the page does not scroll or zoom under the fingers.
 */

import type { PixiSceneHost } from '../../host/scene-host.ts';
import type { IntentSink, PlayIntent, PlayfieldSkin, PlayfieldStage } from '../types.ts';
import type { PlayfieldRuntime } from './playfield/context.ts';
import { TouchLaneFingers, type TouchLaneRect } from './touch-lanes.ts';

/** Where a view's touch lanes are, and how often the play has lifted every finger (`PlayfieldRuntime.touchLiftCount`). */
export interface TouchLaneSource {
  /** The design stage the lanes are laid out on, as the view fits it into the canvas. */
  stage(): PlayfieldStage;
  /** The lanes as laid out on the stage. */
  lanes(): Iterable<TouchLaneRect>;
  /** How many times the play has lifted every finger (a pause). */
  liftCount(): number;
}

/**
 * The touch lanes of a view drawing the shared playfield (the built-in and LR2 views): the lanes it laid out
 * (`PlayfieldRuntime.laneX`) on its skin's stage. Read at each finger event, so a stage that turns with the screen and
 * lanes laid out anew count at once.
 */
export function playfieldTouchLanes(view: {
  readonly play: Pick<PlayfieldRuntime, 'laneX' | 'touchLiftCount'>;
  readonly playfieldSkin: Pick<PlayfieldSkin, 'stage'>;
}): TouchLaneSource {
  return {
    stage: () => view.playfieldSkin.stage,
    lanes: () => Array.from(view.play.laneX, ([channel, lane]) => ({ channel, ...lane })),
    liftCount: () => view.play.touchLiftCount,
  };
}

/** A play view's touch lanes. See the module comment. */
export class TouchLaneInput {
  private readonly source: TouchLaneSource;
  private readonly fingers = new TouchLaneFingers();
  private host: PixiSceneHost | undefined;
  private emit: IntentSink<PlayIntent> | undefined;
  private previousTouchAction: string | undefined;

  public constructor(source: TouchLaneSource) {
    this.source = source;
  }

  /** Follows the fingers on `host`'s canvas, sending their intents to `emit`, until {@link detach}. */
  public attach(host: PixiSceneHost, emit: IntentSink<PlayIntent>): void {
    if (this.host !== undefined) this.detach();
    this.host = host;
    this.emit = emit;
    const canvas = host.app.canvas;
    this.previousTouchAction = canvas.style.touchAction;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this.handlePointer);
    canvas.addEventListener('pointermove', this.handlePointer);
    canvas.addEventListener('pointerup', this.handlePointer);
    canvas.addEventListener('pointercancel', this.handlePointer);
  }

  /** Stops following the fingers and forgets them (their lanes are the session's to let go), restoring the canvas. */
  public detach(): void {
    const host = this.host;
    if (host === undefined) return;
    const canvas = host.app.canvas;
    canvas.removeEventListener('pointerdown', this.handlePointer);
    canvas.removeEventListener('pointermove', this.handlePointer);
    canvas.removeEventListener('pointerup', this.handlePointer);
    canvas.removeEventListener('pointercancel', this.handlePointer);
    if (this.previousTouchAction !== undefined) canvas.style.touchAction = this.previousTouchAction;
    this.previousTouchAction = undefined;
    this.fingers.reset();
    this.host = undefined;
    this.emit = undefined;
  }

  private readonly handlePointer = (event: PointerEvent): void => {
    const host = this.host;
    if (host === undefined) return;
    const result = this.fingers.handle(
      event,
      () => ({ stage: this.source.stage(), screen: host.app.screen, lanes: this.source.lanes() }),
      this.source.liftCount(),
    );
    if (result.preventDefault) event.preventDefault();
    for (const intent of result.intents) this.emit?.(intent);
  };
}
