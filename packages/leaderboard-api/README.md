[Japanese version](./README.ja.md)

# @be-music/leaderboard-api

The be-music Leaderboard API: a Hono app on Cloudflare Workers with D1 and R2. The design is in
[docs/leaderboard.md](../../docs/leaderboard.md); this README covers running and deploying it.

## What is implemented

- Sign-in with Better Auth: anonymous sessions, passkeys, and Discord / Google OAuth when their secrets are set.
- `POST /api/v0/scores`: submits a play log (gzip). The server checks eligibility and the play and chart fingerprint
  documents (verification layers L1–L3, and L4 for charts without `#RANDOM`), re-simulates the play under `lr2`,
  `beatoraja` and `iidx`, stores the log in R2 and updates personal bests. A retried play is recognised; the same play
  from a second account is refused.
- `GET /api/v0/charts/:chartFingerprint/leaderboard` and `.../leaderboard/me`: rankings, with filters for assisted
  plays, anonymous players, and "played under this ruleset".
- `GET /api/v0/scores/:id` and `.../playlog`.
- `GET /api/v0/openapi.json`: the OpenAPI 3.1 document, generated from the routes' valibot schemas
  (`src/api/schemas.ts`), and its reference page at `/leaderboard/api`. A copy is committed as
  [`openapi.json`](./openapi.json); the test fails when it is out of date, so refresh it with `vp test run -u` after
  changing the API.

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
pnpm exec cf d1 create --name be-music-leaderboard-preview --primary-location-hint apac
```

```bash
pnpm exec cf r2 buckets create --name be-music-leaderboard-preview --location-hint apac
```

### Secrets

Secrets live in 1Password, in the `be-music` vault of the `my.1password.com` account, one item per Worker
(`be-music-leaderboard-preview`, `be-music-leaderboard`). The repository holds only references:
`secrets/<environment>.env.tpl` maps each secret to its 1Password field (`KEY={{ op://… }}`). Set them on the Worker
with the [1Password CLI](https://developer.1password.com/docs/cli/) signed in:

```bash
pnpm --filter @be-music/leaderboard-api run secrets:preview
```

`scripts/put-secrets.ts` reads each value with `op read` and passes it to `cf workers secrets update`; nothing is
written to disk or printed. Set `OP_ACCOUNT` to use another 1Password account. To rotate a secret, regenerate it in
1Password and run the script again (rotating `BETTER_AUTH_SECRET` signs everyone out; passkeys stay).

Use `cf`, not Wrangler, for anything that touches an account: Wrangler keeps its own login, which may be another
Cloudflare account.

A secret declared in `cloudflare.config.ts` is required on every deploy. The first deploy of a new Worker must carry it
in a file (`cf deploy --secrets-file`); a named pipe keeps the value off the disk:

```bash
d=$(mktemp -d) && mkfifo -m 600 "$d/secrets" && (op inject -i secrets/preview.env.tpl > "$d/secrets" &) && pnpm exec cf deploy --mode preview --secrets-file "$d/secrets"; rm -rf "$d"
```

Later deploys keep the secrets already set.

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
pnpm --filter @be-music/leaderboard-api run db:migrate:preview
```

## Deploy

Two environments, following the player demo's Workers Builds: `devel` is production, and every other branch is
preview.

| Environment | Worker                         | D1 / R2                        | Player demo                                    |
| ----------- | ------------------------------ | ------------------------------ | ---------------------------------------------- |
| production  | `be-music-leaderboard`         | `be-music-leaderboard`         | `be-music-player-demo` (deployed from `devel`) |
| preview     | `be-music-leaderboard-preview` | `be-music-leaderboard-preview` | preview versions of every other branch         |

- preview: `pnpm run build && pnpm --filter @be-music/leaderboard-api run db:migrate:preview && pnpm --filter @be-music/leaderboard-api run deploy:preview`
- production: the same with `db:migrate:production` and `deploy`

The preview Worker is shared by every branch: the last one deployed wins.

The Worker has no public URL; the player's Worker forwards `/api/*` and `/leaderboard/*` to it through a Service
Binding.

## Pages

The pages under `/leaderboard` are Hono JSX styled with Tailwind CSS v4 and [Basecoat](https://basecoatui.com) (the
shadcn/ui design without a framework runtime). `src/pages/app.css` compiles into `src/pages/styles.generated.ts`,
served from `/leaderboard/assets/app.<hash>.css`.

The stylesheet, the icons and the client script (`src/pages/*.generated.ts`) are generated, not kept in git.
`pnpm install`, `dev`, the deploys and the tests generate them; after changing the pages' classes, the icons or
`client/` while `cf dev` runs, regenerate them:

```bash
pnpm --filter @be-music/leaderboard-api run generate
```

`build:css`, `build:icons` and `build:client` run one step each.

### Icons

The pages' icon is `src/pages/icons/icon.svg`: the browser tab shows it as is. The home-screen icon (180 px) and the
web app manifest icons (192 / 512 px) are rendered from it. To change the icon, replace the SVG and rebuild:

```bash
pnpm --filter @be-music/leaderboard-api run build:icons
```

The icons are compiled into `src/pages/icons.generated.ts` and served from
`/leaderboard/assets/<name>.<hash>.<ext>`, next to `/leaderboard/manifest.webmanifest`. A hand-made PNG placed next to
the SVG (`apple-touch-icon.png`, `icon-192.png`, `icon-512.png`) is used instead of its rendered one.

## Tests

`pnpm test` runs this package's tests with the rest of the workspace. The API tests drive the Hono app with real D1
and R2 bindings from Miniflare, so they also check the migrations.
