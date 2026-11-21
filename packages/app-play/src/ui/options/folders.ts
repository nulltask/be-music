// The layout of the player's Options dialog (`OptionsDialog`): its tabs, folders, pages and options, in order, read from
// `options-layout.json` (`layout.ts`) so the structure reads in one place and stays testable; the code that builds each
// option places it by its id.
import { parseOptionsLayout, type OptionsLayout } from './layout.ts';
import optionsLayoutJSON from './options-layout.json' with { type: 'json' };

export * from '../../player-storage.ts';

/** The Options dialog's layout (`options-layout.json`), read and checked once as the module loads. */
export const OPTIONS_LAYOUT: OptionsLayout = parseOptionsLayout(optionsLayoutJSON);
