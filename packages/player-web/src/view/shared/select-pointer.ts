/**
 * The select screen's pointer input. A click, or a touch that did not swipe, picks the bar under it (or goes to the
 * theme's hit test); a swipe drags the list and lets it glide on when let go; the wheel steps the list a notch at a time,
 * or by the distance a trackpad travels. A list pulled part of a row eases back to one once nothing moves it. While the
 * README overlay is open, the pointer scrolls or closes it instead.
 *
 * The pointer reads the last frame and turns what the player does into intents through {@link SelectPointerContext}; the
 * family view passes it.
 */

import type { BeMusicSelectLayout } from '@be-music/skin-sdk';
import type { Application } from 'pixi.js';
import type { BrowserBrowseEntry } from '../../collection/types.ts';
import {
  FLING_START_VELOCITY,
  FLING_STOP_VELOCITY,
  isTouchDrag,
  isWheelNotch,
  releaseVelocity,
  stepFling,
  stepTouchScroll,
  stepWheelScroll,
  type TouchSample,
} from './touch-scroll.ts';
import { resolveScaledViewport } from '../../stage/viewport.ts';
import { resolveSelectListWindow } from '../../skin/be-music/registry.ts';

/** A skin's design canvas, in design pixels. */
export interface SelectDesignSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Minimum interval between two notch-driven cursor moves in the bar list, so a free-spinning notched wheel can't fire
 * the `cursor-move` SFX and re-seed the slide faster than it can play. Smooth (trackpad) scrolling isn't throttled: it
 * steps by the distance travelled instead (see `stepWheelScroll`).
 */
const WHEEL_THROTTLE_INTERVAL_MS = 15;

/** Finger positions kept per touch for the release velocity (a few frames' worth). */
const TOUCH_SAMPLE_LIMIT = 8;

/** How long (ms) after the last wheel or drag movement a partly pulled list starts settling back to a row. */
const PULL_SETTLE_DELAY_MS = 120;
/** Time constant (ms) of the settle back to a row. */
const PULL_SETTLE_TIME_CONSTANT_MS = 70;
/** Below this pull (design pixels) the list counts as at rest. */
const PULL_SETTLE_EPSILON = 0.3;

/** What the pointer input reads and drives on the select scene: its fields and methods of these names. */
export interface SelectPointerContext {
  /** Whether the select is the scene showing; the pointer is ignored while it is off stage. */
  readonly visible: boolean;
  /** When a launch whose be-music outro is still playing started, else `undefined`; the pointer waits for it. */
  readonly launchAt: number | undefined;
  /** The canvas, in CSS pixels: the host's `app.screen`. */
  readonly screen: Application['screen'];
  readonly themeDesignSize: SelectDesignSize | undefined;
  readonly beMusicDesignSize: SelectDesignSize;
  readonly beMusicSelectLayout: BeMusicSelectLayout;
  /** The cursor in the list shown. */
  readonly selectedIndex: number;
  /** The pointer in design pixels, `-1` while it is off the canvas. */
  mouseX: number;
  mouseY: number;
  /** Whether the README overlay is open; the pointer then scrolls or closes it. */
  readonly readTextOpen: boolean;
  scrollReadText(delta: number): void;
  closeReadText(): void;
  resolveDesignSize(): SelectDesignSize;
  currentEntries(): readonly BrowserBrowseEntry[];
  /** Moves the cursor bar by bar (`SelectSession.moveCursorBy`). */
  moveCursorBy(steps: number): void;
  /** Moves the cursor one bar, wrapping past either end (`SelectSession.stepCursor`). */
  stepCursor(direction: 1 | -1): void;
  /** Puts the cursor on a bar (`SelectSession.jumpCursor`). */
  jumpCursor(index: number): void;
  /** Opens the folder or starts the bar under the cursor (`SelectSession.activateFocused`). */
  activateFocused(): void;
  handleThemePointerDown(virtualX: number, virtualY: number): void;
  startSelectBgm(): Promise<void>;
}

/** The select screen's pointer input. See the module comment. */
export class SelectPointer {
  private readonly ctx: SelectPointerContext;

