/** @jsxImportSource hono/jsx */
import type { Child } from 'hono/jsx';
import type { PlaylogRulesetId } from '@be-music/player/playlog';
import { RULESET_LABELS } from './format.ts';
import { LOCALE_NAMES, LOCALES, MessagesContext, messagesFor, useMessages, type Locale } from './i18n/index.ts';
import { helpHref } from './help-topics.ts';
import { RULESET_IDS } from '../rulesets.ts';
import { CLIENT_SCRIPT_PATH } from './client-script.ts';
import { Avatar, playerHref } from './components/basics.tsx';
import { EntityIcon, type EntityKind } from './components/entity-icon.tsx';
import { Icon } from './components/icon.tsx';
import {
  Check,
  ChevronDown,
  ExternalLink,
  KeyRound,
  Languages,
  LogOut,
  Menu,
  Play,
  Scale,
  UserPlus,
} from 'lucide-static';
import { CARD_HEIGHT, CARD_WIDTH } from '../cards.ts';
import { ICON_LINKS } from './icons.ts';
import { ICONS } from './icons.generated.ts';
import type { Viewer } from './viewer.ts';
import { LOCAL_TIME_SCRIPT } from './local-time.ts';
import { APP_CSS_HASH } from './styles.generated.ts';
import { speculationRules } from './speculation.ts';

/** Where the compiled stylesheet is served; the hash in the name lets browsers keep it forever. */
export const STYLESHEET_PATH = `/leaderboard/assets/app.${APP_CSS_HASH}.css`;

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
 * Tooltips of the info and help icons (components/play-info.tsx, components/help-tip.tsx). A mouse hovering an icon,
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
  title: string;
  description: string;
  /** The trail below "Leaderboard", ending with this page. */
  crumbs: Crumb[];
  /** Absolute URL of this page, for `og:url`. */
  url: string;
  /** Path and query of this page, where the ruleset switch comes back to. */
  path: string;
  /** The viewer's display ruleset, highlighted in the switch. */
  ruleset: PlaylogRulesetId;
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
 * The frame of the header's menus. They sit in the header's no-wrap row, so they turn wrapping back on (Japanese at
 * phrase boundaries where the browser can), and they never grow wider than the screen less a margin on each side.
 */
const HEADER_MENU_CLASS =
  'bg-popover text-popover-foreground max-w-[calc(100vw-2rem)] rounded-lg border p-1 text-sm whitespace-normal [word-break:auto-phrase] shadow-md';

/**
 * Below the button, right edges aligned; the other way round when that would run off the screen, and centred under the
 * button, a gutter in from the edges, when neither fits (`--header-menu-span` in app.css).
 */
function headerMenuStyle(anchor: string): string {
  return `position-anchor:${anchor};inset:auto;margin:6px 0;position-area:block-end span-inline-start;position-try-fallbacks:flip-inline,--header-menu-span`;
}

/**
 * The header's account area. Signed out: Sign in (a passkey) and Sign up (a handle and a name, then a passkey). Signed
 * in: the player's icon, opening a menu with their page, Settings and Sign out. The buttons are wired by the client
 * script (client/main.ts); `data-account-status` shows what went wrong.
 */
function AccountMenu(props: { viewer: Viewer | null }) {
  const t = useMessages();
  const viewer = props.viewer;
  if (viewer === null) {
    return (
      <div class="flex items-center gap-1">
        <button type="button" class="btn" data-size="sm" data-variant="ghost" data-account-action="open-sign-in">
          {t.account.signIn}
        </button>
        <button
          type="button"
          class="btn hidden sm:inline-flex"
          data-size="sm"
          data-variant="outline"
          data-account-action="open-sign-up"
        >
          {t.account.signUp}
        </button>
        <SignInDialog />
        <SignUpDialog />
      </div>
    );
  }
  return (
    <div class="relative">
      <button
        type="button"
        class="btn"
        data-size="sm"
        data-variant="ghost"
        popovertarget="account-menu"
        aria-label={t.account.accountOf(viewer.handle)}
        style="anchor-name:--account-menu"
      >
        <Avatar src={viewer.avatarUrl} size={24} />
        <span class="hidden max-w-[12ch] truncate sm:inline">@{viewer.handle}</span>
        <Icon svg={ChevronDown} class="text-muted-foreground" />
      </button>
      <div
        id="account-menu"
        popover="auto"
        class={`${HEADER_MENU_CLASS} w-56`}
        style={headerMenuStyle('--account-menu')}
      >
        <div class="border-b px-2 py-2">
          <div class="truncate font-medium">{viewer.displayName}</div>
          <div class="text-muted-foreground truncate text-xs">@{viewer.handle}</div>
        </div>
        <a class="hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5" href={playerHref(viewer.handle)}>
          <EntityIcon kind="player" size="md" class="text-current" />
          {t.account.yourPage}
        </a>
        <a class="hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5" href="/leaderboard/settings">
          <EntityIcon kind="settings" size="md" class="text-current" />
          {t.account.settings}
        </a>
        <button
          type="button"
          class="hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start"
          data-account-action="sign-out"
        >
          <Icon svg={LogOut} />
          {t.account.signOut}
        </button>
      </div>
    </div>
  );
}

