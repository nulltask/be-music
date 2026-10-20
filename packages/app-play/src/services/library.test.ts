import type { BrowserChartCollection } from '@be-music/player-browser/collection';
import type { SceneKind, SelectScene } from '@be-music/player-browser/host';
import type { BrowseSnapshot } from '@be-music/player-scene-model';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import { COURSE_TABLE_URLS_STORAGE_KEY } from '../course-table-import.ts';
import { LibraryService, type LibraryServiceOptions } from './library.ts';

const MD5 = ['a', 'b', 'c', 'd', 'e', 'f', '1'].map((digit) => digit.repeat(32));

const TABLE_PAGE = 'https://table.example/insane/table.html';
const TABLE_HEADER = 'https://table.example/insane/header.json';

/** A difficulty table's header with one course. */
function tableHeader(fields: { name?: string } = { name: 'Insane' }): string {
  return JSON.stringify({ ...fields, course: [[{ name: 'Dan 1', md5: [MD5[0]] }]] });
}

/** An LR2 `.lr2crs` course list with one course of `stages` stages. */
function lr2CourseList(title: string, stages: number): string {
  const header = `${'0'.repeat(10)}0${'0'.repeat(21)}`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<courselist>',
    '  <course>',
    `    <title>${title}</title>`,
    '    <line>7</line>',
    '    <type>0</type>',
    `    <hash>${header}${MD5.slice(0, stages).join('')}</hash>`,
    '  </course>',
    '</courselist>',
    '',
  ].join('\n');
}

/** A dropped file, at `path` inside the drop. */
function dropped(path: string, text: string): File {
  const file = new File([text], path.split('/').at(-1)!);
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
}

function fakeElement(): HTMLDivElement {
  const classes = new Set<string>();
  return {
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
      contains: (name: string) => classes.has(name),
    },
    setAttribute: () => {},
    style: {},
    textContent: '',
  } as unknown as HTMLDivElement;
}

/** `localStorage` as the course-table import sees it through `window`. */
function stubStorage(entries: Record<string, string> = {}): Map<string, string> {
  const values = new Map(Object.entries(entries));
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    },
  });
  return values;
}

