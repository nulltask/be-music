# @be-music/accounts

## 0.1.0

### Minor Changes

- b2818d0: Provide the Accounts service with its own authentication database and avatar storage, separate production and preview environments, and OIDC sign-in for registered applications using Authorization Code with PKCE.
  
  - Support anonymous accounts, passkeys, Discord and Google sign-in, and account linking.
  - Manage handles, display names, handle history and avatars at Accounts. Validate and resize uploaded images, and serve public profiles and versioned avatars for other services and score cards.
  - Let consumers retrieve profiles through Service Bindings or HTTPS without a reverse dependency on those services.
  - Use the shared service-page styling and show the donation link only in the preview footer.

### Patch Changes

- Updated dependencies [b2818d0]
  - @be-music/auth-client@0.1.0
  - @be-music/web-theme@0.1.0
