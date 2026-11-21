// The layout of the player's Options dialog, read from `options-layout.json`: its tabs, sections, pages and the order of
// its options, and which of them show. The JSON holds the structure only; each option's label, choices, range, change
// handler and play lock stay in the code that builds it (`play-options.ts`, `audio.ts`, …), which asks the layout where
// the row goes by its id (`OptionLayout.place`). See docs/player-web.md ("Options dialog layout").
//
// This module reaches the controls only through the small interfaces below, so the schema and the assembly are tested
// without a DOM.
import type { OptionContainer } from '../options-controls.ts';

/** What an option row is, as the JSON states it and `OptionRow.kind` reports it. */
export const OPTION_ROW_KINDS = [
  'toggle',
  'select',
  'slider',
  'number',
  'text',
  'monitor',
  'button',
  'element',
] as const;
export type OptionRowKind = (typeof OPTION_ROW_KINDS)[number];

/** One row the code builds, named by its id. */
export interface OptionLayoutOption {
  readonly option: string;
  readonly kind: OptionRowKind;
  readonly hidden: boolean;
}

/** Rows the code makes as it needs them (a row per lane, a loaded skin's settings), at one place among the others. */
export interface OptionLayoutGroup {
  readonly group: string;
  readonly hidden: boolean;
}

/** A section with a heading, holding items. */
export interface OptionLayoutFolder {
  readonly folder: string;
  readonly title: string;
  readonly hidden: boolean;
  readonly items: readonly OptionLayoutItem[];
}

/** One page of a set of tabs. */
export interface OptionLayoutPage {
  readonly title: string;
  readonly hidden: boolean;
  readonly items: readonly OptionLayoutItem[];
}

/** A set of tabs, one page each. */
export interface OptionLayoutTabs {
  readonly tabs: string;
  readonly hidden: boolean;
  readonly pages: readonly OptionLayoutPage[];
}

export type OptionLayoutItem = OptionLayoutOption | OptionLayoutGroup | OptionLayoutFolder | OptionLayoutTabs;

/** The whole dialog: its top tabs, with the JSON's format version. */
export interface OptionsLayout extends OptionLayoutTabs {
  readonly version: 1;
}

/** A layout the schema refuses, with where in the JSON (`pages[0].items[2].kind`). */
export class OptionsLayoutError extends Error {
  public readonly path: string;
  public constructor(path: string, message: string) {
    super(`options layout ${path === '' ? '' : `at ${path}`}: ${message}`.replace('layout :', 'layout:'));
    this.name = 'OptionsLayoutError';
    this.path = path;
  }
}

