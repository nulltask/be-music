# @be-music/app-dashboard

## 0.1.2

### Patch Changes

- 3e694df: Dashboard pages use the shared service header (who is signed in, a link to Play, the viewer's language) and footer, and Basecoat cards and buttons, the same components as the Leaderboard. The be-music label and the preview Donate link stay in this site's own footer row.
- Updated dependencies [17aebd5]
- Updated dependencies [051e0c0]
- Updated dependencies [6f94ff0]
- Updated dependencies [00139f5]
  - @be-music/service-web-theme@0.3.0
  - @be-music/service-auth-client@0.1.2

## 0.1.1

### Patch Changes

- ebff0e7: Display the fixed build timestamp and source revision in the service footer.
  
  Rename the package from `@be-music/dashboard` to `@be-music/app-dashboard` to identify its role consistently. Update imports and package filters to the new name.
- Updated dependencies [325e7bb]
- Updated dependencies [ebff0e7]
  - @be-music/service-auth-client@0.1.1
  - @be-music/service-web-theme@0.2.0

## 0.1.0

### Minor Changes

- b2818d0: Provide the Dashboard service at the environment's root domain with account status and links to Play, Leaderboard and account management.
  
  - Sign in through Accounts OIDC using a host-only session.
  - Retrieve the current public profile directly from Accounts through a Service Binding or HTTPS, without creating a Leaderboard player.
  - Support Japanese and English with responsive styling shared with Leaderboard.
  - Hide donation links in production and keep the link discreetly in the preview footer.

### Patch Changes

- Updated dependencies [b2818d0]
  - @be-music/service-auth-client@0.1.0
  - @be-music/service-web-theme@0.1.0
