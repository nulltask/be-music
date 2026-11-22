// The LR2 mania options of the Options dialog's View folder: LR2's hidden panel options that only change what the
// playfield draws. They are read at each frame, so they stay enabled during a play.
import { PLAY_OPTION_CHOICES } from '@be-music/player-scene-model';
import { selectBinding } from '../../pane-controls.ts';
import type { OptionsDialog } from './index.ts';

/** Fills the LR2 mania options section on the View folder's Effects page (`lr2Mania` in `options-layout.json`). */
export function buildLR2ManiaRows(this: OptionsDialog): void {
  selectBinding(this.place('lr2Acceleration'), this.guiState, 'lr2Acceleration', 'ACCELERATION (LR2)', [
    ...PLAY_OPTION_CHOICES.lr2Acceleration!,
  ]).on('change', ({ value }) => this.setPlayOptions({ lr2Acceleration: value }));
  for (const [key, label] of LEVEL_ROWS) {
    this.place(key)
      .addBinding(this.guiState, key, { label, min: 0, max: 100, step: 10 })
      .on('change', ({ value }) => this.setPlayOptions({ [key]: value }));
  }
}

/** The options LR2 sets from OFF (0) to 100 in steps of 10, in its panel's order. */
const LEVEL_ROWS = [
  ['lr2Earthquake', 'EARTHQUAKE (LR2)'],
  ['lr2Tornado', 'TORNADO (LR2)'],
  ['lr2SuperLoop', 'SUPERLOOP (LR2)'],
  ['lr2Char', 'CHAR (LR2)'],
  ['lr2Heartbeat', 'HEARTBEAT (LR2)'],
  ['lr2Nabeatsu', 'NABEATSU (LR2)'],
  ['lr2SinCurve', 'SINCURVE (LR2)'],
  ['lr2Wave', 'WAVE (LR2)'],
  ['lr2SpiralEffect', 'SPIRAL effect (LR2)'],
  ['lr2SideJump', 'SIDEJUMP (LR2)'],
] as const;