  /**
   * `performance.now()` of the most recent wheel-driven cursor move. Used by {@link handleWheel} to throttle high-rate
   * trackpad / hi-res-mouse input to one cursor step per {@link WHEEL_THROTTLE_INTERVAL_MS} so a fast flick doesn't
   * fly past the user's target. `-Infinity` lets the very first wheel tick after mount fire immediately.
   */
  lastWheelMoveAt: number = Number.NEGATIVE_INFINITY;
  /**
   * The finger currently on the list (touch / pen only): where it touched down and last was, in canvas CSS pixels,
   * whether it has moved far enough to be a swipe, and the swipe travel not yet turned into a cursor step. A touch acts
   * on lift — as a tap when it never became a swipe — so swiping the list does not also pick the row it started on.
   */
  private touchGesture:
    | {
        pointerId: number;
        startX: number;
        startY: number;
        lastY: number;
        dragging: boolean;
        /** Recent positions (design pixels), for the velocity the list keeps once the finger lifts. */
        samples: TouchSample[];
      }
    | undefined;
  /**
   * The list still gliding after a swipe was let go: its velocity (design pixels per ms, positive = toward earlier
   * entries, as the finger moved down) and when it last advanced.
   */
  fling: { velocity: number; lastAt: number } | undefined;
  /**
   * How far the list is pulled past the focused row toward later entries, in design pixels, less than a row: the
   * travel of a drag, a fling or a trackpad not yet turned into a cursor step. Shown to the skin as
   * `frame.listScroll`, and eased back to a row (see {@link settleListPull}) once nothing is moving the list.
   */
  private listPull = 0;
  /** `performance.now()` of the last wheel or drag movement, so the pull settles only once input stops. */
  private lastPullInputAt = Number.NEGATIVE_INFINITY;
  /** `performance.now()` of the last {@link settleListPull}, for its frame-rate independent easing. */
  private lastSettleAt: number | undefined;

  public constructor(ctx: SelectPointerContext) {
    this.ctx = ctx;
  }

