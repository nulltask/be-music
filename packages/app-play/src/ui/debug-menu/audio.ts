// The Debug Menu's Audio folder: the volumes, "Play in silent mode" and the Compressor folder. It is built with the menu
// as `this` (`DebugMenu`).

import type { GUI } from 'lil-gui';
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
  audio: GUI,
  addFolder: (parent: GUI, folder: DebugMenuFolder) => GUI,
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
  audio
    .add(this.guiState, 'muted')
    .name('Mute')
    .onChange((value: boolean) => {
      setMasterVolume(value ? 0 : this.guiState.masterVolume / 100);
      rememberVolumes();
    });
  audio
    .add(this.guiState, 'masterVolume', 0, 100, 1)
    .name('Master (%)')
    .onChange((value: number) => {
      setMasterVolume(this.guiState.muted ? 0 : value / 100);
      rememberVolumes();
    });
  audio.add(this.guiState, 'keyVolume', 0, 100, 1).name('Key sound (%)').onChange(onVolumeChange('key'));
  audio.add(this.guiState, 'bgmVolume', 0, 100, 1).name('BGM (%)').onChange(onVolumeChange('bgm'));
  // Safari / iOS only (`navigator.audioSession`): elsewhere web audio has no silent switch to get past, so the row is
  // left out rather than shown disabled.
  if (supportsSystemAudioSession()) {
    const strings = SILENT_MODE_STRINGS[resolveSilentModeLanguage(navigator.language)];
    this.silentMode.controller = audio
      .add(this.guiState, 'playInSilentMode')
      .name(strings.label)
      .onChange((value: boolean) => this.silentMode.set(value));
    const note = document.createElement('div');
    note.className = 'gui-note';
    note.textContent = strings.note;
    audio.$children.append(note);
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
  compressor
    .add(this.guiState, 'compressor')
    .name('Enabled')
    .onChange((value: boolean) => {
      this.gameplayView?.setAudioCompressor(value);
      this.refreshCompressorStageVisibility();
    });
  const stages = addFolder(compressor, DEBUG_MENU_FOLDERS.compressorStages);
  this.compressorStageFolder = stages;
  stages
    .add(this.guiState, 'compressorKey')
    .name('Key')
    .onChange((value: boolean) => {
      this.gameplayView?.setAudioCompressorStageEnabled('key', value);
    });
  stages
    .add(this.guiState, 'compressorBGM')
    .name('BGM')
    .onChange((value: boolean) => {
      this.gameplayView?.setAudioCompressorStageEnabled('bgm', value);
    });
  stages
    .add(this.guiState, 'compressorMaster')
    .name('Master')
    .onChange((value: boolean) => {
      this.gameplayView?.setAudioCompressorStageEnabled('master', value);
    });
  this.buildCompressorTuningGUI(compressor);
}
