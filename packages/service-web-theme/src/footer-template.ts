import { html, nothing, type TemplateResult } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import type { BuildInfo } from './build-info.ts';
import { publicBetaNotice } from './public-beta.ts';
import type { Locale } from './locale.ts';
import {
  serviceOrigins,
  SERVICE_NAMES,
  SERVICE_LABELS,
  SERVICE_COPYRIGHT,
  SERVICE_FOOTER_CLASS,
  SERVICE_FOOTER_COLUMNS_CLASS,
  SERVICE_FOOTER_NAV_CLASS,
  SERVICE_FOOTER_LINK_CLASS,
  type ServiceFooterInput,
} from './footer.ts';

export function buildInfoTemplate(info?: BuildInfo): TemplateResult {
  if (info === undefined) return html``;
  const date = new Date(info.builtAt);
  const valid = Number.isFinite(date.getTime());
  const timestamp = valid ? date.toISOString() : '';
  const label = valid ? `${timestamp.slice(0, 19).replace('T', ' ')} UTC` : 'unknown';
  const revision = info.revision || 'unknown';
  return html`<span class="build-info"
    >Built ${valid ? html`<time datetime=${timestamp}>${label}</time>` : label} · Revision
    <code title=${revision}>${revision.slice(0, 8)}</code></span
  >`;
}

export function publicBetaNoticeTemplate(locale: Locale | 'both'): TemplateResult {
  return locale === 'both'
    ? html`<p data-public-beta-notice="en" lang="en">${publicBetaNotice('en')}</p>
        <p data-public-beta-notice="ja" lang="ja" hidden>${publicBetaNotice('ja')}</p>`
    : html`<p lang=${locale}>${publicBetaNotice(locale)}</p>`;
}

/** One footer template serves both browser clients and server HTML. siteHTML is an explicit trusted boundary. */
export function serviceFooterTemplate(input: ServiceFooterInput = {}): TemplateResult {
  const origins = serviceOrigins(input.hostname ?? '');
  for (const name of SERVICE_NAMES) {
    const origin = input.origins?.[name];
    if (origin !== undefined && origin !== '') origins[name] = origin;
  }
  const columns = input.layout === 'columns';
  const baseClass = columns ? SERVICE_FOOTER_COLUMNS_CLASS : SERVICE_FOOTER_CLASS;
  const footerClass = input.className ? `${baseClass} ${input.className}` : baseClass;
  const notice = input.publicBeta === false ? nothing : publicBetaNoticeTemplate(input.locale ?? 'en');
  const site = input.siteHTML ? unsafeHTML(input.siteHTML) : nothing;
  const copyright = input.copyright ?? SERVICE_COPYRIGHT;
  const nav = html`<nav class=${SERVICE_FOOTER_NAV_CLASS} aria-label=${input.navLabel ?? 'Services'}>
    ${SERVICE_NAMES.map((name) =>
      name === input.current
        ? html`<span aria-current="page">${SERVICE_LABELS[name]}</span>`
        : html`<a class=${SERVICE_FOOTER_LINK_CLASS} data-service=${name} href=${origins[name]}
            >${SERVICE_LABELS[name]}</a
          >`,
    )}
  </nav>`;
  return columns
    ? html`<footer class=${footerClass}>
        ${input.publicBeta === false ? nothing : html`<div class="sm:col-span-3">${notice}</div>`}
        <div class="sm:justify-self-start">${buildInfoTemplate(input.buildInfo)}</div>
        ${nav}
        <p class="sm:justify-self-end">${input.siteHTML ? html`${site} · ` : nothing}${copyright}</p>
      </footer>`
    : html`<footer class=${footerClass}>
        ${notice}${nav}${input.siteHTML ? html`<div class="space-y-2">${site}</div>` : nothing}
        <p>${copyright}</p>
        ${buildInfoTemplate(input.buildInfo)}
      </footer>`;
}