/** The frame of the account dialogs: a centred card over a dimmed page. */
const DIALOG_CLASS =
  'bg-background text-foreground m-auto w-[min(24rem,calc(100vw-2rem))] rounded-xl border p-6 shadow-lg backdrop:bg-black/50';

/** Google's "G", in its four colours. */
const GOOGLE_LOGO = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z"/></svg>`;

/** Discord's mark, in its blurple. */
const DISCORD_LOGO = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="#5865F2" d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.3 18.3 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5A20.3 20.3 0 0 0 .1 18a19.9 19.9 0 0 0 6 3l1.3-2.1a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.8 19.8 0 0 0 6-3 20.2 20.2 0 0 0-3.6-13.6zM8 15.3c-1.2 0-2.2-1.1-2.2-2.4 0-1.4 1-2.5 2.2-2.5s2.2 1.1 2.2 2.5c0 1.3-1 2.4-2.2 2.4zm8 0c-1.2 0-2.2-1.1-2.2-2.4 0-1.4 1-2.5 2.2-2.5s2.2 1.1 2.2 2.5c0 1.3-1 2.4-2.2 2.4z"/></svg>`;

/**
 * Google and Discord, shown where they will go but not usable yet: the buttons are disabled and say they are in
 * development. Sign-in with a provider turns on once its secrets are set (src/auth.ts).
 */
function ProviderButtons(props: { action: 'sign-in' | 'sign-up' }) {
  const t = useMessages();
  const label = (provider: string) =>
    props.action === 'sign-in' ? t.dialogs.signInWith(provider) : t.dialogs.signUpWith(provider);
  return (
    <div class="grid gap-2">
      {[
        { name: 'Google', logo: GOOGLE_LOGO },
        { name: 'Discord', logo: DISCORD_LOGO },
      ].map((provider) => (
        <button
          type="button"
          class="btn w-full justify-start"
          data-variant="outline"
          disabled
          aria-disabled="true"
          title={t.dialogs.providerTitle(label(provider.name))}
        >
          <span
            class="inline-flex size-4 shrink-0 [&>svg]:size-4"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: provider.logo }}
          />
          {label(provider.name)}
          <span class="badge ms-auto" data-variant="secondary">
            {t.dialogs.inDevelopment}
          </span>
        </button>
      ))}
    </div>
  );
}

/** A rule with a word in it, between the providers and the passkey. */
function OrDivider(props: { label: string }) {
  return (
    <div class="text-muted-foreground flex items-center gap-3 text-xs" role="separator">
      <span class="bg-border h-px flex-1" />
      {props.label}
      <span class="bg-border h-px flex-1" />
    </div>
  );
}

/** Sign-in: a passkey now; Google and Discord in development. */
function SignInDialog() {
  const t = useMessages();
  return (
    <dialog id="sign-in" aria-labelledby="sign-in-title" class={DIALOG_CLASS}>
      <div class="space-y-4">
        <header class="space-y-1">
          <h2 id="sign-in-title" class="text-lg font-semibold">
            {t.dialogs.signInTitle}
          </h2>
          <p class="text-muted-foreground text-sm">{t.dialogs.signInLead}</p>
        </header>
        <button type="button" class="btn w-full" data-account-action="sign-in">
          <Icon svg={KeyRound} />
          {t.dialogs.signInWithPasskey}
        </button>
        <OrDivider label={t.dialogs.or} />
        <ProviderButtons action="sign-in" />
        <p class="text-destructive text-sm" data-sign-in-status role="status" hidden />
        <footer class="flex items-center justify-between gap-2">
          <button type="button" class="btn px-0" data-size="sm" data-variant="link" data-account-action="open-sign-up">
            {t.dialogs.noAccount}
          </button>
          <button type="button" class="btn" data-size="sm" data-variant="ghost" data-account-action="close-dialogs">
            {t.dialogs.cancel}
          </button>
        </footer>
      </div>
    </dialog>
  );
}

