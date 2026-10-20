# @be-music/service-auth-client

## 0.1.1

### Patch Changes

- 325e7bb: Automatically establish an app session from an existing Accounts session when a browser opens a service page. Use prompt=none with PKCE and state validation, keep public pages accessible when Accounts is signed out, and suppress automatic retries after explicit sign-out.
  
  Rename the package from `@be-music/auth-client` to `@be-music/service-auth-client` to identify its role consistently. Update imports and package filters to the new name.

## 0.1.0

### Minor Changes

- b2818d0: Provide server-side OIDC sign-in, callback, session, account-management and sign-out handlers for services on shared or unrelated domains.
  
  - Use Authorization Code with PKCE, state and nonce checks, signed-token validation and encrypted host-only session cookies.
  - Validate resource-bound access tokens and expose issuer-scoped identities without returning tokens to browser JavaScript.
