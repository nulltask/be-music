/**
 * The lanes of the shared playfield: lays out each lane's rect (the theme's, else the built-in layout's) into `laneX`,
 * and draws the lane backgrounds and key beams through the be-music skin (or Phantom's) unless the theme owns them.
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
  ctx.laneX.clear();
  const themeOwnsPlayfield = ctx.theme.themeOwnsPlayfield();
  const {
    lanes: fallbackLanes,
    left: fallbackLeft,
    top: fallbackTop,
    judgementY: fallbackBottom,
  } = resolveLaneGeometry(ctx);

  const skinlessLanes: BeMusicLaneFrame[] = [];
  ctx.laneChannels.forEach((channel, index) => {
    // A theme-authored lane rect wins; channels the theme doesn't place use the default-family layout.
    const themeLane = ctx.theme.resolveThemeLaneRect(channel, width, height);
    const fallbackLane = fallbackLanes[index];
    const x = themeLane ? themeLane.x : (fallbackLane?.x ?? fallbackLeft);
    const w = themeLane ? themeLane.w : Math.max(4, fallbackLane?.w ?? PLAYFIELD.w);
    const top = themeLane ? themeLane.top : fallbackTop;
    const bottom = themeLane ? themeLane.bottom : fallbackBottom;
    ctx.laneX.set(channel, { x, w, top, bottom });

    if (themeOwnsPlayfield) {
      // With a theme owning the playfield, the lane background, judgement line and key lasers are all rendered by the
      // theme itself. Drawing our own colored rectangles on top of that just paints over the skin -- which is exactly
      // the "scratch lane is too red" / "judgement line is white" problem we want to avoid. Skip them here.
      return;
    }
    skinlessLanes.push({
      channel,
      kind: resolveBeMusicLaneKind(channel, resolveLr2LaneIndex(channel, ctx.chartPlayVariant), ctx.chartPlayVariant),
      x,
      w,
      top,
      bottom,
      beam: resolveFallbackLaneLaserAlpha(ctx, channel),
      pressedAtMs: ctx.lanePressedAt.get(channel),
      releasedAtMs: ctx.laneReleasedAt.get(channel),
      holding: ctx.longNotes.isHolding(channel),
      holdStartedAtMs: ctx.longNotes.holdStartedAtMs(channel),
    });
  });

  if (!themeOwnsPlayfield && skinlessLanes.length > 0) {
    const beat = ctx.currentBeat(ctx.currentSeconds());
    const binding = ctx.skinBinding;
    if (binding) {
      binding.addLanes(skinlessLanes);
      return;
    }
    renderPhantomLanes({
      graphics: ctx.laneLayer,
      lanes: skinlessLanes,
      beatPhase: beat - Math.floor(beat),
      nowMs: ctx.playClock(),
      combo: ctx.tracker.combo,
      effects: ctx.options.beMusicEffects ?? 'full',
      audio: ctx.audioFrame,
    });
  }
}

function resolveFallbackLaneLaserAlpha(ctx: PlayfieldContext, channel: string): number {
  const timerId = ctx.resolveKeyOnTimerId(channel);
  if (timerId === undefined) {
    return 0;
  }
  if (ctx.pressedChannels.has(channel)) {
    return 1;
  }
  if (!ctx.timerStartedAt.has(timerId)) {
    return 0;
  }
  const fadeStart = ctx.keyOnFadeOutStart.get(timerId);
  if (fadeStart === undefined) {
    return 1;
  }
  const fadeMs = ctx.theme.resolveKeyOnFadeMs(timerId);
  const elapsed = Math.max(0, ctx.playClock() - fadeStart);
  if (elapsed >= fadeMs) {
    ctx.keyOnFadeOutStart.delete(timerId);
    ctx.timerStartedAt.delete(timerId);
    return 0;
  }
  return Math.max(0, 1 - elapsed / fadeMs);
}
