import { paneOptions, selectBinding } from '../../pane-controls.ts';
import { onPlayerLangChange, playerLang } from '../../player-copy.ts';
import { recordingQualityOptions } from '../../recording-format-choice.ts';
import { optionLabel } from './labels.ts';
// The Options dialog's Library & records folder. It is built with the dialog as `this` (`OptionsDialog`).
import type { OptionContainer } from '../options-controls.ts';
import { storeChartBestRecords } from '../../chart-best-records.ts';
import { LocalDataPanel } from '../../local-data-panel.ts';
import { parseURLMediaParams } from '../../url-load.ts';
import { mountBemuseServerManager } from './bemuse-servers.ts';
import { mountCourseTableManager } from './course-tables.ts';
import type { ReplayAutoSaveRule } from '../../services/replay-slots.ts';
import { OPTION_FOLDERS, type OptionFolderSpec } from './folders.ts';
import type { OptionsDialog } from './index.ts';
/** Each replay slot auto-save rule, as beatoraja's launcher names it. */
const REPLAY_AUTO_SAVE_LABELS: Record<string, ReplayAutoSaveRule> = {
  'Never (save by hand)': 'never',
  'Better EX score': 'score-update',
  'Better or equal EX score': 'score-update-or-equal',
  'Fewer BP': 'miss-count-update',
  'Fewer or equal BP': 'miss-count-update-or-equal',
  'Better max combo': 'max-combo-update',
  'Better or equal max combo': 'max-combo-update-or-equal',
  'Better clear lamp': 'clear-update',
  'Better or equal clear lamp': 'clear-update-or-equal',
  'Any of them better': 'any-update',
  Always: 'always',
};

/**
 * Loading from URLs (the same path as the `?music=` / `?skin=` parameters) and the play-history and best-record
 * stores.
 */
export function buildLibraryFolder(
  this: OptionsDialog,
  library: OptionContainer,
  addFolder: (parent: OptionContainer, folder: OptionFolderSpec) => OptionContainer,
): void {
  // Where charts come from, one tab each: folders and files on this device, Bemuse music servers, difficulty tables.
  const sources = library.addTab({
    pages: [{ title: 'Local folders' }, { title: 'Bemuse servers' }, { title: 'Difficulty tables' }],
  });
  const [local, bemuse, tables] = sources.pages;
  if (local === undefined || bemuse === undefined || tables === undefined) return;
  local.addButton({ title: 'Open folder' }).on('click', () => this.guiState['openFolder']());
  local.addButton({ title: 'Open files (ZIP / replay)' }).on('click', () => this.guiState['openFiles']());
  const folderManager = document.createElement('div');
  folderManager.dataset.rememberedFolderManager = '';
  local.addElement(folderManager);
  // The select screen's F8 / F2, for a player without a keyboard: the folders, Bemuse servers and tables read again.
  local.addButton({ title: 'Reload folders' }).on('click', () => void this.library.reloadCharts());
  const bemuseServers = document.createElement('div');
  bemuse.addElement(bemuseServers);
  mountBemuseServerManager(bemuseServers, {
    library: this.library,
    setStatus: (text) => this.setStatus(text),
    saveSettings: () => this.scheduleSettingsSave(),
  });
  // Bemuse's own volume for each server song (its `replaygain`). Read as a play starts, so it is locked while one runs.
  this.trackPlayOption(
    bemuse.addBinding(this.guiState, 'bemuseReplayGain', { label: 'Bemuse ReplayGain' }).on('change', ({ value }) => {
      this.guiState.bemuseReplayGain = value;
      this.library.refreshBemuseReplayGain();
    }),
  );
  // The difficulty tables whose courses are listed: remembered, and imported again on load.
  const courseTables = document.createElement('div');
  tables.addElement(courseTables);
  mountCourseTableManager(courseTables, {
    library: this.library,
    setStatus: (text) => this.setStatus(text),
    saveSettings: () => this.scheduleSettingsSave(),
  });

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
  // Off by default: a replay then records each input's coarse device class only. On, it also keeps each controller's
  // `Gamepad.id`, which often names its vendor and product ids, in every replay it records (files, slots, Leaderboard).
  // Read as a play starts, so it is locked while one runs.
  this.trackPlayOption(
    library
      .addBinding(this.guiState, 'replayDeviceNames', { label: 'Record device names in replays' })
      .on('change', ({ value }) => {
        this.guiState.replayDeviceNames = value;
      }),
  );
  // Slots select a replay from history when its result meets the rule or the player assigns it by hand.
  const slots = addFolder(library, OPTION_FOLDERS.replaySlots);
  for (const slot of [1, 2, 3, 4] as const) {
    selectBinding(slots, this.guiState, `replaySlotAutoSave${slot}`, `Slot ${slot} auto-save`, REPLAY_AUTO_SAVE_LABELS);
  }
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
  // What the player keeps in this browser, read-only; built on first use.
  let localData: LocalDataPanel | undefined;
  library.addButton({ title: 'Local data…' }).on('click', () => (localData ??= new LocalDataPanel()).open());
}

/** The BGA transcode settings, which apply while charts load (the Advanced folder's BGA video transcode). */
export function buildBGATranscodeFolder(this: OptionsDialog, transcode: OptionContainer): void {
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
  // The bitrate the transcode spends, as the Capture tab's Video quality picks a recording's: libx264's -crf, or the
  // WebCodecs encoder's bitrate. Standard is the long-standing one.
  const quality = selectBinding(
    transcode,
    this.guiState,
    'bgaTranscodeQuality',
    'Transcode quality',
    recordingQualityOptions(),
  ).on('change', ({ value }) => {
    this.guiState.bgaTranscodeQuality = value;
  });
  const relabelQualities = (): void => {
    quality.options = paneOptions(recordingQualityOptions()).map((choice) => ({
      ...choice,
      text: optionLabel(choice.text, playerLang()),
    }));
  };
  relabelQualities();
  onPlayerLangChange(relabelQualities);
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
