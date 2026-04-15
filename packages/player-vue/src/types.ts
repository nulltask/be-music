import type { BrowserSongCollection } from '@be-music/player-web-core';

export interface BeMusicBrowserLibraryProps {
  collection?: BrowserSongCollection;
  statusText?: string;
  enableDrop?: boolean;
}
