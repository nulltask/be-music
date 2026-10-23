import { selectBinding, type PaneBinding } from '../../pane-controls.ts';
// The Debug Menu's Course folder. It is built with the menu as `this` (`DebugMenu`).
import type { FolderApi } from 'tweakpane';
import { normalizeCourseTableURL } from '../../course-table-import.ts';
import type { DemoGUIState } from '../../types.ts';
import type { DebugMenu, DebugMenuDeps } from './index.ts';
/**
 * Courses: whether stage results show, the player's own courses, the NONSTOP placement, and importing a difficulty
 * table's courses from its URL (remembered and imported again on load).
 */
export function buildCourseFolder(this: DebugMenu, folder: FolderApi): void {
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
  // Courses from a difficulty table's page (or header JSON) URL; the URL is remembered and imported again on load.
  const courseTable = {
    url: '',
    import: () => {
      const url = normalizeCourseTableURL(courseTable.url);
      if (url === undefined) {
        this.setStatus('Enter a difficulty-table URL first');
        return;
      }
      void this.library.importCourseTables([url], true).finally(() => this.scheduleSettingsSave());
    },
  };
  folder.addBinding(courseTable, 'url', { label: 'Table URL' });
  folder.addButton({ title: 'Import table courses' }).on('click', () => courseTable['import']());
}
/**
 * Takes a NONSTOP placement picked on the menu. A NONSTOP course keeps its records per placement (`courseBestRecordKey`), so
 * the select screen draws its records again to show the new placement's: the built-in screen builds itself again only
 * when told something changed.
 */
export function applyNonstopPlacement(
  deps: Pick<DebugMenuDeps, 'settings' | 'refreshSelectRecords'>,
  value: DemoGUIState['nonstopPlacement'],
): void {
  deps.settings.nonstopPlacement = value;
  deps.refreshSelectRecords();
}
