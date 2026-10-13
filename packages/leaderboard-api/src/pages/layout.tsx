/** @jsxImportSource hono/jsx */
import type { Child } from 'hono/jsx';
import type { PlaylogRulesetId } from '@be-music/player/playlog';
import { RULESET_LABELS, RULESET_MEANING } from './format.ts';
import { RULESET_IDS } from '../rulesets.ts';
import { CLIENT_SCRIPT_PATH } from './client-script.ts';
import { Avatar, playerHref } from './components/basics.tsx';
import { EntityIcon, type EntityKind } from './components/entity-icon.tsx';
import { Icon } from './components/icon.tsx';
import { ChevronDown, KeyRound, LogOut, Play } from 'lucide-static';
import { CARD_HEIGHT, CARD_WIDTH } from '../cards.ts';
import { ICON_LINKS } from './icons.ts';
import { ICONS } from './icons.generated.ts';
import type { Viewer } from './viewer.ts';
import { LOCAL_TIME_SCRIPT } from './local-time.ts';
import { APP_CSS_HASH } from './styles.generated.ts';

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
 * Tooltips of the info icons (components/play-info.tsx). A mouse hovering an icon, or the keyboard focusing it, shows
 * its card; leaving hides it. A click (or a tap) on a hovered card pins it instead of closing it; the Popover API then
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
  document.addEventListener('toggle', (event) => {
    const card = event.target;
    if (!(card instanceof HTMLElement) || !card.hasAttribute('data-tooltip')) return;
    if (event.newState === 'open') place(card);
    else delete card.dataset.hovered;
  }, true);
  document.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'mouse') show(cardOf(event.target)[1]);
  });
  document.addEventListener('pointerout', (event) => {
    const [trigger, card] = cardOf(event.target);
    if (event.pointerType === 'mouse' && trigger && !trigger.contains(event.relatedTarget)) hide(card);
  });
  document.addEventListener('focusin', (event) => {
    if (event.target instanceof Element && event.target.matches(':focus-visible')) show(cardOf(event.target)[1]);
  });
  document.addEventListener('focusout', (event) => hide(cardOf(event.target)[1]));
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
  /** The signed-in player, or null. */
  viewer: Viewer | null;
  /** The picture link previews show (a path on this site); the site's default card when absent. */
  image?: { path: string; alt: string };
}

/**
 * The header's account area. Signed out: Sign in (a passkey) and Sign up (a handle and a name, then a passkey). Signed
 * in: the player's icon, opening a menu with their page, Settings and Sign out. The buttons are wired by the client
 * script (client/main.ts); `data-account-status` shows what went wrong.
 */
