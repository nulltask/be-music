// The Debug Menu's Audio folder: the volumes, "Play in silent mode" and the Compressor folder. It is built with the menu
// as `this` (`DebugMenu`).
import type { FolderApi } from 'tweakpane';
import { setMasterVolume, supportsSystemAudioSession } from '@be-music/player-browser/audio';
import { storeVolumes } from '../../services/settings.ts';
import {
  SILENT_MODE_STRINGS,
  mountStartSilentModeOption,
  resolveSilentModeLanguage,
} from '../../silent-mode-playback.ts';
import { DEBUG_MENU_FOLDERS, type DebugMenuFolder } from './folders.ts';
import type { DebugMenu } from './index.ts';
/**
 * Volumes (master over every sound, then the keysound / BGM balance; all three apply live and are remembered for the
 * next visit), then the compressor: the master switch, the split-mode stage toggles, and every compressor's
 * parameters.
 */
export function buildAudioFolder(
  this: DebugMenu,
  audio: FolderApi,
  addFolder: (parent: FolderApi, folder: DebugMenuFolder) => FolderApi,
): void {
  const rememberVolumes = () =>
    storeVolumes({
      masterVolume: this.guiState.masterVolume,
      muted: this.guiState.muted,
      keyVolume: this.guiState.keyVolume,
      bgmVolume: this.guiState.bgmVolume,
    });
  const onVolumeChange = (channel: 'key' | 'bgm') => (value: number) => {
    this.gameplayView?.setAudioVolume(channel, value / 100);
    rememberVolumes();
  };
  audio.addBinding(this.guiState, 'muted', { label: 'Mute' }).on('change', ({ value }) => {
    setMasterVolume(value ? 0 : this.guiState.masterVolume / 100);
    rememberVolumes();
  });
  audio
    .addBinding(this.guiState, 'masterVolume', { label: 'Master (%)', min: 0, max: 100, step: 1 })
    .on('change', ({ value }) => {
      setMasterVolume(this.guiState.muted ? 0 : value / 100);
      rememberVolumes();
    });
  audio
    .addBinding(this.guiState, 'keyVolume', { label: 'Key sound (%)', min: 0, max: 100, step: 1 })
    .on('change', (event) => onVolumeChange('key')(event.value));
  audio
    .addBinding(this.guiState, 'bgmVolume', { label: 'BGM (%)', min: 0, max: 100, step: 1 })
    .on('change', (event) => onVolumeChange('bgm')(event.value));
  // Safari / iOS only (`navigator.audioSession`): elsewhere web audio has no silent switch to get past, so the row is
  // left out rather than shown disabled.
  if (supportsSystemAudioSession()) {
    const strings = SILENT_MODE_STRINGS[resolveSilentModeLanguage(navigator.language)];
    this.silentMode.controller = audio
      .addBinding(this.guiState, 'playInSilentMode', { label: strings.label })
      .on('change', ({ value }) => this.silentMode.set(value));
    audio.addBinding({ note: strings.note }, 'note', {
      label: 'Silent switch',
      readonly: true,
      multiline: true,
      rows: 3,
    });
    // The same setting on the start card, so it can be chosen before the first sound.
    const startSection = document.querySelector<HTMLElement>('#start-silent-mode');
    if (startSection !== null) {
      this.silentMode.startOption = mountStartSilentModeOption({
        section: startSection,
        strings,
        checked: this.guiState.playInSilentMode,
        onChange: (value) => this.silentMode.set(value),
      });
    }
  }
  const compressor = addFolder(audio, DEBUG_MENU_FOLDERS.compressor);
  compressor.addBinding(this.guiState, 'compressor', { label: 'Enabled' }).on('change', ({ value }) => {
    this.gameplayView?.setAudioCompressor(value);
    this.refreshCompressorStageVisibility();
  });
  const stages = addFolder(compressor, DEBUG_MENU_FOLDERS.compressorStages);
  this.compressorStageFolder = stages;
  stages.addBinding(this.guiState, 'compressorKey', { label: 'Key' }).on('change', ({ value }) => {
    this.gameplayView?.setAudioCompressorStageEnabled('key', value);
  });
  stages.addBinding(this.guiState, 'compressorBGM', { label: 'BGM' }).on('change', ({ value }) => {
    this.gameplayView?.setAudioCompressorStageEnabled('bgm', value);
  });
  stages.addBinding(this.guiState, 'compressorMaster', { label: 'Master' }).on('change', ({ value }) => {
    this.gameplayView?.setAudioCompressorStageEnabled('master', value);
  });
  this.buildCompressorTuningGUI(compressor);
}
