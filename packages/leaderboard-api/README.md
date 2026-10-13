[Japanese version](./README.ja.md)

# @be-music/leaderboard-api

The be-music Leaderboard API: a Hono app on Cloudflare Workers with D1 and R2. The design is in
[docs/leaderboard.md](../../docs/leaderboard.md); this README covers running and deploying it.

## What is implemented

- Sign-in with Better Auth: anonymous sessions, passkeys, and Discord / Google OAuth when their secrets are set.
- `POST /api/v1/scores`: submits a play log (gzip). The server checks eligibility and the play and chart fingerprint
  documents (verification layers L1–L3, and L4 for charts without `#RANDOM`), re-simulates the play under `lr2`,
  `beatoraja` and `iidx`, stores the log in R2 and updates personal bests. A retried play is recognised; the same play
  from a second account is refused.
- `GET /api/v1/charts/:chartFingerprint/leaderboard` and `.../leaderboard/me`: rankings, with filters for assisted
  plays, anonymous players, and "played under this ruleset".
- `GET /api/v1/scores/:id` and `.../playlog`.

- Pages under `/leaderboard`: new scores (top), a score, a chart's rankings, and a player.

Not yet: L4 for new `#RANDOM` outcomes and L5, rivals, and OG cards.

## Setup

Workspace packages are bundled from their `dist`, so build them first:

```bash
pnpm run build
```

The resources already exist in the be-music account (D1 and R2 in APAC, one of each per environment); their D1 ids
are in `cloudflare.config.ts` and the migrate scripts. For a new environment, create them and record the new id:

```bash
pnpm exec cf d1 create be-music-leaderboard-staging
```

```bash
pnpm exec cf r2 bucket create be-music-leaderboard-staging
```

Secrets, per environment (none of them are committed). A secret declared in `cloudflare.config.ts` is required on every
deploy; the very first deploy of a Worker passes it with `cf deploy --secrets-file <file>`, later ones keep it.

| Secret                                       | Purpose                                                        |
| -------------------------------------------- | -------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                         | Signs sessions; any long random string                         |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | Discord sign-in (optional; off when unset; declare when added) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`   | Google sign-in (optional; off when unset; declare when added)  |

## Database

The schema lives in `src/db/schema.ts`. After changing it, generate a migration and commit it:

```bash
pnpm --filter @be-music/leaderboard-api run db:generate
```

Migrations run before the deploy and must work with the code still running (add, switch, then remove):

```bash
pnpm --filter @be-music/leaderboard-api run db:migrate:staging
```

## Deploy

Workers Builds deploys `devel` to the staging Worker and `main` to production:

- staging: `pnpm run build && pnpm --filter @be-music/leaderboard-api run db:migrate:staging && pnpm --filter @be-music/leaderboard-api run deploy:staging`
- production: the same with `db:migrate:production` and `deploy`

The Worker has no public URL; the player's Worker forwards `/api/*` and `/leaderboard/*` to it through a Service
Binding.

## Pages

The pages under `/leaderboard` are Hono JSX styled with Tailwind CSS v4 and [Basecoat](https://basecoatui.com) (the
shadcn/ui design without a framework runtime). `src/pages/app.css` compiles into `src/pages/styles.generated.ts`,
which is committed and served from `/leaderboard/assets/app.<hash>.css`. After changing classes in the pages, rebuild
it:

```bash
pnpm --filter @be-music/leaderboard-api run build:css
```

## Tests

`pnpm test` runs this package's tests with the rest of the workspace. The API tests drive the Hono app with real D1
and R2 bindings from Miniflare, so they also check the migrations.
