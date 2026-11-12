// The LR2 mania options of the Options dialog's View folder: LR2's hidden panel options that only change what the
// playfield draws. They are read at each frame, so they stay enabled during a play.
import { PLAY_OPTION_CHOICES } from '@be-music/player-scene-model';
import { selectBinding } from '../../pane-controls.ts';
import type { OptionContainer } from '../options-controls.ts';
import type { OptionsDialog } from './index.ts';

/** Adds the LR2 mania options section to the View folder's Effects page. */
export function buildLR2ManiaRows(this: OptionsDialog, effects: OptionContainer): void {
  const mania = effects.addFolder({ title: 'LR2 mania options' });
  selectBinding(mania, this.guiState, 'lr2Acceleration', 'ACCELERATION (LR2)', [
    ...PLAY_OPTION_CHOICES.lr2Acceleration!,
  ]).on('change', ({ value }) => this.setPlayOptions({ lr2Acceleration: value }));
}
