import { restoreBrowse } from '@be-music/scene-model';
import { describe, expect, it } from 'vite-plus/test';
import { CoreSongSelectView } from './select.ts';
import type { BrowserCourseEntry } from '../../collection/types.ts';
import type { SelectSession } from '../../session/select/select-session.ts';
import { makeCollection, makeCourse, makeCourseFolder } from '../../session/select/test-support.ts';

/*
 * The select scene's browsing, search, cursor and play options are tested with its session
 * (`session/select/select-session.test.ts`) and the browse and play options models in `@be-music/scene-model`.
 */

describe('CoreSongSelectView course bars', () => {
  type CourseBarView = {
    session: SelectSession;
    activateFocused(): void;
    launchFocusedSong(autoPlay: boolean): void;
  };

  /** A view (not mounted, so nothing renders) with the cursor on `entry` inside its course folder. */
  function viewOnCourse(entry: BrowserCourseEntry, options: ConstructorParameters<typeof CoreSongSelectView>[0]) {
    const view = new CoreSongSelectView(options) as unknown as CourseBarView;
    view.session.collection = makeCollection([], [makeCourseFolder('Dan', [entry])]);
    view.session.browse = restoreBrowse(view.session.collection, { folderPath: ['Dan'], cursors: [0, 0] }).state;
    return view;
  }

  it('hands a course with a missing stage to the host, which says why it does not start', () => {
    const selected: BrowserCourseEntry[] = [];
    const missing = makeCourse('dan#0', { playable: false });
    const view = viewOnCourse(missing, { onCourseSelected: (picked) => selected.push(picked) });
    view.activateFocused();
    view.launchFocusedSong(false);
    expect(selected).toEqual([missing, missing]);
  });
});
