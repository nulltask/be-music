import { html, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { LOCALE_NAMES, type Locale } from './locale.ts';
const LANGUAGES_ICON =
  '<svg class="lucide lucide-languages" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>';
const CHECK_ICON =
  '<svg class="lucide lucide-check" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

const MENU_CLASS =
  'bg-popover text-popover-foreground max-w-[calc(100vw-2rem)] rounded-lg border p-1 text-sm whitespace-normal [word-break:auto-phrase] shadow-md';

export interface PopoverInput {
  /** Unique HTML id and CSS identifier; the anchor name is derived from it. */
  id: string;
  label: string;
  trigger: unknown;
  content: unknown;
  title?: string;
  width?: string;
  className?: string;
  buttonSize?: 'sm' | 'icon-sm';
}

/** Native popover semantics, responsive placement, and accessible naming shared by header menus. */
export function popoverTemplate(input: PopoverInput): TemplateResult {
  const anchor = `--${input.id}`;
  return html`<div class=${input.className ?? 'relative'}>
    <button
      type="button"
      class="btn"
      data-size=${input.buttonSize ?? 'sm'}
      data-variant="ghost"
      popovertarget=${input.id}
      aria-label=${input.label}
      title=${ifDefined(input.title)}
      style=${`anchor-name:${anchor}`}
    >
      ${input.trigger}
    </button>
    <div
      id=${input.id}
      popover="auto"
      class=${`${MENU_CLASS} ${input.width ?? 'w-56'}`}
      style=${`position-anchor:${anchor};inset:auto;margin:6px 0;position-area:block-end span-inline-start;position-try-fallbacks:flip-inline,--header-menu-span`}
    >
      ${input.content}
    </div>
  </div>`;
}

export interface LanguageChoice {
  locale: Locale;
  href: string;
  current: boolean;
  label?: string;
}

/** Language links may also appear in a phone navigation menu; callers supply their URL policy. */
export function languageLinksTemplate(choices: readonly LanguageChoice[]): TemplateResult {
  return html`${choices.map(
    (choice) =>
      html`<a
        class="hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5"
        href=${choice.href}
        lang=${choice.locale}
        hreflang=${choice.locale}
        aria-current=${ifDefined(choice.current ? 'true' : undefined)}
      >
        <span class=${ifDefined(choice.current ? undefined : 'invisible')}
          ><span class="inline-flex shrink-0 [&>svg]:size-4" aria-hidden="true">${unsafeHTML(CHECK_ICON)}</span></span
        >${choice.label ?? LOCALE_NAMES[choice.locale]}</a
      >`,
  )}`;
}

/** One language picker for both the shared and specialized application headers. */
export function languageMenuTemplate(input: {
  label: string;
  choices: readonly LanguageChoice[];
  title?: string;
  className?: string;
  buttonSize?: 'sm' | 'icon-sm';
}): TemplateResult {
  return popoverTemplate({
    ...input,
    id: 'language-menu',
    width: 'w-44',
    trigger: html`<span class="inline-flex shrink-0 [&>svg]:size-4 text-muted-foreground" aria-hidden="true"
      >${unsafeHTML(LANGUAGES_ICON)}</span
    >`,
    content: languageLinksTemplate(input.choices),
  });
}
