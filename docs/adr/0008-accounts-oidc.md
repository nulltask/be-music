[Japanese version](./0008-accounts-oidc.ja.md)

# 0008: Independent Accounts with OIDC and host-only app sessions

Status: accepted. Date: 2026-10-20.

## Context

A self-hosted instance may put services on unrelated domains. The interim shared parent-domain cookie cannot support that layout and couples every app to the Leaderboard's authentication tables.

## Decision

Accounts owns authentication in a separate D1 and runs Better Auth's OAuth provider with public first-party clients, exact callback URIs, authorization code and S256 PKCE. Dynamic registration is disabled. All clients use public subjects; services key identities by `(issuer, sub)`, never email.

`@be-music/auth-client` implements the server-side relying party: state/nonce checks, issuer/audience and signature validation, and resource-bound API access tokens. Each app stores an encrypted, host-only HttpOnly session for at most ten minutes, bounded by its tokens. There are no refresh tokens, parent-domain cookies or browser-visible bearer tokens. The flow is shown in [Services §3](../services.md#3-sign-in).

The Leaderboard keeps its profiles and scores. An identity mapping preserves migrated player IDs; signed guest-link claims transfer anonymous scores lazily and idempotently. Accounts does not import Leaderboard modules or access its database.

## Consequences

Signing out of Accounts stops new SSO sessions, but existing app sessions can last ten minutes. A user starts Sign in again after expiry; an existing Accounts session avoids another credential prompt. Immediate global logout and device authorization remain separate work.

Preview has a separate issuer, database, keys and app secrets. Branch URLs are not clients; adding one requires an exact registered origin and callback. This deliberately replaces the earlier proposed wildcard redirects.

The private donation content repository vendors the small relying-party module from a pinned monorepo commit until a separately distributable package is released. A sync script records its source and checksum; updates must run the shared auth tests and donation tests together.
