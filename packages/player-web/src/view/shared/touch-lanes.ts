/**
 * Touch play for the play views: which lane a touch point lands in, how fingers pressing, holding, sliding and lifting
 * turn into lane presses and releases, and the `lane` intents ({@link PlayIntent}) a pointer event makes
 * ({@link TouchLaneFingers}). Kept free of DOM and Pixi so the rules can be tested on their own; a play view feeds it
 * its pointer events (`touch-lane-input.ts`) and sends the intents to the session, which presses the lanes through the
 * engine's input.
 */

import type { PlayIntent, PlayfieldStage } from '../types.ts';
import { resolveScaledViewport } from '../../stage/viewport.ts';

/** A lane column as the gameplay layout places it, in design pixels (`bottom` is the judgement line). */
export interface TouchLaneRect {
  readonly channel: string;
  readonly x: number;
  readonly w: number;
  readonly top: number;
  readonly bottom: number;
}

/** The area a finger presses a lane through, in design pixels. `right` and `bottom` are exclusive. */
export interface TouchLaneZone {
  readonly channel: string;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface TouchLaneZoneOptions {
  /** Height of the stage; zones run from their top down to it, past the judgement line. */
  readonly stageHeight: number;
  /** Share of the lane above the judgement line a zone covers. Defaults to 0.45. */
  readonly heightRatio?: number;
  /** Smallest height above the judgement line a zone covers, for short lanes. Defaults to 80. */
  readonly minHeight?: number;
  /** How far a zone reaches past an outer lane edge (one with no neighbour beside it). Defaults to 16. */
  readonly edgePadding?: number;
}

const DEFAULT_HEIGHT_RATIO = 0.45;
const DEFAULT_MIN_HEIGHT = 80;
const DEFAULT_EDGE_PADDING = 16;

/**
 * Touch zones for the lanes: each covers its lane column from the lower part of the lane (`heightRatio` of it, at least
 * `minHeight`) down past the judgement line to the bottom of the stage. Neighbouring lanes split the gap (or overlap)
 * between them at its midpoint, so a finger landing on a lane divider still presses one of the two; lanes further apart
 * than either lane's width — the two sides of a DP layout — are not joined, and every unjoined edge reaches out by
 * `edgePadding` (at most half the lane's width). Zones come back ordered left to right; lanes without width are skipped.
 */
export function resolveTouchLaneZones(lanes: Iterable<TouchLaneRect>, options: TouchLaneZoneOptions): TouchLaneZone[] {
  const heightRatio = options.heightRatio ?? DEFAULT_HEIGHT_RATIO;
  const minHeight = options.minHeight ?? DEFAULT_MIN_HEIGHT;
  const edgePadding = options.edgePadding ?? DEFAULT_EDGE_PADDING;
  const sorted = [...lanes].filter((lane) => lane.w > 0).sort((a, b) => a.x - b.x);
  const lefts = sorted.map((lane) => lane.x - Math.min(edgePadding, lane.w / 2));
  const rights = sorted.map((lane) => lane.x + lane.w + Math.min(edgePadding, lane.w / 2));
  for (let index = 0; index + 1 < sorted.length; index += 1) {
    const current = sorted[index]!;
    const next = sorted[index + 1]!;
    const gap = next.x - (current.x + current.w);
    if (gap > Math.max(current.w, next.w)) continue;
    const split = (current.x + current.w + next.x) / 2;
    rights[index] = split;
    lefts[index + 1] = split;
  }
  return sorted.map((lane, index) => {
    const reach = Math.max(minHeight, (lane.bottom - lane.top) * heightRatio);
    return {
      channel: lane.channel,
      left: lefts[index]!,
      right: rights[index]!,
      top: Math.max(lane.top, lane.bottom - reach),
      bottom: Math.max(options.stageHeight, lane.bottom),
    };
  });
}

/** The channel of the zone containing (`x`, `y`), or `undefined` when the point is in none. */
export function hitTestTouchLane(zones: readonly TouchLaneZone[], x: number, y: number): string | undefined {
  for (const zone of zones) {
    if (x >= zone.left && x < zone.right && y >= zone.top && y < zone.bottom) return zone.channel;
  }
  return undefined;
}

/** Lanes that went down and came up because of one finger event. */
export interface TouchLaneChange {
  readonly pressed: readonly string[];
  readonly released: readonly string[];
}

const NO_CHANGE: TouchLaneChange = { pressed: [], released: [] };

/**
 * Tracks which lane each finger is on. A lane is held while at least one finger is on it: the first finger to reach it
 * presses it, and the last to leave (lift off, or slide into another lane or out of every lane) releases it. A finger
 * that touches down outside every lane is still tracked, so sliding it into a lane presses that lane.
 */
export class TouchLaneTracker {
  private readonly laneByPointer = new Map<number, string | undefined>();
  private readonly fingersByLane = new Map<string, number>();

