import type { Locale } from './locale.ts';
import { html, nothing, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import { repeat } from 'lit/directives/repeat.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { resolveServiceHeader, type HeaderAction, type ServiceHeaderInput } from './header-model.ts';

/** Header markup for clients. Only the model's fixed icon constants enter through unsafeHTML. */
export function serviceHeaderTemplate(input: ServiceHeaderInput): TemplateResult {
  const view = resolveServiceHeader(input);
  const { account, language } = view;
  return html`<header class="bg-background/90 sticky top-0 z-40 border-b backdrop-blur">
    <div class=${view.rowClass}>
      <div class="flex shrink-0 items-center gap-1">
        <a class="font-semibold tracking-tight whitespace-nowrap no-underline" href=${view.homeHref}>${view.title}</a>
        <span class=${view.badgeClass} data-variant="outline">Beta</span>
      </div>
      <nav class="ms-auto flex items-center gap-1 whitespace-nowrap sm:gap-2" aria-label=${view.navLabel}>
        <a
          class="btn"
          data-size="sm"
          data-variant="ghost"
          data-service-header="account"
          href=${account.href}
          target=${ifDefined(account.newTab ? '_blank' : undefined)}
          rel=${ifDefined(account.newTab ? 'noopener' : undefined)}
          title=${ifDefined(account.title)}
          aria-label=${ifDefined(account.ariaLabel)}
        >
          ${
            account.signedIn
              ? html`${account.avatarURL !== undefined ? html`<img class="bg-muted ring-foreground/10 inline-block shrink-0 rounded-full ring-1" src=${account.avatarURL} width="24" height="24" alt="" loading="lazy" decoding="async" />` : nothing}
                  <span class="hidden max-w-[12ch] truncate sm:inline">${account.label}</span
                  >${icon(account.iconHTML, 'text-muted-foreground')}`
              : account.label
          }
        </a>
        ${repeat(view.actions, (action) => action.key, actionTemplate)}
        <div class="relative">
          <button
            type="button"
            class="btn"
            data-size="icon-sm"
            data-variant="ghost"
            popovertarget="language-menu"
            aria-label=${language.label}
            style="anchor-name:--language-menu"
          >
            ${icon(language.iconHTML, 'text-muted-foreground')}
          </button>
          <div
            id="language-menu"
            popover="auto"
            class=${language.menuClass}
            style="position-anchor:--language-menu;inset:auto;margin:6px 0;position-area:block-end span-inline-start;position-try-fallbacks:flip-inline,--header-menu-span"
          >
            ${language.choices.map(
              (choice) =>
                html`<a
                  class="hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5"
                  href=${choice.href}
                  lang=${choice.locale}
                  hreflang=${choice.locale}
                  aria-current=${ifDefined(choice.current ? 'true' : undefined)}
                >
                  <span class=${ifDefined(choice.current ? undefined : 'invisible')}
                    >${icon(language.checkIconHTML)}</span
                  >${choice.label}
                </a>`,
            )}
          </div>
        </div>
      </nav>
    </div>
  </header>`;
}

function icon(svg: string, className = ''): TemplateResult {
  return html`<span class=${`inline-flex shrink-0 [&>svg]:size-4${className ? ` ${className}` : ''}`} aria-hidden="true"
    >${unsafeHTML(svg)}</span
  >`;
}

function actionTemplate(action: HeaderAction): TemplateResult {
  if (action.href !== undefined)
    return html`<a class="btn" data-size="sm" href=${action.href} title=${action.title} aria-label=${action.label}
      >${icon(action.iconHTML)}<span class="hidden md:inline">${action.label}</span></a
    >`;
  return html`<button
    type="button"
    class="btn"
    data-size="icon-sm"
    data-service-header=${action.key}
    aria-haspopup=${ifDefined(action.dialog === undefined ? undefined : 'dialog')}
    aria-controls=${ifDefined(action.dialog)}
    data-tooltip=${action.label}
    data-side="bottom"
    aria-label=${action.label}
    aria-expanded=${ifDefined(action.expanded === undefined ? undefined : String(action.expanded))}
    aria-pressed=${ifDefined(action.pressed === undefined ? undefined : String(action.pressed))}
  >
    ${icon(action.iconHTML)}
  </button>`;
}

export function serviceSkipLinkTemplate(locale: Locale): TemplateResult {
  return html`<a
    class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
    href="#main"
    >${locale === 'ja' ? '本文へ移動' : 'Skip to content'}</a
  >`;
}
