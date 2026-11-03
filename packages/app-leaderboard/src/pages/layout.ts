import {
  authPanelTemplate,
  accountIdentityTemplate,
  popoverTemplate,
  languageMenuTemplate,
  languageLinksTemplate,
} from '@be-music/service-web-theme/server';
import type { PageContent } from './template.ts';
import { html, nothing, unsafeHTML, renderHTML } from '@be-music/service-web-theme/server';
import { serviceFooterTemplate } from '@be-music/service-web-theme/server';
import { SERVICE_FOOTER_NAV_CLASS, type BuildInfo } from '@be-music/service-web-theme';
import type { RulesetId } from '@be-music/player-engine/replay';
import { RULESET_LABELS } from './format.ts';
import { LOCALE_NAMES, LOCALES, messagesFor, type Locale, type Messages } from './i18n/index.ts';
import { helpHref } from './help-topics.ts';
import { RULESET_IDS } from '../rulesets.ts';
import { CLIENT_SCRIPT_PATH } from './client-script.ts';
import { playerAppHref, playerHref } from './components/basics.ts';
import { EntityIcon, type EntityKind } from './components/entity-icon.ts';
import { Icon } from './components/icon.ts';
import { Check, ChevronDown, ExternalLink, LogOut, Menu, Play, Scale, UserPlus } from 'lucide-static';
import { CARD_HEIGHT, CARD_WIDTH } from '../cards.ts';
import { ICON_LINKS } from './icons.ts';
import { ICONS } from './icons.generated.ts';
import type { Viewer } from './viewer.ts';
import { APP_CSS_HASH } from './styles.generated.ts';
import { speculationRules } from './speculation.ts';
import { partialLinkAttributes, SITE_HEADER_ID } from './partial-swap.ts';

/** Where the compiled stylesheet is served; the hash in the name lets browsers keep it forever. */
export const STYLESHEET_PATH = `/assets/app.${APP_CSS_HASH}.css`;

/**
 * Follows the system colour scheme. Basecoat switches its tokens on `html.dark`, so the class is set before the first
 * paint (no flash) and kept in sync when the system setting changes. Without JavaScript the page stays light.
 */
const COLOR_SCHEME_SCRIPT = `(() => {
  const media = matchMedia('(prefers-color-scheme: dark)');
  const apply = () => document.documentElement.classList.toggle('dark', media.matches);
  apply();
  media.addEventListener('change', apply);
})();`;

/**
 * Tooltips of the info and help icons (components/play-info.ts, components/help-tip.ts). A mouse hovering an icon,
 * or the keyboard focusing it, shows its card; leaving hides it after a short grace, so the pointer (or the focus) can
 * move into the card and use its links — the card stays while it is there. A click (or a tap) on a hovered card pins it instead of closing it; the Popover API then
 * closes it on Escape or a click elsewhere. Browsers without CSS anchor positioning get the card placed here, below
 * the icon or above it when there is no room. Without JavaScript the cards still open on click, centered.
 */
