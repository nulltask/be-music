import * as playerWebCoreApi from '@be-music/player-web-core';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

export function registerPlayerWebCoreExportsCases(define: DefineBenchmarkCase): void {
  define('player-web-core.BrowserSongLibrary', {
    run: () => {
      new playerWebCoreApi.BrowserSongLibrary();
    },
  });
}
