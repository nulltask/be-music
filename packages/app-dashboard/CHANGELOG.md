# @be-music/app-dashboard

## 0.2.0

### Minor Changes

- b74bb64: Run Accounts in the Dashboard.
  
  - The Dashboard now runs Accounts: sign-in, passkeys, Google and Discord, profiles, avatars and the `/login` and `/account` pages are served from `be-music.app`, and the OIDC issuer is `https://be-music.app/api/auth`. The Dashboard reads the Accounts session directly instead of signing in as an OIDC client, and its sign-out form ends that session. Accounts starts from an empty database, so every user signs in again.
  - The profile page's avatar preview is round, matching the avatar everywhere else, instead of a rounded square.
  - Call guest accounts guests, and treat an account as kept once Google or Discord is linked, as with a passkey.

### Patch Changes

- Updated dependencies: `@be-music/service-web-theme@0.4.1`

## 0.1.5

### Patch Changes

- Updated dependencies: `@be-music/service-web-theme@0.4.0`

## 0.1.4

### Patch Changes

- adcaa23: The dashboard footer spells the product name Be-Music.

## 0.1.3

### Patch Changes

- c69a154: The dashboard’s play card writes bmson in lowercase, matching the format name.
- 9300c75: The Dashboard header shows a Beta badge beside Be-Music Dashboard, and the footer says Public Beta and that data may be deleted without notice, in the language of the page.
- Updated dependencies: `@be-music/service-auth-client@0.2.0`, `@be-music/service-web-theme@0.3.1`

## 0.1.2

### Patch Changes

- 3e694df: Dashboard pages use the shared service header (who is signed in, a link to Play, the viewer's language) and footer, and Basecoat cards and buttons, the same components as the Leaderboard. The be-music label and the preview Donate link stay in this site's own footer row.
- Updated dependencies: `@be-music/service-web-theme@0.3.0`, `@be-music/service-auth-client@0.1.2`

## 0.1.1

### Patch Changes

- ebff0e7: Display the fixed build timestamp and source revision in the service footer.
  
  Rename the package from `@be-music/dashboard` to `@be-music/app-dashboard` to identify its role consistently. Update imports and package filters to the new name.
- Updated dependencies: `@be-music/service-auth-client@0.1.1`, `@be-music/service-web-theme@0.2.0`

## 0.1.0

### Minor Changes

- b2818d0: Provide the Dashboard service at the environment's root domain with account status and links to Play, Leaderboard and account management.
  
  - Sign in through Accounts OIDC using a host-only session.
  - Retrieve the current public profile directly from Accounts through a Service Binding or HTTPS, without creating a Leaderboard player.
  - Support Japanese and English with responsive styling shared with Leaderboard.
  - Hide donation links in production and keep the link discreetly in the preview footer.

### Patch Changes

- Updated dependencies: `@be-music/service-auth-client@0.1.0`, `@be-music/service-web-theme@0.1.0`