  /** A finger touched down at `channel` (`undefined` outside every lane). A pointer already down is treated as a move. */
  public down(pointerId: number, channel: string | undefined): TouchLaneChange {
    if (!this.laneByPointer.has(pointerId)) this.laneByPointer.set(pointerId, undefined);
    return this.move(pointerId, channel);
  }

  /** A finger that is down moved to `channel`. Ignored for pointers that are not down. */
  public move(pointerId: number, channel: string | undefined): TouchLaneChange {
    if (!this.laneByPointer.has(pointerId)) return NO_CHANGE;
    const previous = this.laneByPointer.get(pointerId);
    if (previous === channel) return NO_CHANGE;
    this.laneByPointer.set(pointerId, channel);
    const released = previous !== undefined && this.leave(previous) ? [previous] : [];
    const pressed = channel !== undefined && this.enter(channel) ? [channel] : [];
    return { pressed, released };
  }

  /** A finger lifted (or the browser cancelled it). Ignored for pointers that are not down. */
  public up(pointerId: number): TouchLaneChange {
    if (!this.laneByPointer.has(pointerId)) return NO_CHANGE;
    const previous = this.laneByPointer.get(pointerId);
    this.laneByPointer.delete(pointerId);
    return { pressed: [], released: previous !== undefined && this.leave(previous) ? [previous] : [] };
  }

  /** Lifts every finger, releasing every held lane (used when play pauses, loses focus, or ends). */
  public upAll(): TouchLaneChange {
    const released = [...this.fingersByLane.keys()];
    this.laneByPointer.clear();
    this.fingersByLane.clear();
    return { pressed: [], released };
  }

  /** Lanes held by at least one finger. */
  public heldLanes(): string[] {
    return [...this.fingersByLane.keys()];
  }

  /** Whether `pointerId` is a finger this tracker follows. */
  public isTracking(pointerId: number): boolean {
    return this.laneByPointer.has(pointerId);
  }

  /** Adds a finger to `channel`; true when it is the lane's first. */
  private enter(channel: string): boolean {
    const count = this.fingersByLane.get(channel) ?? 0;
    this.fingersByLane.set(channel, count + 1);
    return count === 0;
  }

