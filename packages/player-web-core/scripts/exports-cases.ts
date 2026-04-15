import * as playerWebCoreApi from '@be-music/player-web-core';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

export function registerPlayerWebCoreExportsCases(define: DefineBenchmarkCase): void {
  define('player-web-core.BrowserSongLibrary', {
    run: () => {
      new playerWebCoreApi.BrowserSongLibrary();
    },
  });
  define('player-web-core.loadSongCollectionFromDrop', {
    run: async (fixtures) => {
      const file = new File([fixtures.bmsBuffer], 'bench.bms', { type: 'text/plain' });
      await playerWebCoreApi.loadSongCollectionFromDrop({
        items: [
          {
            kind: 'file',
            getAsFile: () => file,
          },
        ],
        files: [] as unknown as FileList,
      } as DataTransfer);
    },
  });
  define('player-web-core.loadSongCollectionFromFiles', {
    run: async (fixtures) => {
      const file = new File([fixtures.bmsBuffer], 'bench.bms', { type: 'text/plain' });
      await playerWebCoreApi.loadSongCollectionFromFiles([file]);
    },
  });
  define('player-web-core.PixiSongListView', {
    run: () => {
      new playerWebCoreApi.PixiSongListView();
    },
  });
}
