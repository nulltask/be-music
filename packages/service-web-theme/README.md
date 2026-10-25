[日本語](./README.ja.md)

# Service theme

Private CSS foundation for Accounts and Dashboard. `SERVICE_CSS` uses [shadcn's neutral design tokens](https://ui.shadcn.com/docs/theming): the CSS variables only, not the shadcn/ui component library. It keeps the system font stack, the 64rem shell and the existing control sizes. Dark values follow the system color scheme, because these pages set no theme class. Keyboard focus, a skip link and the responsive header are included.

Leaderboard gets the same token names from Basecoat. The private donation site keeps a copy in `src/service-theme.ts`; update that copy whenever this stylesheet changes. The player has its own skin-driven interface and does not use this theme.

`renderServiceHeader` is the header for every service except Play. It shows who is signed in, a link to Play, and English / 日本語. `resolveLocale` picks the language from `?lang=`, the `be-music-lang` cookie, then `Accept-Language`.

Use `renderBuildInfo({ builtAt, revision })` for the service footer. It displays a fixed ISO build timestamp in UTC and an eight-character source revision, retaining the full revision in its title. Build tools resolve the actual checkout; request handlers do not generate timestamps.