const ID_PATTERN = /^[a-z][A-Za-z0-9]*$/u;
const ITEM_KEYS = ['option', 'group', 'folder', 'tabs'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads `json` as an Options dialog layout, or throws an {@link OptionsLayoutError} naming the first problem: a shape the
 * schema does not have, a key it does not know, an id used twice, a title left empty. `$comment` keys are allowed
 * anywhere and ignored.
 */
export function parseOptionsLayout(json: unknown): OptionsLayout {
  const ids = new Set<string>();
  const fail = (path: string, message: string): never => {
    throw new OptionsLayoutError(path, message);
  };
  const object = (value: unknown, path: string, allowed: readonly string[]): Record<string, unknown> => {
    if (!isRecord(value)) return fail(path, 'expected an object');
    for (const key of Object.keys(value)) {
      if (key !== '$comment' && !allowed.includes(key)) fail(path, `unknown key "${key}"`);
    }
    return value;
  };
  const id = (value: unknown, path: string): string => {
    if (typeof value !== 'string' || !ID_PATTERN.test(value)) return fail(path, 'expected a lowerCamelCase id');
    if (ids.has(value)) fail(path, `id "${value}" is used twice`);
    ids.add(value);
    return value;
  };
  const hidden = (value: unknown, path: string): boolean => {
    if (value === undefined) return false;
    if (typeof value !== 'boolean') return fail(path, 'expected true or false');
    return value;
  };
  const title = (value: unknown, path: string): string => {
    if (typeof value !== 'string' || value.trim() === '') return fail(path, 'expected a title');
    return value;
  };
  const items = (value: unknown, path: string): OptionLayoutItem[] => {
    if (!Array.isArray(value)) return fail(path, 'expected a list of items');
    return value.map((entry, index) => item(entry, `${path}[${index}]`));
  };
  const pages = (value: unknown, path: string): OptionLayoutPage[] => {
    if (!Array.isArray(value) || value.length === 0) return fail(path, 'expected a list of pages');
    return value.map((entry, index) => {
      const at = `${path}[${index}]`;
      const page = object(entry, at, ['title', 'hidden', 'items']);
      return {
        title: title(page.title, `${at}.title`),
        hidden: hidden(page.hidden, `${at}.hidden`),
        items: items(page.items, `${at}.items`),
      };
    });
  };
  const item = (value: unknown, path: string): OptionLayoutItem => {
    if (!isRecord(value)) return fail(path, 'expected an object');
    const kinds = ITEM_KEYS.filter((key) => key in value);
    if (kinds.length !== 1) return fail(path, 'expected exactly one of "option", "group", "folder" or "tabs"');
    switch (kinds[0]) {
      case 'option': {
        const entry = object(value, path, ['option', 'kind', 'hidden']);
        const kind = entry.kind;
        if (typeof kind !== 'string' || !(OPTION_ROW_KINDS as readonly string[]).includes(kind))
          fail(`${path}.kind`, `expected one of ${OPTION_ROW_KINDS.join(', ')}`);
        return {
          option: id(entry.option, `${path}.option`),
          kind: kind as OptionRowKind,
          hidden: hidden(entry.hidden, `${path}.hidden`),
        };
      }
      case 'group': {
        const entry = object(value, path, ['group', 'hidden']);
        return { group: id(entry.group, `${path}.group`), hidden: hidden(entry.hidden, `${path}.hidden`) };
      }
      case 'folder': {
        const entry = object(value, path, ['folder', 'title', 'hidden', 'items']);
        return {
          folder: id(entry.folder, `${path}.folder`),
          title: title(entry.title, `${path}.title`),
          hidden: hidden(entry.hidden, `${path}.hidden`),
          items: items(entry.items, `${path}.items`),
        };
      }
      default: {
        const entry = object(value, path, ['tabs', 'hidden', 'pages']);
        return {
          tabs: id(entry.tabs, `${path}.tabs`),
          hidden: hidden(entry.hidden, `${path}.hidden`),
          pages: pages(entry.pages, `${path}.pages`),
        };
      }
    }
  };
  const root = object(json, '', ['version', 'tabs', 'hidden', 'pages']);
  if (root.version !== 1) fail('version', 'expected 1');
  if (root.hidden !== undefined) fail('hidden', 'the dialog itself cannot be hidden');
  return { version: 1, tabs: id(root.tabs, 'tabs'), hidden: false, pages: pages(root.pages, 'pages') };
}

/** Each item of `items`, and every item inside them, depth first. */
export function* walkOptionLayout(items: readonly OptionLayoutItem[]): Generator<OptionLayoutItem> {
  for (const item of items) {
    yield item;
    if ('folder' in item) yield* walkOptionLayout(item.items);
    else if ('tabs' in item) for (const page of item.pages) yield* walkOptionLayout(page.items);
  }
}

/** Every item of the dialog, depth first. */
export function optionLayoutItems(layout: OptionsLayout): OptionLayoutItem[] {
  return [...walkOptionLayout(layout.pages.flatMap((page) => page.items))];
}

/** Every title the dialog shows for a tab, a page or a folder, in order and once each. */
export function optionLayoutTitles(layout: OptionsLayout): string[] {
  const titles = layout.pages.map((page) => page.title);
  for (const item of optionLayoutItems(layout)) {
    if ('folder' in item) titles.push(item.title);
    else if ('tabs' in item) titles.push(...item.pages.map((page) => page.title));
  }
  return [...new Set(titles)];
}

/** The id of every option and group, the places the code fills. */
export function optionLayoutSlotIds(layout: OptionsLayout): string[] {
  return optionLayoutItems(layout).flatMap((item) =>
    'option' in item ? [item.option] : 'group' in item ? [item.group] : [],
  );
}

/** A row as the layout sees it: whether the layout leaves it off the dialog. */
export interface LayoutRow {
  omitted: boolean;
}

/** Something that holds rows: the dialog, a folder or a page. */
export interface LayoutContainer {
  addFolder(params: { title: string }): LayoutFolder;
  addTab(params: { pages: readonly { title: string }[] }): LayoutTabs;
  /** Moves `row`, one of its rows, to the place of `rank` among the others: after those of a rank up to it. */
  placeAt(row: LayoutRow, rank: number): void;
}
export interface LayoutFolder extends LayoutContainer, LayoutRow {}
export interface LayoutTabs extends LayoutRow {
  readonly pages: readonly LayoutContainer[];
  /** Leaves a page's tab off the bar, or brings it back. */
  omitPage(index: number, omitted: boolean): void;
}

/** Where the code puts an option's or a group's rows. */
export interface LayoutSlot<C> {
  readonly container: C;
  /** Its place among the items of `container`. */
  readonly rank: number;
  /** An option's kind; `undefined` for a group. */
  readonly kind: OptionRowKind | undefined;
  readonly hidden: boolean;
}

/** A page of tabs on the way to an item: the tabs' id and the page's index. */
export interface LayoutStep {
  readonly tabs: string;
  readonly page: number;
}

/** The containers {@link assembleOptionsLayout} made, by id, and the places the code fills. */
export interface AssembledOptionsLayout<C extends LayoutContainer> {
  readonly folders: ReadonlyMap<string, ReturnType<C['addFolder']>>;
  readonly tabs: ReadonlyMap<string, ReturnType<C['addTab']>>;
  readonly slots: ReadonlyMap<string, LayoutSlot<LayoutContainer>>;
  /** The pages to select, outermost first, to show each item. */
  readonly paths: ReadonlyMap<string, readonly LayoutStep[]>;
}

/**
 * Makes the dialog's tabs, pages and folders in `root`, in the layout's order, leaving off those it hides, and lists
 * where each option and group goes. The rows themselves are the code's to make ({@link OptionLayout.place}).
 */
export function assembleOptionsLayout<C extends LayoutContainer>(
  layout: OptionsLayout,
  root: C,
): AssembledOptionsLayout<C> {
  const folders = new Map<string, LayoutFolder>();
  const tabs = new Map<string, LayoutTabs>();
  const slots = new Map<string, LayoutSlot<LayoutContainer>>();
  const paths = new Map<string, readonly LayoutStep[]>();
  const addTabs = (parent: LayoutContainer, spec: OptionLayoutTabs, rank: number, path: readonly LayoutStep[]) => {
    const made = parent.addTab({ pages: spec.pages.map((page) => ({ title: page.title })) });
    parent.placeAt(made, rank);
    made.omitted = spec.hidden;
    tabs.set(spec.tabs, made);
    paths.set(spec.tabs, path);
    spec.pages.forEach((page, index) => {
      made.omitPage(index, page.hidden);
      const container = made.pages[index];
      if (container !== undefined) fill(container, page.items, [...path, { tabs: spec.tabs, page: index }]);
    });
  };
  const fill = (container: LayoutContainer, items: readonly OptionLayoutItem[], path: readonly LayoutStep[]) => {
    items.forEach((item, rank) => {
      if ('option' in item) {
        slots.set(item.option, { container, rank, kind: item.kind, hidden: item.hidden });
        paths.set(item.option, path);
      } else if ('group' in item) {
        slots.set(item.group, { container, rank, kind: undefined, hidden: item.hidden });
        paths.set(item.group, path);
      } else if ('folder' in item) {
        const folder = container.addFolder({ title: item.title });
        container.placeAt(folder, rank);
        folder.omitted = item.hidden;
        folders.set(item.folder, folder);
        paths.set(item.folder, path);
        fill(folder, item.items, path);
      } else {
        addTabs(container, item, rank, path);
      }
    });
  };
  addTabs(root, layout, 0, []);
  return {
    folders: folders as Map<string, ReturnType<C['addFolder']>>,
    tabs: tabs as Map<string, ReturnType<C['addTab']>>,
    slots,
    paths,
  };
}

/** A row the code made, as the layout checks it. */
export interface PlacedRow extends LayoutRow {
  readonly kind: OptionRowKind | 'folder' | 'tabs';
}

/** The ways a container makes rows, which {@link OptionPlacement} passes on. */
export interface RowMaker {
  addBinding(object: object, key: PropertyKey, params?: object): PlacedRow;
  addButton(params: { title: string }): PlacedRow;
  addElement(content: HTMLElement, localize?: (language: string) => void): PlacedRow;
  addFolder(params: { title: string }): PlacedRow;
  addTab(params: { pages: readonly { title: string }[] }): PlacedRow;
}

/** Reports an option the code built as another kind than the layout says; the row still shows. */
export type KindMismatchReporter = (id: string, expected: OptionRowKind, actual: PlacedRow['kind']) => void;

/**
 * The dialog's layout once made: the code asks it where each option goes ({@link place}), and reaches the folders and
 * tabs it made by id.
 */
export class OptionLayout<C extends LayoutContainer = LayoutContainer> {
  public readonly spec: OptionsLayout;
  private readonly assembled: AssembledOptionsLayout<C>;
  private readonly claimed = new Map<string, PlacedRow>();
  private readonly reportKindMismatch: KindMismatchReporter;

  public constructor(spec: OptionsLayout, root: C, reportKindMismatch: KindMismatchReporter) {
    this.spec = spec;
    this.assembled = assembleOptionsLayout(spec, root);
    this.reportKindMismatch = reportKindMismatch;
  }

  /**
   * Where the option or group `id` goes: rows made through it land at its place, hidden when the layout hides it. An
   * option takes one row (a row made again after the last was disposed replaces it); a group takes any number.
   */
  public place(id: string): OptionPlacement {
    const slot = this.assembled.slots.get(id);
    if (slot === undefined) throw new Error(`Options layout has no option or group "${id}" (options-layout.json)`);
    return new OptionPlacement(slot.container as unknown as RowMaker & LayoutContainer, slot.rank, (row) =>
      this.claim(id, slot, row),
    );
  }

  /** A folder the layout made. */
  public folder(id: string): ReturnType<C['addFolder']> {
    const folder = this.assembled.folders.get(id);
    if (folder === undefined) throw new Error(`Options layout has no folder "${id}" (options-layout.json)`);
    return folder;
  }

  /** A set of tabs the layout made. */
  public tabs(id: string): ReturnType<C['addTab']> {
    const tabs = this.assembled.tabs.get(id);
    if (tabs === undefined) throw new Error(`Options layout has no tabs "${id}" (options-layout.json)`);
    return tabs;
  }

  /** The pages to select, outermost first, to show the item `id`. */
  public path(id: string): readonly LayoutStep[] {
    return this.assembled.paths.get(id) ?? [];
  }

  /** The options of the layout no code has built: one only some browsers have, or a mistake. */
  public unclaimed(): string[] {
    return [...this.assembled.slots]
      .filter(([id, slot]) => slot.kind !== undefined && !this.claimed.has(id))
      .map(([id]) => id);
  }

  private claim(id: string, slot: LayoutSlot<LayoutContainer>, row: PlacedRow): void {
    row.omitted = slot.hidden;
    if (slot.kind === undefined) return;
    const previous = this.claimed.get(id);
    const container = slot.container as unknown as { readonly children?: readonly unknown[] };
    if (previous !== undefined && previous !== row && container.children?.includes(previous) === true) {
      throw new Error(`Options layout option "${id}" is built twice; give the second row an id of its own`);
    }
    this.claimed.set(id, row);
    if (row.kind !== slot.kind) this.reportKindMismatch(id, slot.kind, row.kind);
  }
}

/** Makes rows in a container at one option's or group's place (`OptionLayout.place`), as the container would. */
export class OptionPlacement implements Pick<OptionContainer, keyof RowMaker> {
  private readonly target: RowMaker & LayoutContainer;
  private readonly rank: number;
  private readonly claim: (row: PlacedRow) => void;

  public constructor(target: RowMaker & LayoutContainer, rank: number, claim: (row: PlacedRow) => void) {
    this.target = target;
    this.rank = rank;
    this.claim = claim;
  }

  public readonly addBinding = ((object: object, key: PropertyKey, params?: object) =>
    this.put(this.target.addBinding(object, key, params))) as OptionContainer['addBinding'];
  public readonly addButton = ((params: { title: string }) =>
    this.put(this.target.addButton(params))) as OptionContainer['addButton'];
  public readonly addElement = ((content: HTMLElement, localize?: (language: string) => void) =>
    this.put(this.target.addElement(content, localize))) as OptionContainer['addElement'];
  public readonly addFolder = ((params: { title: string }) =>
    this.put(this.target.addFolder(params))) as OptionContainer['addFolder'];
  public readonly addTab = ((params: { pages: readonly { title: string }[] }) =>
    this.put(this.target.addTab(params))) as OptionContainer['addTab'];

  private put<R extends PlacedRow>(row: R): R {
    this.target.placeAt(row, this.rank);
    this.claim(row);
    return row;
  }
}
