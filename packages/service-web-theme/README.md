[日本語](./README.ja.md)

# Service theme

Private CSS foundation for Accounts and Dashboard. `SERVICE_CSS` matches the Leaderboard's Basecoat neutral palette, system font stack, 64rem shell and Vega controls. It follows the system color scheme without JavaScript and includes keyboard focus, a skip link and responsive header styles.

Keep the palette aligned with `packages/app-leaderboard/src/pages/app.css` and its Basecoat dependency. The private donation site keeps a copy in `src/service-theme.ts`; update that copy whenever this stylesheet changes. The player has its own skin-driven interface and does not use this theme.

Use `renderBuildInfo({ builtAt, revision })` for the service footer. It displays a fixed ISO build timestamp in UTC and an eight-character source revision, retaining the full revision in its title. Build tools resolve the actual checkout; request handlers do not generate timestamps.