  /** Removes a finger from `channel`; true when it was the lane's last. */
  private leave(channel: string): boolean {
    const count = this.fingersByLane.get(channel) ?? 0;
    if (count <= 1) {
      this.fingersByLane.delete(channel);
      return count === 1;
    }
    this.fingersByLane.set(channel, count - 1);
    return false;
  }
}

/** Pointer kinds that play lanes. A mouse keeps its desktop behaviour (clicking only focuses the canvas). */
export function isTouchPlayPointer(pointerType: string): boolean {
  return pointerType === 'touch' || pointerType === 'pen';
}

/**
 * Converts a point on the canvas (CSS pixels, e.g. `PointerEvent.offsetX/Y`) to design pixels under the letterbox fit
 * the scenes apply (`resolveScaledViewport`).
 */
export function canvasPointToDesign(
  canvasX: number,
  canvasY: number,
  viewport: { readonly x: number; readonly y: number; readonly scale: number },
): { x: number; y: number } {
  return { x: (canvasX - viewport.x) / viewport.scale, y: (canvasY - viewport.y) / viewport.scale };
}

/** A touch lane's `lane` intent: a lane went down or up. */
export type TouchLaneIntent = Extract<PlayIntent, { readonly type: 'lane' }>;

/** A pointer event as the touch lanes read it (`PointerEvent`'s members of these names). */
export interface TouchLanePointer {
  /** `pointerdown`, `pointermove`, `pointerup` or `pointercancel`. */
  readonly type: string;
  readonly pointerId: number;
  readonly pointerType: string;
  /** Where on the canvas, in CSS pixels. */
  readonly offsetX: number;
  readonly offsetY: number;
  /** When, on the host clock (`performance.now()`). */
  readonly timeStamp: number;
}

/** Where the touch lanes are: the design stage, the canvas it is fitted into (CSS pixels) and the lanes on the stage. */
export interface TouchLaneLayout {
  readonly stage: PlayfieldStage;
  readonly screen: { readonly width: number; readonly height: number };
  readonly lanes: Iterable<TouchLaneRect>;
}

/** What a pointer event did: the `lane` intents it makes, and whether the browser's default for it should be stopped. */
export interface TouchLanePointerResult {
  readonly intents: readonly TouchLaneIntent[];
  /** A finger touching down: stopped, so the browser makes no mouse events or gestures of it. */
  readonly preventDefault: boolean;
}

const NO_POINTER_RESULT: TouchLanePointerResult = { intents: [], preventDefault: false };

/**
 * The fingers on a play's touch lanes: turns each pointer event into the `lane` intents it makes. A finger touching
 * down or moving presses the lane under it, or — when it slid out of the lane it held — releases that lane and presses
 * the new one; lifting it releases its lane. Mouse pointers are left alone (a click only focuses the canvas).
 *
 * The play lifts every finger itself when it pauses (it releases the lanes they held), counting each time
 * (`liftCount`): the fingers down before the latest lift are forgotten, so they press nothing until they touch down
 * again.
 */
export class TouchLaneFingers {
  private readonly tracker = new TouchLaneTracker();
  private lifts: number | undefined;

  /**
   * The intents `pointer` makes. `layout` is asked only for a finger touching down or moving; `liftCount` is how many
   * times the play has lifted every finger so far.
   */
  public handle(pointer: TouchLanePointer, layout: () => TouchLaneLayout, liftCount: number): TouchLanePointerResult {
    if (!isTouchPlayPointer(pointer.pointerType)) return NO_POINTER_RESULT;
    if (this.lifts !== liftCount) {
      this.tracker.upAll();
      this.lifts = liftCount;
    }
    if (pointer.type === 'pointerup' || pointer.type === 'pointercancel') {
      return {
        intents: touchLaneIntents(this.tracker.up(pointer.pointerId), pointer.timeStamp),
        preventDefault: false,
      };
    }
    const down = pointer.type === 'pointerdown';
    if (!down && (pointer.type !== 'pointermove' || !this.tracker.isTracking(pointer.pointerId))) {
      return NO_POINTER_RESULT;
    }
    const { stage, screen, lanes } = layout();
    const viewport = resolveScaledViewport(screen.width, screen.height, stage.width, stage.height);
    const point = canvasPointToDesign(pointer.offsetX, pointer.offsetY, viewport);
    const channel = hitTestTouchLane(resolveTouchLaneZones(lanes, { stageHeight: stage.height }), point.x, point.y);
    const change = down ? this.tracker.down(pointer.pointerId, channel) : this.tracker.move(pointer.pointerId, channel);
    return { intents: touchLaneIntents(change, pointer.timeStamp), preventDefault: down };
  }

  /** Forgets every finger, pressing nothing and releasing nothing (the view is leaving the stage). */
  public reset(): void {
    this.tracker.upAll();
    this.lifts = undefined;
  }
}

/** The `lane` intents of `change` at `atMs`: its releases first, then its presses. */
export function touchLaneIntents(change: TouchLaneChange, atMs: number): TouchLaneIntent[] {
  const intents: TouchLaneIntent[] = [];
  for (const channel of change.released) intents.push({ type: 'lane', channel, pressed: false, atMs });
  for (const channel of change.pressed) intents.push({ type: 'lane', channel, pressed: true, atMs });
  return intents;
}