const TOOLTIP_SCRIPT = `(() => {
  const anchored = typeof CSS !== 'undefined' && CSS.supports('anchor-name: --a');
  const cardOf = (element) => {
    const trigger = element instanceof Element ? element.closest('[data-tooltip-for]') : null;
    return trigger ? [trigger, document.getElementById(trigger.dataset.tooltipFor)] : [null, null];
  };
  const place = (card) => {
    if (anchored) return;
    const trigger = document.querySelector('[data-tooltip-for="' + card.id + '"]');
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const gap = 6, edge = 8;
    let top = r.bottom + gap;
    if (top + card.offsetHeight > innerHeight - edge && r.top - gap - card.offsetHeight >= edge) top = r.top - gap - card.offsetHeight;
    const left = Math.max(edge, Math.min(r.right - card.offsetWidth, innerWidth - card.offsetWidth - edge));
    card.style.position = 'fixed';
    card.style.margin = '0';
    card.style.top = top + 'px';
    card.style.left = left + 'px';
  };
  const show = (card) => {
    if (!card || card.matches(':popover-open')) return;
    card.dataset.hovered = '';
    card.showPopover();
  };
  const hide = (card) => {
    if (card && card.matches(':popover-open') && 'hovered' in card.dataset) card.hidePopover();
  };
  // Leaving the icon (or the card) hides the card a moment later, unless the pointer or focus arrives in the other.
  const timers = new WeakMap();
  const keep = (card) => {
    if (card) clearTimeout(timers.get(card));
  };
  const hideSoon = (card) => {
    if (!card) return;
    keep(card);
    timers.set(card, setTimeout(() => hide(card), 250));
  };
  const cardHolding = (element) => (element instanceof Element ? element.closest('[data-tooltip]') : null);
  const triggerOf = (card) => document.querySelector('[data-tooltip-for="' + card.id + '"]');
  const within = (card, element) =>
    element instanceof Node && (card.contains(element) || (triggerOf(card)?.contains(element) ?? false));
  document.addEventListener('toggle', (event) => {
    const card = event.target;
    if (!(card instanceof HTMLElement) || !card.hasAttribute('data-tooltip')) return;
    if (event.newState === 'open') place(card);
    else delete card.dataset.hovered;
  }, true);
  document.addEventListener('pointerover', (event) => {
    if (event.pointerType !== 'mouse') return;
    const card = cardOf(event.target)[1] ?? cardHolding(event.target);
    keep(card);
    if (card && !cardHolding(event.target)) show(card);
  });
  document.addEventListener('pointerout', (event) => {
    if (event.pointerType !== 'mouse') return;
    const card = cardOf(event.target)[1] ?? cardHolding(event.target);
    if (card && !within(card, event.relatedTarget)) hideSoon(card);
  });
  document.addEventListener('focusin', (event) => {
    const card = cardOf(event.target)[1] ?? cardHolding(event.target);
    keep(card);
    if (event.target instanceof Element && event.target.matches(':focus-visible') && !cardHolding(event.target)) show(card);
  });
  document.addEventListener('focusout', (event) => {
    const card = cardOf(event.target)[1] ?? cardHolding(event.target);
    if (card && !within(card, event.relatedTarget)) hideSoon(card);
  });
  // A click on a hovered card pins it: keep it open instead of letting popovertarget toggle it shut.
  document.addEventListener('click', (event) => {
    const [, card] = cardOf(event.target);
    if (card && card.matches(':popover-open') && 'hovered' in card.dataset) {
      event.preventDefault();
      delete card.dataset.hovered;
    }
  }, true);
})();`;

/** One step of the breadcrumb trail; the last one is the current page and has no link. */
export interface Crumb {
  label: string;
  href?: string;
  /** What the step is, shown as its icon. */
  kind?: EntityKind;
}

export interface PageMeta {
  buildInfo?: BuildInfo;
  title: string;
  description: string;
  /** The trail below "Leaderboard", ending with this page. */
  crumbs: Crumb[];
  /** Absolute URL of this page, for `og:url`. */
  url: string;
  /** Path and query of this page, where the ruleset switch comes back to. */
  path: string;
  /** The viewer's display ruleset, highlighted in the switch. */
  ruleset: RulesetId;
  /** The language the page is in. */
  locale: Locale;
  /** The signed-in player, or null. */
  viewer: Viewer | null;
  /** The picture link previews show (a path on this site); the site's default card when absent. */
  image?: { path: string; alt: string };
  /** Keeps search engines from indexing the page (a chart not listed yet). */
  noindex?: boolean;
}

/**
 * The header's account area. Signed out: Sign in (a passkey, Google, or Discord) and Sign up. Signed in: the
 * player's icon, opening a menu with their page, Settings and Sign out. The buttons are wired by the client script
 * (client/main.ts); `data-account-status` shows what went wrong.
 */
