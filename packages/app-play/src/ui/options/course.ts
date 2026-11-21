import { selectBinding, type PaneBinding } from '../../pane-controls.ts';
// The Options dialog's Course folder. It is built with the dialog as `this` (`OptionsDialog`).
import type { OptionContainer } from '../options-controls.ts';
import type { PlayerGUIState } from '../../types.ts';
import type { OptionsDialog, OptionsDialogDeps } from './index.ts';
/**
 * Courses: whether stage results show, the player's own courses and the NONSTOP placement. The difficulty tables whose
 * courses are imported are on the Library section's Difficulty tables tab.
 */
export function buildCourseFolder(this: OptionsDialog, folder: OptionContainer): void {
  const trackPlayOption = (controller: PaneBinding): PaneBinding => this.trackPlayOption(controller);
  folder.addBinding(this.guiState, 'courseAutoAdvance', { label: 'Skip stage results' }).on('change', ({ value }) => {
    this.guiState.courseAutoAdvance = value;
  });
  folder.addButton({ title: 'My courses…' }).on('click', () => this.courseMaker.panel?.openManager());
  trackPlayOption(
    selectBinding(folder, this.guiState, 'nonstopPlacement', 'NONSTOP placement', ['intended', 'lr2']).on(
      'change',
      ({ value }) => applyNonstopPlacement(this.deps, value),
    ),
  );
}
/**
 * Takes a NONSTOP placement picked on the menu. A NONSTOP course keeps its records per placement (`courseBestRecordKey`), so
 * the select screen draws its records again to show the new placement's: the built-in screen builds itself again only
 * when told something changed.
 */
export function applyNonstopPlacement(
  deps: Pick<OptionsDialogDeps, 'settings' | 'refreshSelectRecords'>,
  value: PlayerGUIState['nonstopPlacement'],
): void {
  deps.settings.nonstopPlacement = value;
  deps.refreshSelectRecords();
}
