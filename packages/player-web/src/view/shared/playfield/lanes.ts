/**
 * The lanes of the shared playfield: lays out each lane's rect (the skin's, else the built-in layout's) into `laneX`,
 * and draws the lane backgrounds and key beams through the be-music skin (or Phantom's) unless the skin owns them.
 */

import { PLAYFIELD } from '../../../scene/gameplay-constants.ts';
import { resolveLr2LaneIndex } from '../../../scene/gameplay-lanes.ts';
import { resolveBeMusicLaneKind } from '../../../skin/be-music/registry.ts';
import type { BeMusicLaneFrame } from '../../../skin/be-music/types.ts';
import { renderPhantomLanes } from '../../../skins/phantom/playfield.ts';
import { resolveLaneGeometry } from '../../built-in/play-chrome.ts';
import type { PlayfieldContext } from './context.ts';

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

  const skinlessLanes: BeMusicLaneFrame[] = [];
  ctx.play.laneChannels.forEach((channel, index) => {
    // A skin-authored lane rect wins; channels the skin doesn't place use the default-family layout.
    const themeLane = skin.laneRect(channel, { width, height });
    const fallbackLane = fallbackLanes[index];
    const x = themeLane ? themeLane.x : (fallbackLane?.x ?? fallbackLeft);
    const w = themeLane ? themeLane.w : Math.max(4, fallbackLane?.w ?? PLAYFIELD.w);
    const top = themeLane ? themeLane.top : fallbackTop;
    const bottom = themeLane ? themeLane.bottom : fallbackBottom;
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
        resolveLr2LaneIndex(channel, ctx.play.chartPlayVariant),
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
    renderPhantomLanes({
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

function resolveFallbackLaneLaserAlpha(ctx: PlayfieldContext, channel: string): number {
  const timerId = ctx.play.resolveKeyOnTimerId(channel);
  if (timerId === undefined) {
    return 0;
  }
  if (ctx.play.pressedChannels.has(channel)) {
    return 1;
  }
  if (!ctx.play.timerStartedAt.has(timerId)) {
    return 0;
  }
  const fadeStart = ctx.play.keyOnFadeOutStart.get(timerId);
  if (fadeStart === undefined) {
    return 1;
  }
  const fadeMs = ctx.playfieldSkin.keyOnFadeMs(channel);
  const elapsed = Math.max(0, ctx.play.playClock() - fadeStart);
  if (elapsed >= fadeMs) {
    ctx.play.keyOnFadeOutStart.delete(timerId);
    ctx.play.timerStartedAt.delete(timerId);
    return 0;
  }
  return Math.max(0, 1 - elapsed / fadeMs);
}
