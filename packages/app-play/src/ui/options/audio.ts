// The Options dialog's Audio folder: the volumes, "Play in silent mode", peak gain and the Compressor folder. It is built
// with the dialog as `this` (`OptionsDialog`).
import { setMasterVolume, supportsSystemAudioSession } from '@be-music/player-browser/audio';
import { storeVolumes } from '../../services/settings.ts';
import {
  SILENT_MODE_STRINGS,
  mountStartSilentModeOption,
  resolveSilentModeLanguage,
} from '../../silent-mode-playback.ts';
import type { OptionsDialog } from './index.ts';
/**
 * Volumes (master over every sound, then the keysound / BGM balance; all three apply live and are remembered for the
 * next visit), then peak gain (the next play only; off until turned on), then the compressor: the master switch, the
 * split-mode stage toggles, and every compressor's parameters.
 */
export function buildAudioFolder(this: OptionsDialog): void {
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
  this.place('muted')
    .addBinding(this.guiState, 'muted', { label: 'Mute' })
    .on('change', ({ value }) => {
      setMasterVolume(value ? 0 : this.guiState.masterVolume / 100);
      rememberVolumes();
    });
  this.place('masterVolume')
    .addBinding(this.guiState, 'masterVolume', { label: 'Master (%)', min: 0, max: 100, step: 1 })
    .on('change', ({ value }) => {
      setMasterVolume(this.guiState.muted ? 0 : value / 100);
      rememberVolumes();
    });
  this.place('keyVolume')
    .addBinding(this.guiState, 'keyVolume', { label: 'Key sound (%)', min: 0, max: 100, step: 1 })
    .on('change', (event) => onVolumeChange('key')(event.value));
  this.place('bgmVolume')
    .addBinding(this.guiState, 'bgmVolume', { label: 'BGM (%)', min: 0, max: 100, step: 1 })
    .on('change', (event) => onVolumeChange('bgm')(event.value));
  // Safari / iOS only (`navigator.audioSession`): elsewhere web audio has no silent switch to get past, so the row is
  // left out rather than shown disabled.
  if (supportsSystemAudioSession()) {
    const strings = SILENT_MODE_STRINGS[resolveSilentModeLanguage(navigator.language)];
    this.silentMode.controller = this.place('playInSilentMode')
      .addBinding(this.guiState, 'playInSilentMode', { label: strings.label })
      .on('change', ({ value }) => this.silentMode.set(value));
    this.place('silentModeNote').addBinding({ note: strings.note }, 'note', {
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
  this.place('peakGain').addBinding(this.guiState, 'peakGain', { label: 'Peak gain (next play)' });
  this.place('compressorEnabled')
    .addBinding(this.guiState, 'compressor', { label: 'Enabled' })
    .on('change', ({ value }) => {
      this.gameplayView?.setAudioCompressor(value);
      this.refreshCompressorStageVisibility();
    });
  this.layout?.folder('compressorStages').element.setAttribute('data-hide-empty-options-folder', '');
  for (const [key, label, stage] of [
    ['compressorKey', 'Key', 'key'],
    ['compressorBGM', 'BGM', 'bgm'],
    ['compressorMaster', 'Master', 'master'],
  ] as const) {
    this.compressorStageControllers.push(
      this.place(key)
        .addBinding(this.guiState, key, { label })
        .on('change', ({ value }) => this.gameplayView?.setAudioCompressorStageEnabled(stage, value)),
    );
  }
  this.buildCompressorTuningGUI(this.place('compressorTuning'));
}
