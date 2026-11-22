import { defaultBrowserWorkerCount } from '@be-music/player-browser/compute';
import { readDeviceSignals, resolveDefaultSkinEffects } from '../../device-profile.ts';
import { DEFAULT_RENDER_RESOLUTION, nearestRenderResolution, renderResolutionSteps } from '../../render-resolution.ts';
import { BE_MUSIC_SKINS } from '../../services/built-in-skins.ts';
import type { RuntimeDefaultResolver } from './layout.ts';

/** Applies the device profile and the currently loaded themes to the JSON's runtime defaults. */
export function runtimeOptionDefaults(firstLR2Theme: () => string | undefined): RuntimeDefaultResolver {
  return (policy) => {
    switch (policy) {
      case 'builtInSkin':
        return BE_MUSIC_SKINS.resolve(undefined).id;
      case 'lr2Theme':
        return firstLR2Theme();
      case 'skinEffects':
        return resolveDefaultSkinEffects(undefined, readDeviceSignals());
      case 'renderResolution':
        return nearestRenderResolution(renderResolutionSteps(window.devicePixelRatio || 1), DEFAULT_RENDER_RESOLUTION);
      case 'workers':
        return defaultBrowserWorkerCount(navigator.hardwareConcurrency);
      case 'bgaUseWebCodecs':
        return 'VideoEncoder' in globalThis;
    }
  };
}
