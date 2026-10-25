[日本語](./README.ja.md)

# Service theme

Private stylesheet for Accounts and Dashboard. `src/theme.css` imports Tailwind CSS v4 and [Basecoat](https://basecoatui.com) (the same components as the Leaderboard; shadcn/ui is not a dependency). `pnpm --filter @be-music/service-web-theme run build:css` writes `src/styles.generated.ts`, and `prepare` regenerates it on install. Pages use Basecoat classes (`btn`, `card`, `input`) and Tailwind utilities.

Dark colors follow the system color scheme. Leaderboard toggles a `.dark` class from a script; these pages cannot, because their content security policy blocks inline scripts. The build repeats Basecoat's dark tokens under `prefers-color-scheme`.

The private donation site keeps its own copy in `src/service-theme.ts`. Update that copy separately when this stylesheet changes. Play has its own skin-driven interface and does not use this theme.

`renderServiceHeader` is the header for every service except Play. It shows who is signed in, a link to Play, and English / 日本語. `resolveLocale` picks the language from `?lang=`, the `be-music-lang` cookie, then `Accept-Language`.

`renderServiceFooter` is the footer for Dashboard, Accounts, Play and Leaderboard. It links those four services and leaves the current one as text. A site then adds its own footer content, the copyright line (`© 2026 nulltask · MIT License`), and `renderBuildInfo`. Pass the page hostname so a preview site links to the preview siblings. An unknown host uses production, as the Player does.

Use `renderBuildInfo({ builtAt, revision })` for that build line. It displays a fixed ISO build timestamp in UTC and an eight-character source revision, retaining the full revision in its title. Build tools resolve the actual checkout; request handlers do not generate timestamps.
