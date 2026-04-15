import { createElement } from 'react';
import * as playerReactApi from '@be-music/player-react';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

export function registerPlayerReactExportsCases(define: DefineBenchmarkCase): void {
  define('player-react.BeMusicBrowserLibrary', {
    run: () => {
      createElement(playerReactApi.BeMusicBrowserLibrary, { enableDrop: false });
    },
  });
}
