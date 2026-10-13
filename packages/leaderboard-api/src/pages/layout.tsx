/** @jsxImportSource hono/jsx */
import type { Child } from 'hono/jsx';
import type { PlaylogRulesetId } from '@be-music/player/playlog';
import { RULESET_LABELS } from './format.ts';
import { RULESETS } from './preferences.ts';

const STYLE = `
:root { color-scheme: dark light; --bg: #0b0d12; --panel: #141821; --line: #262c3a; --text: #e6e8ee; --muted: #8b93a7;
  --accent: #f5c518; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
@media (prefers-color-scheme: light) { :root { --bg: #f6f7fb; --panel: #fff; --line: #dfe3ec; --text: #161a23; --muted: #5b6477; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); }
a { color: inherit; }
header { display: flex; align-items: baseline; gap: 16px; padding: 16px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
header .brand { font-weight: 700; letter-spacing: .04em; text-decoration: none; }
header .brand span { color: var(--accent); }
header nav { display: flex; gap: 12px; font-size: 14px; color: var(--muted); }
header nav.ruleset { margin-left: auto; gap: 0; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; }
header nav.ruleset a { padding: 4px 12px; text-decoration: none; }
header nav.ruleset a.on { background: var(--accent); color: #111; }
main { max-width: 960px; margin: 0 auto; padding: 16px; }
h1 { font-size: 22px; margin: 8px 0 4px; }
.sub { color: var(--muted); margin: 0 0 16px; font-size: 14px; }
.beta { font-size: 12px; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 2px 8px; }
.filters { display: flex; gap: 8px; flex-wrap: wrap; margin: 0 0 12px; font-size: 13px; }
.filters a { padding: 4px 10px; border: 1px solid var(--line); border-radius: 999px; text-decoration: none; color: var(--muted); }
.filters a.on { border-color: var(--accent); color: var(--text); }
.table-wrap { overflow-x: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; white-space: nowrap; }
th { color: var(--muted); font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; }
tr:last-child td { border-bottom: 0; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
td.song { white-space: normal; min-width: 180px; }
td.song small { display: block; color: var(--muted); }
.lamp { display: inline-block; width: 6px; height: 1.1em; border-radius: 2px; vertical-align: -2px; margin-right: 6px; }
.tag { font-size: 11px; color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; margin-left: 4px; }
.empty { padding: 24px; color: var(--muted); text-align: center; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; font-size: 14px; }
dt { color: var(--muted); }
dd { margin: 0; word-break: break-all; }
`;

export interface PageMeta {
  title: string;
  description: string;
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
    <nav class="ruleset" aria-label="Display ruleset">
      {RULESETS.map((id) => (
        <a
          class={id === props.current ? 'on' : ''}
          aria-current={id === props.current ? 'true' : undefined}
          href={`/leaderboard/ruleset/${id}?next=${encodeURIComponent(props.path)}`}
        >
          {RULESET_LABELS[id]}
        </a>
      ))}
    </nav>
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
        <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      </head>
      <body>
        <header>
          <a class="brand" href="/leaderboard">
            be-music <span>Leaderboard</span>
          </a>
          <span class="beta">beta · rankings may be reset</span>
          <nav>
            <a href="/leaderboard">New scores</a>
            <a href="/">Play</a>
          </nav>
          <RulesetSwitch current={props.meta.ruleset} path={props.meta.path} />
        </header>
        <main>{props.children}</main>
      </body>
    </html>
  );
}
