/**
 * The lanes of the shared playfield: lays out each lane's rect (the skin's, else the built-in layout's) into `laneX`,
 * and draws the lane backgrounds and key beams through the be-music skin (or the default playfield's) unless the skin owns them.
 */

import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../../../stage/design.ts';
import { PLAYFIELD } from '@be-music/player-skin-sdk';
import { resolveLR2LaneIndex } from '@be-music/player-engine/lanes';
import { resolveBeMusicLaneKind } from '../../../skin/be-music/registry.ts';
import type { BeMusicLaneFrame } from '../../../skin/be-music/types.ts';
import { renderDefaultLanes } from './default-playfield.ts';
import { resolveLaneGeometry } from '../../built-in/play-chrome.ts';
import type { PlayfieldContext } from './context.ts';
import { resolveKeyBeamAlpha } from './key-beam.ts';

export function renderLanes(ctx: PlayfieldContext, width: number, height: number): void {
  ctx.laneLayer.clear();
  ctx.play.laneX.clear();
  const skin = ctx.playfieldSkin;
  const skinOwnsLanes = skin.ownsLanes;
  const {
    lanes: fallbackLanes,
    left: fallbackLeft,
    top: fallbackTop,
    judgementY: fallbackBottom,
  } = resolveLaneGeometry(ctx);

  // LR2 can borrow an SP/DP skin for keyboard modes, whose lanes the skin does not place.
  const fallbackScaleX = ctx.beMusicStage ? 1 : width / DESIGN_WIDTH;
  const fallbackScaleY = ctx.beMusicStage ? 1 : height / DESIGN_HEIGHT;
  const skinlessLanes: BeMusicLaneFrame[] = [];
  ctx.play.laneChannels.forEach((channel, index) => {
    // A skin-authored lane rect wins; channels the skin doesn't place use the default-family layout.
    const themeLane = skin.laneRect(channel, { width, height });
    const fallbackLane = fallbackLanes[index];
    const x = themeLane ? themeLane.x : (fallbackLane?.x ?? fallbackLeft) * fallbackScaleX;
    const w = themeLane ? themeLane.w : Math.max(4, (fallbackLane?.w ?? PLAYFIELD.w) * fallbackScaleX);
    const top = themeLane ? themeLane.top : fallbackTop * fallbackScaleY;
    const bottom = themeLane ? themeLane.bottom : fallbackBottom * fallbackScaleY;
    ctx.play.laneX.set(channel, { x, w, top, bottom });

    if (skinOwnsLanes) {
      // With a skin owning the lanes, the lane background, judgement line and key lasers are all rendered by the skin
      // itself. Drawing our own colored rectangles on top of that just paints over the skin -- which is exactly
      // the "scratch lane is too red" / "judgement line is white" problem we want to avoid. Skip them here.
      return;
    }
    skinlessLanes.push({
      channel,
      kind: resolveBeMusicLaneKind(
        channel,
        resolveLR2LaneIndex(channel, ctx.play.chartPlayVariant),
        ctx.play.chartPlayVariant,
      ),
      x,
      w,
      top,
      bottom,
      beam: resolveFallbackLaneLaserAlpha(ctx, channel),
      pressedAtMs: ctx.play.lanePressedAt.get(channel),
      releasedAtMs: ctx.play.laneReleasedAt.get(channel),
      holding: ctx.play.longNotes.isHolding(channel),
      holdStartedAtMs: ctx.play.longNotes.holdStartedAtMs(channel),
    });
  });

  if (!skinOwnsLanes && skinlessLanes.length > 0) {
    const beat = ctx.play.currentBeat(ctx.play.currentSeconds());
    const binding = ctx.skinBinding;
    if (binding) {
      binding.addLanes(skinlessLanes);
      return;
    }
    renderDefaultLanes({
      graphics: ctx.laneLayer,
      lanes: skinlessLanes,
      beatPhase: beat - Math.floor(beat),
      nowMs: ctx.play.playClock(),
      combo: ctx.play.playState.combo,
      effects: ctx.options.beMusicEffects ?? 'full',
      audio: ctx.audioFrame,
    });
  }
}

/** How bright `channel`'s key beam is: every lane's, whatever the play variant. */
function resolveFallbackLaneLaserAlpha(ctx: PlayfieldContext, channel: string): number {
  return resolveKeyBeamAlpha(ctx.play, channel, ctx.playfieldSkin.keyOnFadeMs(channel), ctx.play.playClock());
}
