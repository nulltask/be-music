# @be-music/service-web-theme

## 0.3.0

### Minor Changes

- 051e0c0: Share one header for the service pages, with the signed-in person, a link to Play, and English or Japanese. Its account, Play and language controls follow the Leaderboard's trailing order.

### Patch Changes

- 17aebd5: Share one service footer that links Dashboard, Accounts, Play and Leaderboard, leaves the current service as text, then renders that site's own content, the copyright line, and the build timestamp and source revision.
- 6f94ff0: Accounts and Dashboard compile Basecoat on Tailwind CSS v4, the same components as the Leaderboard, instead of a hand-written stylesheet. Dark colors follow the system color scheme.

## 0.2.0

### Minor Changes

- ebff0e7: Provide a shared, escaped build-information footer renderer with UTC timestamps and short revisions.
  
  Rename the package from `@be-music/web-theme` to `@be-music/service-web-theme` to identify its role consistently. Update imports and package filters to the new name.

## 0.1.0

### Minor Changes

- b2818d0: Provide the shared neutral service-page styles used by Accounts and Dashboard, including responsive layout, typography, controls, focus states and light/dark colors matching Leaderboard.