function AccountMenu(props: { viewer: Viewer | null }) {
  const viewer = props.viewer;
  if (viewer === null) {
    return (
      <div class="flex items-center gap-1">
        <button type="button" class="btn" data-size="sm" data-variant="ghost" data-account-action="open-sign-in">
          Sign in
        </button>
        <button type="button" class="btn" data-size="sm" data-variant="outline" data-account-action="open-sign-up">
          Sign up
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
        aria-label={`Account of @${viewer.handle}`}
        style="anchor-name:--account-menu"
      >
        <Avatar src={viewer.avatarUrl} size={24} />
        <span class="hidden max-w-[12ch] truncate sm:inline">@{viewer.handle}</span>
        <Icon svg={ChevronDown} class="text-muted-foreground" />
      </button>
      <div
        id="account-menu"
        popover="auto"
        class="bg-popover text-popover-foreground w-56 rounded-lg border p-1 text-sm shadow-md"
        style="position-anchor:--account-menu;inset:auto;margin:6px 0;position-area:block-end span-inline-start;position-try-fallbacks:flip-inline"
      >
        <div class="border-b px-2 py-2">
          <div class="truncate font-medium">{viewer.displayName}</div>
          <div class="text-muted-foreground truncate text-xs">@{viewer.handle}</div>
        </div>
        <a class="hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5" href={playerHref(viewer.handle)}>
          <EntityIcon kind="player" size="md" class="text-current" />
          Your page
        </a>
        <a class="hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5" href="/leaderboard/settings">
          <EntityIcon kind="settings" size="md" class="text-current" />
          Settings
        </a>
        <button
          type="button"
          class="hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start"
          data-account-action="sign-out"
        >
          <Icon svg={LogOut} />
          Sign out
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
function ProviderButtons(props: { verb: string }) {
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
          title={`${props.verb} with ${provider.name} is in development`}
        >
          <span
            class="inline-flex size-4 shrink-0 [&>svg]:size-4"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: provider.logo }}
          />
          {props.verb} with {provider.name}
          <span class="badge ms-auto" data-variant="secondary">
            In development
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
  return (
    <dialog id="sign-in" aria-labelledby="sign-in-title" class={DIALOG_CLASS}>
      <div class="space-y-4">
        <header class="space-y-1">
          <h2 id="sign-in-title" class="text-lg font-semibold">
            Sign in
          </h2>
          <p class="text-muted-foreground text-sm">Use the passkey of your Leaderboard account.</p>
        </header>
        <button type="button" class="btn w-full" data-account-action="sign-in">
          <Icon svg={KeyRound} />
          Sign in with a passkey
        </button>
        <OrDivider label="or" />
        <ProviderButtons verb="Sign in" />
        <p class="text-destructive text-sm" data-sign-in-status role="status" hidden />
        <footer class="flex items-center justify-between gap-2">
          <button type="button" class="btn px-0" data-size="sm" data-variant="link" data-account-action="open-sign-up">
            No account yet? Sign up
          </button>
          <button type="button" class="btn" data-size="sm" data-variant="ghost" data-account-action="close-dialogs">
            Cancel
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
  return (
    <dialog id="sign-up" aria-labelledby="sign-up-title" class={DIALOG_CLASS}>
      <form class="space-y-4" data-sign-up-form method="dialog">
        <header class="space-y-1">
          <h2 id="sign-up-title" class="text-lg font-semibold">
            Create your account
          </h2>
          <p class="text-muted-foreground text-sm">
            Pick a handle and a name. Your browser then makes a passkey for it.
          </p>
        </header>
        <ProviderButtons verb="Sign up" />
        <OrDivider label="or with a passkey" />
        <div class="grid gap-2">
          <label class="label" for="sign-up-handle">
            Handle
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
          <p class="text-muted-foreground text-xs">3 to 15 letters, digits or _. It names your page.</p>
        </div>
        <div class="grid gap-2">
          <label class="label" for="sign-up-name">
            Name
          </label>
          <input class="input" id="sign-up-name" name="displayName" required maxlength={64} autocomplete="nickname" />
          <p class="text-muted-foreground text-xs">Up to 32 characters, in any script. The rankings show it.</p>
        </div>
        <p class="text-destructive text-sm" data-sign-up-status role="status" hidden />
        <footer class="flex justify-end gap-2">
          <button type="button" class="btn" data-variant="ghost" data-account-action="close-dialogs">
            Cancel
          </button>
          <button type="submit" class="btn">
            Create passkey
          </button>
        </footer>
      </form>
    </dialog>
  );
}

/**
 * The display ruleset, for every page: a bar under the header, its start on the content's edge. Labelled "Scoring
 * rules", so the names do not read as the software the plays came from.
 */
function RulesetBar(props: { current: PlaylogRulesetId; path: string }) {
  return (
    <div class="bg-muted/40 border-b">
      <div class="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2">
        <span class="text-muted-foreground cursor-help text-xs" id="ruleset-switch-label" title={RULESET_MEANING}>
          Scoring rules
        </span>
        <div class="button-group" role="group" aria-labelledby="ruleset-switch-label">
          {RULESET_IDS.map((id) => (
            <a
              class="btn"
              data-size="sm"
              data-variant={id === props.current ? 'primary' : 'outline'}
              aria-current={id === props.current ? 'true' : undefined}
              href={`/leaderboard/ruleset/${id}?next=${encodeURIComponent(props.path)}`}
            >
              {RULESET_LABELS[id]}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Where this page sits: Leaderboard › … › this page (the last step is not a link). */
function Breadcrumbs(props: { crumbs: Crumb[] }) {
  const trail: Crumb[] = [{ label: 'Leaderboard', href: '/leaderboard' }, ...props.crumbs];
  return (
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <ol class="text-muted-foreground gap-1.5 text-sm">
        {trail.map((crumb, index) => {
          const last = index === trail.length - 1;
          return (
            <>
              {index > 0 ? (
                <li aria-hidden="true">
                  <span aria-hidden="true">›</span>
                </li>
              ) : null}
              <li>
                {last || crumb.href === undefined ? (
                  <span
                    class="text-foreground inline-flex max-w-[40ch] items-center gap-1"
                    aria-current={last ? 'page' : undefined}
                  >
                    {crumb.kind !== undefined ? <EntityIcon kind={crumb.kind} size="sm" /> : null}
                    <span class="truncate">{crumb.label}</span>
                  </span>
                ) : (
                  <a class="hover:text-foreground inline-flex max-w-[40ch] items-center gap-1" href={crumb.href}>
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
  const fullTitle = `${props.meta.title} · be-music Leaderboard`;
  // Link previews need an absolute image URL.
  const image = {
    url: new URL(props.meta.image?.path ?? ICONS.ogDefault.path, props.meta.url).href,
    alt: props.meta.image?.alt ?? 'be-music Leaderboard: rankings, replays and rivals for BMS players',
  };
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{fullTitle}</title>
        <meta name="description" content={props.meta.description} />
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
        <link rel="icon" type="image/svg+xml" href={ICON_LINKS.favicon} />
        <link rel="apple-touch-icon" href={ICON_LINKS.appleTouch} />
        <link rel="manifest" href={ICON_LINKS.manifest} />
        <meta name="theme-color" content="#0a0e18" />
      </head>
      <body class="bg-background text-foreground min-h-screen antialiased">
        <header class="border-b">
          <div class="mx-auto flex max-w-5xl items-center gap-x-4 px-4 py-2.5 sm:gap-x-6">
            <a href="/leaderboard" class="shrink-0 font-semibold tracking-tight">
              be-music <span class="text-muted-foreground hidden font-normal sm:inline">Leaderboard</span>
            </a>
            <nav class="text-muted-foreground flex items-center gap-4 text-sm" aria-label="Leaderboard">
              <a
                class="hover:text-foreground inline-flex items-center gap-1.5"
                href="/leaderboard"
                title="Latest plays"
              >
                <EntityIcon kind="latest" size="md" class="text-current" />
                <span class="hidden sm:inline">Latest</span>
              </a>
              <a class="hover:text-foreground inline-flex items-center gap-1.5" href="/leaderboard/api" title="API">
                <EntityIcon kind="api" size="md" class="text-current" />
                <span class="hidden sm:inline">API</span>
              </a>
            </nav>
            <div class="ms-auto flex items-center gap-2">
              <a class="btn" data-size="sm" href="/" title="Play in the browser">
                <Icon svg={Play} />
                Play
              </a>
              <AccountMenu viewer={props.meta.viewer} />
            </div>
          </div>
          <p class="text-destructive mx-auto max-w-5xl px-4 pb-3 text-sm" data-account-status role="status" hidden />
        </header>
        <RulesetBar current={props.meta.ruleset} path={props.meta.path} />
        <main class="mx-auto max-w-5xl space-y-6 px-4 py-8">
          <Breadcrumbs crumbs={props.meta.crumbs} />
          {props.children}
        </main>
        <footer class="text-muted-foreground mx-auto max-w-5xl px-4 pb-8 text-xs">
          Beta — rankings may be reset while scoring rules settle.
        </footer>
      </body>
    </html>
  );
}
