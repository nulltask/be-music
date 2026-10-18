// The Debug Menu's Capture folder. It is built with the menu as `this` (`DebugMenu`).

import type { GUI } from 'lil-gui';
import { RECORD_LABEL } from '../../recording-controller.ts';
import { recordingFormatOptions } from '../../recording-format-choice.ts';
import { storeRecordingFormat } from '../../services/settings.ts';
import type { DebugMenu } from './index.ts';

/** Capture: recording the play screen as a video in the chosen format, and screenshots. */
export function buildCaptureFolder(this: DebugMenu, capture: GUI): void {
  this.recordController = capture.add(this.guiState, 'record').name(RECORD_LABEL);
  // The container and codec of the video: MP4 · H.264 unless the player picks another, remembered across visits.
  capture
    .add(this.guiState, 'recordingFormat', recordingFormatOptions())
    .name('Video format')
    .onChange((key: string) => storeRecordingFormat(key));
  // Screenshot button — captures the Pixi stage at its native size (= the renderer's current screen dimensions;
  // matches what the user sees in the canvas, downloaded as PNG). See `captureScreenshot` for the extract pipeline.
  capture.add(this.guiState, 'screenshot').name('📸 Screenshot');
}
