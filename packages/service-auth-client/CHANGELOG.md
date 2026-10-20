# @be-music/service-auth-client

## 0.1.0

### Minor Changes

- b2818d0: Provide server-side OIDC sign-in, callback, session, account-management and sign-out handlers for services on shared or unrelated domains.
  
  - Use Authorization Code with PKCE, state and nonce checks, signed-token validation and encrypted host-only session cookies.
  - Validate resource-bound access tokens and expose issuer-scoped identities without returning tokens to browser JavaScript.
