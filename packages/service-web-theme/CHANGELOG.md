# @be-music/service-web-theme

## 0.5.0

### Minor Changes

- 3646413: Add a shared loading placeholder: `skeletonTemplate` draws a shimmering line, circle or block in the box of the content it stands in for, `skeletonGroupTemplate` marks the region busy for assistive technology, and `src/skeleton.css` styles both for light and dark themes and stops the shimmer under `prefers-reduced-motion`. The header takes `accountLoading`, which shows a placeholder in the signed-in control's box instead of "Sign in" while a page reads the account.

## 0.4.1

### Patch Changes

- b46629e: Round avatars and the Accounts link on the Dashboard host.
  
  - Avatars are always round: `avatarTemplate` drops its `shape` option and renders one shared style, a square cropped with `object-cover` so a non-square image is never stretched.
  - The service footer's Accounts link opens the account page on the Dashboard host (`https://be-music.app/account`), where Accounts now runs.

## 0.4.0

### Minor Changes

- f3900b2: Share Lit service templates through explicit browser and server entries.

  - Add `/client` exports for status components and shared authentication, account identity, avatar, header, footer, language, and popover templates. Register status elements explicitly with `defineServiceUI`.
  - Add `/server` exports for synchronous HTML rendering and server versions of the shared templates. Import rendering functions such as `renderServiceHeader`, `renderServiceFooter`, and `renderBuildInfo` from `/server` rather than the package root; keep this entry out of browser bundles.
  - Keep locale helpers, service models, and compiled styles available from the root entry.

## 0.3.1

### Patch Changes

- 9d2a360: The shared header can show a Settings button in place of the Play link, and a fullscreen button beside it. The Settings button reports whether its menu is open. Play asks for both, and its header spans the viewport instead of the centered column the other services keep. The other services still link to Play.
- e90a500: The shared header shows a Beta badge beside the site title, and the shared footer labels each service Public Beta and says that data may be deleted without notice, in English and Japanese.

## 0.3.0

### Minor Changes

- 8518a0c: Share one header for the service pages, with the signed-in person, a link to Play, and English or Japanese. Its account, Play and language controls follow the Leaderboard's trailing order.

### Patch Changes

- c67a1af: Share one service footer that links Dashboard, Accounts, Play and Leaderboard, leaves the current service as text, then renders that site's own content, the copyright line, and the build timestamp and source revision.
- edc2f6d: Accounts and Dashboard compile Basecoat on Tailwind CSS v4, the same components as the Leaderboard, instead of a hand-written stylesheet. Dark colors follow the system color scheme.

## 0.2.0

### Minor Changes

- 7a10f67: Provide a shared, escaped build-information footer renderer with UTC timestamps and short revisions.
  
  Rename the package from `@be-music/web-theme` to `@be-music/service-web-theme` to identify its role consistently. Update imports and package filters to the new name.

## 0.1.0

### Minor Changes

- 8a051a5: Provide the shared neutral service-page styles used by Accounts and Dashboard, including responsive layout, typography, controls, focus states and light/dark colors matching Leaderboard.