function AccountMenu(props: { viewer: Viewer | null }, messages: Messages) {
  const t = messages;
  const viewer = props.viewer;
  if (viewer === null) {
    return html`<div class="flex items-center gap-1">
      <button type="button" class="btn" data-size="sm" data-variant="ghost" data-account-action="open-sign-in">
        ${t.account.signIn}</button
      ><button
        type="button"
        class="btn hidden sm:inline-flex"
        data-size="sm"
        data-variant="outline"
        data-account-action="open-sign-up"
      >
        ${t.account.signUp}</button
      >${SignInDialog(messages)}${SignUpDialog(messages)}
    </div>`;
  }
  const identity = {
    handle: viewer.handle,
    displayName: viewer.displayName,
    anonymous: viewer.anonymous,
    avatarURL: viewer.avatarUrl,
  };
  const locale = t.locale === 'ja' ? 'ja' : 'en';
  return popoverTemplate({
    id: 'account-menu',
    label: t.account.accountOf(viewer.handle),
    width: 'w-56',
    className: 'relative',
    trigger: html`${accountIdentityTemplate({ account: identity, locale, variant: 'compact' })}${Icon({ svg: ChevronDown, class: 'text-muted-foreground' })}`,
    content: html`
      <div class="border-b px-2 py-2">${accountIdentityTemplate({ account: identity, locale, showAvatar: false })}</div>
      <a
        class="hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5"
        href=${playerHref(viewer.handle) ?? nothing}
        >${EntityIcon({ kind: 'player', size: 'md', class: 'text-current' })}${t.account.yourPage}</a
      ><a class="hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5" href="/settings"
        >${EntityIcon({ kind: 'settings', size: 'md', class: 'text-current' })}${t.account.settings}</a
      ><button
        type="button"
        class="hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start"
        data-account-action="sign-out"
      >
        ${Icon({ svg: LogOut })}${t.account.signOut}
      </button>
    `,
  });
}

/** The frame of the account dialogs: a centred card over a dimmed page. */
const DIALOG_CLASS =
  'bg-background text-foreground m-auto w-[min(24rem,calc(100vw-2rem))] rounded-xl border p-6 shadow-lg backdrop:bg-black/50';

/** The same auth panel used by Play; this application's client handles its action intents. */
function SignInDialog(messages: Messages) {
  return html`<dialog id="sign-in" aria-labelledby="sign-in-title" class=${DIALOG_CLASS}>
    ${authPanelTemplate({ id: 'sign-in', locale: messages.locale === 'ja' ? 'ja' : 'en', mode: 'sign-in' })}
  </dialog>`;
}

function SignUpDialog(messages: Messages) {
  return html`<dialog id="sign-up" aria-labelledby="sign-up-title" class=${DIALOG_CLASS}>
    ${authPanelTemplate({ id: 'sign-up', locale: messages.locale === 'ja' ? 'ja' : 'en', mode: 'sign-up' })}
  </dialog>`;
}

/** The Be-Music source repository. */
export const SOURCE_URL = 'https://github.com/nulltask/be-music';

const FOOTER_LINK = 'hover:text-foreground inline-flex items-center gap-1 underline-offset-4 hover:underline';

/** About, Help, the API and source links, followed by the ranking reset notice. */
function leaderboardSiteFooter(t: Messages) {
  return html`<nav class=${SERVICE_FOOTER_NAV_CLASS} aria-label=${t.footer.label}>
      <a class=${FOOTER_LINK} href="/about">${t.footer.about}</a>
      <a class=${FOOTER_LINK} href="/help">${t.footer.help}</a>
      <a class=${FOOTER_LINK} href="/api-reference" target="_blank" rel="noopener" title=${t.footer.apiTitle}>
        ${t.footer.api}${Icon({ svg: ExternalLink, class: '[&>svg]:size-3' })}
      </a>
      <a
        class=${FOOTER_LINK}
        href=${SOURCE_URL}
        target="_blank"
        rel="noopener noreferrer"
        title=${t.footer.githubTitle}
      >
        ${t.footer.github}${Icon({ svg: ExternalLink, class: '[&>svg]:size-3' })}
      </a>
    </nav>
    <p>${t.footer.beta}</p>`;
}

/**
 * The scoring rules every figure on the pages is shown under, as a menu in the header next to the account: the
 * current ruleset on the button, the three to pick from in its popover. A choice is kept in a cookie
 * (`/ruleset/:id`) and brings the viewer back to the page, which the client script updates in place (partial-swap.ts).
 */
