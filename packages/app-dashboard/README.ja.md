[English version](./README.md)

# @be-music/app-dashboard

非公開の Be-Music サービスダッシュボードと Accounts サービス（ログイン、パスキー、連携プロバイダーを扱う OIDC プロバイダー）です。専用の D1 を持つ 1 つの Cloudflare Worker として動き、ほかのサービスは [`@be-music/service-auth-client`](../service-auth-client/README.ja.md) を通じてここでログインします。

[サービスと環境](../../docs/services.ja.md) と [ADR 0039](../../docs/adr/0039-accounts-in-dashboard.ja.md) を参照してください。

## スクリプト

`pnpm --filter @be-music/app-dashboard run <script>` で実行します。

| スクリプト                                     | 用途                                                 |
| ---------------------------------------------- | ---------------------------------------------------- |
| `deploy` / `deploy:preview`                    | クライアントを build して Worker をデプロイ          |
| `db:migrate:production` / `db:migrate:preview` | D1 のマイグレーションを適用                          |
| `secrets:production` / `secrets:preview`       | Worker のシークレットを登録                          |
| `build:client`                                 | ブラウザ用クライアントを build（`prepare` でも実行） |
