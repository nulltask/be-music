[English](./0039-accounts-in-dashboard.md)

# 0039: Accounts を Dashboard の Worker で Dashboard のホストに置く

ステータス: 承認済み。日付: 2026-11-05。[ADR 0008](./0008-accounts-oidc.ja.md) を補います。

## 背景

Accounts（`accounts.be-music.app`）と Dashboard（`be-music.app`）は別々の Worker でした。Dashboard は Accounts の OIDC クライアントで、ログイン中のユーザーのプロフィールを Service Binding で Accounts から取っていました。ユーザーのホームとアカウントが 2 つのホストに分かれ、セッションも 2 つありました。

## 決定

Accounts を `@be-music/app-dashboard` と `dashboard` / `dashboard-preview` の Worker に移します。Better Auth、OIDC プロバイダー、プロフィール API、アバター、`/login` と `/account` のページは Dashboard のホストで配信します。

- issuer は `https://be-music.app/api/auth`（プレビューは `https://preview.be-music.app/api/auth`）になります。Play・Leaderboard・Donate はこれを `AUTH_ISSUER` に設定します。Leaderboard は Dashboard の Worker への Service Binding でプロフィールを取ります。
- Dashboard は自分自身の OIDC クライアントではなくなります。Better Auth のセッションを直接読み、`/sign-out` でそのセッションを終えます。ホストの `/api/auth/*` はすべて Better Auth が持ちます。
- パスキーの relying party ID は `be-music.app`（`preview.be-music.app`）のままです。変わるのは認証を行うオリジンだけです。
- Discord と Google のリダイレクト先は `https://be-music.app/api/auth/callback/{discord,google}` です。
- `accounts.<site>` のホストはまだ配信しません。そのカスタムドメインは `accounts` の Worker を削除するまでそちらに付いたままです。予定している Dashboard のホストへの恒久的なリダイレクトは、その後で付けられます。
- Accounts の D1 は削除し、`dashboard` / `dashboard-preview` として空で作り直しました。`accounts` / `accounts-preview` の Worker も削除します。オーナーは、既存のアカウント・パスキー・ゲスト・プロフィールを移行せず、すべて失うことを受け入れました。アバターのバケットは `accounts` / `accounts-preview` の名前のままです。

## 結果

すべてのユーザーが新しいアカウントで改めてログインし、ゲストも最初からになります。以前の issuer `https://accounts.<site>/api/auth` で作られた Leaderboard の対応付けはどのアカウントにも一致しないので、それに結び付いたスコアは新しいアカウントからは見えません。ADR 0008 と ADR 0009 の一度きりのユーザー・プロフィール移行スクリプトは削除しました。

`accounts` の Worker は、Dashboard と Leaderboard がそれへの Service Binding を外してデプロイされた後でないと削除できません。そのデプロイまでは、データベースがないため、デプロイ済みのサービスでログインできません。

各サービスはホスト専用のセッションを持つ別々の OIDC クライアントのままなので、セルフホストのインスタンスは `AUTH_ORIGIN` と各クライアントの `AUTH_ISSUER` を設定すれば、Accounts を好きなホストに置けます。
