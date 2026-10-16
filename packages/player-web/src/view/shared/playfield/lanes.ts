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

export function renderLanes(this: PlayfieldContext, width: number, height: number): void {
  this.laneLayer.clear();
  this.laneX.clear();
  const themeOwnsPlayfield = this.theme.themeOwnsPlayfield();
  const {
    lanes: fallbackLanes,
    left: fallbackLeft,
    top: fallbackTop,
    judgementY: fallbackBottom,
  } = resolveLaneGeometry.call(this);

  const skinlessLanes: BeMusicLaneFrame[] = [];
  this.laneChannels.forEach((channel, index) => {
    // A theme-authored lane rect wins; channels the theme doesn't place use the default-family layout.
    const themeLane = this.theme.resolveThemeLaneRect(channel, width, height);
    const fallbackLane = fallbackLanes[index];
    const x = themeLane ? themeLane.x : (fallbackLane?.x ?? fallbackLeft);
    const w = themeLane ? themeLane.w : Math.max(4, fallbackLane?.w ?? PLAYFIELD.w);
    const top = themeLane ? themeLane.top : fallbackTop;
    const bottom = themeLane ? themeLane.bottom : fallbackBottom;
    this.laneX.set(channel, { x, w, top, bottom });

    if (themeOwnsPlayfield) {
      // With a theme owning the playfield, the lane background, judgement line and key lasers are all rendered by the
      // theme itself. Drawing our own colored rectangles on top of that just paints over the skin -- which is exactly
      // the "scratch lane is too red" / "judgement line is white" problem we want to avoid. Skip them here.
      return;
    }
    skinlessLanes.push({
      channel,
      kind: resolveBeMusicLaneKind(channel, resolveLr2LaneIndex(channel, this.chartPlayVariant), this.chartPlayVariant),
      x,
      w,
      top,
      bottom,
      beam: resolveFallbackLaneLaserAlpha.call(this, channel),
      pressedAtMs: this.lanePressedAt.get(channel),
      releasedAtMs: this.laneReleasedAt.get(channel),
      holding: this.longNotes.isHolding(channel),
      holdStartedAtMs: this.longNotes.holdStartedAtMs(channel),
    });
  });

  if (!themeOwnsPlayfield && skinlessLanes.length > 0) {
    const beat = this.currentBeat(this.currentSeconds());
    const binding = this.skinBinding;
    if (binding) {
      binding.addLanes(skinlessLanes);
      return;
    }
    renderPhantomLanes({
      graphics: this.laneLayer,
      lanes: skinlessLanes,
      beatPhase: beat - Math.floor(beat),
      nowMs: this.playClock(),
      combo: this.tracker.combo,
      effects: this.options.beMusicEffects ?? 'full',
      audio: this.audioFrame,
    });
  }
}

function resolveFallbackLaneLaserAlpha(this: PlayfieldContext, channel: string): number {
  const timerId = this.resolveKeyOnTimerId(channel);
  if (timerId === undefined) {
    return 0;
  }
  if (this.pressedChannels.has(channel)) {
    return 1;
  }
  if (!this.timerStartedAt.has(timerId)) {
    return 0;
  }
  const fadeStart = this.keyOnFadeOutStart.get(timerId);
  if (fadeStart === undefined) {
    return 1;
  }
  const fadeMs = this.theme.resolveKeyOnFadeMs(timerId);
  const elapsed = Math.max(0, this.playClock() - fadeStart);
  if (elapsed >= fadeMs) {
    this.keyOnFadeOutStart.delete(timerId);
    this.timerStartedAt.delete(timerId);
    return 0;
  }
  return Math.max(0, 1 - elapsed / fadeMs);
}
