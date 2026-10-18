// The Debug Menu's Course folder. It is built with the menu as `this` (`DebugMenu`).

import type { Controller, GUI } from 'lil-gui';
import { normalizeCourseTableUrl } from '../../course-table-import.ts';
import type { DemoGuiState } from '../../types.ts';
import type { DebugMenu } from './index.ts';

/**
 * Courses: whether stage results show, the player's own courses, the NONSTOP placement, and importing a difficulty
 * table's courses from its URL (remembered and imported again on load).
 */
export function buildCourseFolder(this: DebugMenu, folder: GUI): void {
  const trackPlayOption = (controller: Controller): Controller => this.trackPlayOption(controller);
  folder
    .add(this.guiState, 'courseAutoAdvance')
    .name('Skip stage results')
    .onChange((value: boolean) => {
      this.guiState.courseAutoAdvance = value;
    });
  folder.add({ open: () => this.courseMaker.panel?.openManager() }, 'open').name('My courses…');
  trackPlayOption(
    folder
      .add(this.guiState, 'nonstopPlacement', ['intended', 'lr2'])
      .name('NONSTOP placement')
      .onChange((value: DemoGuiState['nonstopPlacement']) => {
        this.guiState.nonstopPlacement = value;
      }),
  );
  // Courses from a difficulty table's page (or header JSON) URL; the URL is remembered and imported again on load.
  const courseTable = {
    url: '',
    import: () => {
      const url = normalizeCourseTableUrl(courseTable.url);
      if (url === undefined) {
        this.setStatus('Enter a difficulty-table URL first');
        return;
      }
      void this.library.importCourseTables([url], true);
    },
  };
  folder.add(courseTable, 'url').name('Table URL');
  folder.add(courseTable, 'import').name('Import table courses');
}
