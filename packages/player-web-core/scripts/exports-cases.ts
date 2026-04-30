import * as playerWebCoreApi from '@be-music/player-web-core';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

export function registerPlayerWebCoreExportsCases(define: DefineBenchmarkCase): void {
  define('player-web-core.BrowserSongLibrary', {
    run: () => {
      new playerWebCoreApi.BrowserSongLibrary();
    },
  });
  define('player-web-core.splitDroppedSongAndThemeFiles', {
    run: () => {
      playerWebCoreApi.splitDroppedSongAndThemeFiles([
        { name: 'main.bms', webkitRelativePath: 'Songs/Example/main.bms' },
        { name: 'kick.wav', webkitRelativePath: 'Songs/Example/kick.wav' },
        { name: 'play_7.lr2skin', webkitRelativePath: 'Theme/play_7.lr2skin' },
      ]);
    },
  });
  define('player-web-core.summarizeLr2PlaySkins', {
    run: () => {
      playerWebCoreApi.summarizeLr2PlaySkins({ '7': { name: 'play_7' } as playerWebCoreApi.Lr2Skin });
    },
  });
}
