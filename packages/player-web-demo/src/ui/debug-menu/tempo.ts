// The Debug Menu's Tempo folder. It is built with the menu as `this` (`DebugMenu`).

import type { Controller, GUI } from 'lil-gui';
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
export function buildTempoFolder(this: DebugMenu, folder: GUI): void {
  const trackPlayOption = (controller: Controller): Controller => this.trackPlayOption(controller);
  // The play tempo (-50 % .. +50 %) and how a tempo change sounds, for the song tempo and NONSTOP FIT stages alike.
  // Read when a play starts, so they are disabled during one; a play at another tempo is practice (not ranked, no
  // records).
  // With the pitch following the tempo, the slider stays enabled during a play and changes its tempo live.
  const rememberTempo = () => storePlayTempoSettings(this.guiState);
  this.tempoController = trackPlayOption(
    folder
      .add(this.guiState, 'tempoPercent', TEMPO_PERCENT_MIN, TEMPO_PERCENT_MAX, 1)
      .name('Tempo (%)')
      .onChange(() => {
        rememberTempo();
        if (!this.liveTempoPlay) return;
        const tempo = tempoFromPercent(this.guiState.tempoPercent);
        this.gameplayView?.setTempo(tempo);
      }),
  );
  trackPlayOption(
    folder
      .add(this.guiState, 'tempoPitchMode', { 'Pitch follows tempo (LR2)': 'pitch', 'Keep pitch': 'keep-pitch' })
      .name('Pitch')
      .onChange(rememberTempo),
  );
  trackPlayOption(
    folder
      .add(this.guiState, 'tempoStretchAlgorithm', { 'Signalsmith Stretch': 'signalsmith', WSOLA: 'wsola' })
      .name('Keep-pitch stretcher')
      .onChange(rememberTempo),
  );
}
