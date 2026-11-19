// The Options dialog's list of difficulty tables, in the Course folder: the remembered tables, each with a remove
// button, and a field that adds one. A table added here imports at once; every remembered table imports again each time
// the player opens (`LibraryService.autoLoad`). Removing one takes its courses off the select screen at once.
import { html, render } from 'lit';
import {
  DEFAULT_COURSE_TABLE_URLS,
  normalizeCourseTableURL,
  readStoredCourseTableURLs,
  storeCourseTableURLs,
} from '../../course-table-import.ts';
import { playerText } from '../../player-copy.ts';
import type { LibraryService } from '../../services/library.ts';
import { localized } from '../localized.ts';

/** A table's name before it has imported this session: its host and path, which tell tables on one host apart. */
export function courseTableURLLabel(url: string): string {
  try {
    const { host, pathname, search } = new URL(url);
    const path = decodeURIComponent(pathname).replace(/\/$/u, '');
    return `${host}${path}${search}`;
  } catch {
    return url;
  }
}

/** Mounts the table list into `root`, which it owns. */
export function mountCourseTableManager(
  root: HTMLElement,
  {
    library,
    setStatus,
    saveSettings,
  }: {
    library: Pick<
      LibraryService,
      'importCourseTables' | 'removeCourseTable' | 'courseTableLabel' | 'onCourseTablesChange'
    >;
    setStatus: (text: string) => void;
    /** Publishes the settings, which carry the table list to the player's other browsers. */
    saveSettings: () => void;
  },
): void {
  let tables = readStoredCourseTableURLs();
  let draft = '';
  let importing = false;

  const label = (url: string) => library.courseTableLabel(url) ?? courseTableURLLabel(url);
  /** Imports `urls` and remembers the ones that imported; a table that fails to import stays off the list. */
  const importTables = async (urls: readonly string[]) => {
    importing = true;
    update();
    try {
      await library.importCourseTables(urls, true);
    } finally {
      importing = false;
      tables = readStoredCourseTableURLs();
      saveSettings();
      update();
    }
  };
  const add = (event: Event) => {
    event.preventDefault();
    const url = normalizeCourseTableURL(draft);
    if (url === undefined) {
      setStatus(playerText().shell.invalidCourseTableURL);
      return;
    }
    draft = '';
    if (tables.includes(url)) {
      update();
      return;
    }
    void importTables([url]);
  };
  /** Adds the well-known tables the list lacks (removed, or added to the defaults later) and imports them. */
  const restoreDefaults = () => {
    const missing = DEFAULT_COURSE_TABLE_URLS.filter((url) => !tables.includes(url));
    if (missing.length > 0) void importTables(missing);
  };
  const remove = (url: string) => {
    tables = storeCourseTableURLs(tables.filter((table) => table !== url));
    saveSettings();
    update();
    void library.removeCourseTable(url);
  };

  function update(): void {
    render(
      html`
        <section aria-labelledby="course-tables-heading">
          <h3 id="course-tables-heading">${localized('courseTables')}</h3>
          <p>${localized('courseTablesHint')}</p>
          <ul class="remembered-folder-list">
            ${tables.map(
              (url) => html`
                <li>
                  <span title=${url}>${label(url)}</span>
                  <button
                    type="button"
                    class="btn"
                    aria-label=${localized(() => playerText().shell.removeCourseTable(label(url)))}
                    @click=${() => remove(url)}
                  >
                    ${localized('removeFolder')}
                  </button>
                </li>
              `,
            )}
          </ul>
          <form class="bemuse-server-form" @submit=${add}>
            <input
              class="input"
              type="url"
              required
              aria-label=${localized('courseTableURL')}
              placeholder="https://stellabms.xyz/sl/table.html"
              .value=${draft}
              ?disabled=${importing}
              @input=${(event: Event) => {
                draft = (event.target as HTMLInputElement).value;
              }}
            />
            <button type="submit" class="btn" ?disabled=${importing}>${localized('addCourseTable')}</button>
          </form>
          ${
            DEFAULT_COURSE_TABLE_URLS.some((url) => !tables.includes(url))
              ? html`<button type="button" class="btn" ?disabled=${importing} @click=${restoreDefaults}>
                  ${localized('restoreCourseTables')}
                </button>`
              : null
          }
        </section>
      `,
      root,
    );
  }

  // Tables import on load after the dialog is built, and the list shows their names once they have.
  library.onCourseTablesChange(() => {
    if (!importing) tables = readStoredCourseTableURLs();
    update();
  });
  update();
}
