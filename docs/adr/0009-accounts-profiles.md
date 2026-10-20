[Japanese version](./0009-accounts-profiles.ja.md)

# 0009: Accounts owns public profiles and avatars

Accounts owns the user's handle, display name, handle history and avatar, in addition to authentication. Editing takes place at `/account`; its session and an exact Origin protect all mutations. Uploaded images are limited to 128 KiB and recognized by signature. Public profile responses contain only the handle, display name and avatar URL.

Leaderboard retains a projection for ranking queries and existing player URLs. It pulls the authoritative profile through its Accounts binding when an authenticated identity is synchronized. Accounts also calls the named `ProfileSync` Worker entrypoint after edits; this entrypoint has no public HTTP route and accepts only a subject, never caller-supplied profile values. A D1 outbox retries failed notifications every five minutes. A revision prevents an older delivery from deleting a newer pending update.

```mermaid
flowchart LR
    U[Account settings] --> A[Accounts]
    A --> D[(Profile DB)]
    A --> R[(Avatar R2)]
    A --> O[(Outbox)]
    O -->|Private RPC| L[Leaderboard]
    L -->|Public profile| A
    L --> P[(Ranking projection)]
```

The projection trades immediate cross-service transactions for efficient ranking queries and independent storage. Accounts remains authoritative; delivery failures retain the pending update. API writes to the old Leaderboard profile/avatar endpoints are refused when OIDC is configured, and settings direct users to Accounts. Local development without OIDC retains the standalone implementation and its test fixtures.

D1 names and R2 bucket names follow `accounts`/`accounts-preview`, `leaderboard`/`leaderboard-preview`, and `play`/`play-preview`. The separate static public asset bucket is `assets` at `assets.be-music.app`. No user authentication data is shared across environments.

For an existing installation, apply the Accounts profile migration, copy the public profiles and handle histories using `packages/accounts/scripts/migrate-profiles.ts --apply` (add `--preview` for preview), and copy avatar objects to Accounts before switching workers. Never infer identity ownership from email. The script checks that passkeys already exist in Accounts before the legacy cleanup migration is run. After both Workers support the projection, use `--apply --project` to replace legacy avatar keys with Accounts URLs.

The one-time storage-copy Worker in `packages/accounts/scripts/storage-copy-worker.ts` streams objects with metadata and checks size, single-part ETags and streaming SHA-256 digests, using explicit source/destination bindings and a temporary secret. Run a final catch-up and verification after switching bindings. Move the static asset custom domain after verifying its new bucket. Delete source buckets and the temporary Worker only after verifying the new services.

The Leaderboard cleanup migration deletes old sessions, verification challenges, provider credentials and passkeys, and removes old email/image data from local player rows. It keeps player IDs, profiles, identity mappings and all scores. The table definitions remain for standalone local development; production uses Accounts OIDC exclusively.
