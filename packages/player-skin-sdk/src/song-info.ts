import type { BeMusicGameplayRuntime } from './types.ts';

/** The song info a skin draws in one layer: the title, artist and genre the runtime names it by. */
export interface BeMusicSongInfoText {
  chartTitle?: string;
  chartArtist?: string;
  chartGenre?: string;
}

/** One song info layer to draw this frame, at `alpha` (0-1). */
export interface BeMusicSongInfoLayer {
  info: BeMusicSongInfoText;
  alpha: number;
}

/**
 * The song info layers to draw this frame, back to front: the current song alone at full opacity, or, while a NONSTOP
 * play crossfades into the next stage's song (`runtime.songInfoFade`), the old song fading out under the new one fading
 * in. A skin draws its title block once per layer, multiplying each layer's opacity in, so it crossfades without
 * tracking anything itself; a layer at 0 is left out.
 */
export function resolveSongInfoLayers(runtime: BeMusicGameplayRuntime): BeMusicSongInfoLayer[] {
  const current: BeMusicSongInfoText = {
    chartTitle: runtime.chartTitle,
    chartArtist: runtime.chartArtist,
    chartGenre: runtime.chartGenre,
  };
  const fade = runtime.songInfoFade;
  if (fade === undefined) return [{ info: current, alpha: 1 }];
  const progress = Number.isFinite(fade.progress) ? Math.min(1, Math.max(0, fade.progress)) : 1;
  const layers: BeMusicSongInfoLayer[] = [];
  if (progress < 1) {
    const { progress: _progress, ...previous } = fade;
    layers.push({ info: previous, alpha: 1 - progress });
  }
  if (progress > 0) layers.push({ info: current, alpha: progress });
  return layers;
}
