/**
 * The Leaderboard pages' languages: the catalogs, the one a request is in, and how components reach it. A page handler
 * gets its catalog from {@link messagesFor} (through `meta`); components below the layout read it with
 * {@link useMessages}, which the layout provides for the whole page.
 */
import { createContext, useContext } from 'hono/jsx';
import { en, type Messages } from './en.ts';
import { ja } from './ja.ts';
import type { Locale } from './locale.ts';

export type { Messages } from './en.ts';
export * from './locale.ts';

const CATALOGS: Readonly<Record<Locale, Messages>> = { en, ja };

export function messagesFor(locale: Locale): Messages {
  return CATALOGS[locale];
}

/** The page's catalog, provided by the layout; English outside one. */
export const MessagesContext = createContext<Messages>(en);

/** The catalog of the page being rendered. */
export function useMessages(): Messages {
  return useContext(MessagesContext);
}