function RulesetMenu(props: { current: RulesetId; path: string }, messages: Messages) {
  const t = messages;
  const name = (id: RulesetId) => t.rules.name(RULESET_LABELS[id] ?? id);
  return popoverTemplate({
    id: 'ruleset-menu',
    label: t.rules.menuAria(name(props.current)),
    title: t.rules.menuTitle,
    width: 'w-72',
    className: 'relative',
    trigger: html`
      ${Icon({ svg: Scale, class: 'text-muted-foreground' })}<span>${RULESET_LABELS[props.current]}</span
      ><span class="hidden md:inline">${t.rules.word}</span>${Icon({
        svg: ChevronDown,
        class: 'text-muted-foreground',
      })}
    `,
    content: html`
      <div class="text-muted-foreground px-2 pt-1.5 pb-1 text-xs">${t.rules.showUnder}</div>
      ${RULESET_IDS.map((id) => {
        const href = `/ruleset/${id}?next=${encodeURIComponent(props.path)}`;
        const partial = partialLinkAttributes(href, { push: false });
        return html`<a
          class="hover:bg-muted flex items-start gap-2 rounded-md px-2 py-1.5"
          href=${href ?? nothing}
          hx-get=${partial['hx-get'] ?? nothing}
          hx-target=${partial['hx-target'] ?? nothing}
          hx-select=${partial['hx-select'] ?? nothing}
          hx-swap=${partial['hx-swap'] ?? nothing}
          hx-select-oob=${partial['hx-select-oob'] ?? nothing}
          hx-sync=${partial['hx-sync'] ?? nothing}
          hx-indicator=${partial['hx-indicator'] ?? nothing}
          hx-push-url=${partial['hx-push-url'] ?? nothing}
          aria-current=${(id === props.current ? 'true' : undefined) ?? nothing}
          ><span class=${`mt-0.5 ${id === props.current ? '' : 'invisible'}`}>${Icon({ svg: Check })}</span
          ><span
            ><span class="block font-medium">${name(id)}</span
            ><span class="text-muted-foreground block text-xs">${t.rules.notes[id]}</span></span
          ></a
        >`;
      })}
      <p class="text-muted-foreground border-t px-2 pt-2 pb-1.5 text-xs">
        ${t.rules.meaning}${' '}<a
          class="text-foreground underline underline-offset-4"
          href=${helpHref('rules') ?? nothing}
          >${t.help.more}</a
        >
      </p>
    `,
  });
}

/**
 * The language menu next to the ruleset menu: the page's language on the button, the others in its popover. A choice is
 * kept in a cookie (`/lang/:locale`) and brings the viewer back to the page.
 */
function languageChoices(props: { current: Locale; path: string }) {
  return LOCALES.map((locale) => ({
    locale,
    current: locale === props.current,
    href: `/lang/${locale}?next=${encodeURIComponent(withoutLang(props.path))}`,
  }));
}

function LanguageMenu(props: { current: Locale; path: string }, messages: Messages) {
  return languageMenuTemplate({
    label: messages.language.menuAria(LOCALE_NAMES[props.current]),
    title: messages.language.menuTitle,
    choices: languageChoices(props),
    className: 'relative hidden sm:block',
  });
}

/**
 * The header's menu on a phone, where only the main buttons (ruleset, account, Play) fit in the row: the navigation,
 * Help, Sign up when signed out, and the language, behind one button at the right edge. From `sm` up the header shows
 * all of them itself and this button is hidden.
 */
function NavMenu(props: { current: Locale; path: string; signedIn: boolean }, messages: Messages) {
  const t = messages;
  const item = 'hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start';
  return popoverTemplate({
    id: 'nav-menu',
    label: t.nav.menu,
    title: t.nav.menu,
    width: 'w-56',
    className: 'relative sm:hidden',
    trigger: html` ${Icon({ svg: Menu })} `,
    content: html`
      <nav aria-label=${t.nav.label ?? nothing}>
        <a class=${item ?? nothing} href="/"
          >${EntityIcon({ kind: 'latest', size: 'md', class: 'text-current' })}${t.nav.latestTitle}</a
        ><a class=${item ?? nothing} href="/help"
          >${EntityIcon({ kind: 'help', size: 'md', class: 'text-current' })}${t.nav.help}</a
        >
      </nav>
      ${
        props.signedIn
          ? null
          : html`<button type="button" class=${item ?? nothing} data-account-action="open-sign-up">
              ${Icon({ svg: UserPlus })}${t.account.signUp}
            </button>`
      }
      <div class="mt-1 border-t pt-1">
        <div class="text-muted-foreground px-2 pt-1.5 pb-1 text-xs">${t.language.menuTitle}</div>
        ${languageLinksTemplate(languageChoices({ current: props.current, path: props.path }))}
      </div>
    `,
  });
}

