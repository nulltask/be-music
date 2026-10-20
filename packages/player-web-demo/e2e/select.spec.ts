import type { TestHookFamily, TestHookState } from '../src/test-hook.ts';
import { type Demo, expect, openWithLibrary, SONGS, test } from './support.ts';

/**
 * The select screen's list on the built-in, LR2 and beatoraja families (the browse model of `@be-music/scene-model`):
 * the sort and the filters keep the bar under the cursor, the key filter lists a chart under its own key mode, and the
 * search narrows the list and puts the cursor on its top. beatoraja has no difficulty filter.
 *
 * The checklist library's `fixtures` folder lists, in the library's order: Fixture 5KEY (level 2, NORMAL, 5 keys),
 * Fixture A (1, BEGINNER), B (2, NORMAL), C (3, HYPER), D dense (12, ANOTHER), E (4, NORMAL), F (5, NORMAL) and G (6,
 * HYPER), every chart but 5KEY a 7-key one.
 */

/** A list option the specs change. */
type ListKey = 'sort' | 'keysFilter' | 'difficultyFilter';

/** How a family changes the list. */
interface SelectFamilyCase {
  name: string;
  family: TestHookFamily;
  open(demo: Demo): Promise<void>;
  /** Changes the list option `key` to `value` as the family's player would, and waits for the list to show it. */
  setList(demo: Demo, key: ListKey, value: string): Promise<TestHookState>;
  /** Whether the family has a difficulty filter (beatoraja has none). */
  difficultyFilter: boolean;
}

/** Waits for the select screen's list option `key` to read `value`. */
function listShows(demo: Demo, key: ListKey, value: string): Promise<TestHookState> {
  return demo.waitFor(
    (state) => state.scene.kind === 'select' && state.cursor?.list?.[key] === value,
    `the list's ${key} to be ${value}`,
    10_000,
  );
}

/** The Debug Menu's control for each list option (Play options). */
const MENU_LABELS: Readonly<Record<ListKey, string>> = {
  sort: 'Sort',
  keysFilter: 'Key filter',
  difficultyFilter: 'Difficulty filter',
};

/**
 * The fixture LR2 select skin (640 × 480, `scripts/course-checklist/skins/lr2`): its key filter (11) and sort (12)
 * buttons, which step to the next choice, and its difficulty filter buttons (91-96), which set one.
 */
const LR2_SELECT = { width: 640, height: 480 };
const LR2_CYCLE_BUTTONS: Readonly<Record<'sort' | 'keysFilter', { x: number; y: number }>> = {
  keysFilter: { x: 150, y: 120 },
  sort: { x: 250, y: 120 },
};
/**
 * The fixture beatoraja select skin (640 × 480, `scripts/course-checklist/skins/beatoraja`): its MODE (act 11) and SORT
 * (act 12) buttons, which step to the next choice, and its bar list, the focused bar on the sixth row.
 */
const BEATORAJA_SELECT = { width: 640, height: 480 };
const BEATORAJA_CYCLE_BUTTONS: Readonly<Record<'sort' | 'keysFilter', { x: number; y: number }>> = {
  keysFilter: { x: 80, y: 30 },
  sort: { x: 230, y: 30 },
};
const BEATORAJA_FOCUSED_BAR = { x: 460, y: 185 };
const BEATORAJA_BAR_BELOW = { x: 470, y: 217 };

/** Clicks `button` until the list option `key` reads `value`: a click steps it to its next choice. */
async function stepListTo(
  demo: Demo,
  key: ListKey,
  value: string,
  click: () => Promise<void>,
  family: string,
): Promise<TestHookState> {
  for (let clicks = 0; clicks < 8; clicks += 1) {
    const state = await demo.state();
    const shown = state.cursor?.list?.[key];
    if (shown === value) return state;
    await click();
    await demo.waitFor(
      (current) => current.cursor?.list?.[key] !== shown,
      `the ${family} ${key} button to step from ${shown}`,
      10_000,
    );
  }
  throw new Error(`the ${family} ${key} button never reached ${value}`);
}

const LR2_DIFFICULTY_BUTTONS: Readonly<Record<string, { x: number; y: number }>> = {
  ALL: { x: 30, y: 165 },
  BEGINNER: { x: 76, y: 165 },
  NORMAL: { x: 122, y: 165 },
  HYPER: { x: 168, y: 165 },
  ANOTHER: { x: 214, y: 165 },
  INSANE: { x: 260, y: 165 },
};

