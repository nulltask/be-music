import { optionLayoutItems, parseOptionsLayout, type OptionDefaultValue } from './options-layout-schema.ts';
import optionsLayoutJSON from './ui/options/options-layout.json' with { type: 'json' };

/** The layout used to build the Options dialog and supply its defaults. */
export const OPTIONS_LAYOUT = parseOptionsLayout(optionsLayoutJSON);

const defaults = new Map(
  optionLayoutItems(OPTIONS_LAYOUT).flatMap((item) =>
    'option' in item && item.default !== undefined ? [[item.option, item.default] as const] : [],
  ),
);

/** The static default used by a persisted setting, including when it has never been saved. */
export function optionDefault<T extends OptionDefaultValue>(id: string): T {
  const value = defaults.get(id);
  if (value === undefined || typeof value === 'object')
    throw new Error(`Options layout has no static default for "${id}"`);
  return value as T;
}
