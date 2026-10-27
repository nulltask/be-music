# @be-music/app-accounts

## 0.1.2

### Patch Changes

- 853d9d7: Discord sign-in asks for consent on the first authorization. Google sign-in leaves the authorize prompt unset so the first authorization can show account selection and consent, and the Accounts Worker requires the Discord and Google client id and secret for that environment.
- 3040887: A signed-in account can link a passkey, Discord, and Google later, and the link stays on that account when the provider email differs.
- 3e694df: Account pages use the shared service header (who is signed in, a link to Play, the viewer's language) and footer, and Basecoat buttons, cards and inputs, the same components as the Leaderboard. The preview Donate link stays in this site's own footer row.
- Updated dependencies [17aebd5]
- Updated dependencies [051e0c0]
- Updated dependencies [6f94ff0]
- Updated dependencies [2e435b9]
- Updated dependencies [00139f5]
  - @be-music/service-web-theme@0.3.0
  - @be-music/shared-utils@0.6.0
  - @be-music/service-auth-client@0.1.2

## 0.1.1

### Patch Changes

- ebff0e7: Display the fixed build timestamp and source revision in the service footer.
  
  Rename the package from `@be-music/accounts` to `@be-music/app-accounts` to identify its role consistently. Update imports and package filters to the new name.
- Updated dependencies [325e7bb]
- Updated dependencies [ebff0e7]
  - @be-music/service-auth-client@0.1.1
  - @be-music/service-web-theme@0.2.0

## 0.1.0

### Minor Changes

- b2818d0: Provide the Accounts service with its own authentication database and avatar storage, separate production and preview environments, and OIDC sign-in for registered applications using Authorization Code with PKCE.
  
  - Support anonymous accounts, passkeys, Discord and Google sign-in, and account linking.
  - Manage handles, display names, handle history and avatars at Accounts. Validate and resize uploaded images, and serve public profiles and versioned avatars for other services and score cards.
  - Let consumers retrieve profiles through Service Bindings or HTTPS without a reverse dependency on those services.
  - Use the shared service-page styling and show the donation link only in the preview footer.

### Patch Changes

- Updated dependencies [b2818d0]
  - @be-music/service-auth-client@0.1.0
  - @be-music/service-web-theme@0.1.0