const FAMILIES: readonly SelectFamilyCase[] = [
  {
    name: 'built-in',
    family: 'built-in',
    difficultyFilter: true,
    open: (demo) => openWithLibrary(demo),
    async setList(demo, key, value) {
      await demo.setOption(['Play options'], MENU_LABELS[key], value);
      return listShows(demo, key, value);
    },
  },
  {
    name: 'LR2',
    family: 'lr2',
    difficultyFilter: true,
    async open(demo) {
      await openWithLibrary(demo);
      await demo.drop('skins/lr2');
      await demo.waitFor((state) => state.scene.kind === 'select' && state.scene.family === 'lr2', 'the LR2 select');
    },
    async setList(demo, key, value) {
      const click = (point: { x: number; y: number }) =>
        demo.clickSkin(point.x, point.y, LR2_SELECT.width, LR2_SELECT.height);
      if (key === 'difficultyFilter') {
        const button = LR2_DIFFICULTY_BUTTONS[value];
        if (button === undefined) throw new Error(`no LR2 difficulty filter button for ${value}`);
        await click(button);
        return listShows(demo, key, value);
      }
      // A click steps the option to its next choice, as LR2's buttons do.
      return stepListTo(demo, key, value, () => click(LR2_CYCLE_BUTTONS[key]), 'LR2');
    },
  },
  {
    name: 'beatoraja',
    family: 'beatoraja',
    difficultyFilter: false,
    async open(demo) {
      await openWithLibrary(demo);
      await demo.drop('skins/beatoraja');
      await demo.waitFor(
        (state) => state.scene.kind === 'select' && state.scene.family === 'beatoraja',
        'the beatoraja select',
      );
    },
    async setList(demo, key, value) {
      if (key === 'difficultyFilter') throw new Error('beatoraja has no difficulty filter');
      // The MODE and SORT buttons step the browse position's key filter and sort, as beatoraja's do.
      const button = BEATORAJA_CYCLE_BUTTONS[key];
      return stepListTo(
        demo,
        key,
        value,
        () => demo.clickSkin(button.x, button.y, BEATORAJA_SELECT.width, BEATORAJA_SELECT.height),
        'beatoraja',
      );
    },
  },
];

/**
 * Presses ↓ and returns the title of the bar the cursor lands on: the same bar on a list of one, where the cursor stays.
 */
async function next(demo: Demo): Promise<string | undefined> {
  const before = await demo.state();
  const shown = JSON.stringify(before.cursor);
  await demo.key('ArrowDown');
  const after = await demo
    .waitFor((current) => JSON.stringify(current.cursor) !== shown, 'the cursor to move down', 2_000)
    .catch(() => before);
  return after.cursor?.bar?.title;
}

/** Walks the whole list once from the bar under the cursor, and returns its titles in list order from that bar. */
async function walkList(demo: Demo): Promise<string[]> {
  const first = (await demo.state()).cursor?.bar?.title;
  if (first === undefined) throw new Error('no bar under the cursor');
  const titles = [first];
  for (let step = 0; step < 32; step += 1) {
    const title = await next(demo);
    if (title === first) return titles;
    if (title !== undefined) titles.push(title);
  }
  throw new Error(`the list did not wrap back to ${first}: ${titles.join(', ')}`);
}

