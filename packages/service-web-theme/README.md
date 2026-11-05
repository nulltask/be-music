[日本語](./README.ja.md)

# Service theme

Private styles and shared Lit views for Be-Music services. The root entry exposes compiled styles, locale helpers, service origins, and presentation types. Import server rendering functions and templates from `@be-music/service-web-theme/server`; import browser components and templates from `@be-music/service-web-theme/client`. The server entry is excluded from browser bundles. `defineServiceUI()` explicitly registers the shared status element; its Shadow DOM isolates Lit-owned messages from htmx morphs. Authentication panels, account identities and avatars, header popovers, and language pickers share their templates across services.

`src/theme.css` imports Tailwind CSS v4 and [Basecoat](https://basecoatui.com). `pnpm --filter @be-music/service-web-theme run build:css` writes `src/styles.generated.ts`; `build:server` bundles the server entry for Workers. `prepare` regenerates both on install. Accounts and Dashboard use the compiled stylesheet; pages use Basecoat classes (`btn`, `card`, `input`) and Tailwind utilities.

Dark colors follow the system color scheme. Leaderboard toggles a `.dark` class from a script; these pages cannot, because their content security policy blocks inline scripts. The build repeats Basecoat's dark tokens under `prefers-color-scheme`.

The private donation site keeps its own copy in `src/service-theme.ts`. Update that copy separately when this stylesheet changes. Play draws its stage with skins and builds its own stylesheet, so it does not use this compiled CSS, which follows the system scheme. Play does use the shared header and forces dark mode on its own page.

`renderServiceHeader` is the header for Dashboard, Accounts, Leaderboard and Play. It shows who is signed in, then either a link to Play or, when `settings` is set, a Settings button in that place, then English / 日本語. One Beta badge sits beside the title. Play sets `settings` and that button toggles its Options dialog. Play also sets `fullscreen` for a button beside Settings; the page toggles fullscreen from that click. The other services pass `playHref` and leave `settings` and `fullscreen` unset. `resolveLocale` picks the language from `?lang=`, the `be-music-lang` cookie, then `Accept-Language`.

`renderServiceFooter` is the footer for Dashboard, Accounts, Play and Leaderboard. It links those four services and leaves the current one as text. A site then adds its own footer content, the copyright line (`© 2026 nulltask · MIT License`), and `renderBuildInfo`. Pass the page hostname so a preview site links to the preview siblings. An unknown host uses production, as the Player does.

Use `renderBuildInfo({ builtAt, revision })` for that build line. It displays a fixed ISO build timestamp in UTC and an eight-character source revision, retaining the full revision in its title. Build tools resolve the actual checkout; request handlers do not generate timestamps.
