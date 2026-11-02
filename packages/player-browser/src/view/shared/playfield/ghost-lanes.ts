/**
 * A ghost's recorded inputs over the player's own lanes (the `'lane-overlay'` ghost, docs/replay.md "Ghost"): where the
 * ghost pressed a key, a hollow beam in the ghost's colour rises from the judgement line; where it was judged, a bar in
 * the judgment's colour flashes just above the line. Both are outlines and bars, never filled lanes, in a colour no lane
 * beam uses, so the player's own beams, bombs and notes stay readable under them. Drawn over the lanes on the built-in
 * family's playfield (`lanes.ts`), whatever the skin.
 */

import type { JudgmentKind } from '@be-music/player-engine/ruleset';
import type { Graphics } from 'pixi.js';
import type { PlayfieldLaneRect } from '../../types.ts';

/** What the ghost does on the player's lanes, by channel, on the play clock (ms). The ghost writes it; views read it. */
export interface GhostLaneOverlay {
  /** When the ghost's key went down on each lane. */
  readonly pressedAt: Map<string, number>;
  /** When it went up again (after its press). */
  readonly releasedAt: Map<string, number>;
  /** The ghost's latest judgment on each lane, and when it came. */
  readonly flashes: Map<string, { readonly judgment: JudgmentKind; readonly atMs: number }>;
}

/** An empty overlay. */
export function createGhostLaneOverlay(): GhostLaneOverlay {
  return { pressedAt: new Map(), releasedAt: new Map(), flashes: new Map() };
}

/** How long the ghost's beam takes to fade after its key goes up. */
export const GHOST_BEAM_FADE_MS = 120;
/** How long the ghost's judgment flash shows. */
export const GHOST_FLASH_MS = 300;

/** How one lane's ghost marks show at a moment: the beam's strength, and the judgment flash's (when one shows). */
export interface GhostLaneMarks {
  /** 0..1: 1 while the ghost holds the key, fading out after it lets go. */
  readonly beam: number;
  readonly flash?: { readonly judgment: JudgmentKind; readonly alpha: number };
}

/** The ghost's marks on `channel` at `nowMs` (see {@link GhostLaneMarks}). */
export function resolveGhostLaneMarks(overlay: GhostLaneOverlay, channel: string, nowMs: number): GhostLaneMarks {
  const pressed = overlay.pressedAt.get(channel);
  const released = overlay.releasedAt.get(channel);
  let beam = 0;
  if (pressed !== undefined && pressed <= nowMs) {
    if (released === undefined || released < pressed) beam = 1;
    else beam = Math.max(0, 1 - Math.max(0, nowMs - released) / GHOST_BEAM_FADE_MS);
  }
  const flash = overlay.flashes.get(channel);
  const age = flash === undefined ? Number.POSITIVE_INFINITY : nowMs - flash.atMs;
  return {
    beam,
    ...(flash !== undefined && age >= 0 && age < GHOST_FLASH_MS
      ? { flash: { judgment: flash.judgment, alpha: 1 - age / GHOST_FLASH_MS } }
      : {}),
  };
}

/** The ghost's colour: a violet no lane beam, judgement line or note of the built-in skins uses. */
export const GHOST_LANE_COLOR = 0xb56cff;

/** A judgment flash's colour, by judgment. */
export const GHOST_FLASH_COLORS: Readonly<Record<JudgmentKind, number>> = {
  PERFECT: 0xe9f6ff,
  GREAT: 0xffd23f,
  GOOD: 0x5fd38d,
  BAD: 0xff7a3d,
  POOR: 0xff3d5a,
};

/** The beam's height above the judgement line, as a share of the lane (at most `GHOST_BEAM_MAX_HEIGHT`). */
const GHOST_BEAM_SHARE = 0.3;
const GHOST_BEAM_MAX_HEIGHT = 180;
const GHOST_FLASH_HEIGHT = 6;

/** Draws the ghost's marks into `graphics` over the lanes laid out in `laneX`, at `nowMs` on the play clock. */
export function renderGhostLanes(
  graphics: Graphics,
  laneX: ReadonlyMap<string, PlayfieldLaneRect>,
  overlay: GhostLaneOverlay,
  nowMs: number,
): void {
  for (const [channel, lane] of laneX) {
    const marks = resolveGhostLaneMarks(overlay, channel, nowMs);
    if (marks.beam <= 0 && marks.flash === undefined) continue;
    const width = Math.max(2, lane.w - 4);
    const x = lane.x + 2;
    if (marks.beam > 0) {
      const height = Math.min(GHOST_BEAM_MAX_HEIGHT, Math.max(1, lane.bottom - lane.top) * GHOST_BEAM_SHARE);
      graphics
        .rect(x, lane.bottom - height, width, height)
        .stroke({ color: GHOST_LANE_COLOR, width: 2, alpha: 0.9 * marks.beam });
      graphics.rect(x, lane.bottom - height, width, height).fill({ color: GHOST_LANE_COLOR, alpha: 0.12 * marks.beam });
    }
    if (marks.flash !== undefined) {
      graphics
        .rect(x, lane.bottom - 10 - GHOST_FLASH_HEIGHT, width, GHOST_FLASH_HEIGHT)
        .fill({ color: GHOST_FLASH_COLORS[marks.flash.judgment], alpha: marks.flash.alpha })
        .stroke({ color: GHOST_LANE_COLOR, width: 1, alpha: marks.flash.alpha });
    }
  }
}