  /**
   * Tracks the pointer in design-space coordinates so `#SRC_ONMOUSE` hit-tests and the `#SRC_MOUSECURSOR` follow can
   * read from a single source of truth. The math mirrors `handlePointerDown` — undo the viewport scale & offset to land
   * in skin design pixels.
   */
  readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.ctx.visible) return;
    const { width: designWidth, height: designHeight } = this.ctx.resolveDesignSize();
    const viewport = resolveScaledViewport(this.ctx.screen.width, this.ctx.screen.height, designWidth, designHeight);
    this.ctx.mouseX = (event.offsetX - viewport.x) / viewport.scale;
    this.ctx.mouseY = (event.offsetY - viewport.y) / viewport.scale;
    const gesture = this.touchGesture;
    if (gesture === undefined || gesture.pointerId !== event.pointerId) return;
    if (!gesture.dragging) {
      if (!isTouchDrag(event.offsetX - gesture.startX, event.offsetY - gesture.startY)) return;
      gesture.dragging = true;
    }
    const delta = (event.offsetY - gesture.lastY) / viewport.scale;
    gesture.lastY = event.offsetY;
    gesture.samples.push({ at: performance.now(), y: event.offsetY / viewport.scale });
    if (gesture.samples.length > TOUCH_SAMPLE_LIMIT) gesture.samples.shift();
    // A swipe over the open README pans its body, as the wheel does.
    if (this.ctx.readTextOpen) {
      this.ctx.scrollReadText(-delta);
      return;
    }
    const step = stepTouchScroll(this.listPull, delta, this.resolveTouchScrollPitch());
    this.listPull = step.carry;
    this.lastPullInputAt = performance.now();
    if (step.steps !== 0) this.ctx.moveCursorBy(step.steps);
  };

  /**
   * A finger lifting: a touch that never became a swipe is a tap at the point it touched down; a swipe let go while
   * still moving keeps the list gliding and slowing down (see {@link advanceFling}).
   */
  readonly handlePointerUp = (event: PointerEvent): void => {
    const gesture = this.touchGesture;
    if (gesture === undefined || gesture.pointerId !== event.pointerId) return;
    this.touchGesture = undefined;
    if (!gesture.dragging) {
      this.handlePointerTap(gesture.startX, gesture.startY);
      return;
    }
    if (this.ctx.readTextOpen) return;
    const now = performance.now();
    const velocity = releaseVelocity(gesture.samples, now);
    if (Math.abs(velocity) >= FLING_START_VELOCITY) {
      this.fling = { velocity, lastAt: now };
    }
  };

  /** Moves a gliding list on by the time since its last frame, stepping the cursor per row travelled. */
  advanceFling(now: number): void {
    const fling = this.fling;
    if (fling === undefined) return;
    const { distance, velocity } = stepFling(fling.velocity, now - fling.lastAt);
    fling.lastAt = now;
    fling.velocity = velocity;
    const step = stepTouchScroll(this.listPull, distance, this.resolveTouchScrollPitch());
    this.listPull = step.carry;
    if (step.steps !== 0) this.ctx.moveCursorBy(step.steps);
    if (Math.abs(velocity) < FLING_STOP_VELOCITY) this.fling = undefined;
  }

  /**
   * Once nothing moves the list (no finger down, no fling, no wheel for {@link PULL_SETTLE_DELAY_MS}), eases its pull
   * back to a row: on to the next one when it was pulled past half a row and the window can move that way, back to the
   * focused one otherwise.
   */
  settleListPull(now: number): void {
    const dt = this.lastSettleAt === undefined ? 0 : now - this.lastSettleAt;
    this.lastSettleAt = now;
    if (this.listPull === 0 || this.touchGesture?.dragging || this.fling !== undefined) return;
    if (now - this.lastPullInputAt < PULL_SETTLE_DELAY_MS) return;
    const pitch = this.resolveTouchScrollPitch();
    const direction = Math.sign(this.listPull);
    if (Math.abs(this.listPull) >= pitch / 2 && this.listWindowMoves(direction)) {
      this.ctx.moveCursorBy(direction);
      this.listPull -= direction * pitch;
    }
    this.listPull *= Math.exp(-dt / PULL_SETTLE_TIME_CONSTANT_MS);
    if (Math.abs(this.listPull) < PULL_SETTLE_EPSILON) this.listPull = 0;
  }

  /** The pull the skin draws: none where the list window can't move that way (at the list's ends). */
  shownListPull(): number {
    return this.listPull !== 0 && this.listWindowMoves(Math.sign(this.listPull)) ? this.listPull : 0;
  }

  /** Whether one cursor step in `direction` (±1) scrolls the list window rather than only moving the highlight. */
  private listWindowMoves(direction: number): boolean {
    const entries = this.ctx.currentEntries();
    const next = this.ctx.selectedIndex + direction;
    if (next < 0 || next >= entries.length) return false;
    const layout = this.ctx.beMusicSelectLayout;
    const { height } = this.ctx.resolveDesignSize();
    return (
      resolveSelectListWindow(layout, height, next, entries.length).firstVisibleIndex !==
      resolveSelectListWindow(layout, height, this.ctx.selectedIndex, entries.length).firstVisibleIndex
    );
  }

  readonly handlePointerCancel = (event: PointerEvent): void => {
    if (this.touchGesture?.pointerId === event.pointerId) this.touchGesture = undefined;
  };

  /** Design pixels a swipe travels per cursor step: the list's row pitch. */
  private resolveTouchScrollPitch(): number {
    return this.ctx.themeDesignSize ? 30 : this.ctx.beMusicSelectLayout.rowHeight;
  }

  readonly handlePointerLeave = (): void => {
    this.ctx.mouseX = -1;
    this.ctx.mouseY = -1;
  };

  /**
   * Wheel-scroll → cursor move. `deltaY > 0` (wheel down) advances to the next entry; `deltaY < 0` (wheel up) rewinds.
   * A notched mouse wheel moves one entry per notch (several notches in one event still count once, throttled by
   * {@link WHEEL_THROTTLE_INTERVAL_MS}). A trackpad or free-spinning wheel sends a stream of small pixel deltas; those
   * move the list by the distance travelled, one entry per row pitch on screen, so a light touch no longer races through
   * the list.
   *
   * Wraps at the list ends, matching the keyboard navigation. Skipped while hidden (gameplay on top) so a wheel event
   * over the canvas doesn't navigate the select view in the background.
   */
  readonly handleWheel = (event: WheelEvent): void => {
    if (!this.ctx.visible) return;
    if (event.deltaY === 0) return;
    event.preventDefault();
    // While the readtext modal is open, the wheel scrolls the README body instead of moving the bar cursor. Otherwise
    // the user couldn't pan a long author note without first closing the overlay.
    if (this.ctx.readTextOpen) {
      this.ctx.scrollReadText(event.deltaY);
      return;
    }
    const entries = this.ctx.currentEntries();
    if (entries.length === 0) return;
    this.fling = undefined;
    if (!isWheelNotch(event)) {
      const { width: designWidth, height: designHeight } = this.ctx.resolveDesignSize();
      const viewport = resolveScaledViewport(this.ctx.screen.width, this.ctx.screen.height, designWidth, designHeight);
      const step = stepWheelScroll(this.listPull, event.deltaY / viewport.scale, this.resolveTouchScrollPitch());
      this.listPull = step.carry;
      this.lastPullInputAt = performance.now();
      if (step.steps !== 0) this.ctx.moveCursorBy(step.steps);
      return;
    }
    this.listPull = 0;
    const now = performance.now();
    if (now - this.lastWheelMoveAt < WHEEL_THROTTLE_INTERVAL_MS) return;
    this.lastWheelMoveAt = now;
    // One bar in the wheel's direction, wrapping, and the bars slide that way even where the cursor wraps on a tiny
    // list: wheel input is an "infinite rail", every notch one slot in its direction, as LR2's selection feels.
    this.ctx.stepCursor(event.deltaY > 0 ? 1 : -1);
  };

  readonly handlePointerDown = (event: PointerEvent): void => {
    if (!this.ctx.visible || this.ctx.launchAt !== undefined) return;
    // Retry BGM start on the first user gesture — browsers gate `AudioContext.resume()` behind a user-input event, so
    // the start on entering the scene may have left the context suspended. Cheap to call repeatedly
    // (early-returns when a source is already playing).
    void this.ctx.startSelectBgm();
    // A finger may be starting a swipe over the list, so its tap waits for the lift (`handlePointerUp`).
    if (event.pointerType === 'touch' || event.pointerType === 'pen') {
      if (this.touchGesture !== undefined) return;
      // A touch stops a gliding list where it is, like catching it.
      this.fling = undefined;
      this.touchGesture = {
        pointerId: event.pointerId,
        startX: event.offsetX,
        startY: event.offsetY,
        lastY: event.offsetY,
        dragging: false,
        samples: [],
      };
      return;
    }
    if (this.ctx.readTextOpen) event.preventDefault();
    this.handlePointerTap(event.offsetX, event.offsetY);
  };

  /** A click (or a touch that did not swipe) at canvas point (`offsetX`, `offsetY`), in CSS pixels. */
  private handlePointerTap(offsetX: number, offsetY: number): void {
    if (!this.ctx.visible || this.ctx.launchAt !== undefined) return;
    // README modal owns the pointer while open. LR2 uses Enter (the decide key) for panel close, mirrored on the
    // keyboard path; on the mouse side we accept any click anywhere as a dismiss to cover users who'd reach for "click
    // outside the card" before reading the footer hint. The README content itself isn't interactive so consuming the
    // click loses no affordance.
    if (this.ctx.readTextOpen) {
      this.ctx.closeReadText();
      return;
    }
    // No `canvas.focus()` — we listen for `keydown` on `window`, so capturing focus here would needlessly pull it away
    // from any form input the user might already be typing into.
    const themeSize = this.ctx.themeDesignSize;
    const { width: designWidth, height: designHeight } = themeSize ?? this.ctx.beMusicDesignSize;
    const viewport = resolveScaledViewport(this.ctx.screen.width, this.ctx.screen.height, designWidth, designHeight);
    const virtualX = (offsetX - viewport.x) / viewport.scale;
    const virtualY = (offsetY - viewport.y) / viewport.scale;

    if (themeSize) {
      this.ctx.handleThemePointerDown(virtualX, virtualY);
      return;
    }

    // Skin-less fallback: hit-test the right-column bar list. The chrome paints other interactive-looking regions
    // (search box, top tabs, score panel), but those are decorative-only in this no-skin path — clicks on them
    // shouldn't pick a song or change navigation. Bound the song-list reaction to the right-column rectangle the rows
    // actually live in.
    //
    // Geometry must mirror the `render()` layout above: rows begin at `listTop` with `rowHeight` pitch, and the visible
    // window centers on `selectedIndex` with the same `start` calculation. Anything outside the list rectangle is a
    // no-op.
    const layout = this.ctx.beMusicSelectLayout;
    const { listX, listTop, rowHeight } = layout;
    const listBottom = designHeight - layout.listBottomInset;
    if (virtualX < listX || virtualY < listTop || virtualY > listBottom) {
      return;
    }
    const fallbackEntries = this.ctx.currentEntries();
    if (fallbackEntries.length === 0) {
      return;
    }
    const start = resolveSelectListWindow(
      layout,
      designHeight,
      this.ctx.selectedIndex,
      fallbackEntries.length,
    ).firstVisibleIndex;
    const visibleRow = Math.floor((virtualY - listTop) / rowHeight);
    const entryIndex = start + visibleRow;
    if (entryIndex < 0 || entryIndex >= fallbackEntries.length) {
      return;
    }
    // The bar clicked comes under the cursor (sliding the shortest way round) and starts at once.
    this.ctx.jumpCursor(entryIndex);
    this.ctx.activateFocused();
  }
}
