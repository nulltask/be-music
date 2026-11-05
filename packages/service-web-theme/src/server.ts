import { unsafeHTML as renderedFragment } from 'lit/directives/unsafe-html.js';
import { popoverTemplate as sharedPopoverTemplate, type PopoverInput } from './popover-template.ts';
import { render } from '@lit-labs/ssr';
import type { TemplateResult } from 'lit';
import { collectResultSync } from '@lit-labs/ssr/lib/render-result.js';
import { serviceHeaderTemplate, serviceSkipLinkTemplate } from './header-template.ts';
export { serviceHeaderTemplate, serviceSkipLinkTemplate };
import { buildInfoTemplate, publicBetaNoticeTemplate, serviceFooterTemplate } from './footer-template.ts';
export { buildInfoTemplate, publicBetaNoticeTemplate, serviceFooterTemplate };
import type { BuildInfo } from './build-info.ts';
import type { Locale } from './locale.ts';
import type { ServiceFooterInput } from './footer.ts';
import type { ServiceHeaderInput } from './header-model.ts';

/** Server-only templates support full documents and trusted inline styles/scripts. */
export { html } from '@lit-labs/ssr';
export { nothing } from 'lit';
export { unsafeHTML } from 'lit/directives/unsafe-html.js';
export type { TemplateResult } from 'lit';

/** Render a synchronous page/fragment without client hydration markers; htmx owns its response DOM. */
export function renderHTML(value: unknown): string {
  requireSynchronous(value, new WeakSet());
  return collectResultSync(render(value, { elementRenderers: [] }))
    .replace(/<!--(?:lit-part(?:\s[^]*?)?|\/lit-part|lit-node\s[^]*?)-->/g, '')
    .replace(/<\?>/g, '');
}

/** Server and client share the complete header template, including escaping and optional controls. */
export function renderServiceHeader(input: ServiceHeaderInput): string {
  return renderHTML(serviceHeaderTemplate(input));
}

/** Template values and directive arguments must be resolved before entering this synchronous boundary. */
function requireSynchronous(value: unknown, seen: WeakSet<object>): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if ('then' in value && typeof value.then === 'function')
    throw new TypeError('Await asynchronous values before rendering HTML');
  if (Array.isArray(value)) {
    for (const entry of value) requireSynchronous(entry, seen);
  } else if ('values' in value && Array.isArray(value.values)) {
    for (const entry of value.values) requireSynchronous(entry, seen);
  }
}

export function renderBuildInfo(info?: BuildInfo): string {
  return renderHTML(buildInfoTemplate(info));
}

export function renderPublicBetaNotice(locale: Locale | 'both'): string {
  return renderHTML(publicBetaNoticeTemplate(locale));
}

export function renderServiceFooter(input: ServiceFooterInput = {}): string {
  return renderHTML(serviceFooterTemplate(input));
}

export function serviceSkipLink(locale: Locale): string {
  return renderHTML(serviceSkipLinkTemplate(locale));
}

export { authButtonTemplate, authPanelTemplate, type AuthButtonInput } from './auth-template.ts';
export { avatarTemplate, accountIdentityTemplate } from './account-identity-template.ts';
export type { ServiceAccountIdentity } from './account-model.ts';
export {
  languageMenuTemplate,
  languageLinksTemplate,
  type PopoverInput,
  type LanguageChoice,
} from './popover-template.ts';

/** Accept server-only content at the server seam while sharing the browser's complete popover markup. */
export function popoverTemplate(input: PopoverInput): TemplateResult {
  return sharedPopoverTemplate({
    ...input,
    trigger: renderedFragment(renderHTML(input.trigger)),
    content: renderedFragment(renderHTML(input.content)),
  });
}
