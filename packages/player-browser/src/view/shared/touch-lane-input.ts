/**
 * A play view's touch lanes on the canvas, or on the element a DOM playfield is drawn in: follows the fingers through its
 * pointer events ({@link TouchLaneFingers}) and sends the session a `lane` intent for each lane a finger presses or
 * releases. While attached, the element takes `touch-action: none`, so the page does not scroll or zoom under the
 * fingers.
 */

import type { PixiSceneHost } from '../../host/scene-host.ts';
import type { IntentSink, PlayIntent, PlayfieldSkin, PlayfieldStage } from '../types.ts';
import type { PlayfieldRuntime } from './playfield/context.ts';
import { TouchLaneFingers, type TouchLanePointer, type TouchLaneRect } from './touch-lanes.ts';

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
  private target: HTMLElement | undefined;
  private emit: IntentSink<PlayIntent> | undefined;
  private previousTouchAction: string | undefined;

  public constructor(source: TouchLaneSource) {
    this.source = source;
  }

  /**
   * Follows the fingers on `target` (`host`'s canvas by default; another element must cover the same area), sending
   * their intents to `emit`, until {@link detach}.
   */
  public attach(host: PixiSceneHost, emit: IntentSink<PlayIntent>, target: HTMLElement = host.app.canvas): void {
    if (this.host !== undefined) this.detach();
    this.host = host;
    this.target = target;
    this.emit = emit;
    this.previousTouchAction = target.style.touchAction;
    target.style.touchAction = 'none';
    target.addEventListener('pointerdown', this.handlePointer);
    target.addEventListener('pointermove', this.handlePointer);
    target.addEventListener('pointerup', this.handlePointer);
    target.addEventListener('pointercancel', this.handlePointer);
  }

  /** Stops following the fingers and forgets them (their lanes are the session's to let go), restoring the canvas. */
  public detach(): void {
    const target = this.target;
    if (target === undefined) return;
    target.removeEventListener('pointerdown', this.handlePointer);
    target.removeEventListener('pointermove', this.handlePointer);
    target.removeEventListener('pointerup', this.handlePointer);
    target.removeEventListener('pointercancel', this.handlePointer);
    if (this.previousTouchAction !== undefined) target.style.touchAction = this.previousTouchAction;
    this.previousTouchAction = undefined;
    this.fingers.reset();
    this.host = undefined;
    this.target = undefined;
    this.emit = undefined;
  }

  private readonly handlePointer = (event: PointerEvent): void => {
    const host = this.host;
    const target = this.target;
    if (host === undefined || target === undefined) return;
    if (target === host.app.canvas) {
      this.forward(
        event,
        this.fingers.handle(
          event,
          () => ({ stage: this.source.stage(), screen: host.app.screen, lanes: this.source.lanes() }),
          this.source.liftCount(),
        ),
      );
      return;
    }
    // A finger touching down on a control inside the element (a HUD button) is the control's.
    if (event.type === 'pointerdown' && event.target !== target) return;
    const box = target.getBoundingClientRect();
    this.forward(
      event,
      this.fingers.handle(
        pointerInBox(event, box),
        () => ({ stage: this.source.stage(), screen: box, lanes: this.source.lanes() }),
        this.source.liftCount(),
      ),
    );
  };

  private forward(event: PointerEvent, result: ReturnType<TouchLaneFingers['handle']>): void {
    if (result.preventDefault) event.preventDefault();
    for (const intent of result.intents) this.emit?.(intent);
  }
}

/** `event` with its position measured from the top-left corner of `box` (an element's client rect), in CSS pixels. */
export function pointerInBox(
  event: Pick<PointerEvent, 'type' | 'pointerId' | 'pointerType' | 'timeStamp' | 'clientX' | 'clientY'>,
  box: { readonly left: number; readonly top: number },
): TouchLanePointer {
  return {
    type: event.type,
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    timeStamp: event.timeStamp,
    offsetX: event.clientX - box.left,
    offsetY: event.clientY - box.top,
  };
}
