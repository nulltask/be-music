[Japanese version](./README.ja.md)

# @be-music/auth-client

Server-side OIDC relying-party code shared by the be-music apps. See [Services](../../docs/services.md) and [ADR 0008](../../docs/adr/0008-accounts-oidc.md).

Configure `AUTH_ISSUER`, `PUBLIC_ORIGIN`, `OIDC_CLIENT_ID`, `API_AUDIENCE` and a separate `SESSION_SECRET` of at least 32 random characters. Origins and issuers must use HTTPS. Register exactly `PUBLIC_ORIGIN/api/auth/callback` at Accounts. The issuer includes `/api/auth`.

- `handleAuth`: local sign-in, callback, session inspection, account-management link and POST sign-out routes under `/api/auth/`.
- `readSession`: decrypt the app's host-only session, returning server-only identity and access-token data.
- `verifyAccess`: validate the configured issuer's resource-bound API bearer token and required scope.
- `returnPath`: constrain return destinations to local paths.

Never include `accessToken` in a browser response. Cookie-authenticated writes require an exact same-origin Origin check; service-to-service requests use Bearer credentials. Each app uses its own secret, and production and preview use different issuers/secrets.

Run `pnpm test --project @be-music/auth-client --project @be-music/accounts` from the root for the boundaries and real-provider cross-domain flow. Run `pnpm --filter @be-music/auth-client bench` for exported helper benchmarks.
