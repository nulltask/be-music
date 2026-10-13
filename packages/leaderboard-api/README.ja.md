[English version](./README.md)

# @be-music/leaderboard-api

be-music の Leaderboard API です。Cloudflare Workers 上の Hono アプリで、D1 と R2 を使います。設計は
[docs/leaderboard.ja.md](../../docs/leaderboard.ja.md) にあり、この README は動かし方とデプロイ方法を扱います。

## 実装済みのもの

- Better Auth によるログイン: 匿名セッション、passkey、secret が設定されていれば Discord / Google の OAuth。
- `POST /api/v0/scores`: プレイログ（gzip）を送信します。サーバーは対象かどうかの判定と、play / chart fingerprint の
  ドキュメントの確認（検証の層 L1〜L3、`#RANDOM` のない譜面では L4 も）を行い、`lr2`・`beatoraja`・`iidx` で再計算し、
  ログを R2 に保存して自己ベストを更新します。再送された同じプレイはそれと分かり、別のアカウントからの同じプレイは
  拒否します。
- `GET /api/v0/charts/:chartFingerprint/leaderboard` と `.../leaderboard/me`: ランキング。アシスト付きのプレイ、匿名の
  プレイヤー、「このルールセットでプレイしたもの」のフィルタ付き。
- `GET /api/v0/scores/:id` と `.../playlog`。
- `GET /api/v0/openapi.json`: OpenAPI 3.1 のドキュメント。ルートの valibot スキーマ（`src/api/schemas.ts`）から生成します。リファレンスページは `/leaderboard/api` です。コピーを [`openapi.json`](./openapi.json) としてコミットしており、古くなるとテストが失敗します。API を変えたら `vp test run -u` で更新してください。

- `/leaderboard` 以下のページ: 新着スコア（トップ）、スコア、譜面のランキング、プレイヤー。

未実装: 新しい `#RANDOM` の結果に対する L4 と L5、ライバル、OG カード。

## 準備

ワークスペースのパッケージは `dist` からバンドルされるので、先にビルドします。

```bash
pnpm run build
```

リソースは be-music のアカウントに作成済みです（D1 と R2 を APAC に、環境ごとに 1 つずつ）。D1 の id は
`cloudflare.config.ts` とマイグレーションのスクリプトに書いてあります。新しい環境では作成して id を記録します。

```bash
pnpm exec cf d1 create --name be-music-leaderboard-preview --primary-location-hint apac
```

```bash
pnpm exec cf r2 buckets create --name be-music-leaderboard-preview --location-hint apac
```

### Secrets

