import { selectBinding } from '../../pane-controls.ts';
// The Debug Menu's Library & records folder. It is built with the menu as `this` (`DebugMenu`).
import type { FolderApi } from 'tweakpane';
import { storeChartBestRecords } from '../../chart-best-records.ts';
import { parseURLMediaParams } from '../../url-load.ts';
import { DEBUG_MENU_FOLDERS, type DebugMenuFolder } from './folders.ts';
import type { DebugMenu } from './index.ts';
/**
 * Loading from URLs (the same path as the `?music=` / `?skin=` parameters), the play-history and best-record stores,
 * and the BGA transcode settings that apply while charts load.
 */
export function buildLibraryFolder(
  this: DebugMenu,
  library: FolderApi,
  addFolder: (parent: FolderApi, folder: DebugMenuFolder) => FolderApi,
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
  library.addBinding(urls, 'music', { label: 'Music ZIP URL' });
  library.addBinding(urls, 'skin', { label: 'Skin ZIP URL' });
  library.addButton({ title: 'Load from URLs' }).on('click', () => urls['load']());
  // Play-history auto-save — OFF by default. When enabled, every finished play downloads its replay
  // (`*.bmplay.json`, the raw input replay defined in `@be-music/player-engine/replay`) as soon as the result scene
  // mounts. The file feeds the `bms-replay` CLI, which re-derives LR2 / beatoraja / That-Which-Must-Not-Be-Named scores from the replay.
  // The value is LATCHED at song start (`lockReplayOptionsForPlay`) and the controller is disabled while a song
  // is playing — replay options cannot change mid-play.
  this.replaySaveController = library
    .addBinding(this.guiState, 'autoSaveReplay', { label: 'Auto-save replays' })
    .on('change', ({ value }) => {
      this.guiState.autoSaveReplay = value;
    });
  library.addButton({ title: 'Clear best records' }).on('click', () => {
    if (this.records.chartBestRecords.size === 0) {
      this.setStatus('No best records to clear');
      return;
    }
    if (
      !window.confirm(
        `Clear ${this.records.chartBestRecords.size} best record(s), of every judge ruleset? This cannot be undone.`,
      )
    ) {
      return;
    }
    this.records.chartBestRecords.clear();
    storeChartBestRecords(this.records.chartBestRecords);
    this.setStatus('Best records cleared');
  });
  // BGA video transcode controls. Both settings are seeded into the next play scene's settings (see
  // `preloadGameplay` / `playChart` for the wiring), so changing them mid-session takes effect on the next chart mount
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
    .addBinding(this.guiState, 'bgaUseWebCodecs', {
      label: webCodecsSupported ? 'Use WebCodecs encoder' : 'Use WebCodecs encoder (unsupported)',
    })
    .on('change', ({ value }) => {
      this.guiState.bgaUseWebCodecs = value;
    });
  if (!webCodecsSupported) {
    webCodecsController.disabled = true;
  }
  selectBinding(transcode, this.guiState, 'bgaResizeMaxEdgePx', 'Resize', {
    'Off (preserve resolution)': 0,
    '256 px (BMS spec)': 256,
    '360 px (≈ SD)': 360,
    '480 px (SD)': 480,
    '512 px': 512,
    '720 px (HD)': 720,
    '1080 px (FHD)': 1080,
    '1440 px (QHD)': 1440,
    '2160 px (4K)': 2160,
  }).on('change', ({ value }) => {
    this.guiState.bgaResizeMaxEdgePx = value;
  });
}
