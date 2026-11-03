/** Request-local message catalogs passed explicitly to server templates. */
import { en, type Messages } from './en.ts';
import { ja } from './ja.ts';
import type { Locale } from './locale.ts';

export type { Messages } from './en.ts';
export * from './locale.ts';

const CATALOGS: Readonly<Record<Locale, Messages>> = { en, ja };

export function messagesFor(locale: Locale): Messages {
  return CATALOGS[locale];
}
