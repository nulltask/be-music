/**
 * The bombs (hit explosions) of the shared playfield: retires each bomb once its effect has played out, and draws the
 * live ones with the skin's cells, or by default through the be-music skin (or Phantom's).
 */

import { resolveLr2LaneIndex } from '../../../scene/gameplay-lanes.ts';
import { resolveBeMusicLaneKind } from '../../../skin/be-music/registry.ts';
import type { BeMusicBomb } from '../../../skin/be-music/types.ts';
import { renderPhantomBombs } from '../../../skins/phantom/playfield.ts';
import type { PlayfieldContext } from './context.ts';

/**
 * One-shot bomb cleanup. Runs every frame so each bomb stops once its effect has played out
 * (`PlayfieldSkin.bombDurationMs`: the be-music skin's effect length, or a skin-authored span). A retired bomb is told
 * to the view's chrome (`bombRetired`) so a skin can stop its own per-lane bomb timer; without this retirement a skin's
 * "play once and clamp" explosion would keep displaying its last frame forever.
 */
function cleanupBombTimers(ctx: PlayfieldContext): void {
  if (ctx.play.bombStartedAt.size === 0) {
    return;
  }
  const now = ctx.play.playClock();
  for (const [channel, startedAt] of ctx.play.bombStartedAt) {
    const cleanupAtMs = ctx.playfieldSkin.bombDurationMs(channel);
    if (now - startedAt < cleanupAtMs) {
      continue;
    }
    ctx.play.bombStartedAt.delete(channel);
    ctx.play.bombJudge.delete(channel);
    ctx.chrome.bombRetired?.(channel);
  }
}

export function renderBombs(ctx: PlayfieldContext): void {
  // Pooled per-frame children — see `ChildPool` in `pixi-utils.ts`. The previous `disposeChildren` rebuild ran a
  // destroy + Sprite-allocation cycle for every active explosion; the pool reuses parented sprites across frames.
  ctx.bombLayerPool.begin();
  cleanupBombTimers(ctx);
  // When a skin owns the lanes its bombs are part of its own chrome (the LR2 skin's `#DST_IMAGE` set, gated on bomb
  // timer 50–57 / 60–67). Drawing our own copy on top would double-render the explosion, so this path only fires for a
  // skin that leaves the lanes to the playfield.
  if (ctx.playfieldSkin.ownsLanes || ctx.play.bombStartedAt.size === 0) {
    ctx.bombLayerPool.end();
    return;
  }
  renderBombEffects(ctx);
  ctx.bombLayerPool.end();
}

/**
 * The bombs on lanes the skin leaves to the playfield: each with the skin's cell (`PlayfieldSkin.bombCell`) when it has
 * one, centred on the lane's judgement line; the rest through the be-music skin, or Phantom's.
 */
function renderBombEffects(ctx: PlayfieldContext): void {
  const now = ctx.play.playClock();
  const bombs: BeMusicBomb[] = [];
  for (const [channel, startedAt] of ctx.play.bombStartedAt) {
    const lane = ctx.play.laneX.get(channel);
    if (!lane) continue;
    const elapsedMs = Math.max(0, now - startedAt);
    const cell = ctx.playfieldSkin.bombCell(channel, elapsedMs);
    if (cell?.texture) {
      const sprite = ctx.bombLayerPool.acquireSprite();
      sprite.texture = cell.texture;
      sprite.label = `bomb[ch=${channel}]`;
      sprite.position.set(lane.x + (lane.w - cell.width) / 2, lane.bottom - cell.height / 2);
      sprite.width = cell.width;
      sprite.height = cell.height;
      sprite.blendMode = 'add';
      continue;
    }
    bombs.push({
      channel,
      kind: resolveBeMusicLaneKind(
        channel,
        resolveLr2LaneIndex(channel, ctx.play.chartPlayVariant),
        ctx.play.chartPlayVariant,
      ),
      x: lane.x,
      w: lane.w,
      y: lane.bottom,
      elapsedMs,
      // Stable per hit: the start time changes on every re-trigger, so a new hit gets a new scatter.
      seed: Math.floor(startedAt * 7.31) % 100_003,
      judge: ctx.play.bombJudge.get(channel),
    });
  }
  const binding = ctx.skinBinding;
  if (binding) {
    binding.addBombs(bombs);
    return;
  }
  renderPhantomBombs({
    pool: ctx.bombLayerPool,
    bombs,
    nowMs: now,
    combo: ctx.play.playState.combo,
    effects: ctx.options.beMusicEffects ?? 'full',
    audio: ctx.audioFrame,
  });
}
