// The persisted Options layout schema, shared by the settings defaults and the dialog.

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
export type OptionDefaultValue = boolean | number | string;
const RUNTIME_DEFAULTS = [
  'builtInSkin',
  'lr2Theme',
  'skinEffects',
  'renderResolution',
  'workers',
  'bgaUseWebCodecs',
] as const;
export type RuntimeOptionDefault = (typeof RUNTIME_DEFAULTS)[number];
export type OptionDefault = OptionDefaultValue | { readonly use: RuntimeOptionDefault };
export type RuntimeDefaultResolver = (policy: RuntimeOptionDefault) => OptionDefaultValue | undefined;

/** One row the code builds, named by its id. */
export interface OptionLayoutOption {
  readonly option: string;
  readonly kind: OptionRowKind;
  readonly hidden: boolean;
  readonly default?: OptionDefault;
}

/** Rows the code makes as it needs them (a row per lane, a loaded skin's settings), at one place among the others. */
export interface OptionLayoutGroup {
  readonly group: string;
  readonly hidden: boolean;
  readonly reset?: true;
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
  const defaultValue = (value: unknown, kind: OptionRowKind, path: string): OptionDefault => {
    if (kind === 'button' || kind === 'element' || kind === 'monitor') {
      return fail(path, 'only editable options can have a default');
    }
    if (isRecord(value)) {
      const policy = object(value, path, ['use']).use;
      if (typeof policy === 'string' && (RUNTIME_DEFAULTS as readonly string[]).includes(policy))
        return { use: policy as RuntimeOptionDefault };
      return fail(`${path}.use`, 'unknown runtime default');
    }
    const type = typeof value;
    if (
      (type === 'boolean' && (kind === 'toggle' || kind === 'select')) ||
      (type === 'string' && (kind === 'text' || kind === 'select')) ||
      (type === 'number' && Number.isFinite(value) && (kind === 'slider' || kind === 'number' || kind === 'select'))
    )
      return value as OptionDefaultValue;
    return fail(path, `invalid default for ${kind}`);
  };
  const item = (value: unknown, path: string): OptionLayoutItem => {
    if (!isRecord(value)) return fail(path, 'expected an object');
    const kinds = ITEM_KEYS.filter((key) => key in value);
    if (kinds.length !== 1) return fail(path, 'expected exactly one of "option", "group", "folder" or "tabs"');
    switch (kinds[0]) {
      case 'option': {
        const entry = object(value, path, ['option', 'kind', 'hidden', 'default']);
        const kind = entry.kind;
        if (typeof kind !== 'string' || !(OPTION_ROW_KINDS as readonly string[]).includes(kind))
          fail(`${path}.kind`, `expected one of ${OPTION_ROW_KINDS.join(', ')}`);
        return {
          option: id(entry.option, `${path}.option`),
          kind: kind as OptionRowKind,
          hidden: hidden(entry.hidden, `${path}.hidden`),
          ...(entry.default === undefined
            ? {}
            : { default: defaultValue(entry.default, kind as OptionRowKind, `${path}.default`) }),
        };
      }
      case 'group': {
        const entry = object(value, path, ['group', 'hidden', 'reset']);
        if (entry.reset !== undefined && entry.reset !== true) fail(`${path}.reset`, 'expected true');
        return {
          group: id(entry.group, `${path}.group`),
          hidden: hidden(entry.hidden, `${path}.hidden`),
          ...(entry.reset === true ? { reset: true } : {}),
        };
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
