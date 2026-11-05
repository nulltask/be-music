import { accountIdentityTemplate } from './account-identity-template.ts';
import { skeletonGroupTemplate, skeletonTemplate } from './skeleton-template.ts';
import { languageMenuTemplate } from './popover-template.ts';
import type { Locale } from './locale.ts';
import { html, type TemplateResult } from 'lit';
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
        ${
          account.loading
            ? accountLoadingTemplate(input.locale, account.loadingLabel, account.iconHTML)
            : html`<a
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
                  input.account !== undefined
                    ? html`${accountIdentityTemplate({ account: input.account, locale: input.locale, variant: 'compact' })}${icon(account.iconHTML, 'text-muted-foreground')}`
                    : account.label
                }
              </a>`
        }
        ${repeat(view.actions, (action) => action.key, actionTemplate)}
        ${languageMenuTemplate({ label: language.label, choices: language.choices, buttonSize: 'icon-sm' })}
      </nav>
    </div>
  </header>`;
}

/**
 * The account control while the page reads who is signed in: the signed-in control's box (avatar, then the name from
 * `sm` up at the label's 12ch cap, then the chevron), so the header does not move when the account arrives. It is not
 * a link yet.
 */
function accountLoadingTemplate(locale: Locale, label: string, chevronHTML: string): TemplateResult {
  return html`<span
    class="btn pointer-events-none"
    data-size="sm"
    data-variant="ghost"
    data-service-header="account-loading"
    >${skeletonGroupTemplate({
      locale,
      label,
      content: html`${skeletonTemplate({ shape: 'circle', width: 24 })}${skeletonTemplate({
        shape: 'line',
        width: '12ch',
        className: 'hidden sm:inline-block',
      })}`,
    })}${icon(chevronHTML, 'text-muted-foreground')}</span
  >`;
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
