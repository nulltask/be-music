[Japanese version](./README.ja.md)

# @be-music/app-dashboard

The private Be-Music service dashboard and the Accounts service: the OIDC provider for sign-in, passkeys, and linked providers. It runs as one Cloudflare Worker with its own D1, and every other service signs in through it with [`@be-music/service-auth-client`](../service-auth-client/README.md).

See [Services and environments](../../docs/services.md) and [ADR 0039](../../docs/adr/0039-accounts-in-dashboard.md).

## Scripts

Run these with `pnpm --filter @be-music/app-dashboard run <script>`:

| Script                                         | Purpose                                      |
| ---------------------------------------------- | -------------------------------------------- |
| `deploy` / `deploy:preview`                    | Build the client and deploy the Worker       |
| `db:migrate:production` / `db:migrate:preview` | Apply the D1 migrations                      |
| `secrets:production` / `secrets:preview`       | Put the Worker secrets                       |
| `build:client`                                 | Build the browser client (also on `prepare`) |
