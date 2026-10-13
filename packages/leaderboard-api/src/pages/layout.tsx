/** @jsxImportSource hono/jsx */
import type { Child } from 'hono/jsx';
import type { PlaylogRulesetId } from '@be-music/player/playlog';
import { RULESET_LABELS } from './format.ts';
import { RULESETS } from './preferences.ts';
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

/** One step of the breadcrumb trail; the last one is the current page and has no link. */
export interface Crumb {
  label: string;
  href?: string;
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
}

/** Header switch of the display ruleset; it applies to every page. */
function RulesetSwitch(props: { current: PlaylogRulesetId; path: string }) {
  return (
    <div class="button-group sm:ms-auto" role="group" aria-label="Display ruleset">
      {RULESETS.map((id) => (
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
                  <span class="text-foreground max-w-[40ch] truncate" aria-current={last ? 'page' : undefined}>
                    {crumb.label}
                  </span>
                ) : (
                  <a class="hover:text-foreground max-w-[40ch] truncate" href={crumb.href}>
                    {crumb.label}
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
export function PageHeader(props: { title: Child; children?: Child }) {
  return (
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold tracking-tight break-words">{props.title}</h1>
      {props.children !== undefined ? (
        <p class="text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">{props.children}</p>
      ) : null}
    </div>
  );
}

/** The shell of every Leaderboard page: head with sharing tags, header, and the page body. */
export function Layout(props: { meta: PageMeta; children: Child }) {
  const fullTitle = `${props.meta.title} · be-music Leaderboard`;
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
        <meta name="twitter:card" content="summary" />
        <script dangerouslySetInnerHTML={{ __html: COLOR_SCHEME_SCRIPT }} />
        <link rel="stylesheet" href={STYLESHEET_PATH} />
      </head>
      <body class="bg-background text-foreground min-h-screen antialiased">
        <header class="border-b">
          <div class="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
            <a href="/leaderboard" class="font-semibold tracking-tight">
              be-music <span class="text-muted-foreground font-normal">Leaderboard</span>
            </a>
            <nav class="text-muted-foreground flex items-center gap-4 text-sm">
              <a class="hover:text-foreground" href="/leaderboard">
                New scores
              </a>
              <a class="hover:text-foreground" href="/">
                Play
              </a>
              <a class="hover:text-foreground" href="/leaderboard/api">
                API
              </a>
            </nav>
            <RulesetSwitch current={props.meta.ruleset} path={props.meta.path} />
          </div>
        </header>
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