/** A page path without its `lang` query: once a language is picked, the link's own one should not override it. */
function withoutLang(path: string): string {
  const url = new URL(path, 'https://leaderboard.invalid');
  url.searchParams.delete('lang');
  return `${url.pathname}${url.search}`;
}

/**
 * Where this page sits: … › this page (the last step is not a link). The site name in the header is the way home, so the
 * trail does not repeat it. It is the header's second row, so it stays on one line rather than wrapping the sticky header
 * taller: the steps before this page give way first.
 */
function Breadcrumbs(props: { crumbs: Crumb[] }, messages: Messages) {
  const t = messages;
  const trail = props.crumbs;
  return html`<nav class="breadcrumb" aria-label=${t.nav.breadcrumb ?? nothing}>
    <ol class="text-muted-foreground flex-nowrap gap-1.5 text-sm">
      ${trail.map((crumb, index) => {
        const last = index === trail.length - 1;
        return html`${
            index > 0 ? html`<li class="shrink-0" aria-hidden="true"><span aria-hidden="true">›</span></li>` : null
          }
          <li class=${last ? 'min-w-0' : 'min-w-0 shrink-[4]'}>
            ${
              last || crumb.href === undefined
                ? html`<span
                    class="text-foreground inline-flex max-w-[40ch] min-w-0 items-center gap-1"
                    aria-current=${(last ? 'page' : undefined) ?? nothing}
                    >${crumb.kind !== undefined ? EntityIcon({ kind: crumb.kind, size: 'sm' }) : null}<span
                      class="truncate"
                      >${crumb.label}</span
                    ></span
                  >`
                : html`<a
                    class="hover:text-foreground inline-flex max-w-[40ch] min-w-0 items-center gap-1"
                    href=${crumb.href ?? nothing}
                    >${crumb.kind !== undefined ? EntityIcon({ kind: crumb.kind, size: 'sm' }) : null}<span
                      class="truncate"
                      >${crumb.label}</span
                    ></a
                  >`
            }
          </li>`;
      })}
    </ol>
  </nav>`;
}

/** The heading block of a page. */
export function PageHeader(props: { title: PageContent; kind?: EntityKind; children?: PageContent }) {
  return html`<div class="space-y-1">
    <h1 class="flex items-center gap-2 text-2xl font-semibold tracking-tight break-words">
      ${props.kind !== undefined ? EntityIcon({ kind: props.kind, size: 'lg' }) : null}<span class="min-w-0"
        >${props.title}</span
      >
    </h1>
    ${
      props.children !== undefined
        ? html`<p class="text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
            ${props.children}
          </p>`
        : null
    }
  </div>`;
}

