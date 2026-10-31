// The embed page's bootstrap (`/embed/?track=…`): the browser workers, then the preview player over the page.
import {
  configureBGAVideoWorkers,
  configureBrowserWorkers,
  disposeBrowserWorkers,
} from '@be-music/player-browser/compute';
import { installSilentModePlayback } from '../silent-mode-playback.ts';
import { PreviewApp } from './preview-app.ts';
import { parseEmbedTrack } from './track-url.ts';
import './embed.css';

configureBrowserWorkers(() => new Worker(new URL('../compute-worker.ts', import.meta.url), { type: 'module' }));
// A BGA video the browser can't play streams through these while ffmpeg.wasm transcodes it.
configureBGAVideoWorkers({
  createDecodeWorker: () => new Worker(new URL('../bga-decode-worker.ts', import.meta.url), { type: 'module' }),
  createEncodeWorker: () => new Worker(new URL('../bga-encode-worker.ts', import.meta.url), { type: 'module' }),
});
window.addEventListener('pagehide', (event) => {
  if (!event.persisted) disposeBrowserWorkers();
});

// A preview plays like a video: with sound, whatever the iPhone / iPad silent switch says (`navigator.audioSession`
// asked for 'playback' now, before any AudioContext, and again on the first gesture that starts the sound).
installSilentModePlayback({ enabled: () => true, target: window, visibility: document });

const element = (id: string): HTMLElement => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`The embed page has no #${id}`);
  return found;
};

void new PreviewApp({ root: element('preview'), stage: element('stage'), overlay: element('overlay') }).open(
  parseEmbedTrack(window.location.href),
);
