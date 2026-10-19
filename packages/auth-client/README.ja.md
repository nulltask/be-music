[English version](./README.md)

# @be-music/auth-client

be-music のアプリで使う、サーバー側の OIDC クライアントです。[サービス構成](../../docs/services.ja.md)と [ADR 0008](../../docs/adr/0008-accounts-oidc.ja.md)を参照してください。

`AUTH_ISSUER`・`PUBLIC_ORIGIN`・`OIDC_CLIENT_ID`・`API_AUDIENCE` と、32 文字以上のランダムな `SESSION_SECRET` を設定します。issuer とオリジンは HTTPS です。Accounts に `PUBLIC_ORIGIN/api/auth/callback` を完全一致で登録します。issuer は `/api/auth` を含みます。

- `handleAuth`: `/api/auth/` 配下のログイン・コールバック・セッション参照・アカウント管理リンク・POST ログアウト。
- `readSession`: ホスト専用セッションを復号し、サーバー専用の識別情報とアクセストークンを返す。
- `verifyAccess`: 設定した issuer・API 向け audience・必要なスコープを持つ bearer トークンを検証する。
- `returnPath`: 戻り先をローカルパスに制限する。

`accessToken` はブラウザのレスポンスに含めません。Cookie 認証の書き込みは同一オリジンの Origin を確認し、サーバー間通信は Bearer を使います。秘密値はアプリごとに分け、本番とプレビューの issuer・秘密値も分けます。

ルートで `pnpm test --project @be-music/auth-client --project @be-music/accounts` を実行すると、境界と実際のプロバイダーを使った異なるドメイン間のログインを確認できます。公開ヘルパーのベンチマークは `pnpm --filter @be-music/auth-client bench` です。
