// Builds the Options dialog's containers from its validated layout and places controls by id.
import type { OptionContainer } from '../options-controls.ts';
import type {
  OptionDefault,
  OptionDefaultValue,
  OptionLayoutItem,
  OptionLayoutTabs,
  OptionRowKind,
  OptionsLayout,
  RuntimeDefaultResolver,
} from '../../options-layout-schema.ts';

export * from '../../options-layout-schema.ts';

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
  /** Adds a button that runs `reset`, and returns its row for {@link placeAt}. */
  addSectionReset?(reset: () => void): LayoutRow;
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
  readonly default?: OptionDefault;
}

/** A page of tabs on the way to an item: the tabs' id and the page's index. */
export interface LayoutStep {
  readonly tabs: string;
  readonly page: number;
}

/** A folder or a page, as its reset sees it. */
export interface LayoutSection {
  /** The options and groups placed directly in it that have a default; those in its folders and tabs are theirs. */
  readonly ids: ReadonlySet<string>;
  /** The rank of its last option or group, after which its reset goes. */
  readonly lastRank: number;
}

/** The containers {@link assembleOptionsLayout} made, by id, and the places the code fills. */
export interface AssembledOptionsLayout<C extends LayoutContainer> {
  readonly folders: ReadonlyMap<string, ReturnType<C['addFolder']>>;
  readonly tabs: ReadonlyMap<string, ReturnType<C['addTab']>>;
  readonly slots: ReadonlyMap<string, LayoutSlot<LayoutContainer>>;
  /** The pages to select, outermost first, to show each item. */
  readonly paths: ReadonlyMap<string, readonly LayoutStep[]>;
  readonly sections: ReadonlyMap<LayoutContainer, LayoutSection>;
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
  const sections = new Map<LayoutContainer, { ids: Set<string>; lastRank: number }>();
  const sectionOf = (container: LayoutContainer) => {
    const section = { ids: new Set<string>(), lastRank: -1 };
    sections.set(container, section);
    return section;
  };
  const addTabs = (parent: LayoutContainer, spec: OptionLayoutTabs, rank: number, path: readonly LayoutStep[]) => {
    const made = parent.addTab({ pages: spec.pages.map((page) => ({ title: page.title })) });
    parent.placeAt(made, rank);
    made.omitted = spec.hidden;
    tabs.set(spec.tabs, made);
    paths.set(spec.tabs, path);
    spec.pages.forEach((page, index) => {
      made.omitPage(index, page.hidden);
      const container = made.pages[index];
      if (container === undefined) return;
      fill(container, page.items, [...path, { tabs: spec.tabs, page: index }]);
    });
  };
  const fill = (container: LayoutContainer, items: readonly OptionLayoutItem[], path: readonly LayoutStep[]) => {
    const section = sectionOf(container);
    items.forEach((item, rank) => {
      if ('option' in item) {
        slots.set(item.option, {
          container,
          rank,
          kind: item.kind,
          hidden: item.hidden,
          ...(item.default === undefined ? {} : { default: item.default }),
        });
        paths.set(item.option, path);
        section.lastRank = rank;
        if (item.default !== undefined) section.ids.add(item.option);
      } else if ('group' in item) {
        slots.set(item.group, { container, rank, kind: undefined, hidden: item.hidden });
        paths.set(item.group, path);
        section.lastRank = rank;
        if (item.reset === true) section.ids.add(item.group);
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
    sections,
  };
}

/** A row the code made, as the layout checks it. */
export interface PlacedRow extends LayoutRow {
  readonly kind: OptionRowKind | 'folder' | 'tabs';
  resetToDefault?(value: OptionDefaultValue): void;
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
  private readonly resetters = new Map<string, (resolve: RuntimeDefaultResolver) => void>();
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

  /** Supplies the reset for a group whose controls are built from runtime data. */
  public setGroupReset(id: string, reset: () => void): void {
    this.resetters.set(id, reset);
  }

  /**
   * Adds one reset to each folder or page with settings of its own, right after them. It resets only those settings,
   * so a folder or tabs inside it keep theirs and their own reset; nested sections never stack resets at one end.
   */
  public installSectionResets(resolve: RuntimeDefaultResolver): void {
    for (const [container, { ids, lastRank }] of this.assembled.sections) {
      if (ids.size === 0) continue;
      const row = container.addSectionReset?.(() => {
        // Construction order applies mode switches and choice lists before dependent values.
        for (const [id, reset] of this.resetters) if (ids.has(id)) reset(resolve);
      });
      // Half a rank on: after the rows of its last item, including those a group makes later, and before what follows.
      if (row !== undefined) container.placeAt(row, lastRank + 0.5);
    }
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
    const fallback = slot.default;
    if (fallback !== undefined) {
      this.resetters.set(id, (resolve) => {
        const value = typeof fallback === 'object' ? resolve(fallback.use) : fallback;
        if (value !== undefined) row.resetToDefault?.(value);
      });
    }
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
