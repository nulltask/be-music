/**
 * The bombs (hit explosions) of the shared playfield: retires each bomb once its effect has played out, and draws the
 * live ones through the theme, or by default through the be-music skin (or Phantom's).
 */

import { resolveLr2LaneIndex } from '../../../scene/gameplay-lanes.ts';
import { resolveBeMusicLaneKind } from '../../../skin/be-music/registry.ts';
import type { BeMusicBomb } from '../../../skin/be-music/types.ts';
import { renderPhantomBombs } from '../../../skins/phantom/playfield.ts';
import type { PlayfieldContext } from './context.ts';

/**
 * One-shot bomb cleanup. Runs every frame so each bomb stops once its effect has played out
 * ({@link resolveBombDurationMs} — the be-music skin's effect length, or a theme-authored span). Retired bombs raise
 * `bomb-retired` so a theme can stop its own per-lane bomb timer; without this retirement a theme's "play once and
 * clamp" explosion would keep displaying its last frame forever.
 */
function cleanupBombTimers(ctx: PlayfieldContext): void {
  if (ctx.bombStartedAt.size === 0) {
    return;
  }
  const now = ctx.playClock();
  for (const [channel, startedAt] of ctx.bombStartedAt) {
    const cleanupAtMs = ctx.theme.resolveBombDurationMs(channel);
    if (now - startedAt < cleanupAtMs) {
      continue;
    }
    ctx.bombStartedAt.delete(channel);
    ctx.bombJudge.delete(channel);
    ctx.theme.onThemeEvent({ kind: 'bomb-retired', channel });
  }
}

export function renderBombs(ctx: PlayfieldContext): void {
  // Pooled per-frame children — see `ChildPool` in `pixi-utils.ts`. The previous `disposeChildren` rebuild ran a
  // destroy + Sprite-allocation cycle for every active explosion; the pool reuses parented sprites across frames.
  ctx.bombLayerPool.begin();
  cleanupBombTimers(ctx);
  // When a theme owns the playfield its bombs are part of the theme's own chrome (the LR2 skin's `#DST_IMAGE` set,
  // gated on bomb timer 50–57 / 60–67). Drawing our own copy on top would double-render the explosion, so this path
  // only fires for the skinless experience.
  if (ctx.theme.themeOwnsPlayfield() || ctx.bombStartedAt.size === 0) {
    ctx.bombLayerPool.end();
    return;
  }
  ctx.theme.renderBombEffects();
  ctx.bombLayerPool.end();
}

/** The built-in bombs: `CoreGameplayView.renderBombEffects`, unless a theme draws its own. */
export function renderBombEffects(ctx: PlayfieldContext): void {
  const now = ctx.playClock();
  const bombs: BeMusicBomb[] = [];
  for (const [channel, startedAt] of ctx.bombStartedAt) {
    const lane = ctx.laneX.get(channel);
    if (!lane) continue;
    bombs.push({
      channel,
      kind: resolveBeMusicLaneKind(channel, resolveLr2LaneIndex(channel, ctx.chartPlayVariant), ctx.chartPlayVariant),
      x: lane.x,
      w: lane.w,
      y: lane.bottom,
      elapsedMs: Math.max(0, now - startedAt),
      // Stable per hit: the start time changes on every re-trigger, so a new hit gets a new scatter.
      seed: Math.floor(startedAt * 7.31) % 100_003,
      judge: ctx.bombJudge.get(channel),
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
    combo: ctx.playState.combo,
    effects: ctx.options.beMusicEffects ?? 'full',
    audio: ctx.audioFrame,
  });
}
