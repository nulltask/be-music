import type { ChartPlayVariant } from '@be-music/player/core/lane-layout';
import { isScratchLaneForVariant, resolveSideRelativeLaneIndex } from '../../scene/gameplay-lanes.ts';
import type { BeMusicLaneKind, BeMusicSelectLayout, BeMusicSkin } from './types.ts';
import { validateBeMusicSkin } from '../../skin-sdk/define.ts';
import { logger } from '../../logger.ts';

const log = logger('be-music-skin');

export interface BeMusicSkinRegistry {
  readonly skins: readonly BeMusicSkin[];
  /** The skin with `id`, or the first registered skin when `id` is unknown / undefined. */
  resolve(id: string | undefined): BeMusicSkin;
}

export interface BeMusicSkinRegistryOptions {
  /**
   * Called for each skin left out because its declaration is invalid or written for an unsupported API revision (see
   * `validateBeMusicSkin`). Defaults to a logged warning.
   */
  onRejected?: (skin: BeMusicSkin, problems: readonly string[]) => void;
}

/**
 * Registry over a fixed skin list. Skins whose declaration doesn't validate (an unsupported `apiVersion`, a malformed
 * id or version, …) are left out, so a third-party skin built for another player release can't break the host. The
 * first accepted entry is the fallback for unknown ids; at least one must be accepted.
 */
export function createBeMusicSkinRegistry(
  candidates: readonly BeMusicSkin[],
  options: BeMusicSkinRegistryOptions = {},
): BeMusicSkinRegistry {
  const onRejected =
    options.onRejected ??
    ((skin: BeMusicSkin, problems: readonly string[]) =>
      log.warn(`skipping skin "${skin.id}": ${problems.join('; ')}`));
  const skins = candidates.filter((skin) => {
    const problems = validateBeMusicSkin(skin);
    if (problems.length > 0) onRejected(skin, problems);
    return problems.length === 0;
  });
  const first = skins[0];
  if (!first) {
    throw new Error('createBeMusicSkinRegistry: at least one valid skin is required');
  }
  const byId = new Map<string, BeMusicSkin>();
  for (const skin of skins) {
    if (byId.has(skin.id)) {
      throw new Error(`createBeMusicSkinRegistry: duplicate skin id "${skin.id}"`);
    }
    byId.set(skin.id, skin);
  }
  return {
    skins,
    resolve: (id) => (id !== undefined ? byId.get(id) : undefined) ?? first,
  };
}

/** Chromatic offsets of the black keys within an octave (C# D# F# G# A#). */
const KEYBOARD_BLACK_KEY_SEMITONES = new Set([1, 3, 6, 8, 10]);

/**
 * Visual class of a lane. `laneIndex` is the LR2 lane id (0 / 10 = scratch, 1..9 / 11..19 = keys, -1 when the lane
 * has no LR2 rect). IIDX convention: odd keys white, even keys black. The 24 / 48-key keyboard modes colour by piano
 * key instead, repeating every octave.
 */
export function resolveBeMusicLaneKind(
  channel: string,
  laneIndex: number,
  playVariant: ChartPlayVariant | undefined,
): BeMusicLaneKind {
  if (isScratchLaneForVariant(channel, playVariant)) return 'scratch';
  if (playVariant === '24' || playVariant === '48') {
    const semitone = (resolveSideRelativeLaneIndex(channel, playVariant) - 1) % 12;
    return KEYBOARD_BLACK_KEY_SEMITONES.has(semitone) ? 'black' : 'white';
  }
  return (laneIndex % 10) % 2 === 0 ? 'black' : 'white';
}

/**
 * The slice of the entry list the select renderer draws: keeps the focused row near the vertical centre, clamped so
 * the window never scrolls past either end. Shared by rendering and row hit-testing so both agree on row positions.
 */
export function resolveSelectListWindow(
  layout: BeMusicSelectLayout,
  designHeight: number,
  selectedIndex: number,
  entryCount: number,
): { firstVisibleIndex: number; visibleRows: number } {
  const listBottom = designHeight - layout.listBottomInset;
  const visibleRows = Math.max(1, Math.floor((listBottom - layout.listTop) / layout.rowHeight));
  const firstVisibleIndex = Math.max(
    0,
    Math.min(selectedIndex - Math.floor(visibleRows / 2), Math.max(0, entryCount - visibleRows)),
  );
  return { firstVisibleIndex, visibleRows };
}