/** Types `text` into the page's search field, as a person types it there, and waits for the list to take it. */
async function search(demo: Demo, text: string): Promise<TestHookState> {
  await demo.page.evaluate((value) => {
    const input = document.querySelector<HTMLInputElement>('#search');
    if (input === null) throw new Error('no search field');
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
  return demo.waitFor(
    (state) => state.scene.kind === 'select' && state.cursor?.list?.search === text,
    `the search "${text}"`,
    10_000,
  );
}

for (const setup of FAMILIES) {
  test.describe(`select list on the ${setup.name} family`, () => {
    test('keeps the bar under the cursor when the sort changes', async ({ demo }) => {
      await setup.open(demo);
      let state = await demo.browseTo(SONGS, 'Fixture C');
      expect(state.scene.family).toBe(setup.family);
      state = await setup.setList(demo, 'sort', 'LEVEL');
      expect(state.cursor?.bar?.title).toBe('Fixture C');
      // By level, Fixture E (4) follows Fixture C (3); in the library's order Fixture D dense does.
      expect(await next(demo)).toBe('Fixture E');
      state = await setup.setList(demo, 'sort', 'TITLE');
      expect(state.cursor?.bar?.title).toBe('Fixture E');
      expect(await walkList(demo)).toEqual([
        'Fixture E',
        'Fixture F',
        'Fixture G',
        'Fixture 5KEY',
        'Fixture A',
        'Fixture B',
        'Fixture C',
        'Fixture D dense',
      ]);
    });

    test('keeps the bar under the cursor through the filters, and lists a chart under its own key mode', async ({
      demo,
    }) => {
      await setup.open(demo);
      let state = await demo.browseTo(SONGS, 'Fixture 5KEY');
      state = await setup.setList(demo, 'keysFilter', 'KEYS_5');
      expect(state.cursor?.bar?.title).toBe('Fixture 5KEY');
      expect(await walkList(demo)).toEqual(['Fixture 5KEY']);
      // The 7-key filter takes the 5-key chart out: the cursor stays on its row, the top of the list.
      state = await setup.setList(demo, 'keysFilter', 'KEYS_7');
      expect(state.cursor?.bar?.title).toBe('Fixture A');
      const sevenKeys = await walkList(demo);
      expect(sevenKeys).toHaveLength(7);
      expect(sevenKeys).not.toContain('Fixture 5KEY');
      if (!setup.difficultyFilter) return;
      await demo.cursorTo((bar) => bar.title === 'Fixture C', 'Fixture C');
      state = await setup.setList(demo, 'difficultyFilter', 'HYPER');
      expect(state.cursor?.bar?.title).toBe('Fixture C');
      expect(await walkList(demo)).toEqual(['Fixture C', 'Fixture G']);
      state = await setup.setList(demo, 'difficultyFilter', 'ALL');
      expect(state.cursor?.bar?.title).toBe('Fixture C');
    });

    test('narrows the list to the search, and lists the matching charts at the root', async ({ demo }) => {
      await setup.open(demo);
      await demo.browseTo(SONGS, 'Fixture C');
      let state = await search(demo, 'dense');
      expect(state.cursor?.folderPath).toEqual([SONGS]);
      expect(state.cursor?.bar?.title).toBe('Fixture D dense');
      expect(await walkList(demo)).toEqual(['Fixture D dense']);
      await search(demo, '');
      await demo.key('Escape');
      await demo.waitFor((current) => current.cursor?.folderPath.length === 0, 'the root of the list', 10_000);
      // At the root, the search lists the matching charts of every folder.
      state = await search(demo, 'Fixture G');
      expect(state.cursor?.bar).toMatchObject({ kind: 'chart', title: 'Fixture G' });
      // Clearing it lists the folders again, from the top.
      state = await search(demo, '');
      expect(state.cursor?.bar).toMatchObject({ kind: 'folder', title: SONGS });
    });
  });
}

test.describe('select bars on the beatoraja family', () => {
  const beatoraja = FAMILIES.find((family) => family.family === 'beatoraja')!;

  test('takes the focused bar on a click, and moves the cursor onto another clicked bar', async ({ demo }) => {
    await beatoraja.open(demo);
    // The drop opened its folder: back out to the root, where the folder bar is.
    let state = await demo.state();
    for (let depth = state.cursor?.folderPath.length ?? 0; depth > 0; depth -= 1) {
      await demo.key('Escape');
      state = await demo.waitFor(
        (current) => (current.cursor?.folderPath.length ?? 0) < depth,
        'the select screen to leave a folder',
        10_000,
      );
    }
    state = await demo.cursorTo((bar) => bar.kind === 'folder' && bar.title === SONGS, `the folder ${SONGS}`);
    const click = (point: { x: number; y: number }) =>
      demo.clickSkin(point.x, point.y, BEATORAJA_SELECT.width, BEATORAJA_SELECT.height);
    // The focused bar opens its folder, at its first chart.
    await click(BEATORAJA_FOCUSED_BAR);
    state = await demo.waitFor(
      (current) => current.cursor?.folderPath.at(-1) === SONGS,
      `the folder ${SONGS} to open`,
      10_000,
    );
    expect(state.cursor?.bar?.title).toBe('Fixture 5KEY');
    // The bar below it takes the cursor, without starting the chart.
    await click(BEATORAJA_BAR_BELOW);
    state = await demo.waitFor(
      (current) => current.cursor?.bar?.title === 'Fixture A',
      'the cursor to move onto the clicked bar',
      10_000,
    );
    expect(state.scene.kind).toBe('select');
  });
});