/** The shell of every Leaderboard page: head with sharing tags, header, and the page body. */
export function Layout(props: { meta: PageMeta; children: PageContent }) {
  const t = messagesFor(props.meta.locale);
  const fullTitle = `${props.meta.title} · ${t.site.name}`;
  // Link previews need an absolute image URL.
  const image = {
    url: new URL(props.meta.image?.path ?? ICONS.ogDefault.path, props.meta.url).href,
    alt: props.meta.image?.alt ?? t.site.previewAlt,
  };
  return html`<html lang=${props.meta.locale ?? nothing}>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${fullTitle}</title>
      <meta name="description" content=${props.meta.description ?? nothing} />
      ${props.meta.noindex === true ? html`<meta name="robots" content="noindex" />` : null}
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="Be-Music Leaderboard" />
      <meta property="og:title" content=${fullTitle ?? nothing} />
      <meta property="og:description" content=${props.meta.description ?? nothing} />
      <meta property="og:url" content=${props.meta.url ?? nothing} />
      <meta property="og:image" content=${image.url ?? nothing} />
      <meta property="og:image:width" content=${String(CARD_WIDTH)} />
      <meta property="og:image:height" content=${String(CARD_HEIGHT)} />
      <meta property="og:image:alt" content=${image.alt ?? nothing} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content=${fullTitle ?? nothing} />
      <meta name="twitter:description" content=${props.meta.description ?? nothing} />
      <meta name="twitter:image" content=${image.url ?? nothing} />
      <meta name="twitter:image:alt" content=${image.alt ?? nothing} />
      ${unsafeHTML(`<script>${COLOR_SCHEME_SCRIPT}</script>`)}${unsafeHTML(`<script>${TOOLTIP_SCRIPT}</script>`)}
      <link rel="stylesheet" href=${STYLESHEET_PATH ?? nothing} />
      <meta name="htmx-config" content="includeIndicatorCSS:false" />
      <script src=${CLIENT_SCRIPT_PATH ?? nothing} defer></script>
      ${unsafeHTML(`<script type="speculationrules">${speculationRules()}</script>`)}
      <link rel="icon" type="image/svg+xml" href=${ICON_LINKS.favicon ?? nothing} />
      <link rel="apple-touch-icon" href=${ICON_LINKS.appleTouch ?? nothing} />
      <link rel="manifest" href=${ICON_LINKS.manifest ?? nothing} />
      <meta name="theme-color" content="#0a0e18" />
    </head>
    <body class="bg-background text-foreground min-h-screen antialiased">
      <header
        id=${SITE_HEADER_ID ?? nothing}
        class="bg-background/90 sticky top-0 z-40 border-b backdrop-blur [view-transition-name:site-header]"
      >
        <div class="mx-auto flex max-w-5xl items-center gap-x-3 px-4 py-2.5 sm:gap-x-6">
          <div class="flex shrink-0 items-center gap-1">
            <a href="/" class="font-semibold tracking-tight whitespace-nowrap">Be-Music Leaderboard</a
            ><span class="badge" data-variant="outline">Beta</span>
          </div>
          <nav
            class="text-muted-foreground hidden items-center gap-4 text-sm sm:flex"
            aria-label=${t.nav.label ?? nothing}
          >
            <a
              class="hover:text-foreground inline-flex items-center gap-1.5 whitespace-nowrap"
              href="/"
              title=${t.nav.latestTitle ?? nothing}
              >${EntityIcon({ kind: 'latest', size: 'md', class: 'text-current' })}<span class="hidden sm:inline"
                >${t.nav.latest}</span
              ></a
            >
          </nav>
          <div class="ms-auto flex items-center gap-1 whitespace-nowrap sm:gap-2">
            ${RulesetMenu({ current: props.meta.ruleset, path: props.meta.path }, t)}<a
              class="btn hidden sm:inline-flex"
              data-size="sm"
              data-variant="ghost"
              href="/help"
              title=${t.nav.helpTitle ?? nothing}
              aria-label=${t.nav.help ?? nothing}
              >${EntityIcon({ kind: 'help', size: 'md', class: 'text-current' })}</a
            >${AccountMenu({ viewer: props.meta.viewer }, t)}<a
              class="btn"
              data-size="sm"
              href=${playerAppHref(props.meta.url) ?? nothing}
              title=${t.nav.playTitle ?? nothing}
              aria-label=${t.nav.play ?? nothing}
              >${Icon({ svg: Play })}<span class="hidden md:inline">${t.nav.play}</span></a
            >${LanguageMenu({ current: props.meta.locale, path: props.meta.path }, t)}${NavMenu(
              { current: props.meta.locale, path: props.meta.path, signedIn: props.meta.viewer !== null },
              t,
            )}
          </div>
        </div>
        ${
          props.meta.crumbs.length > 0
            ? html`<div class="bg-muted/60 border-t">
                <div class="mx-auto max-w-5xl px-4 py-2">${Breadcrumbs({ crumbs: props.meta.crumbs }, t)}</div>
              </div>`
            : null
        }<be-music-status
          class="text-destructive mx-auto max-w-5xl px-4 pb-3 text-sm"
          data-account-status
          role="status"
          hidden
        ></be-music-status>
      </header>
      <main class="mx-auto max-w-5xl space-y-6 px-4 py-8">${props.children}</main>
      ${serviceFooterTemplate({
        current: 'leaderboard',
        hostname: new URL(props.meta.url).hostname,
        navLabel: props.meta.locale === 'ja' ? 'サービス' : 'Services',
        siteHTML: renderHTML(leaderboardSiteFooter(t)),
        copyright: t.footer.copyright,
        buildInfo: props.meta.buildInfo,
        locale: props.meta.locale,
      })}
    </body>
  </html>`;
}
