import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test, vi } from 'vite-plus/test';
import { OPTIONS_LAYOUT } from './folders.ts';
import {
  OptionLayout,
  OptionsLayoutError,
  assembleOptionsLayout,
  optionLayoutItems,
  optionLayoutSlotIds,
  optionLayoutTitles,
  parseOptionsLayout,
  type LayoutFolder,
  type LayoutTabs,
  type PlacedRow,
} from './layout.ts';

/** A stand-in for a row: what kind it is, and whether the layout leaves it off. */
class FakeRow implements PlacedRow {
  public omitted = false;
  public readonly kind: PlacedRow['kind'];
  public readonly name: string;
  public constructor(kind: PlacedRow['kind'], name: string) {
    this.kind = kind;
    this.name = name;
  }
}

/** A stand-in for a folder or a page: keeps its rows in order, by the ranks the layout gives them. */
class FakeContainer extends FakeRow implements LayoutFolder {
  public readonly children: FakeRow[] = [];
  private readonly ranks = new Map<FakeRow, number>();
  public constructor(name = 'root') {
    super('folder', name);
  }
  public addFolder(params: { title: string }): FakeContainer {
    return this.push(new FakeContainer(params.title));
  }
  public addTab(params: { pages: readonly { title: string }[] }): FakeTabs {
    return this.push(new FakeTabs(params.pages.map((page) => page.title)));
  }
  public addBinding(_object: object, key: PropertyKey, params: { options?: unknown } = {}): FakeRow {
    return this.push(new FakeRow(params.options === undefined ? 'toggle' : 'select', String(key)));
  }
  public addButton(params: { title: string }): FakeRow {
    return this.push(new FakeRow('button', params.title));
  }
  public addElement(): FakeRow {
    return this.push(new FakeRow('element', 'element'));
  }
  public placeAt(row: FakeRow, rank: number): void {
    this.children.splice(this.children.indexOf(row), 1);
    this.ranks.set(row, rank);
    const index = this.children.findIndex((child) => (this.ranks.get(child) ?? Infinity) > rank);
    this.children.splice(index < 0 ? this.children.length : index, 0, row);
  }
  /** The names of its rows, in order. */
  public get names(): string[] {
    return this.children.map((child) => child.name);
  }
  private push<R extends FakeRow>(row: R): R {
    this.children.push(row);
    return row;
  }
}

class FakeTabs extends FakeRow implements LayoutTabs {
  public readonly pages: FakeContainer[];
  public readonly omittedPages = new Set<number>();
  public constructor(titles: readonly string[]) {
    super('tabs', titles.join('|'));
    this.pages = titles.map((title) => new FakeContainer(title));
  }
  public omitPage(index: number, omitted: boolean): void {
    if (omitted) this.omittedPages.add(index);
    else this.omittedPages.delete(index);
  }
}

const SMALL_LAYOUT = {
  version: 1,
  tabs: 'options',
  pages: [
    {
      title: 'Play',
      items: [
        {
          folder: 'playOptions',
          title: 'Play options',
          items: [
            { option: 'judgeRuleset', kind: 'select' },
            { tabs: 'pages', pages: [{ title: 'Judge', items: [{ option: 'gauge', kind: 'select' }] }] },
            { option: 'autoPlay', kind: 'toggle', hidden: true },
            { group: 'extras' },
          ],
        },
      ],
    },
    { title: 'Secret', hidden: true, items: [{ option: 'debug', kind: 'button' }] },
  ],
};

