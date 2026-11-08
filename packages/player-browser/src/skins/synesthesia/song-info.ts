import {
  resolveSongInfoLayers,
  type BeMusicGameplayRuntime,
  type BeMusicSongInfoText,
} from '@be-music/player-skin-sdk';
import type { Text } from 'pixi.js';

/**
 * Draws a NONSTOP play's song info crossfading (`resolveSongInfoLayers`): `draw` once per layer, returning the texts it
 * added, which then take that layer's opacity. Pooled texts come back at full opacity each frame.
 */
export function drawSongInfoLayers(
  runtime: BeMusicGameplayRuntime,
  draw: (info: BeMusicSongInfoText) => ReadonlyArray<Text | undefined>,
): void {
  for (const { info, alpha } of resolveSongInfoLayers(runtime)) {
    for (const node of draw(info)) if (node !== undefined) node.alpha = alpha;
  }
}