/** `fetch` answering each URL of `pages` with its text, and rejecting the rest as a blocked request does. */
function stubFetch(pages: Record<string, string>): ReturnType<typeof vi.fn> {
  const fetch = vi.fn(async (url: string) => {
    const page = pages[url];
    if (page === undefined) throw new TypeError('Failed to fetch');
    return new Response(page);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function harness(overrides: Partial<LibraryServiceOptions> = {}) {
  const statuses: string[] = [];
  const shown: BrowserChartCollection[] = [];
  const showing: { current: SceneKind | undefined } = { current: 'select' };
  const elements = {
    shell: fakeElement(),
    loadingOverlay: fakeElement(),
    loadingLabel: fakeElement(),
    loadingBarFill: fakeElement(),
    loadingCounter: fakeElement(),
  };
  const options: LibraryServiceOptions = {
    elements,
    resolveChartHashes: async () => undefined,
    courseMaker: { courses: [] },
    selectView: () => undefined,
    showing: () => showing.current,
    setStatus: (text) => {
      statuses.push(text);
    },
    showSelect: async () => {
      shown.push(library.collection);
    },
    leaveSelect: async () => false,
    browseTo: vi.fn(),
    startReplayReplayFromFile: vi.fn(async () => {}),
    loadTheme: vi.fn(async () => {}),
    loadBeatorajaTheme: vi.fn(async () => {}),
    playSkins: () => ({}),
    selectSkin: () => undefined,
    resultSkin: () => undefined,
    beatorajaTheme: () => undefined,
    answerSkinDropPrompt: vi.fn(),
    ...overrides,
  };
  const library = new LibraryService(options);
  const folders = (): string[] => (library.collection.courseFolders ?? []).map((folder) => folder.label);
  return { library, options, statuses, shown, showing, elements, folders };
}

beforeEach(() => {
  // The drop log reports what a load skipped; the tests check what the library did instead.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('LibraryService difficulty tables', () => {
  test("lists a table's courses by its URL, remembers the URL when asked, and shows the select screen again", async () => {
    const stored = stubStorage();
    stubFetch({ [TABLE_PAGE]: '<meta name="bmstable" content="header.json">', [TABLE_HEADER]: tableHeader() });
    const { library, statuses, shown, folders } = harness();
    const before = library.collection;
    await library.importCourseTables([TABLE_PAGE], true);
    expect(statuses).toEqual(['Fetching course table…', 'Course table: Insane (1 courses)']);
    expect(folders()).toContain('Insane');
    // A new library, so the select screen takes it as one rather than redrawing the old one.
    expect(library.collection).not.toBe(before);
    expect(shown).toEqual([library.collection]);
    expect(JSON.parse(stored.get(COURSE_TABLE_URLS_STORAGE_KEY)!)).toEqual([TABLE_PAGE]);

    // The same table imported again replaces its folder.
    await library.importCourseTables([TABLE_PAGE], false);
    expect(folders().filter((label) => label === 'Insane')).toHaveLength(1);
  });

  test('imports a table without remembering it, and leaves a play, decide or result screen up', async () => {
    const stored = stubStorage();
    stubFetch({ [TABLE_HEADER]: tableHeader() });
    const { library, shown, showing, elements, folders } = harness();
    elements.shell.classList.add('playing');
    await library.importCourseTables([TABLE_HEADER], false);
    expect(folders()).toContain('Insane');
    expect(shown).toEqual([]);
    elements.shell.classList.remove('playing');
    for (const kind of ['decide', 'result'] as const) {
      showing.current = kind;
      await library.importCourseTables([TABLE_HEADER], false);
    }
    expect(shown).toEqual([]);
    expect(stored.has(COURSE_TABLE_URLS_STORAGE_KEY)).toBe(false);
  });

  test('says how to import a table whose site cannot be read from here, and lists nothing', async () => {
    const stored = stubStorage();
    stubFetch({});
    const { library, statuses, shown } = harness();
    const before = library.collection;
    await library.importCourseTables([TABLE_PAGE], true);
    expect(statuses.at(-1)).toMatch(/Save the table’s header file .* and drop it here instead/u);
    expect(library.collection).toBe(before);
    expect(shown).toEqual([]);
    expect(stored.has(COURSE_TABLE_URLS_STORAGE_KEY)).toBe(false);
  });

  test('imports the tables of an earlier visit again once the first select screen is up', async () => {
    stubStorage({ [COURSE_TABLE_URLS_STORAGE_KEY]: JSON.stringify([TABLE_HEADER]) });
    const fetch = stubFetch({ [TABLE_HEADER]: tableHeader() });
    const { library, folders } = harness();
    let ready!: () => void;
    const loaded = library.autoLoad(
      'https://demo.example/',
      new Promise<void>((resolve) => {
        ready = resolve;
      }),
    );
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
    ready();
    await loaded;
    expect(fetch).toHaveBeenCalledWith(TABLE_HEADER);
    expect(folders()).toContain('Insane');
  });
});

describe('LibraryService drops', () => {
  test("reads a dropped table header under the table's name, or its folder's when it has none", async () => {
    const { library, shown, folders } = harness();
    await library.processIncomingFiles([dropped('tables/insane/header.json', tableHeader())]);
    expect(folders()).toContain('Insane');
    await library.processIncomingFiles([dropped('tables/overjoy/header.json', tableHeader({}))]);
    expect(folders()).toContain('overjoy');
    expect(shown).toHaveLength(2);
  });

  test('leaves a header.json that is no table header to the other loaders', async () => {
    const { library, options, shown, folders } = harness();
    await library.processIncomingFiles([dropped('pack/header.json', JSON.stringify({ name: 'Not a table' }))]);
    expect(folders()).toEqual([]);
    expect(shown).toEqual([]);
    expect(options.loadTheme).not.toHaveBeenCalled();
  });

  test('reads a course file that lists more than five stages as the five LR2 plays, and says so', async () => {
    const { library, statuses, shown, folders } = harness();
    await library.processIncomingFiles([dropped('seven-stages.lr2crs', lr2CourseList('SEVEN', 7))]);
    expect(folders()).toContain('seven-stages');
    expect(
      library.collection.courseFolders?.find((folder) => folder.label === 'seven-stages')?.courses?.[0]?.stages,
    ).toHaveLength(5);
    expect(statuses).toEqual([
      'seven-stages.lr2crs: 1 course(s) list more than 5 stages; LR2 plays only the first 5, so the rest were left out',
    ]);
    expect(shown).toHaveLength(1);
  });

  test('a course file that holds no course changes nothing', async () => {
    const { library, shown } = harness();
    const before = library.collection;
    await library.processIncomingFiles([dropped('empty.lr2crs', '<courselist></courselist>')]);
    expect(library.collection).toBe(before);
    expect(shown).toEqual([]);
  });

  test('replays a replay dropped on its own, and loads nothing else', async () => {
    const { library, options, shown } = harness();
    const replay = dropped('run.bmplay.json', '{}');
    await library.processIncomingFiles([replay]);
    expect(options.startReplayReplayFromFile).toHaveBeenCalledWith(replay);
    expect(options.loadTheme).not.toHaveBeenCalled();
    expect(shown).toEqual([]);
  });
});

describe('LibraryService made courses', () => {
  test('relists the course folders as a new library and keeps the select screen where it was', async () => {
    const navigation = { folderPath: ['MY COURSES'] } as unknown as BrowseSnapshot;
    const view = { snapshot: vi.fn(() => navigation), setLibrary: vi.fn(), restore: vi.fn() };
    const { library } = harness({ selectView: () => view as unknown as SelectScene });
    const before = library.collection;
    await library.refreshMadeCourses();
    expect(view.setLibrary).toHaveBeenCalledWith(library.collection);
    expect(library.collection).not.toBe(before);
    expect(library.collection.courseFolders?.map((folder) => folder.label)).toEqual([
      'MY COURSES',
      'MY NONSTOP',
      'MY DAN',
    ]);
    expect(view.restore).toHaveBeenCalledWith(navigation);
  });
});