describe('parseOptionsLayout', () => {
  test('reads a layout, with hidden false where it is left out', () => {
    const layout = parseOptionsLayout(SMALL_LAYOUT);
    expect(layout.tabs).toBe('options');
    expect(layout.pages[1]).toMatchObject({ title: 'Secret', hidden: true });
    expect(optionLayoutItems(layout)).toContainEqual({ option: 'judgeRuleset', kind: 'select', hidden: false });
    expect(optionLayoutItems(layout)).toContainEqual({ option: 'autoPlay', kind: 'toggle', hidden: true });
    expect(optionLayoutSlotIds(layout)).toEqual(['judgeRuleset', 'gauge', 'autoPlay', 'extras', 'debug']);
    expect(optionLayoutTitles(layout)).toEqual(['Play', 'Secret', 'Play options', 'Judge']);
  });

  test('keeps literal, runtime and group defaults in the layout', () => {
    const layout = parseOptionsLayout({
      ...SMALL_LAYOUT,
      pages: [
        {
          title: 'Audio',
          items: [
            { option: 'mute', kind: 'toggle', default: false },
            { option: 'workers', kind: 'slider', default: { use: 'workers' } },
            { group: 'tuning', reset: true },
          ],
        },
      ],
    });
    expect(layout.pages[0]!.items).toEqual([
      { option: 'mute', kind: 'toggle', default: false, hidden: false },
      { option: 'workers', kind: 'slider', default: { use: 'workers' }, hidden: false },
      { group: 'tuning', reset: true, hidden: false },
    ]);
  });

  test('ignores $comment keys', () => {
    expect(() => parseOptionsLayout({ ...SMALL_LAYOUT, $comment: 'The Options dialog' })).not.toThrow();
  });

  test.each([
    ['a version other than 1', { ...SMALL_LAYOUT, version: 2 }, 'version'],
    ['a hidden dialog', { ...SMALL_LAYOUT, hidden: true }, 'hidden'],
    ['no pages', { ...SMALL_LAYOUT, pages: [] }, 'pages'],
    ['an unknown key', { ...SMALL_LAYOUT, colour: 'red' }, ''],
    [
      'an unknown kind',
      { ...SMALL_LAYOUT, pages: [{ title: 'A', items: [{ option: 'gauge', kind: 'knob' }] }] },
      'pages[0].items[0].kind',
    ],
    [
      'an id used twice',
      {
        ...SMALL_LAYOUT,
        pages: [{ title: 'A', items: [{ group: 'gauge' }, { option: 'gauge', kind: 'select' }] }],
      },
      'pages[0].items[1].option',
    ],
    [
      'an id that is not lowerCamelCase',
      { ...SMALL_LAYOUT, pages: [{ title: 'A', items: [{ option: 'Gauge', kind: 'select' }] }] },
      'pages[0].items[0].option',
    ],
    [
      'an item of two kinds',
      { ...SMALL_LAYOUT, pages: [{ title: 'A', items: [{ option: 'a', group: 'b', kind: 'select' }] }] },
      'pages[0].items[0]',
    ],
    [
      'a toggle default with the wrong type',
      { ...SMALL_LAYOUT, pages: [{ title: 'A', items: [{ option: 'mute', kind: 'toggle', default: 'off' }] }] },
      'pages[0].items[0].default',
    ],
    [
      'a default on a command',
      { ...SMALL_LAYOUT, pages: [{ title: 'A', items: [{ option: 'capture', kind: 'button', default: true }] }] },
      'pages[0].items[0].default',
    ],
    [
      'an unknown runtime default',
      {
        ...SMALL_LAYOUT,
        pages: [{ title: 'A', items: [{ option: 'workers', kind: 'slider', default: { use: 'unknown' } }] }],
      },
      'pages[0].items[0].default.use',
    ],
    ['an empty title', { ...SMALL_LAYOUT, pages: [{ title: ' ', items: [] }] }, 'pages[0].title'],
    [
      'a hidden flag that is not a boolean',
      { ...SMALL_LAYOUT, pages: [{ title: 'A', items: [{ group: 'a', hidden: 'yes' }] }] },
      'pages[0].items[0].hidden',
    ],
    [
      'an option with a title',
      { ...SMALL_LAYOUT, pages: [{ title: 'A', items: [{ option: 'a', kind: 'select', title: 'A' }] }] },
      'pages[0].items[0]',
    ],
  ])('refuses %s', (_name, json, path) => {
    let error: unknown;
    try {
      parseOptionsLayout(json);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(OptionsLayoutError);
    expect((error as OptionsLayoutError).path).toBe(path);
  });
});

describe('assembleOptionsLayout', () => {
  test('makes the tabs, pages and folders in order, leaving off what the layout hides', () => {
    const root = new FakeContainer();
    const assembled = assembleOptionsLayout(parseOptionsLayout(SMALL_LAYOUT), root);
    const top = assembled.tabs.get('options') as FakeTabs;
    expect(root.children).toEqual([top]);
    expect(top.pages.map((page) => page.name)).toEqual(['Play', 'Secret']);
    expect([...top.omittedPages]).toEqual([1]);
    const folder = assembled.folders.get('playOptions') as FakeContainer;
    expect(top.pages[0]!.children).toEqual([folder]);
    expect(folder.names).toEqual(['Judge']);
    expect(assembled.slots.get('autoPlay')).toMatchObject({ container: folder, rank: 2, kind: 'toggle', hidden: true });
    expect(assembled.slots.get('extras')).toMatchObject({ container: folder, rank: 3, kind: undefined });
    expect(assembled.paths.get('gauge')).toEqual([
      { tabs: 'options', page: 0 },
      { tabs: 'pages', page: 0 },
    ]);
  });
});

describe('OptionLayout', () => {
  const state = { autoPlay: false, judgeRuleset: 'lr2' };
  const build = () => {
    const root = new FakeContainer();
    const report = vi.fn();
    const layout = new OptionLayout(parseOptionsLayout(SMALL_LAYOUT), root, report);
    return { layout, report, folder: layout.folder('playOptions') as unknown as FakeContainer };
  };

  test('puts rows at their places, whatever order the code makes them in', () => {
    const { layout, folder } = build();
    layout.place('extras').addButton({ title: 'Extra 1' });
    layout.place('autoPlay').addBinding(state, 'autoPlay');
    layout.place('extras').addButton({ title: 'Extra 2' });
    layout.place('judgeRuleset').addBinding(state, 'judgeRuleset', { options: [] });
    expect(folder.names).toEqual(['judgeRuleset', 'Judge', 'autoPlay', 'Extra 1', 'Extra 2']);
  });

  test('makes a hidden option but leaves it off, keeping what the code holds of it', () => {
    const { layout } = build();
    const row = layout.place('autoPlay').addBinding(state, 'autoPlay');
    expect(row.omitted).toBe(true);
    expect(layout.place('judgeRuleset').addBinding(state, 'judgeRuleset', { options: [] }).omitted).toBe(false);
  });

  test('reports an option built as another kind than the layout says', () => {
    const { layout, report } = build();
    layout.place('judgeRuleset').addBinding(state, 'judgeRuleset');
    expect(report).toHaveBeenCalledWith('judgeRuleset', 'select', 'toggle');
  });

  test('refuses an id the layout does not have, and an option built twice', () => {
    const { layout } = build();
    expect(() => layout.place('nothing')).toThrow(/no option or group "nothing"/);
    layout.place('autoPlay').addBinding(state, 'autoPlay');
    expect(() => layout.place('autoPlay').addBinding(state, 'autoPlay')).toThrow(/built twice/);
  });

  test('lets an option be built again once its row is gone', () => {
    const { layout, folder } = build();
    const row = layout.place('autoPlay').addBinding(state, 'autoPlay');
    folder.children.splice(folder.children.indexOf(row as unknown as FakeRow), 1);
    expect(() => layout.place('autoPlay').addBinding(state, 'autoPlay')).not.toThrow();
  });

  test('lists the options no code built', () => {
    const { layout } = build();
    layout.place('autoPlay').addBinding(state, 'autoPlay');
    expect(layout.unclaimed()).toEqual(['judgeRuleset', 'gauge', 'debug']);
  });

  test('gives the pages to select to show an item', () => {
    const { layout } = build();
    expect(layout.path('gauge')).toEqual([
      { tabs: 'options', page: 0 },
      { tabs: 'pages', page: 0 },
    ]);
  });
});

describe('options-layout.json', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const sources = [
    ...readdirSync(here)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => join(here, name)),
    join(here, '../../leaderboard-ui.ts'),
  ]
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
  const ids = new Set(optionLayoutSlotIds(OPTIONS_LAYOUT));

  test('names only options and groups the layout has', () => {
    const placed = [...sources.matchAll(/place\('(\w+)'\)/gu)].map((match) => match[1]!);
    expect(placed.length).toBeGreaterThan(50);
    for (const id of placed) expect(ids, id).toContain(id);
  });

  test('has only options and groups the code names', () => {
    // An id made in a loop (`random${side}`) is named by its stem.
    for (const id of ids) {
      const named = sources.includes(`'${id}'`) || sources.includes(`${id.replace(/(?:1P|2P|\d)$/u, '')}\${`);
      expect(named, id).toBe(true);
    }
  });

  test('declares a default for every editable option in the shipped layout', () => {
    for (const item of optionLayoutItems(OPTIONS_LAYOUT)) {
      if ('option' in item && !['button', 'monitor', 'element'].includes(item.kind)) {
        expect(item.default, item.option).toBeDefined();
      }
    }
  });

  test('hides no option by default', () => {
    expect(optionLayoutItems(OPTIONS_LAYOUT).filter((item) => item.hidden)).toEqual([]);
  });
});
