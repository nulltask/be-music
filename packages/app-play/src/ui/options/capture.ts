import { paneOptions, selectBinding } from '../../pane-controls.ts';
import { onPlayerLangChange, playerLang } from '../../player-copy.ts';
import { optionLabel } from './labels.ts';
// The Options dialog's Capture folder. It is built with the dialog as `this` (`OptionsDialog`).
import { recordingFormatOptions, recordingQualityOptions } from '../../recording-format-choice.ts';
import { storeRecordingFormat } from '../../services/settings.ts';
import type { OptionsDialog } from './index.ts';
/** Capture: recording the play screen as a video in the chosen format, and screenshots. */
export function buildCaptureFolder(this: OptionsDialog): void {
  this.place('recordGameplay').addBinding(this.guiState, 'recordGameplay', { label: 'Record every play' });
  // The container and codec of the video: MP4 · H.264 unless the player picks another, remembered across visits.
  const format = selectBinding(
    this.place('recordingFormat'),
    this.guiState,
    'recordingFormat',
    'Video format',
    recordingFormatOptions(),
  ).on('change', ({ value: key }) => storeRecordingFormat(key));
  // The bitrates: Low to Very high, scaled by the canvas size. Standard unless the player picks another.
  const quality = selectBinding(
    this.place('recordingQuality'),
    this.guiState,
    'recordingQuality',
    'Video quality',
    recordingQualityOptions(),
  );
  // The dialog relabels its controls, not a select's choices: these follow the player's language here.
  const relabelQualities = () => {
    quality.options = paneOptions(recordingQualityOptions()).map((choice) => ({
      ...choice,
      text: optionLabel(choice.text, playerLang()),
    }));
  };
  relabelQualities();
  onPlayerLangChange(relabelQualities);
  this.recordingSettingControllers = [format, quality];
  // Screenshot button — captures the Pixi stage at its native size (= the renderer's current screen dimensions;
  // matches what the user sees in the canvas, downloaded as PNG). See `captureScreenshot` for the extract pipeline.
  this.place('screenshot')
    .addButton({ title: '📸 Screenshot' })
    .on('click', () => this.guiState['screenshot']());
}
