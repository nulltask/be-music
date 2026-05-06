// Pure helpers for translating beatoraja `destination[]` samples into PixiJS `Sprite` props.
//
// Keeping the math pure (no Pixi imports here) means the test suite can exercise every keyframe interaction
// without touching a GPU. The actual `Sprite` mutation is a one-liner inside `pixi-gameplay-beatoraja.ts`:
//
//     sprite.x = props.x;
//     sprite.y = props.y;
//     sprite.width = props.width;
//     sprite.height = props.height;
//     sprite.alpha = props.alpha;
//     sprite.tint = props.tint;
//     sprite.angle = props.angle;
//     sprite.visible = props.visible;
//     sprite.blendMode = props.blendMode;

import {
  isElementVisible,
  sampleBeatorajaDestination,
  type BeatorajaDestinationGroup,
} from '@be-music/beatoraja-skin';

export interface BeatorajaSpriteProps {
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0..1 (PixiJS uses 0..1 for `Sprite.alpha`, beatoraja uses 0..255 — this scaling is applied here). */
  alpha: number;
  /** Packed RGB tint as `0xRRGGBB` for `Sprite.tint`. */
  tint: number;
  /** Rotation in degrees — assign directly to `Sprite.angle`. */
  angle: number;
  /** PixiJS `BlendMode` string, derived from beatoraja's numeric blend code. */
  blendMode: BeatorajaPixiBlendMode;
}

/**
 * PixiJS v8 blend mode strings the renderer assigns to `Sprite.blendMode`. Mapping covers the modes beatoraja's
 * reference theme actually uses; the rest fall back to `'normal'`.
 */
export type BeatorajaPixiBlendMode = 'normal' | 'add' | 'multiply' | 'screen' | 'erase';

const HIDDEN_PROPS: BeatorajaSpriteProps = {
  visible: false,
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  alpha: 0,
  tint: 0xffffff,
  angle: 0,
  blendMode: 'normal',
};

export interface BeatorajaRenderContext {
  /** Set of currently-active op-codes (option picks + runtime timer / judge / lamp ops). */
  activeOps: ReadonlySet<number>;
  /** Lookup `(timerId) → start-time-ms-since-scene-start`. Returns `undefined` when the timer hasn't fired yet. */
  getTimerStart: (timerId: number) => number | undefined;
  /** Current scene-relative time in milliseconds. */
  nowMs: number;
}

/**
 * Compute the sprite props for a destination group at the current frame. Returns the hidden state when:
 *
 * - the group's `op` codes don't pass against `activeOps`, or
 * - the parent `if` codes don't pass, or
 * - the group's timer hasn't started (and `timer > 0`), or
 * - the destination's keyframe sample returned `undefined` (animation past the end with `loop = -1`).
 */
export function destinationToSpriteProps(
  group: BeatorajaDestinationGroup,
  context: BeatorajaRenderContext,
): BeatorajaSpriteProps {
  if (!isElementVisible(group.ifCodes, context.activeOps)) return HIDDEN_PROPS;
  if (!isElementVisible(group.op, context.activeOps)) return HIDDEN_PROPS;

  const timerStart = group.timer === 0 ? 0 : context.getTimerStart(group.timer);
  if (timerStart === undefined) return HIDDEN_PROPS;

  const elapsed = context.nowMs - timerStart;
  if (elapsed < 0) return HIDDEN_PROPS;

  const keyframe = sampleBeatorajaDestination(group, elapsed);
  if (keyframe === undefined) return HIDDEN_PROPS;

  const alpha = clampUnit(keyframe.a / 255);
  if (alpha <= 0) return HIDDEN_PROPS;

  return {
    visible: true,
    x: keyframe.x,
    y: keyframe.y,
    width: keyframe.w,
    height: keyframe.h,
    alpha,
    tint: packRgbTint(keyframe.r, keyframe.g, keyframe.b),
    angle: keyframe.angle,
    blendMode: blendCodeToPixi(group.blend),
  };
}

function clampUnit(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function packRgbTint(r: number, g: number, b: number): number {
  const cr = clamp255(r);
  const cg = clamp255(g);
  const cb = clamp255(b);
  return (cr << 16) | (cg << 8) | cb;
}

function clamp255(v: number): number {
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return Math.round(v);
}

/**
 * Translate beatoraja's numeric blend code (LR2-compatible) into PixiJS v8's `BlendMode` string. Codes the
 * reference theme uses are `0` (normal) and `2` (additive — for keybeam glows, judge flashes, etc.); the rest
 * are surfaced for completeness and silently fall back to `'normal'` if the renderer doesn't honor them.
 */
export function blendCodeToPixi(code: number): BeatorajaPixiBlendMode {
  switch (code) {
    case 0:
    case 1:
      return 'normal';
    case 2:
      return 'add';
    case 3:
      return 'screen';
    case 4:
      return 'multiply';
    case 9:
      return 'erase';
    default:
      return 'normal';
  }
}
