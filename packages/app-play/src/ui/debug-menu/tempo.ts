import { selectBinding, type PaneBinding } from '../../pane-controls.ts';
// The Debug Menu's Tempo folder. It is built with the menu as `this` (`DebugMenu`).
import type { FolderApi } from 'tweakpane';
import {
  storePlayTempoSettings,
  TEMPO_PERCENT_MAX,
  TEMPO_PERCENT_MIN,
  tempoFromPercent,
} from '../../play-tempo-settings.ts';
import type { DebugMenu } from './index.ts';
/**
 * The play tempo (-50 % .. +50 %) and how a tempo change sounds, for the song tempo and NONSTOP FIT stages alike.
 */
export function buildTempoFolder(this: DebugMenu, folder: FolderApi): void {
  const trackPlayOption = (controller: PaneBinding): PaneBinding => this.trackPlayOption(controller);
  // The play tempo (-50 % .. +50 %) and how a tempo change sounds, for the song tempo and NONSTOP FIT stages alike.
  // Read when a play starts, so they are disabled during one; a play at another tempo is practice (not ranked, no
  // records).
  // With the pitch following the tempo, the slider stays enabled during a play and changes its tempo live.
  const rememberTempo = () => storePlayTempoSettings(this.guiState);
  trackPlayOption(folder.addBinding(this.guiState, 'tempoEnabled', { label: 'Enabled' }).on('change', rememberTempo));
  this.tempoController = trackPlayOption(
    folder
      .addBinding(this.guiState, 'tempoPercent', {
        label: 'Tempo (%)',
        min: TEMPO_PERCENT_MIN,
        max: TEMPO_PERCENT_MAX,
        step: 1,
      })
      .on('change', () => {
        rememberTempo();
        if (!this.playLock.liveTempoPlay) return;
        const tempo = tempoFromPercent(this.guiState.tempoPercent);
        this.gameplayView?.setTempo(tempo);
      }),
  );
  trackPlayOption(
    selectBinding(folder, this.guiState, 'tempoPitchMode', 'Pitch', {
      'Pitch follows tempo (LR2)': 'pitch',
      'Keep pitch': 'keep-pitch',
    }).on('change', rememberTempo),
  );
  trackPlayOption(
    selectBinding(folder, this.guiState, 'tempoStretchAlgorithm', 'Keep-pitch stretcher', {
      WSOLA: 'wsola',
      'Signalsmith Stretch': 'signalsmith',
    }).on('change', rememberTempo),
  );
}
