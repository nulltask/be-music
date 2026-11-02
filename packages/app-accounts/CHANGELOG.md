# @be-music/app-accounts

## 0.1.5

### Patch Changes

- adcaa23: Accounts spells the product name Be-Music in its copy ("One account for all Be-Music services.", EN and JA), in the passkey prompt and in the name a new passkey is saved under.

## 0.1.4

### Patch Changes

- c69a154: The sign-in page, account page and their status messages follow the page language, in Japanese and English.
- 9300c75: The Accounts header shows a Beta badge beside Be-Music Accounts, and the footer says Public Beta and that data may be deleted without notice, in the language of the page.
- 6e6aeeb: A login opened from a Google or Discord button stayed on the Accounts page, so the requested provider now starts the social sign-in, and the Google, Discord and passkey buttons show the same provider marks as the player.
- Updated dependencies: `@be-music/service-auth-client@0.2.0`, `@be-music/service-web-theme@0.3.1`

## 0.1.3

### Patch Changes

- Updated dependencies: `@be-music/shared-utils@0.7.0`

## 0.1.2

### Patch Changes

- 853d9d7: Discord sign-in asks for consent on the first authorization. Google sign-in leaves the authorize prompt unset so the first authorization can show account selection and consent, and the Accounts Worker requires the Discord and Google client id and secret for that environment.
- 3040887: A signed-in account can link a passkey, Discord, and Google later, and the link stays on that account when the provider email differs.
- 3e694df: Account pages use the shared service header (who is signed in, a link to Play, the viewer's language) and footer, and Basecoat buttons, cards and inputs, the same components as the Leaderboard. The preview Donate link stays in this site's own footer row.
- Updated dependencies: `@be-music/service-web-theme@0.3.0`, `@be-music/shared-utils@0.6.0`, `@be-music/service-auth-client@0.1.2`

## 0.1.1

### Patch Changes

- ebff0e7: Display the fixed build timestamp and source revision in the service footer.
  
  Rename the package from `@be-music/accounts` to `@be-music/app-accounts` to identify its role consistently. Update imports and package filters to the new name.
- Updated dependencies: `@be-music/service-auth-client@0.1.1`, `@be-music/service-web-theme@0.2.0`

## 0.1.0

### Minor Changes

- b2818d0: Provide the Accounts service with its own authentication database and avatar storage, separate production and preview environments, and OIDC sign-in for registered applications using Authorization Code with PKCE.
  
  - Support anonymous accounts, passkeys, Discord and Google sign-in, and account linking.
  - Manage handles, display names, handle history and avatars at Accounts. Validate and resize uploaded images, and serve public profiles and versioned avatars for other services and score cards.
  - Let consumers retrieve profiles through Service Bindings or HTTPS without a reverse dependency on those services.
  - Use the shared service-page styling and show the donation link only in the preview footer.

### Patch Changes

- Updated dependencies: `@be-music/service-auth-client@0.1.0`, `@be-music/service-web-theme@0.1.0`
