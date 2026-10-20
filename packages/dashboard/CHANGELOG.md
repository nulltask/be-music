# @be-music/dashboard

## 0.1.0

### Minor Changes

- b2818d0: Provide the Dashboard service at the environment's root domain with account status and links to Play, Leaderboard and account management.
  
  - Sign in through Accounts OIDC using a host-only session.
  - Retrieve the current public profile directly from Accounts through a Service Binding or HTTPS, without creating a Leaderboard player.
  - Support Japanese and English with responsive styling shared with Leaderboard.
  - Hide donation links in production and keep the link discreetly in the preview footer.

### Patch Changes

- Updated dependencies [b2818d0]
  - @be-music/auth-client@0.1.0
  - @be-music/web-theme@0.1.0
