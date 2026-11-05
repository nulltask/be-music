[Japanese version](./0039-accounts-in-dashboard.ja.md)

# 0039: Run Accounts in the Dashboard Worker on the Dashboard host

Status: accepted. Date: 2026-11-05. Amends [ADR 0008](./0008-accounts-oidc.md).

## Context

Accounts (`accounts.be-music.app`) and the Dashboard (`be-music.app`) were two Workers. The Dashboard was an OIDC client of Accounts and fetched the signed-in user's profile from it through a Service Binding, so the user's home and their account lived on two hosts with two sessions.

## Decision

Accounts moves into `@be-music/app-dashboard` and the `dashboard` / `dashboard-preview` Worker. Better Auth, the OIDC provider, the profile API, avatars and the `/login` and `/account` pages are served from the Dashboard host:

- The issuer becomes `https://be-music.app/api/auth` (`https://preview.be-music.app/api/auth` in preview). Play, the Leaderboard and Donate set it as `AUTH_ISSUER`; the Leaderboard reaches profiles through a Service Binding to the Dashboard Worker.
- The Dashboard is no longer an OIDC client of itself. It reads the Better Auth session directly; `/sign-out` ends that session. Better Auth owns every `/api/auth/*` path on the host.
- The passkey relying party ID stays `be-music.app` (`preview.be-music.app`); only the ceremony origin changes.
- Discord and Google redirect to `https://be-music.app/api/auth/callback/{discord,google}`.
- The `accounts.<site>` host is not served yet: its custom domain stays on the `accounts` Workers until they are deleted. The planned permanent redirect to the Dashboard host can be attached after that.
- The Accounts D1 was deleted and recreated empty as `dashboard` / `dashboard-preview`, and the `accounts` / `accounts-preview` Workers are removed. The owner accepted losing every existing account, passkey, guest and profile rather than migrating them. The avatar bucket keeps its `accounts` / `accounts-preview` name.

## Consequences

Every user signs in again with a new account, and guests start over. Leaderboard identity mappings under the former issuer `https://accounts.<site>/api/auth` no longer match any account, so scores tied to them are not reachable from a new account. The one-time identity and profile migration scripts from ADR 0008 and ADR 0009 were removed.

The `accounts` Workers can only be deleted after the Dashboard and the Leaderboard have been deployed without Service Bindings to them. Until that deploy, sign-in on the deployed services is broken because their database is gone.

Services stay separate OIDC clients with host-only sessions, so a self-hosted instance may still put Accounts on any host by setting `AUTH_ORIGIN` and each client's `AUTH_ISSUER`.