/**
 * Sign-up: a handle and a display name. The client script signs in anonymously, saves them, then asks the browser for
 * a passkey, which claims the account (docs/leaderboard.md section 3).
 */
function SignUpDialog() {
  const t = useMessages();
  return (
    <dialog id="sign-up" aria-labelledby="sign-up-title" class={DIALOG_CLASS}>
      <form class="space-y-4" data-sign-up-form method="dialog">
        <header class="space-y-1">
          <h2 id="sign-up-title" class="text-lg font-semibold">
            {t.dialogs.signUpTitle}
          </h2>
          <p class="text-muted-foreground text-sm">{t.dialogs.signUpLead}</p>
        </header>
        <ProviderButtons action="sign-up" />
        <OrDivider label={t.dialogs.orWithPasskey} />
        <div class="grid gap-2">
          <label class="label" for="sign-up-handle">
            {t.dialogs.handle}
          </label>
          <input
            class="input"
            id="sign-up-handle"
            name="handle"
            required
            minlength={3}
            maxlength={15}
            pattern="[A-Za-z0-9_]{3,15}"
            autocomplete="username webauthn"
            spellcheck={false}
          />
          <p class="text-muted-foreground text-xs">{t.dialogs.handleHint}</p>
        </div>
        <div class="grid gap-2">
          <label class="label" for="sign-up-name">
            {t.dialogs.name}
          </label>
          <input class="input" id="sign-up-name" name="displayName" required maxlength={64} autocomplete="nickname" />
          <p class="text-muted-foreground text-xs">{t.dialogs.nameHint}</p>
        </div>
        <p class="text-destructive text-sm" data-sign-up-status role="status" hidden />
        <footer class="flex justify-end gap-2">
          <button type="button" class="btn" data-variant="ghost" data-account-action="close-dialogs">
            {t.dialogs.cancel}
          </button>
          <button type="submit" class="btn">
            {t.dialogs.createPasskey}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

/** The be-music source repository. */
export const SOURCE_URL = 'https://github.com/nulltask/be-music';

const FOOTER_LINK = 'hover:text-foreground inline-flex items-center gap-1 underline-offset-4 hover:underline';

/**
 * The scoring rules every figure on the pages is shown under, as a menu in the header next to the account: the
 * current ruleset on the button, the three to pick from in its popover. A choice is kept in a cookie
 * (`/leaderboard/ruleset/:id`) and brings the viewer back to the page.
 */
function RulesetMenu(props: { current: PlaylogRulesetId; path: string }) {
  const t = useMessages();
  const name = (id: PlaylogRulesetId) => t.rules.name(RULESET_LABELS[id] ?? id);
  return (
    <div class="relative">
      <button
        type="button"
        class="btn"
        data-size="sm"
        data-variant="ghost"
        popovertarget="ruleset-menu"
        aria-label={t.rules.menuAria(name(props.current))}
        title={t.rules.menuTitle}
        style="anchor-name:--ruleset-menu"
      >
        <Icon svg={Scale} class="text-muted-foreground" />
        <span>{RULESET_LABELS[props.current]}</span>
        <span class="hidden md:inline">{t.rules.word}</span>
        <Icon svg={ChevronDown} class="text-muted-foreground" />
      </button>
      <div
        id="ruleset-menu"
        popover="auto"
        class={`${HEADER_MENU_CLASS} w-72`}
        style={headerMenuStyle('--ruleset-menu')}
      >
        <div class="text-muted-foreground px-2 pt-1.5 pb-1 text-xs">{t.rules.showUnder}</div>
        {RULESET_IDS.map((id) => (
          <a
            class="hover:bg-muted flex items-start gap-2 rounded-md px-2 py-1.5"
            href={`/leaderboard/ruleset/${id}?next=${encodeURIComponent(props.path)}`}
            aria-current={id === props.current ? 'true' : undefined}
          >
            <span class={`mt-0.5 ${id === props.current ? '' : 'invisible'}`}>
              <Icon svg={Check} />
            </span>
            <span>
              <span class="block font-medium">{name(id)}</span>
              <span class="text-muted-foreground block text-xs">{t.rules.notes[id]}</span>
            </span>
          </a>
        ))}
        <p class="text-muted-foreground border-t px-2 pt-2 pb-1.5 text-xs">
          {t.rules.meaning}{' '}
          <a class="text-foreground underline underline-offset-4" href={helpHref('rules')}>
            {t.help.more}
          </a>
        </p>
      </div>
    </div>
  );
}

/**
 * The language menu next to the ruleset menu: the page's language on the button, the others in its popover. A choice is
 * kept in a cookie (`/leaderboard/lang/:locale`) and brings the viewer back to the page.
 */
function LanguageMenu(props: { current: Locale; path: string }) {
  const t = useMessages();
  return (
    <div class="relative hidden sm:block">
      <button
        type="button"
        class="btn"
        data-size="sm"
        data-variant="ghost"
        popovertarget="language-menu"
        aria-label={t.language.menuAria(LOCALE_NAMES[props.current])}
        title={t.language.menuTitle}
        style="anchor-name:--language-menu"
      >
        {/* Just the icon: the header has little room, and the language's name is in the menu and the label. */}
        <Icon svg={Languages} class="text-muted-foreground" />
      </button>
      <div
        id="language-menu"
        popover="auto"
        class={`${HEADER_MENU_CLASS} w-44`}
        style={headerMenuStyle('--language-menu')}
      >
        <LanguageLinks current={props.current} path={props.path} />
      </div>
    </div>
  );
}

/** The languages to pick from, the page's own checked: the language menu's items, and the phone menu's last part. */
function LanguageLinks(props: { current: Locale; path: string }) {
  return (
    <>
      {LOCALES.map((locale) => (
        <a
          class="hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5"
          href={`/leaderboard/lang/${locale}?next=${encodeURIComponent(withoutLang(props.path))}`}
          aria-current={locale === props.current ? 'true' : undefined}
          lang={locale}
        >
          <span class={locale === props.current ? '' : 'invisible'}>
            <Icon svg={Check} />
          </span>
          {LOCALE_NAMES[locale]}
        </a>
      ))}
    </>
  );
}

/**
 * The header's menu on a phone, where only the main buttons (ruleset, account, Play) fit in the row: the navigation,
 * Help, Sign up when signed out, and the language, behind one button at the right edge. From `sm` up the header shows
 * all of them itself and this button is hidden.
 */
function NavMenu(props: { current: Locale; path: string; signedIn: boolean }) {
  const t = useMessages();
  const item = 'hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start';
  return (
    <div class="relative sm:hidden">
      <button
        type="button"
        class="btn"
        data-size="sm"
        data-variant="ghost"
        popovertarget="nav-menu"
        aria-label={t.nav.menu}
        title={t.nav.menu}
        style="anchor-name:--nav-menu"
      >
        <Icon svg={Menu} />
      </button>
      <div id="nav-menu" popover="auto" class={`${HEADER_MENU_CLASS} w-56`} style={headerMenuStyle('--nav-menu')}>
        <nav aria-label={t.nav.label}>
          <a class={item} href="/leaderboard">
            <EntityIcon kind="latest" size="md" class="text-current" />
            {t.nav.latestTitle}
          </a>
          <a class={item} href="/leaderboard/help">
            <EntityIcon kind="help" size="md" class="text-current" />
            {t.nav.help}
          </a>
        </nav>
        {props.signedIn ? null : (
          <button type="button" class={item} data-account-action="open-sign-up">
            <Icon svg={UserPlus} />
            {t.account.signUp}
          </button>
        )}
        <div class="mt-1 border-t pt-1">
          <div class="text-muted-foreground px-2 pt-1.5 pb-1 text-xs">{t.language.menuTitle}</div>
          <LanguageLinks current={props.current} path={props.path} />
        </div>
      </div>
    </div>
  );
}

/** A page path without its `lang` query: once a language is picked, the link's own one should not override it. */
function withoutLang(path: string): string {
  const url = new URL(path, 'https://leaderboard.invalid');
  url.searchParams.delete('lang');
  return `${url.pathname}${url.search}`;
}

/**
 * Where this page sits: Leaderboard › … › this page (the last step is not a link). It is the header's second row, so it
 * stays on one line rather than wrapping the sticky header taller: the steps in between give way first, then this page;
 * the short root step keeps its width.
 */
function Breadcrumbs(props: { crumbs: Crumb[] }) {
  const t = useMessages();
  const trail: Crumb[] = [{ label: t.site.leaderboard, href: '/leaderboard' }, ...props.crumbs];
  return (
    <nav class="breadcrumb" aria-label={t.nav.breadcrumb}>
      <ol class="text-muted-foreground flex-nowrap gap-1.5 text-sm">
        {trail.map((crumb, index) => {
          const last = index === trail.length - 1;
          return (
            <>
              {index > 0 ? (
                <li class="shrink-0" aria-hidden="true">
                  <span aria-hidden="true">›</span>
                </li>
              ) : null}
              <li class={index === 0 ? 'shrink-0' : last ? 'min-w-0' : 'min-w-0 shrink-[4]'}>
                {last || crumb.href === undefined ? (
                  <span
                    class="text-foreground inline-flex max-w-[40ch] min-w-0 items-center gap-1"
                    aria-current={last ? 'page' : undefined}
                  >
                    {crumb.kind !== undefined ? <EntityIcon kind={crumb.kind} size="sm" /> : null}
                    <span class="truncate">{crumb.label}</span>
                  </span>
                ) : (
                  <a
                    class="hover:text-foreground inline-flex max-w-[40ch] min-w-0 items-center gap-1"
                    href={crumb.href}
                  >
                    {crumb.kind !== undefined ? <EntityIcon kind={crumb.kind} size="sm" /> : null}
                    <span class="truncate">{crumb.label}</span>
                  </a>
                )}
              </li>
            </>
          );
        })}
      </ol>
    </nav>
  );
}

/** The heading block of a page. */
export function PageHeader(props: { title: Child; kind?: EntityKind; children?: Child }) {
  return (
    <div class="space-y-1">
      <h1 class="flex items-center gap-2 text-2xl font-semibold tracking-tight break-words">
        {props.kind !== undefined ? <EntityIcon kind={props.kind} size="lg" /> : null}
        <span class="min-w-0">{props.title}</span>
      </h1>
      {props.children !== undefined ? (
        <p class="text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">{props.children}</p>
      ) : null}
    </div>
  );
}

/** The shell of every Leaderboard page: head with sharing tags, header, and the page body. */
export function Layout(props: { meta: PageMeta; children: Child }) {
  const t = messagesFor(props.meta.locale);
  const fullTitle = `${props.meta.title} · ${t.site.name}`;
  // Link previews need an absolute image URL.
  const image = {
    url: new URL(props.meta.image?.path ?? ICONS.ogDefault.path, props.meta.url).href,
    alt: props.meta.image?.alt ?? t.site.previewAlt,
  };
  return (
    <html lang={props.meta.locale}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{fullTitle}</title>
        <meta name="description" content={props.meta.description} />
        {props.meta.noindex === true ? <meta name="robots" content="noindex" /> : null}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="be-music Leaderboard" />
        <meta property="og:title" content={fullTitle} />
        <meta property="og:description" content={props.meta.description} />
        <meta property="og:url" content={props.meta.url} />
        <meta property="og:image" content={image.url} />
        <meta property="og:image:width" content={String(CARD_WIDTH)} />
        <meta property="og:image:height" content={String(CARD_HEIGHT)} />
        <meta property="og:image:alt" content={image.alt} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={fullTitle} />
        <meta name="twitter:description" content={props.meta.description} />
        <meta name="twitter:image" content={image.url} />
        <meta name="twitter:image:alt" content={image.alt} />
        <script dangerouslySetInnerHTML={{ __html: COLOR_SCHEME_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: TOOLTIP_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: LOCAL_TIME_SCRIPT }} />
        <link rel="stylesheet" href={STYLESHEET_PATH} />
        <script src={CLIENT_SCRIPT_PATH} defer />
        {/* Fetches a page while its link is hovered (speculation.ts), so the navigation starts from a warm response. */}
        <script type="speculationrules" dangerouslySetInnerHTML={{ __html: speculationRules() }} />
        <link rel="icon" type="image/svg+xml" href={ICON_LINKS.favicon} />
        <link rel="apple-touch-icon" href={ICON_LINKS.appleTouch} />
        <link rel="manifest" href={ICON_LINKS.manifest} />
        <meta name="theme-color" content="#0a0e18" />
      </head>
      <body class="bg-background text-foreground min-h-screen antialiased">
        {/* Every component on the page reads the page's language from here (`useMessages`). */}
        <MessagesContext.Provider value={t}>
          {/* Stays at the top while the page scrolls, over the rows (their links sit at z-10), the page showing faintly
            through. Named for the cross-page view transition (app.css): it stays put while the page below it changes. */}
          <header class="bg-background/90 sticky top-0 z-40 border-b backdrop-blur [view-transition-name:site-header]">
            <div class="mx-auto flex max-w-5xl items-center gap-x-3 px-4 py-2.5 sm:gap-x-6">
              <a href="/leaderboard" class="shrink-0 font-semibold tracking-tight">
                be-music <span class="text-muted-foreground hidden font-normal md:inline">Leaderboard</span>
              </a>
              <nav class="text-muted-foreground hidden items-center gap-4 text-sm sm:flex" aria-label={t.nav.label}>
                <a
                  class="hover:text-foreground inline-flex items-center gap-1.5 whitespace-nowrap"
                  href="/leaderboard"
                  title={t.nav.latestTitle}
                >
                  <EntityIcon kind="latest" size="md" class="text-current" />
                  <span class="hidden sm:inline">{t.nav.latest}</span>
                </a>
              </nav>
              <div class="ms-auto flex items-center gap-1 whitespace-nowrap sm:gap-2">
                <RulesetMenu current={props.meta.ruleset} path={props.meta.path} />
                {/* Not on a phone, where the header has no room: it is in the phone menu (NavMenu) there. */}
                <a
                  class="btn hidden sm:inline-flex"
                  data-size="sm"
                  data-variant="ghost"
                  href="/leaderboard/help"
                  title={t.nav.helpTitle}
                  aria-label={t.nav.help}
                >
                  <EntityIcon kind="help" size="md" class="text-current" />
                </a>
                <AccountMenu viewer={props.meta.viewer} />
                <a class="btn" data-size="sm" href="/" title={t.nav.playTitle} aria-label={t.nav.play}>
                  <Icon svg={Play} />
                  <span class="hidden md:inline">{t.nav.play}</span>
                </a>
                {/* Last, at the right edge: switching the language changes the other labels' widths, not its place. */}
                <LanguageMenu current={props.meta.locale} path={props.meta.path} />
                {/* In its place on a phone: the menu holding what the row has no room for. */}
                <NavMenu current={props.meta.locale} path={props.meta.path} signedIn={props.meta.viewer !== null} />
              </div>
            </div>
            {/* The second row: where this page sits, kept in view with the header. */}
            <div class="mx-auto max-w-5xl px-4 pb-2.5">
              <Breadcrumbs crumbs={props.meta.crumbs} />
            </div>
            <p class="text-destructive mx-auto max-w-5xl px-4 pb-3 text-sm" data-account-status role="status" hidden />
          </header>
          <main class="mx-auto max-w-5xl space-y-6 px-4 py-8">{props.children}</main>
          <footer class="text-muted-foreground mx-auto max-w-5xl space-y-2 border-t px-4 pt-4 pb-8 text-xs">
            {/* What is about the site rather than in it: its story, help, the API (a tool page of its own, so it opens
              beside the Leaderboard) and the source. */}
            <nav class="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label={t.footer.label}>
              <a class={FOOTER_LINK} href="/leaderboard/about">
                {t.footer.about}
              </a>
              <a class={FOOTER_LINK} href="/leaderboard/help">
                {t.footer.help}
              </a>
              <a class={FOOTER_LINK} href="/leaderboard/api" target="_blank" rel="noopener" title={t.footer.apiTitle}>
                {t.footer.api}
                <Icon svg={ExternalLink} class="[&>svg]:size-3" />
              </a>
              <a
                class={FOOTER_LINK}
                href={SOURCE_URL}
                target="_blank"
                rel="noopener noreferrer"
                title={t.footer.githubTitle}
              >
                {t.footer.github}
                <Icon svg={ExternalLink} class="[&>svg]:size-3" />
              </a>
            </nav>
            <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <span>{t.footer.beta}</span>
              {/* The holder and licence of the be-music repository (LICENSE). */}
              <span>{t.footer.copyright}</span>
            </div>
          </footer>
        </MessagesContext.Provider>
      </body>
    </html>
  );
}
