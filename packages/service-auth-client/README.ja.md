[English version](./README.md)

# @be-music/service-auth-client

be-music のアプリで使う、サーバー側の OIDC クライアントです。[サービス構成](../../docs/services.ja.md)と [ADR 0008](../../docs/adr/0008-accounts-oidc.ja.md)を参照してください。

`AUTH_ISSUER`・`PUBLIC_ORIGIN`・`OIDC_CLIENT_ID`・`API_AUDIENCE` と、32 文字以上のランダムな `SESSION_SECRET` を設定します。issuer とオリジンは HTTPS です。Accounts に `PUBLIC_ORIGIN/api/auth/callback` を完全一致で登録します。issuer は `/api/auth` を含みます。

- `handleAuth`: `/api/auth/` 配下のログイン・コールバック・セッション参照・アカウント管理リンク・POST ログアウトと、ブラウザのページ表示時の自動 SSO。
- `readSession`: ホスト専用セッションを復号し、サーバー専用の識別情報とアクセストークンを返す。
- `verifyAccess`: 設定した issuer・API 向け audience・必要なスコープを持つ bearer トークンを検証する。
- `returnPath`: 戻り先をローカルパスに制限する。

`accessToken` はブラウザのレスポンスに含めません。Cookie 認証の書き込みは同一オリジンの Origin を確認し、サーバー間通信は Bearer を使います。秘密値はアプリごとに分け、本番とプレビューの issuer・秘密値も分けます。

ルートで `pnpm test --project @be-music/service-auth-client --project @be-music/app-accounts` を実行すると、境界と実際のプロバイダーを使った異なるドメイン間のログインを確認できます。公開ヘルパーのベンチマークは `pnpm --filter @be-music/service-auth-client bench` です。

HTML を返す前に `handleAuth` を呼び、Static Assets の設定でもページを Worker に先に通します。アプリのセッションがない場合、ページ表示時に OIDC の `prompt=none` で Accounts を確認します。Accounts にログイン済みなら追加のクリックなしでアプリのセッションを作り、未ログインなら元の公開ページに戻ります。確認に失敗した場合は 60 秒間再確認を控えます。アプリで明示的にログアウトした場合は 1 日間自動ログインを抑止しますが、手動のログインは引き続き使えます。API・アセット・埋め込み・先読みからは自動 SSO を開始しません。トップレベルのリダイレクトを使うため、異なるドメインでもサードパーティ Cookie に依存しません。