secrets は 1Password の `my.1password.com` アカウントの `be-music` Vault に、Worker ごとに 1 アイテム（`be-music-leaderboard-preview`、`be-music-leaderboard`）で保存しています。リポジトリには参照だけを置きます。`secrets/<環境>.env.tpl` が各 secret と 1Password のフィールドを対応づけます（`KEY={{ op://… }}`）。[1Password CLI](https://developer.1password.com/docs/cli/) にサインインした状態で、Worker に設定します。

```bash
pnpm --filter @be-music/leaderboard-api run secrets:preview
```

`scripts/put-secrets.ts` は各値を `op read` で読み、`cf workers secrets update` に渡します。ディスクにも画面にも値は出ません。別の 1Password アカウントを使うときは `OP_ACCOUNT` を指定します。secret を入れ替えるときは 1Password で生成し直してスクリプトを再実行します（`BETTER_AUTH_SECRET` を入れ替えると全員のログインが切れます。パスキーは残ります）。

アカウントに触れる操作は Wrangler ではなく `cf` で行います。Wrangler は独自にログイン情報を持っていて、別の Cloudflare アカウントを指していることがあります。

`cloudflare.config.ts` で宣言した secret はデプロイのたびに必須です。新しい Worker の最初のデプロイではファイルで渡す必要があります（`cf deploy --secrets-file`）。名前付きパイプを使えば値をディスクに書かずに済みます。

```bash
d=$(mktemp -d) && mkfifo -m 600 "$d/secrets" && (op inject -i secrets/preview.env.tpl > "$d/secrets" &) && pnpm exec cf deploy --mode preview --secrets-file "$d/secrets"; rm -rf "$d"
```

以降のデプロイでは設定済みの secret が引き継がれます。

| Secret                                       | 用途                                                           |
| -------------------------------------------- | -------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                         | セッションの署名。長いランダムな文字列                         |
| `DISCORD_CLIENT_ID`、`DISCORD_CLIENT_SECRET` | Discord でのログイン（任意。未設定なら無効。追加時に宣言する） |
| `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`   | Google でのログイン（任意。未設定なら無効。追加時に宣言する）  |

## データベース

スキーマは `src/db/schema.ts` にあります。変更したらマイグレーションを生成してコミットします。

```bash
pnpm --filter @be-music/leaderboard-api run db:generate
```

マイグレーションはデプロイより先に実行するので、動いている旧コードと両立させます（追加 → 切り替え → 削除）。

```bash
pnpm --filter @be-music/leaderboard-api run db:migrate:preview
```

## デプロイ

環境は 2 つで、プレイヤーのデモの Workers Builds に合わせています。`devel` が本番、それ以外のブランチが preview です。

| 環境    | Worker                         | D1 / R2                        | プレイヤーのデモ                               |
| ------- | ------------------------------ | ------------------------------ | ---------------------------------------------- |
| 本番    | `be-music-leaderboard`         | `be-music-leaderboard`         | `be-music-player-demo`（`devel` からデプロイ） |
| preview | `be-music-leaderboard-preview` | `be-music-leaderboard-preview` | それ以外のブランチのプレビュー版               |

- preview: `pnpm run build && pnpm --filter @be-music/leaderboard-api run db:migrate:preview && pnpm --filter @be-music/leaderboard-api run deploy:preview`
- 本番: 同じ手順を `db:migrate:production` と `deploy` で

preview の Worker は全ブランチで共有します。最後にデプロイしたブランチが反映されます。

この Worker は公開 URL を持ちません。プレイヤーの Worker が `/api/*` と `/leaderboard/*` を Service Binding で
転送します。

## ページ

`/leaderboard` 以下のページは Hono JSX で、Tailwind CSS v4 と [Basecoat](https://basecoatui.com)（フレームワークの
ランタイムなしの shadcn/ui デザイン）でスタイルを付けています。`src/pages/app.css` は `src/pages/styles.generated.ts`
にコンパイルされ、コミットされたうえで `/leaderboard/assets/app.<hash>.css` から配信されます。ページのクラスを
変えたら作り直します。

```bash
pnpm --filter @be-music/leaderboard-api run build:css
```

### アイコン

ページのアイコンは `src/pages/icons/icon.svg` です。ブラウザのタブにはこれがそのまま表示されます。ホーム画面用（180 px）と Web アプリマニフェスト用（192 / 512 px）のアイコンはこの SVG から描画します。アイコンを変えるときは SVG を差し替えて、作り直します。

```bash
pnpm --filter @be-music/leaderboard-api run build:icons
```

アイコンは `src/pages/icons.generated.ts`（コミット対象）にまとめられ、`/leaderboard/manifest.webmanifest` と並んで `/leaderboard/assets/<名前>.<hash>.<拡張子>` から配信されます。SVG の隣に手描きの PNG（`apple-touch-icon.png`、`icon-192.png`、`icon-512.png`）を置くと、描画したものの代わりにそちらを使います。

## テスト

`pnpm test` で、ワークスペースのほかのテストと一緒にこのパッケージのテストも実行されます。API のテストは Miniflare の
本物の D1 / R2 binding で Hono アプリを動かすので、マイグレーションも確かめます。
