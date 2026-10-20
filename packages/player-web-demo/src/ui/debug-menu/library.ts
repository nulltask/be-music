// The Debug Menu's Library & records folder. It is built with the menu as `this` (`DebugMenu`).

import type { GUI } from 'lil-gui';
import { storeSongRecords } from '../../song-records.ts';
import { parseURLMediaParams } from '../../url-load.ts';
import { DEBUG_MENU_FOLDERS, type DebugMenuFolder } from './folders.ts';
import type { DebugMenu } from './index.ts';

/**
 * Loading from URLs (the same path as the `?music=` / `?skin=` parameters), the play-history and best-record stores,
 * and the BGA transcode settings that apply while charts load.
 */
export function buildLibraryFolder(
  this: DebugMenu,
  library: GUI,
  addFolder: (parent: GUI, folder: DebugMenuFolder) => GUI,
): void {
  const urlParams = parseURLMediaParams(window.location.href);
  const urls = {
    music: urlParams.musicURL ?? '',
    skin: urlParams.skinURL ?? '',
    load: () => {
      const musicURL = urls.music.trim() || undefined;
      const skinURL = urls.skin.trim() || undefined;
      if (!musicURL && !skinURL) {
        this.setStatus('Enter a music or skin ZIP URL first');
        return;
      }
      void this.library.loadFromURL({ musicURL, skinURL });
    },
  };
  library.add(urls, 'music').name('Music ZIP URL');
  library.add(urls, 'skin').name('Skin ZIP URL');
  library.add(urls, 'load').name('Load from URLs');
  // Play-history auto-save — OFF by default. When enabled, every finished play downloads its play log
  // (`*.bmplay.json`, the raw input replay defined in `@be-music/player/playlog`) as soon as the result scene
  // mounts. The file feeds the `bms-playlog` CLI, which re-derives LR2 / beatoraja / IIDX scores from the replay.
  // The value is LATCHED at song start (`lockPlaylogOptionsForPlay`) and the controller is disabled while a song
  // is playing — playlog options cannot change mid-play.
  this.playlogSaveController = library
    .add(this.guiState, 'autoSavePlaylog')
    .name('Auto-save play history')
    .onChange((value: boolean) => {
      this.guiState.autoSavePlaylog = value;
    });
  library
    .add(
      {
        clear: () => {
          if (this.records.songRecords.size === 0) {
            this.setStatus('No best records to clear');
            return;
          }
          if (
            !window.confirm(
              `Clear ${this.records.songRecords.size} best record(s), of every judge ruleset? This cannot be undone.`,
            )
          ) {
            return;
          }
          this.records.songRecords.clear();
          storeSongRecords(this.records.songRecords);
          this.setStatus('Best records cleared');
        },
      },
      'clear',
    )
    .name('Clear best records');
  // BGA video transcode controls. Both settings are seeded into the next play scene's settings (see
  // `preloadGameplay` / `playSong` for the wiring), so changing them mid-session takes effect on the next chart mount
  // — no need to rebuild gameplay if the user is between songs. We don't push live into the running gameplay because
  // BGA assets are loaded once at chart- prepare time and the codec / resize decisions are encoded into the cached
  // video bytes.
  //
  // Both controls are dropdowns rather than free-form fields: the meaningful options cluster around standard video
  // heights (SD / 720p / 1080p / 4K) and a discrete codec pick. `0` in the resize dropdown is the magic "Off" value —
  // the consumer treats anything `≤ 0` as "preserve resolution". Earlier iterations split resize into a checkbox +
  // size pair, but users would change the size without realizing they also had to flip the checkbox — the resize was
  // silently a no-op. Folding both into one control with an explicit `Off` row removes that footgun.
  const transcode = addFolder(library, DEBUG_MENU_FOLDERS.bgaTranscode);
  // WebCodecs `VideoEncoder` is a browser feature; gate the checkbox on its existence so the user can't toggle a
  // state the runtime can't honor. On unsupported browsers (Safari < 17, older Firefox builds) the controller is
  // disabled and the seed value stays at `false`.
  const webCodecsSupported = typeof window !== 'undefined' && 'VideoEncoder' in window;
  const webCodecsController = transcode
    .add(this.guiState, 'bgaUseWebCodecs')
    .name(webCodecsSupported ? 'Use WebCodecs encoder' : 'Use WebCodecs encoder (unsupported)')
    .onChange((value: boolean) => {
      this.guiState.bgaUseWebCodecs = value;
    });
  if (!webCodecsSupported) {
    webCodecsController.disable();
  }
  transcode
    .add(this.guiState, 'bgaResizeMaxEdgePx', {
      'Off (preserve resolution)': 0,
      '256 px (BMS spec)': 256,
      '360 px (≈ SD)': 360,
      '480 px (SD)': 480,
      '512 px': 512,
      '720 px (HD)': 720,
      '1080 px (FHD)': 1080,
      '1440 px (QHD)': 1440,
      '2160 px (4K)': 2160,
    })
    .name('Resize')
    .onChange((value: number) => {
      this.guiState.bgaResizeMaxEdgePx = value;
    });
}
